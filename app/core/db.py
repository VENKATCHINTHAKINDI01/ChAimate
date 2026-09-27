"""Storage: menu, tables, orders (routed by station), staff, customers and their AI memories.

Two interchangeable backends behind the same `db()` context manager:
  * SQLite (default) — a local file, zero setup, great for development and tests.
  * PostgreSQL / Supabase — used when DATABASE_URL is set. Queries are written once in SQLite style (`?`
    placeholders, `cur.lastrowid`, `row[0]` / `row["col"]`); the thin adapter below translates them.
"""
import json
import logging
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Sequence

from app.core.config import DATABASE_URL, DB_PATH, DB_SCHEMA

IS_PG = bool(DATABASE_URL)

log = logging.getLogger("db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT DEFAULT '',
    veg INTEGER DEFAULT 1,
    spicy INTEGER DEFAULT 0,
    available INTEGER DEFAULT 1,
    station TEXT DEFAULT 'kitchen'      -- kitchen | bar : where the item is prepared
);
CREATE TABLE IF NOT EXISTS cafe_tables (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    seats INTEGER DEFAULT 4,
    status TEXT DEFAULT 'free'          -- free | occupied | bill_requested
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    customer_id INTEGER,
    customer_name TEXT DEFAULT '',
    status TEXT DEFAULT 'new',          -- new | preparing | ready | served | paid | cancelled
    notes TEXT DEFAULT '',
    total REAL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    notes TEXT DEFAULT '',
    station TEXT DEFAULT 'kitchen',
    status TEXT DEFAULT 'queued'        -- queued | preparing | ready
);
CREATE TABLE IF NOT EXISTS staff_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    kind TEXT NOT NULL,                 -- waiter | bill | help
    message TEXT DEFAULT '',
    resolved INTEGER DEFAULT 0,
    created_at REAL NOT NULL,
    resolved_at REAL
);
CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,                 -- manager | kitchen | bar | waiter
    pin_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    prefs TEXT DEFAULT '{}',
    visits INTEGER DEFAULT 0,
    created_at REAL NOT NULL,
    last_seen REAL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    kind TEXT NOT NULL,                 -- customer | staff
    user_id INTEGER NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    fact TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    table_id INTEGER,
    started_at REAL NOT NULL,
    ended_at REAL,
    summary TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    role TEXT NOT NULL,                 -- user | assistant
    text TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    visit TEXT NOT NULL,
    customer_ids TEXT DEFAULT '',
    minutes INTEGER DEFAULT 0,
    billable_minutes INTEGER DEFAULT 0,
    amount REAL DEFAULT 0,
    turns INTEGER DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    llm_cost_usd REAL DEFAULT 0,
    stt_seconds REAL DEFAULT 0,
    tts_chars INTEGER DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    station TEXT NOT NULL,              -- kitchen | bar | order
    status TEXT NOT NULL,
    ts REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    details TEXT DEFAULT '',
    item_ids TEXT DEFAULT '',           -- comma-separated menu item ids the AI companion should feature
    active INTEGER DEFAULT 1,
    created_at REAL NOT NULL,
    ends_at REAL
);
CREATE TABLE IF NOT EXISTS agent_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                 -- price_change | availability | new_item | promotion
    payload TEXT NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',      -- pending | applied | dismissed
    created_at REAL NOT NULL,
    decided_at REAL,
    decided_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS agent_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    content TEXT NOT NULL,              -- JSON list of recommendations
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL,            -- shown to the guest, e.g. DH-7Q4K
    day TEXT NOT NULL,                  -- YYYY-MM-DD (café local time)
    slot TEXT NOT NULL,                 -- HH:MM
    guests INTEGER NOT NULL,
    seating TEXT DEFAULT 'main',
    occasion TEXT DEFAULT '',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'confirmed',    -- confirmed | seated | cancelled | no_show
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS event_enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL, day TEXT NOT NULL, guests INTEGER NOT NULL,
    name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, details TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS newsletter (
    email TEXT PRIMARY KEY,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resv_day ON reservations(day, slot);
CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,               -- one-off data upgrades that have run (e.g. menu_catalog = 2)
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_msgs_customer ON chat_messages(customer_id, id);
CREATE INDEX IF NOT EXISTS idx_mem_customer ON memories(customer_id);
"""

BAR_CATEGORIES = {"Hot Drinks", "Cold Drinks", "Beverages", "Drinks"}

SEED_MENU = [
    # name, category, price, description, veg, spicy
    ("Masala Chai", "Hot Drinks", 60, "Strong Assam tea brewed with ginger, cardamom and milk", 1, 0),
    ("Irani Chai", "Hot Drinks", 50, "Hyderabadi slow-cooked creamy tea", 1, 0),
    ("Filter Coffee", "Hot Drinks", 80, "South Indian decoction coffee with frothy milk", 1, 0),
    ("Cappuccino", "Hot Drinks", 150, "Double espresso with steamed milk foam", 1, 0),
    ("Hot Chocolate", "Hot Drinks", 170, "Rich Belgian chocolate with milk", 1, 0),
    ("Cold Coffee", "Cold Drinks", 160, "Blended coffee with ice cream", 1, 0),
    ("Mango Lassi", "Cold Drinks", 120, "Alphonso mango with fresh curd", 1, 0),
    ("Fresh Lime Soda", "Cold Drinks", 90, "Sweet, salted or mixed", 1, 0),
    ("Osmania Biscuits (4 pcs)", "Snacks", 60, "Classic Hyderabadi sweet-salty biscuits", 1, 0),
    ("Samosa (2 pcs)", "Snacks", 70, "Crispy pastry with spiced potato, with chutneys", 1, 1),
    ("Vada Pav", "Snacks", 80, "Mumbai-style potato fritter in a soft bun", 1, 1),
    ("Paneer Tikka Sandwich", "Snacks", 180, "Grilled sandwich with tandoori paneer", 1, 1),
    ("Chicken Keema Puff", "Snacks", 90, "Flaky puff pastry with spiced chicken mince", 0, 1),
    ("Masala Maggi", "Meals", 130, "Everyone's comfort noodles with veggies and masala", 1, 1),
    ("Chicken Biryani", "Meals", 280, "Hyderabadi dum biryani with raita and salan", 0, 1),
    ("Veg Pulao Bowl", "Meals", 200, "Fragrant basmati with vegetables and raita", 1, 0),
    ("Gulab Jamun (2 pcs)", "Desserts", 90, "Warm, soaked in rose-cardamom syrup", 1, 0),
    ("Double Ka Meetha", "Desserts", 140, "Hyderabadi bread pudding with dry fruits", 1, 0),
    ("Brownie with Ice Cream", "Desserts", 190, "Warm chocolate brownie, vanilla scoop", 1, 0),

    # ---- menu catalogue v2: a full Hyderabadi café menu (added to existing databases once, see _seed) ----
    ("Ginger Chai", "Hot Drinks", 60, "Kadak tea with lots of fresh ginger", 1, 0),
    ("Elaichi Chai", "Hot Drinks", 60, "Milky tea perfumed with green cardamom", 1, 0),
    ("Lemon Tea", "Hot Drinks", 50, "Light black tea with lemon and a pinch of honey", 1, 0),
    ("Green Tea", "Hot Drinks", 90, "Whole-leaf green tea, no milk", 1, 0),
    ("Kashmiri Kahwa", "Hot Drinks", 120, "Saffron, cinnamon and almond green tea", 1, 0),
    ("Hot Badam Milk", "Hot Drinks", 110, "Warm milk with almonds, saffron and cardamom", 1, 0),
    ("Sweet Lassi", "Cold Drinks", 90, "Thick chilled curd, lightly sweetened", 1, 0),
    ("Buttermilk (Chaas)", "Cold Drinks", 60, "Spiced with curry leaves, ginger and green chilli", 1, 0),
    ("Rose Milk", "Cold Drinks", 110, "Chilled milk with rose syrup and basil seeds", 1, 0),
    ("Lemon Iced Tea", "Cold Drinks", 120, "Brewed tea over ice with lemon and mint", 1, 0),
    ("Watermelon Juice", "Cold Drinks", 110, "Fresh-pressed, no added sugar", 1, 0),
    ("Oreo Shake", "Cold Drinks", 170, "Vanilla ice cream blended with Oreo cookies", 1, 0),
    ("Royal Falooda", "Cold Drinks", 180, "Rose milk, vermicelli, basil seeds and kulfi", 1, 0),
    ("Idli Sambar (3 pcs)", "Breakfast", 90, "Steamed rice cakes with sambar and coconut chutney", 1, 0),
    ("Masala Dosa", "Breakfast", 130, "Crisp dosa with spiced potato, sambar and chutneys", 1, 1),
    ("Onion Uttapam", "Breakfast", 140, "Thick rice pancake topped with onion and chilli", 1, 1),
    ("Upma", "Breakfast", 90, "Semolina cooked with vegetables, curry leaves and cashews", 1, 0),
    ("Poha", "Breakfast", 90, "Flattened rice with peanuts, onion and lemon", 1, 0),
    ("Aloo Paratha", "Breakfast", 140, "Stuffed flatbread with curd, butter and pickle", 1, 1),
    ("Bun Maska", "Breakfast", 60, "Soft Irani bun with a thick slab of butter", 1, 0),
    ("Bread Omelette", "Breakfast", 110, "Masala omelette in toasted bread", 0, 1),
    ("Lukhmi (2 pcs)", "Snacks", 110, "Hyderabadi square pastry with spiced mutton mince", 0, 1),
    ("Mirchi Bajji", "Snacks", 80, "Stuffed green chillies fried in gram flour batter", 1, 1),
    ("Punugulu", "Snacks", 80, "Crispy Andhra batter fritters with peanut chutney", 1, 1),
    ("Veg Puff", "Snacks", 50, "Flaky pastry with spiced vegetables", 1, 1),
    ("Egg Puff", "Snacks", 60, "Flaky pastry with masala egg", 0, 1),
    ("Pav Bhaji", "Snacks", 150, "Buttery mashed vegetable curry with toasted pav", 1, 1),
    ("Chicken 65", "Snacks", 220, "Hyderabad's fiery fried chicken with curry leaves", 0, 1),
    ("French Fries", "Snacks", 120, "Salted or peri-peri", 1, 0),
    ("Mutton Biryani", "Meals", 380, "Hyderabadi kacchi dum biryani with raita and salan", 0, 1),
    ("Veg Biryani", "Meals", 240, "Dum-cooked vegetables and basmati with raita", 1, 1),
    ("Chicken Haleem", "Meals", 260, "Slow-cooked wheat, lentils and chicken, with fried onions", 0, 1),
    ("Paneer Butter Masala with 2 Rotis", "Meals", 260, "Paneer in a rich tomato-butter gravy", 1, 0),
    ("Butter Chicken with Naan", "Meals", 320, "Tandoori chicken in creamy makhani gravy", 0, 0),
    ("Dal Tadka with Jeera Rice", "Meals", 200, "Yellow dal tempered with garlic and cumin", 1, 1),
    ("Veg Hakka Noodles", "Meals", 180, "Wok-tossed noodles with crunchy vegetables", 1, 1),
    ("Curd Rice", "Meals", 120, "Cool yoghurt rice tempered with mustard and curry leaves", 1, 0),
    ("Qubani Ka Meetha", "Desserts", 160, "Hyderabadi stewed apricots with cream", 1, 0),
    ("Malai Kulfi", "Desserts", 90, "Slow-reduced milk ice cream with pistachio", 1, 0),
    ("Rasmalai (2 pcs)", "Desserts", 120, "Soft cheese dumplings in saffron milk", 1, 0),
    ("Chocolate Lava Cake", "Desserts", 180, "Warm cake with a molten chocolate centre", 1, 0),
    ("Gajar Halwa", "Desserts", 120, "Slow-cooked carrot pudding with ghee and nuts", 1, 0),

    # ---- menu catalogue v3: Hyderabad icons and what Gen Z orders ----
    ("Sulaimani Chai", "Hot Drinks", 50, "Light black tea with lemon and spices, Hyderabadi-Arab style", 1, 0),
    ("Pink Chai (Noon Chai)", "Hot Drinks", 90, "Kashmiri salted pink tea with pistachio and almonds", 1, 0),
    ("Brown Sugar Boba Tea", "Cold Drinks", 220, "Milk tea with chewy tapioca pearls and brown sugar syrup", 1, 0),
    ("Taro Bubble Tea", "Cold Drinks", 220, "Creamy purple taro milk tea with boba", 1, 0),
    ("Cold Brew Coffee", "Cold Drinks", 180, "Coffee steeped cold for 16 hours, served over ice", 1, 0),
    ("Iced Matcha Latte", "Cold Drinks", 230, "Japanese matcha whisked into cold milk", 1, 0),
    ("Hazelnut Frappe", "Cold Drinks", 210, "Blended iced coffee with hazelnut and cream", 1, 0),
    ("Biscoff Shake", "Cold Drinks", 220, "Thick shake with caramelised Biscoff cookies", 1, 0),
    ("Virgin Mojito", "Cold Drinks", 150, "Lime, mint and soda over crushed ice", 1, 0),
    ("Blue Lagoon Mocktail", "Cold Drinks", 150, "Blue curaçao syrup, lemonade and soda", 1, 0),
    ("Chicken Mandi", "Hyderabadi Specials", 420, "Arabian-style smoked rice with tender chicken — a Hyderabad favourite", 0, 0),
    ("Pathar Ka Gosht", "Hyderabadi Specials", 360, "Mutton slices seared on a hot stone, Nizami style", 0, 1),
    ("Nihari with Kulcha", "Hyderabadi Specials", 280, "Old-city slow-cooked mutton stew with soft kulcha", 0, 1),
    ("Mutton Marag", "Hyderabadi Specials", 220, "Peppery Hyderabadi mutton soup", 0, 1),
    ("Apollo Fish", "Hyderabadi Specials", 300, "Spicy fried fish tossed with curry leaves and chillies", 0, 1),
    ("Chicken Majestic", "Hyderabadi Specials", 260, "Crispy chicken strips in yoghurt, green chilli and curry leaves", 0, 1),
    ("Bagara Baingan with Bagara Rice", "Hyderabadi Specials", 220, "Baby aubergines in peanut-sesame gravy with spiced rice", 1, 1),
    ("Chicken Shawarma", "Hyderabadi Specials", 150, "Street-style roll with garlic toum and pickles", 0, 0),
    ("Korean Cheese Corn Dog", "Trending Now", 160, "Crispy coated mozzarella on a stick, sugar and sauces", 1, 0),
    ("Chicken Momos (8 pcs)", "Trending Now", 160, "Steamed dumplings with fiery red chutney", 0, 1),
    ("Tandoori Momos (8 pcs)", "Trending Now", 180, "Momos roasted in tandoori masala", 1, 1),
    ("Loaded Cheese Fries", "Trending Now", 180, "Fries with cheese sauce, jalapeños and peri-peri", 1, 1),
    ("Nachos with Cheese & Salsa", "Trending Now", 200, "Corn chips, molten cheese, salsa and sour cream", 1, 1),
    ("Spicy Korean Ramen", "Trending Now", 240, "Fire noodles with egg, spring onion and sesame", 0, 1),
    ("Cheese Garlic Bread", "Trending Now", 150, "Toasted baguette with garlic butter and mozzarella", 1, 0),
    ("Chocolate Waffle", "Trending Now", 190, "Belgian waffle with melted chocolate and ice cream", 1, 0),
    ("Biscoff Cheesecake", "Desserts", 220, "Baked cheesecake with a Biscoff crumb and caramel spread", 1, 0),
    ("Sheer Khurma", "Desserts", 140, "Vermicelli simmered in milk with dates and nuts", 1, 0),
]
MENU_CATALOG_VERSION = 3   # bump when SEED_MENU gains dishes that existing cafés should receive once


def default_station(category: str) -> str:
    return "bar" if category in BAR_CATEGORIES else "kitchen"


# ---------------------------------------------------------------------------
# PostgreSQL adapter (Supabase)
# ---------------------------------------------------------------------------

# tables whose id is generated by the database (so an INSERT can return it as lastrowid)
_ID_TABLES = {"menu_items", "orders", "order_items", "staff_requests", "staff_users", "customers", "memories",
              "conversations", "chat_messages", "ai_usage", "order_events", "promotions", "agent_actions",
              "agent_insights", "reservations", "event_enquiries"}
_INSERT_RE = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.I)
# tables whose changes are streamed by Supabase Realtime to the staff app
REALTIME_TABLES = ("orders", "order_items", "staff_requests", "menu_items", "cafe_tables", "reservations")


def _pg_schema_sql() -> List[str]:
    """The SQLite schema translated to Postgres, split into statements."""
    ddl = SCHEMA.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
    ddl = re.sub(r"\bREAL\b", "DOUBLE PRECISION", ddl)
    ddl = re.sub(r"--[^\n]*", "", ddl)
    return [stmt.strip() for stmt in ddl.split(";") if stmt.strip()]


class Row(dict):
    """dict row that also supports positional access (row[0]) like sqlite3.Row."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class _PgCursor:
    def __init__(self, cur, want_id: bool):
        self._cur = cur
        self.lastrowid: Optional[int] = None
        if want_id:
            r = cur.fetchone()
            self.lastrowid = r["id"] if r else None

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def fetchone(self) -> Optional[Row]:
        r = self._cur.fetchone()
        return Row(r) if r is not None else None

    def fetchall(self) -> List[Row]:
        return [Row(r) for r in self._cur.fetchall()]

    def __iter__(self) -> Iterator[Row]:
        for r in self._cur:
            yield Row(r)


class _PgConn:
    """Makes a psycopg connection accept the SQLite-style SQL used throughout the app."""

    def __init__(self, raw):
        self._raw = raw

    @staticmethod
    def _sql(sql: str) -> str:
        return sql.replace("?", "%s")

    def execute(self, sql: str, params: Sequence[Any] = ()) -> _PgCursor:
        q = self._sql(sql)
        m = _INSERT_RE.match(q)
        want_id = bool(m and m.group(1).lower() in _ID_TABLES and "returning" not in q.lower())
        if want_id:
            q += " RETURNING id"
        return _PgCursor(self._raw.execute(q, tuple(params)), want_id)

    def executemany(self, sql: str, seq: Sequence[Sequence[Any]]) -> None:
        with self._raw.cursor() as cur:
            cur.executemany(self._sql(sql), [tuple(x) for x in seq])


_pool = None
_pool_lock = threading.Lock()


def _pg_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                import psycopg
                from psycopg.rows import dict_row
                from psycopg.types.numeric import FloatLoader
                from psycopg_pool import ConnectionPool

                def configure(conn) -> None:
                    conn.adapters.register_loader("numeric", FloatLoader)   # SUM/AVG as float, not Decimal
                    conn.execute(f"SET search_path TO {DB_SCHEMA}, public")

                _pool = ConnectionPool(
                    # 6 warm connections: each new one costs ~1 s to a remote region, and the analytics board
                    # opens several at once
                    DATABASE_URL, min_size=6, max_size=12, timeout=15, max_idle=900, configure=configure, open=True,
                    # prepare_threshold=None: no server-side prepared statements (required behind Supabase's pooler)
                    # autocommit: a single read/write is ONE network round trip. Multi-statement writes use
                    # db(atomic=True), which wraps them in a real transaction.
                    kwargs={"row_factory": dict_row, "prepare_threshold": None, "connect_timeout": 10,
                            "autocommit": True},
                )
                host = re.sub(r"^.*@", "", DATABASE_URL).split("/")[0]
                log.info("connected to PostgreSQL at %s (schema %s)", host, DB_SCHEMA)
                del psycopg
    return _pool


def close() -> None:
    """Close the Postgres pool on shutdown (no-op for SQLite)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def backend() -> str:
    if IS_PG:
        return "postgres:" + re.sub(r"^.*@", "", DATABASE_URL).split("/")[0]
    return f"sqlite:{DB_PATH}"


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _connect() -> sqlite3.Connection:
    try:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    except sqlite3.Error:
        log.critical("cannot open database at %s", DB_PATH, exc_info=True)
        raise
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")   # wait for a concurrent writer instead of failing "database is locked"
    return conn


@contextmanager
def db(atomic: bool = False):
    """A database session.
    SQLite: always one transaction (commit on success, rollback on error) — it's a local file, so it's free.
    Postgres: each statement commits on its own (one network round trip) unless atomic=True, which makes the
    whole block one all-or-nothing transaction. Use atomic=True for any function that writes more than once."""
    if IS_PG:
        import psycopg
        try:
            with _pg_pool().connection() as raw:
                if atomic:
                    with raw.transaction():
                        yield _PgConn(raw)
                else:
                    yield _PgConn(raw)
        except psycopg.Error:
            log.exception("database error — transaction rolled back")
            raise
        return
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        log.exception("database error — transaction rolled back")
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _add_column(conn, table: str, col: str, decl: str) -> bool:
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    if col not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
        return True
    return False


def _init_pg(conn) -> None:
    """Create the schema in Postgres/Supabase: private schema, tables, row-level security, realtime feed."""
    raw = conn._raw
    raw.execute(f"CREATE SCHEMA IF NOT EXISTS {DB_SCHEMA}")
    raw.execute(f"SET search_path TO {DB_SCHEMA}, public")
    for stmt in _pg_schema_sql():
        raw.execute(stmt)
    # columns added after the first release (no-ops on a fresh database)
    for table, col, decl in (("menu_items", "station", "TEXT DEFAULT 'kitchen'"), ("orders", "customer_id", "INTEGER"),
                             ("order_items", "station", "TEXT DEFAULT 'kitchen'"),
                             ("order_items", "status", "TEXT DEFAULT 'queued'"),
                             ("staff_requests", "resolved_at", "DOUBLE PRECISION")):
        raw.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {decl}")
    roles = {r["rolname"] for r in raw.execute(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')").fetchall()}
    tables = [r["tablename"] for r in raw.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname = %s", (DB_SCHEMA,)).fetchall()]
    # Row-level security with no policies: Supabase's public API keys can't read or write anything.
    # The app itself connects as the table owner, which RLS doesn't restrict.
    for t in tables:
        raw.execute(f"ALTER TABLE {DB_SCHEMA}.{t} ENABLE ROW LEVEL SECURITY")
    if {"anon", "authenticated"} <= roles:
        raw.execute(f"REVOKE ALL ON SCHEMA {DB_SCHEMA} FROM anon, authenticated")
        raw.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA {DB_SCHEMA} FROM anon, authenticated")
    if "service_role" in roles:   # the server-side realtime listener authenticates as service_role
        raw.execute(f"GRANT USAGE ON SCHEMA {DB_SCHEMA} TO service_role")
        raw.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {DB_SCHEMA} TO service_role")
    has_pub = raw.execute("SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'").fetchone()
    if has_pub:
        published = {r["tablename"] for r in raw.execute(
            "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = %s",
            (DB_SCHEMA,)).fetchall()}
        for t in REALTIME_TABLES:
            if t not in published:
                raw.execute(f"ALTER PUBLICATION supabase_realtime ADD TABLE {DB_SCHEMA}.{t}")
                log.info("realtime enabled for %s.%s", DB_SCHEMA, t)
    else:
        log.info("no supabase_realtime publication (plain Postgres) — live DB change feed disabled")


def init_db(num_tables: int = 10, seed_staff: Optional[List[Dict[str, str]]] = None) -> None:
    with db(atomic=True) as conn:
        if IS_PG:
            _init_pg(conn)
        else:
            _init_sqlite(conn)
        _seed(conn, num_tables, seed_staff)


def _init_sqlite(conn) -> None:
    conn.executescript(SCHEMA)
    # upgrade databases created by earlier versions
    if _add_column(conn, "menu_items", "station", "TEXT DEFAULT 'kitchen'"):
        for m in conn.execute("SELECT id, category FROM menu_items").fetchall():
            conn.execute("UPDATE menu_items SET station = ? WHERE id = ?", (default_station(m["category"]), m["id"]))
    _add_column(conn, "orders", "customer_id", "INTEGER")
    if _add_column(conn, "order_items", "station", "TEXT DEFAULT 'kitchen'"):
        conn.execute("UPDATE order_items SET station = (SELECT station FROM menu_items m "
                     "WHERE m.id = order_items.menu_item_id) WHERE menu_item_id IN (SELECT id FROM menu_items)")
    _add_column(conn, "order_items", "status", "TEXT DEFAULT 'queued'")
    _add_column(conn, "staff_requests", "resolved_at", "REAL")


def _seed(conn, num_tables: int, seed_staff: Optional[List[Dict[str, str]]]) -> None:
    insert_menu = "INSERT INTO menu_items (name, category, price, description, veg, spicy, station) VALUES (?,?,?,?,?,?,?)"
    done = conn.execute("SELECT value FROM app_meta WHERE key = 'menu_catalog'").fetchone()
    if conn.execute("SELECT COUNT(*) FROM menu_items").fetchone()[0] == 0:
        conn.executemany(insert_menu, [(*m, default_station(m[1])) for m in SEED_MENU])
    elif not done or int(done[0]) < MENU_CATALOG_VERSION:
        # an existing café: add the new catalogue dishes once, skipping any it already has (by name). Runs once per
        # catalogue version, so dishes the manager deletes later are not brought back.
        have = {r[0].strip().lower() for r in conn.execute("SELECT name FROM menu_items").fetchall()}
        new = [m for m in SEED_MENU if m[0].lower() not in have]
        if new:
            conn.executemany(insert_menu, [(*m, default_station(m[1])) for m in new])
            log.info("menu catalogue v%s: added %d new dishes", MENU_CATALOG_VERSION, len(new))
    if not done or int(done[0]) < MENU_CATALOG_VERSION:
        conn.execute("INSERT INTO app_meta (key, value) VALUES ('menu_catalog', ?) "
                     "ON CONFLICT (key) DO UPDATE SET value = excluded.value", (str(MENU_CATALOG_VERSION),))
    if conn.execute("SELECT COUNT(*) FROM cafe_tables").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO cafe_tables (id, label, seats) VALUES (?,?,?)",
            [(i, f"Table {i}", 4) for i in range(1, num_tables + 1)],
        )
    if seed_staff and conn.execute("SELECT COUNT(*) FROM staff_users").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO staff_users (username, name, role, pin_hash) VALUES (?,?,?,?)",
            [(s["username"], s["name"], s["role"], s["pin_hash"]) for s in seed_staff],
        )


def rows(cur) -> List[Dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]


def one(conn, q: str, args=()) -> Optional[Dict[str, Any]]:
    r = conn.execute(q, args).fetchone()
    return dict(r) if r else None


# ---------- menu ----------

def list_menu(only_available: bool = False) -> List[Dict[str, Any]]:
    q = "SELECT * FROM menu_items"
    if only_available:
        q += " WHERE available = 1"
    q += " ORDER BY category, name"
    with db() as conn:
        return rows(conn.execute(q))


def bestseller_ids(days: int = 30, limit: int = 3) -> List[int]:
    """Most-ordered menu items over the last `days` (cancelled orders don't count)."""
    since = time.time() - days * 86400
    with db() as conn:
        rs = rows(conn.execute(
            "SELECT oi.menu_item_id AS id, SUM(oi.qty) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id "
            "WHERE o.created_at > ? AND o.status != 'cancelled' GROUP BY oi.menu_item_id ORDER BY n DESC LIMIT ?",
            (since, limit)))
    return [int(r["id"]) for r in rs]


def get_menu_item(item_id: int) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return one(conn, "SELECT * FROM menu_items WHERE id = ?", (item_id,))


def upsert_menu_item(data: Dict[str, Any], item_id: Optional[int] = None) -> Dict[str, Any]:
    fields = ["name", "category", "price", "description", "veg", "spicy", "available", "station"]
    with db() as conn:
        if item_id is None:
            defaults = {"description": "", "veg": 1, "spicy": 0, "available": 1,
                        "station": default_station(data.get("category", ""))}
            vals = [data.get(f) if data.get(f) is not None else defaults.get(f) for f in fields]
            cur = conn.execute(
                f"INSERT INTO menu_items ({','.join(fields)}) VALUES ({','.join('?' * len(fields))})", vals
            )
            item_id = cur.lastrowid
        else:
            updates = {f: data[f] for f in fields if f in data}
            if updates:
                sets = ", ".join(f"{k} = ?" for k in updates)
                conn.execute(f"UPDATE menu_items SET {sets} WHERE id = ?", [*updates.values(), item_id])
    return get_menu_item(item_id)


def delete_menu_item(item_id: int) -> None:
    with db() as conn:
        conn.execute("DELETE FROM menu_items WHERE id = ?", (item_id,))


# ---------- tables ----------

def list_tables() -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute("SELECT * FROM cafe_tables ORDER BY id"))


def get_table(table_id: int) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return one(conn, "SELECT * FROM cafe_tables WHERE id = ?", (table_id,))


# ---------- orders (split by station) ----------

def create_order(table_id: int, customer_name: str, items: List[Dict[str, Any]], notes: str = "",
                 customer_id: Optional[int] = None) -> Dict[str, Any]:
    """items: [{menu_item_id, qty, notes}] — prices and stations always come from the DB, never from the caller."""
    now = time.time()
    with db(atomic=True) as conn:
        resolved = []
        for it in items:
            m = conn.execute(
                "SELECT * FROM menu_items WHERE id = ? AND available = 1", (int(it["menu_item_id"]),)
            ).fetchone()
            if not m:
                raise ValueError(f"Menu item {it['menu_item_id']} is not available")
            qty = max(1, min(int(it.get("qty", 1)), 20))
            resolved.append((m["id"], m["name"], qty, m["price"], it.get("notes", "") or "", m["station"] or "kitchen"))
        if not resolved:
            raise ValueError("Order has no items")
        total = sum(q * p for _, _, q, p, _, _ in resolved)
        cur = conn.execute(
            "INSERT INTO orders (table_id, customer_id, customer_name, notes, total, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (table_id, customer_id, customer_name, notes, total, now, now),
        )
        order_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO order_items (order_id, menu_item_id, name, qty, unit_price, notes, station) VALUES (?,?,?,?,?,?,?)",
            [(order_id, mid, name, q, p, n, st) for mid, name, q, p, n, st in resolved],
        )
        _event(conn, order_id, "order", "new", now)
        conn.execute("UPDATE cafe_tables SET status = 'occupied' WHERE id = ? AND status = 'free'", (table_id,))
    return get_order(order_id)


