"""Store analytics: sales, items, busy hours, customers, operations and AI usage — each vs the previous period.

Every function takes a Period so the dashboard and the AI store manager see exactly the same numbers.
`signals()` turns the numbers into plain-language findings the manager (and the agent) can act on.
"""
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.core.config import CURRENCY
from app.core.db import db, rows

DAY = 86400
PERIODS = {"today": 1, "7d": 7, "30d": 30, "90d": 90}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@dataclass
class Period:
    key: str
    start: float
    end: float
    prev_start: float
    prev_end: float
    bucket: str            # hour | day

    @property
    def days(self) -> int:
        return PERIODS.get(self.key, 7)


def period(key: str = "7d", now: Optional[float] = None) -> Period:
    key = key if key in PERIODS else "7d"
    now = now or time.time()
    lt = time.localtime(now)
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    if key == "today":
        start = midnight
        # compare with the same weekday last week, up to the same time of day
        return Period(key, start, now, start - 7 * DAY, now - 7 * DAY, "hour")
    days = PERIODS[key]
    start = midnight - (days - 1) * DAY
    return Period(key, start, now, start - days * DAY, start, "day")


def _pct(cur: float, prev: float) -> Optional[float]:
    if not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def _metric(cur: float, prev: float, digits: int = 0) -> Dict[str, Any]:
    return {"value": round(cur, digits), "prev": round(prev, digits), "change_pct": _pct(cur, prev)}


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------

def _sales(conn, start: float, end: float) -> Dict[str, float]:
    r = conn.execute(
        "SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, "
        "COUNT(DISTINCT customer_id) AS customers, "
        "SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled "
        "FROM orders WHERE created_at >= ? AND created_at < ?", (start, end)).fetchone()
    live = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS rev FROM orders "
        "WHERE created_at >= ? AND created_at < ? AND status != 'cancelled'", (start, end)).fetchone()
    ai = conn.execute(
        "SELECT COALESCE(SUM(amount),0) AS rev, COALESCE(SUM(minutes),0) AS minutes, COALESCE(SUM(llm_cost_usd),0) AS cost "
        "FROM ai_usage WHERE created_at >= ? AND created_at < ?", (start, end)).fetchone()
    new_c = conn.execute("SELECT COUNT(*) FROM customers WHERE created_at >= ? AND created_at < ?", (start, end)).fetchone()[0]
    return {
        "orders": live["n"], "food_revenue": live["rev"], "ai_revenue": ai["rev"], "ai_minutes": ai["minutes"],
        "llm_cost_usd": ai["cost"], "customers": r["customers"] or 0, "new_customers": new_c,
        "cancel_rate": (r["cancelled"] or 0) / r["orders"] * 100 if r["orders"] else 0.0,
    }


def _prep_minutes(conn, start: float, end: float, station: Optional[str] = None) -> Optional[float]:
    q = ("SELECT AVG(e.ts - o.created_at) FROM order_events e JOIN orders o ON o.id = e.order_id "
         "WHERE e.status = 'ready' AND o.created_at >= ? AND o.created_at < ?")
    args: List[Any] = [start, end]
    if station:
        q += " AND e.station = ?"
        args.append(station)
    else:
        q += " AND e.station = 'order'"
    v = conn.execute(q, args).fetchone()[0]
    return round(v / 60, 1) if v else None


