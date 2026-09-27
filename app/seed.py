"""Generate realistic demo history so the analytics board and AI store manager have something to analyse.

    DB_PATH=demo.db python -m app.seed            # 90 days into a separate demo database
    DB_PATH=demo.db python -m app.seed --days 60

Refuses to write into a database that already has orders unless you pass --force.
"""
import argparse
import json
import random
import sys
import time

from app.core import db, security as auth
from app.core.config import STAFF_PIN

FIRST = ["Aarav", "Ananya", "Ravi", "Meera", "Kiran", "Sneha", "Arjun", "Divya", "Rohit", "Pooja", "Vikram", "Lakshmi",
         "Farhan", "Ishita", "Karthik", "Nisha", "Sai", "Priya", "Aditya", "Zoya", "Harsha", "Tanvi", "Manoj", "Swathi"]
LAST = ["Reddy", "Sharma", "Rao", "Iyer", "Khan", "Nair", "Patel", "Gupta", "Varma", "Das", "Menon", "Joshi"]
PERSONAS = ["chai_buddy", "filmy_friend", "cricket_fanatic", "good_listener", "motivator", "wise_elder", "barista"]
TOPICS = ["Just chatting", "Movies & OTT", "Cricket & sports", "Career & studies", "Music", "Food & recipes",
          "Life & relationships", "Tech & startups"]

# relative popularity by item name (unlisted items get 1.0)
POPULARITY = {"Masala Chai": 6, "Irani Chai": 4, "Filter Coffee": 4, "Cold Coffee": 3, "Samosa (2 pcs)": 4,
              "Osmania Biscuits (4 pcs)": 3.5, "Chicken Biryani": 2.5, "Masala Maggi": 2.5, "Vada Pav": 2,
              "Hot Chocolate": 0.4, "Double Ka Meetha": 0.6, "Veg Pulao Bowl": 0.5}
RISING, FALLING = "Mango Lassi", "Paneer Tikka Sandwich"   # story lines for the analytics to discover

# orders per hour of day (opening 8:00–22:00) — morning chai rush and evening peak
HOURLY = {8: 5, 9: 7, 10: 5, 11: 4, 12: 6, 13: 7, 14: 4, 15: 4, 16: 6, 17: 9, 18: 10, 19: 8, 20: 6, 21: 3}
WEEKDAY_FACTOR = [0.85, 0.8, 0.85, 0.9, 1.05, 1.35, 1.3]