def _event(conn, order_id: int, station: str, status: str, ts: Optional[float] = None) -> None:
    """Timestamped status changes — the source for prep-time and service-time analytics."""
    conn.execute("INSERT INTO order_events (order_id, station, status, ts) VALUES (?,?,?,?)",
                 (order_id, station, status, ts or time.time()))


def get_order(order_id: int) -> Optional[Dict[str, Any]]:
    with db() as conn:
        order = one(conn, "SELECT * FROM orders WHERE id = ?", (order_id,))
        if not order:
            return None
        order["items"] = rows(conn.execute("SELECT * FROM order_items WHERE order_id = ? ORDER BY station, id", (order_id,)))
        stations: Dict[str, str] = {}
        for i in order["items"]:
            prev = stations.get(i["station"])
            # a station is 'ready' only when all its items are ready
            rank = {"queued": 0, "preparing": 1, "ready": 2}
            stations[i["station"]] = i["status"] if prev is None or rank[i["status"]] < rank[prev] else prev
        order["stations"] = stations
        return order


def list_orders(table_id: Optional[int] = None, active_only: bool = False,
                customer_id: Optional[int] = None, limit: int = 200) -> List[Dict[str, Any]]:
    q = "SELECT id FROM orders WHERE 1=1"
    args: List[Any] = []
    if table_id is not None:
        q += " AND table_id = ?"
        args.append(table_id)
    if customer_id is not None:
        q += " AND customer_id = ?"
        args.append(customer_id)
    if active_only:
        q += " AND status NOT IN ('paid', 'cancelled')"
    q += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with db() as conn:
        ids = [r["id"] for r in conn.execute(q, args).fetchall()]
    return [get_order(i) for i in ids]