def kpis(p: Period) -> Dict[str, Any]:
    with db() as conn:
        cur, prev = _sales(conn, p.start, p.end), _sales(conn, p.prev_start, p.prev_end)
        prep, prep_prev = _prep_minutes(conn, p.start, p.end), _prep_minutes(conn, p.prev_start, p.prev_end)
        returning = conn.execute(
            "SELECT COUNT(DISTINCT o.customer_id) FROM orders o JOIN customers c ON c.id = o.customer_id "
            "WHERE o.created_at >= ? AND o.created_at < ? AND c.created_at < ?", (p.start, p.end, p.start)).fetchone()[0]
    revenue = cur["food_revenue"] + cur["ai_revenue"]
    revenue_prev = prev["food_revenue"] + prev["ai_revenue"]
    aov = cur["food_revenue"] / cur["orders"] if cur["orders"] else 0
    aov_prev = prev["food_revenue"] / prev["orders"] if prev["orders"] else 0
    return {
        "revenue": _metric(revenue, revenue_prev),
        "food_revenue": _metric(cur["food_revenue"], prev["food_revenue"]),
        "ai_revenue": _metric(cur["ai_revenue"], prev["ai_revenue"]),
        "orders": _metric(cur["orders"], prev["orders"]),
        "avg_order_value": _metric(aov, aov_prev),
        "customers": _metric(cur["customers"], prev["customers"]),
        "new_customers": _metric(cur["new_customers"], prev["new_customers"]),
        "returning_customers": returning,
        "returning_share": round(returning / cur["customers"] * 100, 1) if cur["customers"] else 0,
        "cancel_rate": _metric(cur["cancel_rate"], prev["cancel_rate"], 1),
        "prep_minutes": {"value": prep, "prev": prep_prev, "change_pct": _pct(prep or 0, prep_prev or 0) if prep else None},
        "ai_minutes": _metric(cur["ai_minutes"], prev["ai_minutes"]),
        "llm_cost_usd": _metric(cur["llm_cost_usd"], prev["llm_cost_usd"], 4),
    }


# ---------------------------------------------------------------------------
# Trends & patterns
# ---------------------------------------------------------------------------

def trend(p: Period) -> List[Dict[str, Any]]:
    """Revenue per hour (today) or per day, food and AI chat separately."""
    fmt = "%Y-%m-%d %H:00" if p.bucket == "hour" else "%Y-%m-%d"
    step = 3600 if p.bucket == "hour" else DAY
    buckets: Dict[str, Dict[str, Any]] = {}
    t = p.start
    while t < p.end:
        k = time.strftime(fmt, time.localtime(t))
        buckets[k] = {"bucket": k, "food": 0.0, "ai": 0.0, "orders": 0}
        t += step
    with db() as conn:
        for r in conn.execute("SELECT created_at, total FROM orders WHERE created_at >= ? AND created_at < ? "
                              "AND status != 'cancelled'", (p.start, p.end)):
            k = time.strftime(fmt, time.localtime(r["created_at"]))
            if k in buckets:
                buckets[k]["food"] += r["total"]
                buckets[k]["orders"] += 1
        for r in conn.execute("SELECT created_at, amount FROM ai_usage WHERE created_at >= ? AND created_at < ?",
                              (p.start, p.end)):
            k = time.strftime(fmt, time.localtime(r["created_at"]))
            if k in buckets:
                buckets[k]["ai"] += r["amount"]
    return list(buckets.values())


def busy_hours(p: Period) -> Dict[str, Any]:
    """Orders by weekday x hour (uses at least 4 weeks of history so the pattern is stable)."""
    start = min(p.start, p.end - 28 * DAY)
    grid = [[0] * 24 for _ in range(7)]
    with db() as conn:
        for r in conn.execute("SELECT created_at FROM orders WHERE created_at >= ? AND created_at < ? "
                              "AND status != 'cancelled'", (start, p.end)):
            lt = time.localtime(r["created_at"])
            grid[lt.tm_wday][lt.tm_hour] += 1
    weeks = max(1, round((p.end - start) / (7 * DAY)))
    avg = [[round(c / weeks, 1) for c in row] for row in grid]
    hours_open = [h for h in range(24) if any(avg[d][h] for d in range(7))]
    flat = sorted(((avg[d][h], d, h) for d in range(7) for h in range(24)), reverse=True)
    peaks = [{"day": WEEKDAYS[d], "hour": h, "orders_per_week": v} for v, d, h in flat[:5] if v]
    by_hour = [round(sum(avg[d][h] for d in range(7)) / 7, 1) for h in range(24)]
    by_day = [round(sum(avg[d]), 1) for d in range(7)]
    return {"grid": avg, "days": WEEKDAYS, "hours_open": hours_open, "peaks": peaks,
            "by_hour": by_hour, "by_day": by_day, "weeks": weeks}