def generate(days: int, seed: int = 7) -> None:
    rnd = random.Random(seed)
    db.init_db(seed_staff=[  # the same default logins the app creates (see README → Using the apps)
        {"username": u, "name": u.title(), "role": u, "pin_hash": auth.hash_pin(pin)}
        for u, pin in (("manager", STAFF_PIN), ("kitchen", "1111"), ("bar", "2222"), ("waiter", "3333"))])
    menu = db.list_menu()
    now = time.time()
    start = now - days * 86400

    with db.db(atomic=True) as conn:
        # --- customers: a pool of regulars and occasional visitors
        customers = []
        for i in range(70):
            name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
            created = start + rnd.random() * days * 0.8 * 86400
            prefs = {"persona": rnd.choice(PERSONAS), "topics": rnd.sample(TOPICS, 2), "mood": "cheerful"}
            cur = conn.execute("INSERT INTO customers (phone, name, pin_hash, prefs, created_at) VALUES (?,?,?,?,?)",
                               (f"9{rnd.randint(100000000, 999999999)}", name, auth.hash_pin("0000") if i == 0 else "x",
                                json.dumps(prefs), created))
            loyalty = rnd.choice([0.05, 0.1, 0.25, 0.5]) if i < 30 else 0.03
            lapsed = i < 30 and rnd.random() < 0.2          # some regulars stop coming — "at risk"
            customers.append({"id": cur.lastrowid, "name": name, "created": created, "loyalty": loyalty,
                              "lapsed": lapsed, "visits": 0, "last": None})

        order_count = 0
        lt_now = time.localtime(now)
        today = time.mktime((lt_now.tm_year, lt_now.tm_mon, lt_now.tm_mday, 0, 0, 0, 0, 0, -1))
        for d in range(days):                       # the last generated day is today (up to now)
            midnight = today - (days - 1 - d) * 86400
            lt = time.localtime(midnight + 3600)
            progress = d / max(1, days - 1)
            for hour, base in HOURLY.items():
                n = rnd.gauss(base * WEEKDAY_FACTOR[lt.tm_wday] * 0.55, 1.2)
                for _ in range(max(0, round(n))):
                    t = midnight + hour * 3600 + rnd.random() * 3600
                    if t > now:
                        continue
                    # pick a customer (or a walk-in guest)
                    cust = None
                    for c in rnd.sample(customers, 8):
                        if c["created"] < t and rnd.random() < c["loyalty"] and not (c["lapsed"] and t > now - 20 * 86400):
                            cust = c
                            break
                    # items: 1–4 lines, with trends
                    weights = []
                    for m in menu:
                        w = POPULARITY.get(m["name"], 1.0)
                        if m["name"] == RISING:
                            w *= 0.4 + 2.2 * progress
                        if m["name"] == FALLING:
                            w *= 2.2 - 1.9 * progress
                        if m["category"] in ("Hot Drinks",) and hour < 11:
                            w *= 1.8
                        if m["category"] == "Meals" and hour in (12, 13, 19, 20):
                            w *= 2
                        weights.append(w)
                    lines = {}
                    for m in rnd.choices(menu, weights=weights, k=rnd.choice([1, 1, 2, 2, 2, 3, 4])):
                        lines[m["id"]] = (m, lines.get(m["id"], (m, 0))[1] + 1)
                    total = sum(m["price"] * q for m, q in lines.values())
                    status = "cancelled" if rnd.random() < 0.025 else "paid"
                    table = rnd.randint(1, 10)
                    cur = conn.execute(
                        "INSERT INTO orders (table_id, customer_id, customer_name, status, total, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?)", (table, cust["id"] if cust else None, cust["name"] if cust else "",
                                                   status, total, t, t))
                    oid = cur.lastrowid
                    order_count += 1
                    busy = 1.6 if hour in (17, 18, 19) and lt.tm_wday >= 5 else 1.0
                    for m, q in lines.values():
                        conn.execute("INSERT INTO order_items (order_id, menu_item_id, name, qty, unit_price, station, status) "
                                     "VALUES (?,?,?,?,?,?, 'ready')", (oid, m["id"], m["name"], q, m["price"], m["station"]))
                    conn.execute("INSERT INTO order_events (order_id, station, status, ts) VALUES (?,?,?,?)", (oid, "order", "new", t))
                    if status == "paid":
                        ready_all = t
                        for st in {m["station"] for m, _ in lines.values()}:
                            prep = (rnd.gauss(4, 1.2) if st == "bar" else rnd.gauss(11, 3)) * busy * 60
                            ready = t + max(90, prep)
                            ready_all = max(ready_all, ready)
                            conn.execute("INSERT INTO order_events (order_id, station, status, ts) VALUES (?,?,?,?)", (oid, st, "ready", ready))
                        conn.execute("INSERT INTO order_events (order_id, station, status, ts) VALUES (?,?,?,?)", (oid, "order", "ready", ready_all))
                        served = ready_all + max(30, rnd.gauss(2.5, 1) * 60 * busy)
                        conn.execute("INSERT INTO order_events (order_id, station, status, ts) VALUES (?,?,?,?)", (oid, "order", "served", served))
                    # AI companion usage for a share of visits
                    if rnd.random() < 0.45:
                        minutes = max(1, int(rnd.expovariate(1 / 9)))
                        billable = max(0, minutes - 10)
                        turns = minutes * 3
                        conn.execute(
                            "INSERT INTO ai_usage (table_id, visit, customer_ids, minutes, billable_minutes, amount, turns, "
                            "tokens_in, tokens_out, llm_cost_usd, stt_seconds, tts_chars, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            (table, f"demo-{oid}", str(cust["id"]) if cust else "", minutes, billable, billable * 2.0, turns,
                             turns * 2600, turns * 90, turns * 0.00045, minutes * 20.0, turns * 110, t + minutes * 60))
                        if cust:
                            conn.execute("INSERT INTO conversations (customer_id, table_id, started_at, ended_at, summary) "
                                         "VALUES (?,?,?,?,?)", (cust["id"], table, t - 120, t + minutes * 60, ""))
                    if cust:
                        cust["visits"] += 1
                        cust["last"] = t
                    if rnd.random() < 0.12:        # companion chats that didn't lead to an order
                        c = rnd.choice(customers)
                        if c["created"] < t:
                            conn.execute("INSERT INTO conversations (customer_id, table_id, started_at, ended_at, summary) "
                                         "VALUES (?,?,?,?,?)", (c["id"], table, t - 6 * 3600, t - 5.7 * 3600, ""))
                    if rnd.random() < 0.18:
                        kind = rnd.choice(["waiter", "bill", "bill", "help"])
                        wait = max(20, rnd.gauss(3, 2) * 60 * busy)
                        conn.execute("INSERT INTO staff_requests (table_id, kind, resolved, created_at, resolved_at) "
                                     "VALUES (?,?,1,?,?)", (table, kind, t + 600, t + 600 + wait))
        for c in customers:
            conn.execute("UPDATE customers SET visits = ?, last_seen = ? WHERE id = ?", (c["visits"], c["last"], c["id"]))
    print(f"Generated {order_count} orders over {days} days for {len(customers)} customers.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--force", action="store_true", help="write even if the database already has orders")
    args = ap.parse_args()
    db.init_db()
    with db.db() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    if existing and not args.force:
        sys.exit(f"{db.backend()} already has {existing} orders — use a separate demo database "
                 "(DB_PATH=demo.db python -m app.seed) or pass --force.")
    generate(args.days)


if __name__ == "__main__":
    main()