def update_order_status(order_id: int, status: str) -> Optional[Dict[str, Any]]:
    with db(atomic=True) as conn:
        conn.execute("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", (status, time.time(), order_id))
        _event(conn, order_id, "order", status)
        if status in ("served", "paid"):
            conn.execute("UPDATE order_items SET status = 'ready' WHERE order_id = ?", (order_id,))
    return get_order(order_id)


def update_station_status(order_id: int, station: str, status: str) -> Optional[Dict[str, Any]]:
    """Kitchen/bar move their part of an order; the overall order status follows automatically."""
    with db(atomic=True) as conn:
        o = one(conn, "SELECT status FROM orders WHERE id = ?", (order_id,))
        if not o or o["status"] in ("served", "paid", "cancelled"):
            return get_order(order_id) if o else None
        conn.execute("UPDATE order_items SET status = ? WHERE order_id = ? AND station = ?", (status, order_id, station))
        _event(conn, order_id, station, status)
        statuses = [r["status"] for r in conn.execute("SELECT status FROM order_items WHERE order_id = ?", (order_id,))]
        if all(s == "ready" for s in statuses):
            new = "ready"
        elif any(s != "queued" for s in statuses):
            new = "preparing"
        else:
            new = "new"
        if new != o["status"]:
            _event(conn, order_id, "order", new)
        conn.execute("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", (new, time.time(), order_id))
    return get_order(order_id)