def items(p: Period) -> Dict[str, Any]:
    q = ("SELECT oi.menu_item_id AS id, oi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price) AS revenue "
         "FROM order_items oi JOIN orders o ON o.id = oi.order_id "
         "WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' GROUP BY oi.menu_item_id, oi.name")
    with db() as conn:
        cur = {r["id"]: r for r in rows(conn.execute(q, (p.start, p.end)))}
        prev = {r["id"]: r for r in rows(conn.execute(q, (p.prev_start, p.prev_end)))}
        menu = rows(conn.execute("SELECT id, name, category, price, available, station FROM menu_items"))
    total_rev = sum(r["revenue"] for r in cur.values()) or 1
    out = []
    for m in menu:
        c, pv = cur.get(m["id"], {}), prev.get(m["id"], {})
        qty, pqty = c.get("qty", 0) or 0, pv.get("qty", 0) or 0
        out.append({
            "id": m["id"], "name": m["name"], "category": m["category"], "price": m["price"],
            "available": bool(m["available"]), "station": m["station"],
            "qty": qty, "revenue": round(c.get("revenue", 0) or 0, 2), "prev_qty": pqty,
            "change_pct": _pct(qty, pqty), "share_pct": round((c.get("revenue", 0) or 0) / total_rev * 100, 1),
        })
    out.sort(key=lambda x: x["revenue"], reverse=True)
    cats: Dict[str, Dict[str, float]] = {}
    for i in out:
        c = cats.setdefault(i["category"], {"category": i["category"], "revenue": 0.0, "qty": 0})
        c["revenue"] += i["revenue"]
        c["qty"] += i["qty"]
    # pairs bought together (for combo ideas)
    with db() as conn:
        pairs = rows(conn.execute(
            "SELECT a.name AS a, b.name AS b, COUNT(*) AS n FROM order_items a JOIN order_items b "
            "ON a.order_id = b.order_id AND a.menu_item_id < b.menu_item_id JOIN orders o ON o.id = a.order_id "
            "WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' "
            "GROUP BY a.name, b.name ORDER BY n DESC LIMIT 5", (p.start, p.end)))
    return {
        "items": out,
        "categories": sorted(cats.values(), key=lambda c: c["revenue"], reverse=True),
        "top": out[:5],
        "slow": [i for i in sorted(out, key=lambda x: x["qty"]) if i["available"]][:5],
        "unsold": [i["name"] for i in out if i["available"] and not i["qty"]],
        "rising": sorted([i for i in out if (i["change_pct"] or 0) >= 20 and i["qty"] >= 5],
                         key=lambda x: x["change_pct"], reverse=True)[:5],
        "falling": sorted([i for i in out if (i["change_pct"] or 0) <= -20 and i["prev_qty"] >= 5],
                          key=lambda x: x["change_pct"])[:5],
        "pairs": pairs,
    }