def table_bill(table_id: int) -> Dict[str, Any]:
    orders = list_orders(table_id=table_id, active_only=True)
    return {"table_id": table_id, "orders": orders, "total": round(sum(o["total"] for o in orders), 2)}


def settle_table(table_id: int) -> None:
    now = time.time()
    with db(atomic=True) as conn:
        for r in conn.execute("SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('paid','cancelled')",
                              (table_id,)).fetchall():
            _event(conn, r["id"], "order", "paid", now)
        conn.execute(
            "UPDATE orders SET status = 'paid', updated_at = ? WHERE table_id = ? AND status NOT IN ('paid','cancelled')",
            (now, table_id),
        )
        conn.execute("UPDATE cafe_tables SET status = 'free' WHERE id = ?", (table_id,))
        conn.execute("UPDATE staff_requests SET resolved = 1, resolved_at = ? WHERE table_id = ? AND resolved = 0",
                     (now, table_id))


# ---------- staff requests ----------

# ---------------------------------------------------------------------------
# Reservations, private-event enquiries, newsletter (the Deccan House website)
# ---------------------------------------------------------------------------

def covers_booked(day: str) -> Dict[str, int]:
    """Guests already booked per time slot on a day (cancelled bookings excluded)."""
    with db() as conn:
        rs = rows(conn.execute("SELECT slot, SUM(guests) AS n FROM reservations WHERE day = ? AND status != 'cancelled' GROUP BY slot", (day,)))
    return {r["slot"]: int(r["n"]) for r in rs}


def create_reservation(data: Dict[str, Any], capacity: int) -> Optional[Dict[str, Any]]:
    """Books a table if the slot (and the half hour either side) still has room; None when full."""
    with db(atomic=True) as conn:
        booked = conn.execute("SELECT COALESCE(SUM(guests), 0) FROM reservations WHERE day = ? AND slot = ? AND status != 'cancelled'",
                              (data["day"], data["slot"])).fetchone()[0]
        if int(booked) + int(data["guests"]) > capacity:
            return None
        cur = conn.execute(
            "INSERT INTO reservations (reference, day, slot, guests, seating, occasion, name, phone, email, notes, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (data["reference"], data["day"], data["slot"], data["guests"], data["seating"], data["occasion"], data["name"],
             data["phone"], data["email"], data["notes"], time.time()))
        return one(conn, "SELECT * FROM reservations WHERE id = ?", (cur.lastrowid,))


def list_reservations(day_from: str, day_to: str) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute("SELECT * FROM reservations WHERE day >= ? AND day <= ? ORDER BY day, slot", (day_from, day_to)))


def set_reservation_status(res_id: int, status: str) -> Optional[Dict[str, Any]]:
    with db() as conn:
        conn.execute("UPDATE reservations SET status = ? WHERE id = ?", (status, res_id))
        return one(conn, "SELECT * FROM reservations WHERE id = ?", (res_id,))