def customers(p: Period) -> Dict[str, Any]:
    with db() as conn:
        top = rows(conn.execute(
            "SELECT c.id, c.name, c.visits, COUNT(o.id) AS orders, SUM(o.total) AS spent FROM orders o "
            "JOIN customers c ON c.id = o.customer_id WHERE o.created_at >= ? AND o.created_at < ? "
            "AND o.status != 'cancelled' GROUP BY c.id ORDER BY spent DESC LIMIT 8", (p.start, p.end)))
        at_risk = rows(conn.execute(
            "SELECT c.id, c.name, c.visits, c.last_seen, "
            "(SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelled') AS spent "
            "FROM customers c WHERE c.visits >= 3 AND c.last_seen < ? ORDER BY spent DESC LIMIT 8",
            (time.time() - 14 * DAY,)))
        total = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        repeat = conn.execute("SELECT COUNT(*) FROM customers WHERE visits >= 2").fetchone()[0]
        prefs = [json.loads(r["prefs"] or "{}") for r in conn.execute("SELECT prefs FROM customers")]
    personas: Dict[str, int] = {}
    topics: Dict[str, int] = {}
    for pr in prefs:
        if pr.get("persona"):
            personas[pr["persona"]] = personas.get(pr["persona"], 0) + 1
        for t in pr.get("topics") or []:
            topics[t] = topics.get(t, 0) + 1
    for c in at_risk:
        c["days_away"] = int((time.time() - (c["last_seen"] or 0)) // DAY)
    return {
        "top": top, "at_risk": at_risk, "registered": total,
        "repeat_rate": round(repeat / total * 100, 1) if total else 0,
        "personas": sorted(personas.items(), key=lambda x: -x[1]),
        "topics": sorted(topics.items(), key=lambda x: -x[1])[:8],
    }


def operations(p: Period) -> Dict[str, Any]:
    with db() as conn:
        stations = {st: _prep_minutes(conn, p.start, p.end, st) for st in ("kitchen", "bar")}
        serve = conn.execute(
            "SELECT AVG(s.ts - r.ts) FROM order_events s JOIN order_events r ON r.order_id = s.order_id "
            "AND r.station = 'order' AND r.status = 'ready' JOIN orders o ON o.id = s.order_id "
            "WHERE s.station = 'order' AND s.status = 'served' AND o.created_at >= ? AND o.created_at < ?",
            (p.start, p.end)).fetchone()[0]
        req = rows(conn.execute(
            "SELECT kind, COUNT(*) AS n, AVG(resolved_at - created_at) AS wait FROM staff_requests "
            "WHERE created_at >= ? AND created_at < ? GROUP BY kind", (p.start, p.end)))
        tables = rows(conn.execute(
            "SELECT table_id, COUNT(*) AS orders, SUM(total) AS revenue FROM orders WHERE created_at >= ? "
            "AND created_at < ? AND status != 'cancelled' GROUP BY table_id ORDER BY table_id", (p.start, p.end)))
        slow_orders = conn.execute(
            "SELECT COUNT(*) FROM order_events e JOIN orders o ON o.id = e.order_id WHERE e.station = 'order' "
            "AND e.status = 'ready' AND e.ts - o.created_at > 1200 AND o.created_at >= ? AND o.created_at < ?",
            (p.start, p.end)).fetchone()[0]
    for r in req:
        r["wait_minutes"] = round(r.pop("wait") / 60, 1) if r.get("wait") else None
    return {"prep_minutes": stations, "serve_minutes": round(serve / 60, 1) if serve else None,
            "requests": req, "tables": tables, "orders_over_20_min": slow_orders}


def ai_usage(p: Period) -> Dict[str, Any]:
    with db() as conn:
        r = conn.execute(
            "SELECT COUNT(*) AS visits, COALESCE(SUM(minutes),0) AS minutes, COALESCE(SUM(billable_minutes),0) AS billable, "
            "COALESCE(SUM(amount),0) AS revenue, COALESCE(SUM(llm_cost_usd),0) AS cost, COALESCE(SUM(turns),0) AS turns "
            "FROM ai_usage WHERE created_at >= ? AND created_at < ?", (p.start, p.end)).fetchone()
        convs = conn.execute("SELECT COUNT(*) FROM conversations WHERE started_at >= ? AND started_at < ?",
                             (p.start, p.end)).fetchone()[0]
        converted = conn.execute(
            "SELECT COUNT(*) FROM conversations c WHERE c.started_at >= ? AND c.started_at < ? AND EXISTS "
            "(SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.created_at BETWEEN c.started_at "
            "AND COALESCE(c.ended_at, c.started_at + 10800))", (p.start, p.end)).fetchone()[0]
    d = dict(r)
    d["conversations"] = convs
    d["order_conversion_pct"] = round(converted / convs * 100, 1) if convs else None
    d["paying_share_pct"] = round(d["billable"] / d["minutes"] * 100, 1) if d["minutes"] else 0
    return d


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------

def signals(p: Period, pre: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Rule-based findings: fast, free and deterministic. The AI manager builds its advice on top of these.
    Pass `pre` (already-computed sections) to avoid querying the database twice."""
    pre = pre or {}
    k = pre.get("kpis") or kpis(p)
    it = pre.get("items") or items(p)
    bh = pre.get("busy") or busy_hours(p)
    cu = pre.get("customers") or customers(p)
    op = pre.get("operations") or operations(p)
    out: List[Dict[str, Any]] = []

    def add(level: str, title: str, detail: str, area: str) -> None:
        out.append({"level": level, "title": title, "detail": detail, "area": area})

    rc = k["revenue"]["change_pct"]
    if rc is not None and rc <= -10:
        add("serious", f"Revenue down {abs(rc)}%", f"{CURRENCY}{k['revenue']['value']:,.0f} vs {CURRENCY}{k['revenue']['prev']:,.0f} in the previous period.", "sales")
    elif rc is not None and rc >= 10:
        add("good", f"Revenue up {rc}%", f"{CURRENCY}{k['revenue']['value']:,.0f} vs {CURRENCY}{k['revenue']['prev']:,.0f}.", "sales")
    ac = k["avg_order_value"]["change_pct"]
    if ac is not None and ac <= -8:
        add("warning", f"Average order value down {abs(ac)}%", "Customers are ordering fewer items per visit — consider combos or add-on suggestions.", "sales")
    for i in it["falling"][:3]:
        add("warning", f"{i['name']} sales down {abs(i['change_pct'])}%", f"{i['qty']} sold vs {i['prev_qty']} before.", "menu")
    for i in it["rising"][:2]:
        add("good", f"{i['name']} is trending up {i['change_pct']}%", f"{i['qty']} sold vs {i['prev_qty']} before — keep it stocked and featured.", "menu")
    if it["unsold"] and p.days >= 7:
        add("warning", f"{len(it['unsold'])} menu item(s) didn't sell", ", ".join(it["unsold"][:6]) + ".", "menu")
    if k["cancel_rate"]["value"] >= 5:
        add("serious", f"Cancellation rate {k['cancel_rate']['value']}%", "Check stock-outs and kitchen delays.", "operations")
    for st, m in op["prep_minutes"].items():
        if m and m > 15:
            add("serious" if m > 20 else "warning", f"{st.title()} averaging {m} min", "Orders take longer than 15 minutes to be ready.", "operations")
    if op["orders_over_20_min"]:
        add("warning", f"{op['orders_over_20_min']} orders took over 20 minutes", "Look at the busy-hour staffing.", "operations")
    for r in op["requests"]:
        if r["wait_minutes"] and r["wait_minutes"] > 5:
            add("warning", f"Tables wait {r['wait_minutes']} min for '{r['kind']}'", f"{r['n']} requests in the period.", "operations")
    if cu["at_risk"]:
        names = ", ".join(c["name"] for c in cu["at_risk"][:4])
        add("warning", f"{len(cu['at_risk'])} regulars haven't visited in 2+ weeks", names + ".", "customers")
    if bh["peaks"]:
        pk = bh["peaks"][0]
        add("info", f"Busiest slot: {pk['day']} {pk['hour']}:00", f"~{pk['orders_per_week']} orders in that hour each week — staff up and prep ahead.", "operations")
    if it["pairs"]:
        pr = it["pairs"][0]
        add("info", f"Often ordered together: {pr['a']} + {pr['b']}", f"{pr['n']} orders — a natural combo offer.", "menu")
    order = {"serious": 0, "warning": 1, "good": 2, "info": 3}
    return sorted(out, key=lambda x: order[x["level"]])


def dashboard(key: str) -> Dict[str, Any]:
    """All sections, computed in parallel (each on its own connection) — with a remote database the round trips
    add up, so seven sections at once instead of one after another."""
    from concurrent.futures import ThreadPoolExecutor
    p = period(key)
    jobs = {"kpis": kpis, "trend": trend, "busy": busy_hours, "items": items, "customers": customers,
            "operations": operations, "ai": ai_usage}
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {name: pool.submit(fn, p) for name, fn in jobs.items()}
        out: Dict[str, Any] = {name: f.result() for name, f in futures.items()}
    out["signals"] = signals(p, out)
    out["period"] = {"key": p.key, "start": p.start, "end": p.end, "bucket": p.bucket}
    return out