def create_event_enquiry(data: Dict[str, Any]) -> Dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO event_enquiries (kind, day, guests, name, phone, email, details, created_at) VALUES (?,?,?,?,?,?,?,?)",
                           (data["kind"], data["day"], data["guests"], data["name"], data["phone"], data["email"], data["details"], time.time()))
        return one(conn, "SELECT * FROM event_enquiries WHERE id = ?", (cur.lastrowid,))


def list_event_enquiries(limit: int = 50) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute("SELECT * FROM event_enquiries ORDER BY created_at DESC LIMIT ?", (limit,)))


def add_newsletter(email: str) -> bool:
    """True if newly added, False if the address was already subscribed."""
    with db() as conn:
        if conn.execute("SELECT 1 FROM newsletter WHERE email = ?", (email,)).fetchone():
            return False
        conn.execute("INSERT INTO newsletter (email, created_at) VALUES (?, ?)", (email, time.time()))
        return True


def create_request(table_id: int, kind: str, message: str = "") -> Dict[str, Any]:
    with db(atomic=True) as conn:
        cur = conn.execute(
            "INSERT INTO staff_requests (table_id, kind, message, created_at) VALUES (?,?,?,?)",
            (table_id, kind, message, time.time()),
        )
        if kind == "bill":
            conn.execute("UPDATE cafe_tables SET status = 'bill_requested' WHERE id = ?", (table_id,))
        return one(conn, "SELECT * FROM staff_requests WHERE id = ?", (cur.lastrowid,))


def list_requests(open_only: bool = True) -> List[Dict[str, Any]]:
    q = "SELECT * FROM staff_requests"
    if open_only:
        q += " WHERE resolved = 0"
    q += " ORDER BY created_at DESC LIMIT 100"
    with db() as conn:
        return rows(conn.execute(q))


def resolve_request(req_id: int) -> None:
    with db() as conn:
        conn.execute("UPDATE staff_requests SET resolved = 1, resolved_at = ? WHERE id = ? AND resolved = 0",
                     (time.time(), req_id))


# ---------- staff users ----------

def get_staff_by_username(username: str) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return one(conn, "SELECT * FROM staff_users WHERE username = ? AND active = 1", (username.lower(),))


def get_staff(staff_id: int) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return one(conn, "SELECT id, username, name, role, active FROM staff_users WHERE id = ?", (staff_id,))


def list_staff() -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute("SELECT id, username, name, role, active FROM staff_users ORDER BY role, name"))


def add_staff(username: str, name: str, role: str, pin_hash: str) -> Dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO staff_users (username, name, role, pin_hash) VALUES (?,?,?,?)",
                           (username.lower(), name, role, pin_hash))
    return get_staff(cur.lastrowid)


def set_staff_active(staff_id: int, active: bool) -> None:
    with db(atomic=True) as conn:
        conn.execute("UPDATE staff_users SET active = ? WHERE id = ?", (1 if active else 0, staff_id))
        if not active:
            conn.execute("DELETE FROM auth_tokens WHERE kind = 'staff' AND user_id = ?", (staff_id,))


# ---------- auth tokens ----------

def save_token(token: str, kind: str, user_id: int) -> None:
    with db() as conn:
        conn.execute("INSERT INTO auth_tokens (token, kind, user_id, created_at) VALUES (?,?,?,?)",
                     (token, kind, user_id, time.time()))


def token_user(token: str, kind: str, max_age: float) -> Optional[int]:
    with db() as conn:
        r = one(conn, "SELECT user_id, created_at FROM auth_tokens WHERE token = ? AND kind = ?", (token, kind))
    if not r or time.time() - r["created_at"] > max_age:
        return None
    return r["user_id"]


def delete_token(token: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))


# ---------- customers ----------

def _customer_out(c: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not c:
        return None
    c = dict(c)
    c.pop("pin_hash", None)
    c["prefs"] = json.loads(c.get("prefs") or "{}")
    return c


def get_customer_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return one(conn, "SELECT * FROM customers WHERE phone = ?", (phone,))


def get_customer(customer_id: int) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return _customer_out(one(conn, "SELECT * FROM customers WHERE id = ?", (customer_id,)))


def create_customer(phone: str, name: str, pin_hash: str) -> Dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO customers (phone, name, pin_hash, created_at) VALUES (?,?,?,?)",
                           (phone, name, pin_hash, time.time()))
    return get_customer(cur.lastrowid)


def save_customer_prefs(customer_id: int, prefs: Dict[str, Any]) -> None:
    with db() as conn:
        conn.execute("UPDATE customers SET prefs = ? WHERE id = ?", (json.dumps(prefs, ensure_ascii=False), customer_id))
        if prefs.get("name"):
            conn.execute("UPDATE customers SET name = ? WHERE id = ?", (str(prefs["name"])[:40], customer_id))


def touch_customer_visit(customer_id: int) -> None:
    with db() as conn:
        conn.execute("UPDATE customers SET visits = visits + 1, last_seen = ? WHERE id = ?", (time.time(), customer_id))


def count_customers() -> int:
    with db() as conn:
        return conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]


def list_customers(limit: int = 100) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute(
            "SELECT c.id, c.name, c.phone, c.visits, c.last_seen, "
            "(SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS spent "
            "FROM customers c ORDER BY c.last_seen DESC LIMIT ?", (limit,)))


def favourite_items(customer_id: int, limit: int = 5) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute(
            "SELECT oi.menu_item_id, oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id "
            "WHERE o.customer_id = ? AND o.status != 'cancelled' GROUP BY oi.menu_item_id, oi.name "
            "ORDER BY qty DESC LIMIT ?", (customer_id, limit)))


def delete_customer_data(customer_id: int) -> None:
    """'Forget me': wipes memories and chats (orders stay for the store's accounts, unlinked)."""
    with db(atomic=True) as conn:
        conn.execute("DELETE FROM memories WHERE customer_id = ?", (customer_id,))
        conn.execute("DELETE FROM chat_messages WHERE customer_id = ?", (customer_id,))
        conn.execute("DELETE FROM conversations WHERE customer_id = ?", (customer_id,))


# ---------- AI memory ----------

def add_memory(customer_id: int, fact: str, category: str = "general") -> Dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO memories (customer_id, fact, category, created_at) VALUES (?,?,?,?)",
                           (customer_id, fact, category, time.time()))
        return one(conn, "SELECT * FROM memories WHERE id = ?", (cur.lastrowid,))


def list_memories(customer_id: int) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute("SELECT * FROM memories WHERE customer_id = ? ORDER BY created_at", (customer_id,)))


def delete_memory(customer_id: int, memory_id: int) -> bool:
    with db() as conn:
        return conn.execute("DELETE FROM memories WHERE id = ? AND customer_id = ?", (memory_id, customer_id)).rowcount > 0


def start_conversation(customer_id: int, table_id: int) -> int:
    with db() as conn:
        return conn.execute("INSERT INTO conversations (customer_id, table_id, started_at) VALUES (?,?,?)",
                            (customer_id, table_id, time.time())).lastrowid


def end_conversation(conversation_id: int, summary: str) -> None:
    with db() as conn:
        conn.execute("UPDATE conversations SET ended_at = ?, summary = ? WHERE id = ?",
                     (time.time(), summary, conversation_id))


def recent_summaries(customer_id: int, limit: int = 3) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute(
            "SELECT started_at, summary FROM conversations WHERE customer_id = ? AND summary != '' "
            "ORDER BY started_at DESC LIMIT ?", (customer_id, limit)))


def add_chat_message(conversation_id: int, customer_id: int, role: str, text: str) -> None:
    with db() as conn:
        conn.execute("INSERT INTO chat_messages (conversation_id, customer_id, role, text, created_at) VALUES (?,?,?,?,?)",
                     (conversation_id, customer_id, role, text, time.time()))


def recent_messages(customer_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    with db() as conn:
        msgs = rows(conn.execute(
            "SELECT role, text, created_at, conversation_id FROM chat_messages WHERE customer_id = ? "
            "ORDER BY id DESC LIMIT ?", (customer_id, limit)))
    return list(reversed(msgs))


def conversation_messages(conversation_id: int) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows(conn.execute("SELECT role, text FROM chat_messages WHERE conversation_id = ? ORDER BY id",
                                 (conversation_id,)))


# ---------- AI usage (permanent billing record, written when a table's bill is settled) ----------

def save_ai_usage(table_id: int, u: Dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO ai_usage (table_id, visit, customer_ids, minutes, billable_minutes, amount, turns, tokens_in, "
            "tokens_out, llm_cost_usd, stt_seconds, tts_chars, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (table_id, u["visit"], ",".join(str(c) for c in u.get("customer_ids", [])), u["minutes"],
             u["billable_minutes"], u["amount"], u.get("turns", 0), u.get("tokens_in", 0), u.get("tokens_out", 0),
             u.get("llm_cost_usd", 0), u.get("stt_seconds", 0), u.get("tts_chars", 0), time.time()))


def ai_usage_summary(since_ts: float) -> Dict[str, Any]:
    with db() as conn:
        r = conn.execute(
            "SELECT COUNT(*) AS visits, COALESCE(SUM(minutes),0) AS minutes, COALESCE(SUM(amount),0) AS revenue, "
            "COALESCE(SUM(llm_cost_usd),0) AS llm_cost_usd FROM ai_usage WHERE created_at >= ?", (since_ts,)).fetchone()
    return dict(r)


# ---------- reports ----------

def sales_summary(since_ts: float) -> Dict[str, Any]:
    with db() as conn:
        o = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue FROM orders "
            "WHERE created_at >= ? AND status != 'cancelled'",
            (since_ts,),
        ).fetchone()
        top = rows(conn.execute(
            "SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty*oi.unit_price) AS revenue "
            "FROM order_items oi JOIN orders o ON o.id = oi.order_id "
            "WHERE o.created_at >= ? AND o.status != 'cancelled' "
            "GROUP BY oi.name ORDER BY qty DESC LIMIT 5",
            (since_ts,),
        ))
        returning = conn.execute("SELECT COUNT(*) FROM customers WHERE last_seen >= ? AND visits > 1",
                                 (since_ts,)).fetchone()[0]
    n = o["n"]
    return {
        "orders": n,
        "revenue": round(o["revenue"], 2),
        "avg_order": round(o["revenue"] / n, 2) if n else 0,
        "top_items": top,
        "returning_customers": returning,
    }


# ---------- promotions (featured by the AI companion) ----------

def active_promotions() -> List[Dict[str, Any]]:
    now = time.time()
    with db() as conn:
        return rows(conn.execute("SELECT * FROM promotions WHERE active = 1 AND (ends_at IS NULL OR ends_at > ?) "
                                 "ORDER BY created_at DESC", (now,)))


def add_promotion(title: str, details: str, item_ids: List[int], days: Optional[float]) -> Dict[str, Any]:
    now = time.time()
    with db() as conn:
        cur = conn.execute("INSERT INTO promotions (title, details, item_ids, created_at, ends_at) VALUES (?,?,?,?,?)",
                           (title, details, ",".join(str(i) for i in item_ids), now, now + days * 86400 if days else None))
        return one(conn, "SELECT * FROM promotions WHERE id = ?", (cur.lastrowid,))


def end_promotion(promo_id: int) -> None:
    with db() as conn:
        conn.execute("UPDATE promotions SET active = 0 WHERE id = ?", (promo_id,))


# ---------- AI store-manager proposals & briefings ----------

def add_agent_action(kind: str, payload: Dict[str, Any], reason: str) -> Dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO agent_actions (kind, payload, reason, created_at) VALUES (?,?,?,?)",
                           (kind, json.dumps(payload, ensure_ascii=False), reason, time.time()))
        return _action_out(one(conn, "SELECT * FROM agent_actions WHERE id = ?", (cur.lastrowid,)))


def _action_out(a: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if a:
        a["payload"] = json.loads(a["payload"])
    return a


def get_agent_action(action_id: int) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return _action_out(one(conn, "SELECT * FROM agent_actions WHERE id = ?", (action_id,)))


def list_agent_actions(status: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    q, args = "SELECT * FROM agent_actions", []
    if status:
        q += " WHERE status = ?"
        args.append(status)
    q += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with db() as conn:
        return [_action_out(r) for r in rows(conn.execute(q, args))]


def decide_agent_action(action_id: int, status: str, who: str) -> None:
    with db() as conn:
        conn.execute("UPDATE agent_actions SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?",
                     (status, time.time(), who, action_id))


def save_insights(period: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    with db() as conn:
        cur = conn.execute("INSERT INTO agent_insights (period, content, created_at) VALUES (?,?,?)",
                           (period, json.dumps(items, ensure_ascii=False), time.time()))
        r = one(conn, "SELECT * FROM agent_insights WHERE id = ?", (cur.lastrowid,))
    r["content"] = json.loads(r["content"])
    return r


def latest_insights() -> Optional[Dict[str, Any]]:
    with db() as conn:
        r = one(conn, "SELECT * FROM agent_insights ORDER BY created_at DESC LIMIT 1")
    if r:
        r["content"] = json.loads(r["content"])
    return r
