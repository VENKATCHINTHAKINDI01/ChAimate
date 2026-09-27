"""AI store manager: analyses the store's data with tools and gives the manager concrete, numbers-backed advice.

It can only READ data on its own. Anything that changes the store (price, stock, new item, promotion) becomes a
*proposal* the manager approves or dismisses in the staff app — the agent never changes the store by itself.
"""
import json
import logging
import re
from typing import Any, Dict, List

from app.core import db
from app.services import analytics, llm_gateway as gateway
from app.core.errors import ServiceUnavailable
from app.core.config import CAFE_CITY, CAFE_NAME, CURRENCY

log = logging.getLogger("manager_agent")

SYSTEM = f"""You are the AI store manager and growth analyst for {CAFE_NAME}, a café in {CAFE_CITY}, India. \
You work for the café's manager. Prices are in Indian rupees ({CURRENCY}).

How you work:
- Always look at the data with your tools before making a claim. Quote the actual numbers (with the period) \
you're relying on, and compare with the previous period when it matters.
- Give specific, practical recommendations a small Indian café can act on this week: what to change, why \
(the data), and the expected effect. Prefer a few high-impact ideas over a long list.
- Think like an operator: sales, average order value, menu mix, busy-hour staffing, prep speed, repeat customers, \
the AI companion's minutes and revenue, waste from items that don't sell.
- When a recommendation maps to a concrete store change, call the matching propose_* tool so the manager can \
approve it with one click. Never claim a change is done — proposals wait for the manager.
- Promotions only change what the AI companion recommends — they never change what customers are charged. \
Never put prices, discounts or "free" offers in a promotion; a combo deal must be a new menu item with its own price.
- Pricing logic: only raise prices on items with strong or rising demand (high share, stable/growing units). \
Never raise the price of an item whose sales are falling — for weak items suggest featuring, bundling into a combo \
item, fixing the recipe/visibility, or taking it off the menu.
- Be careful with prices: justify any change with demand data, keep changes modest (usually within 10–15%) and \
use round rupee prices customers are used to (e.g. 150, 160, 199).
- If the data is thin (few orders, new store), say so and suggest what to track instead of guessing.
- Answer in the manager's language. Keep answers tight: short paragraphs or a few bullets, bold key numbers \
with **double asterisks**. No tables unless asked."""

PERIOD_PARAM = {"type": "string", "enum": list(analytics.PERIODS), "description": "today, 7d, 30d or 90d"}


def _tool(name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": properties, "required": required}}}


TOOLS = [
    _tool("store_overview", "Headline KPIs for a period vs the previous period, plus automatic findings.",
          {"period": PERIOD_PARAM}, ["period"]),
    _tool("sales_trend", "Revenue and orders per day (or per hour for today), food and AI chat separately.",
          {"period": PERIOD_PARAM}, ["period"]),
    _tool("item_performance", "Per-item sales, revenue, share and change vs previous period; categories; items often bought together.",
          {"period": PERIOD_PARAM, "focus": {"type": "string", "enum": ["all", "top", "slow", "rising", "falling", "pairs", "categories"]}},
          ["period"]),
    _tool("busy_hours", "Average orders per week by weekday and hour (last 4+ weeks): peaks, quiet times.", {}, []),
    _tool("customer_insights", "Top customers, regulars who stopped coming, repeat rate, favourite AI personas/topics.",
          {"period": PERIOD_PARAM}, ["period"]),
    _tool("operations", "Kitchen/bar prep time, serve time, slow orders, table requests and wait times, revenue per table.",
          {"period": PERIOD_PARAM}, ["period"]),
    _tool("ai_companion_usage", "AI companion minutes, paid minutes, revenue, LLM cost and chat-to-order conversion.",
          {"period": PERIOD_PARAM}, ["period"]),
    _tool("menu", "The full current menu with ids, prices, stations and availability, plus active promotions.", {}, []),
    _tool("propose_price_change", "Propose a new price for a menu item (manager must approve).",
          {"menu_item_id": {"type": "integer"}, "new_price": {"type": "number"}, "reason": {"type": "string"}},
          ["menu_item_id", "new_price", "reason"]),
    _tool("propose_availability", "Propose taking an item off the menu for now, or bringing it back (manager must approve).",
          {"menu_item_id": {"type": "integer"}, "available": {"type": "boolean"}, "reason": {"type": "string"}},
          ["menu_item_id", "available", "reason"]),
    _tool("propose_new_item", "Propose adding a new menu item or combo (manager must approve).",
          {"name": {"type": "string"}, "category": {"type": "string"}, "price": {"type": "number"},
           "description": {"type": "string"}, "station": {"type": "string", "enum": ["kitchen", "bar"]},
           "veg": {"type": "boolean"}, "reason": {"type": "string"}},
          ["name", "category", "price", "station", "reason"]),
    _tool("propose_promotion", "Propose items for the customer AI companion to feature and recommend (manager must approve). "
          "Promotions cannot change prices or give discounts — for a combo or special price, use propose_new_item "
          "(e.g. a 'Chai + Samosa combo' item with its own price) and feature that item.",
          {"title": {"type": "string", "description": "e.g. 'Monsoon Chai & Samosa combo'"},
           "details": {"type": "string", "description": "What the companion should tell customers"},
           "menu_item_ids": {"type": "array", "items": {"type": "integer"}},
           "days": {"type": "number", "description": "How long it runs"}, "reason": {"type": "string"}},
          ["title", "details", "menu_item_ids", "reason"]),
]
_REQUIRED = {t["function"]["name"]: t["function"]["parameters"]["required"] for t in TOOLS}


# ---------------------------------------------------------------------------
# Tool implementations — compact JSON so the model's context (and rate limit) stays small
# ---------------------------------------------------------------------------

def _p(args: Dict[str, Any]) -> analytics.Period:
    return analytics.period(str(args.get("period") or "7d"))


def _slim_items(lst: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{"id": i["id"], "name": i["name"], "price": i["price"], "qty": i["qty"], "revenue": i["revenue"],
             "prev_qty": i["prev_qty"], "change_pct": i["change_pct"], "share_pct": i["share_pct"],
             **({} if i["available"] else {"available": False})} for i in lst]


def _run_read_tool(name: str, args: Dict[str, Any]) -> Any:
    if name == "store_overview":
        p = _p(args)
        return {"period": p.key, "kpis": analytics.kpis(p), "findings": analytics.signals(p)}
    if name == "sales_trend":
        return [{k: (round(v) if isinstance(v, float) else v) for k, v in r.items()} for r in analytics.trend(_p(args))]
    if name == "item_performance":
        it = analytics.items(_p(args))
        focus = args.get("focus") or "all"
        if focus == "pairs":
            return it["pairs"]
        if focus == "categories":
            return it["categories"]
        if focus in ("top", "slow", "rising", "falling"):
            return _slim_items(it[focus])
        return {"items": _slim_items(it["items"]), "unsold": it["unsold"], "pairs": it["pairs"][:3]}
    if name == "busy_hours":
        b = analytics.busy_hours(analytics.period("30d"))
        return {"peaks": b["peaks"], "avg_orders_by_hour": {h: b["by_hour"][h] for h in b["hours_open"]},
                "avg_orders_by_weekday": dict(zip(b["days"], b["by_day"])), "weeks_of_data": b["weeks"]}
    if name == "customer_insights":
        c = analytics.customers(_p(args))
        return {**c, "at_risk": [{k: v for k, v in x.items() if k != "last_seen"} for x in c["at_risk"]]}
    if name == "operations":
        return analytics.operations(_p(args))
    if name == "ai_companion_usage":
        return analytics.ai_usage(_p(args))
    if name == "menu":
        return {"menu": [{k: m[k] for k in ("id", "name", "category", "price", "station", "available")} for m in db.list_menu()],
                "active_promotions": [{"title": x["title"], "details": x["details"]} for x in db.active_promotions()]}
    raise ValueError(f"unknown tool {name}")


def _validate_proposal(kind: str, a: Dict[str, Any]) -> Dict[str, Any]:
    """Turn tool arguments into a safe, well-formed proposal payload (raises ValueError with a reason)."""
    if kind in ("price_change", "availability"):
        item = db.get_menu_item(int(a["menu_item_id"]))
        if not item:
            raise ValueError("no such menu item")
        if kind == "price_change":
            new = round(float(a["new_price"]))
            if new <= 0 or not (0.5 * item["price"] <= new <= 1.5 * item["price"]):
                raise ValueError("price change must stay within ±50% of the current price")
            return {"menu_item_id": item["id"], "name": item["name"], "old_price": item["price"], "new_price": new}
        return {"menu_item_id": item["id"], "name": item["name"], "available": bool(a["available"])}
    if kind == "new_item":
        price = round(float(a["price"]))
        if price <= 0 or not str(a.get("name", "")).strip():
            raise ValueError("new item needs a name and a positive price")
        return {"name": str(a["name"]).strip()[:60], "category": str(a.get("category") or "Specials")[:30],
                "price": price, "description": str(a.get("description") or "")[:200],
                "station": a.get("station") if a.get("station") in ("kitchen", "bar") else "kitchen",
                "veg": bool(a.get("veg", True))}
    if kind == "promotion":
        text = f"{a.get('title', '')} {a.get('details', '')}"
        if re.search(r"₹|\brs\.?\s*\d|\d+\s*%|\bdiscount|\boff\b|\bfree\b|\bbogo\b|buy one", text, re.I):
            raise ValueError("promotions can't carry prices or discounts (the bill wouldn't match) — "
                             "propose a combo as a new menu item with its own price, then feature it")
        ids = [int(i) for i in (a.get("menu_item_ids") or [])]
        valid = {m["id"]: m["name"] for m in db.list_menu()}
        ids = [i for i in ids if i in valid]
        return {"title": str(a["title"])[:80], "details": str(a.get("details") or "")[:300], "menu_item_ids": ids,
                "items": [valid[i] for i in ids], "days": float(a.get("days") or 7)}
    raise ValueError(f"unknown proposal {kind}")


PROPOSAL_TOOLS = {"propose_price_change": "price_change", "propose_availability": "availability",
                  "propose_new_item": "new_item", "propose_promotion": "promotion"}


def apply_action(action: Dict[str, Any]) -> str:
    """Execute an approved proposal. Returns a human-readable summary."""
    p, kind = action["payload"], action["kind"]
    if kind == "price_change":
        db.upsert_menu_item({"price": p["new_price"]}, p["menu_item_id"])
        return f"{p['name']} is now {CURRENCY}{p['new_price']:.0f} (was {CURRENCY}{p['old_price']:.0f})."
    if kind == "availability":
        db.upsert_menu_item({"available": 1 if p["available"] else 0}, p["menu_item_id"])
        return f"{p['name']} is now {'available' if p['available'] else 'off the menu'}."
    if kind == "new_item":
        item = db.upsert_menu_item({k: p[k] for k in ("name", "category", "price", "description", "station")}
                                   | {"veg": 1 if p["veg"] else 0})
        return f"Added {item['name']} at {CURRENCY}{item['price']:.0f}."
    if kind == "promotion":
        db.add_promotion(p["title"], p["details"], p["menu_item_ids"], p["days"])
        return f"Promotion '{p['title']}' is live for {p['days']:.0f} days — the AI companion will feature it."
    raise ValueError(kind)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

_sessions: Dict[int, List[Dict[str, Any]]] = {}   # staff id -> conversation (kept in memory)
MAX_HISTORY = 24


def reset(staff_id: int) -> None:
    _sessions.pop(staff_id, None)


async def chat(staff_id: int, message: str) -> Dict[str, Any]:
    history = _sessions.setdefault(staff_id, [])
    history.append({"role": "user", "content": message[:4000]})
    tools_used: List[str] = []
    proposals: List[Dict[str, Any]] = []
    reply = ""
    for _ in range(8):
        msg = await gateway.chat([{"role": "system", "content": SYSTEM}, *history], TOOLS, max_tokens=2500)
        calls = msg.get("tool_calls") or []
        history.append({"role": "assistant", "content": msg.get("content") or None,
                        **({"tool_calls": calls} if calls else {})})
        if not calls:
            reply = msg.get("content") or ""
            break
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
                missing = [k for k in _REQUIRED.get(name, []) if k not in args]
                if missing:
                    raise ValueError(f"missing {', '.join(missing)}")
                if name in PROPOSAL_TOOLS:
                    kind = PROPOSAL_TOOLS[name]
                    action = db.add_agent_action(kind, _validate_proposal(kind, args), str(args.get("reason", ""))[:400])
                    proposals.append(action)
                    out: Any = {"proposal_id": action["id"], "status": "waiting for the manager's approval"}
                else:
                    out = _run_read_tool(name, args)
                tools_used.append(name)
            except Exception as e:  # noqa: BLE001 — errors go back to the model so it can adjust
                level = logging.INFO if isinstance(e, (ValueError, KeyError)) else logging.WARNING
                log.log(level, "agent tool %s failed: %s", name, e, exc_info=level == logging.WARNING)
                out = {"error": str(e)}
            history.append({"role": "tool", "tool_call_id": c["id"], "name": name,
                            "content": json.dumps(out, ensure_ascii=False, default=str)[:6000]})
    else:
        log.warning("store manager hit the step limit for staff %s", staff_id)
        reply = reply or "I ran out of steps analysing that — could you narrow the question?"
    _trim(history)
    log.info("store manager answered (tools: %s, proposals: %d)", ",".join(tools_used) or "none", len(proposals))
    return {"reply": reply, "tools_used": tools_used, "proposals": proposals}


def _trim(history: List[Dict[str, Any]]) -> None:
    """Keep the conversation bounded, cutting only at a user message so tool calls stay paired."""
    while len(history) > MAX_HISTORY:
        cut = next((i for i in range(1, len(history)) if history[i]["role"] == "user"), None)
        if cut is None:
            break
        del history[:cut]


# ---------------------------------------------------------------------------
# Briefing: ranked recommendations from the whole dashboard in one call
# ---------------------------------------------------------------------------

BRIEFING_PROMPT = """Here is the café's analytics for the last {period} (JSON). Write the manager's briefing: \
the 4–6 most valuable recommendations to grow sales or fix problems, ranked by expected impact.

Return ONLY a JSON object: {{"headline": "one sentence on how the café is doing", "recommendations": [ ... ]}} \
where each recommendation is:
{{"title": "short imperative", "why": "the data behind it, with numbers", "impact": "high|medium|low",
  "effort": "low|medium|high", "area": "sales|menu|customers|operations|ai",
  "action": null or one of
    {{"kind": "price_change", "menu_item_id": int, "new_price": number}},
    {{"kind": "availability", "menu_item_id": int, "available": bool}},
    {{"kind": "promotion", "title": str, "details": str, "menu_item_ids": [int], "days": number}}  (featuring only — no prices or discounts in the text),
    {{"kind": "new_item", "name": str, "category": str, "price": number, "description": str, "station": "kitchen|bar", "veg": bool}}
}}
Only attach an action when it directly implements the recommendation. Use menu ids from the data.

DATA:
{data}"""


def _briefing_data(p: analytics.Period) -> Dict[str, Any]:
    d = analytics.dashboard(p.key)
    it = d["items"]
    return {
        "kpis": d["kpis"], "findings": d["signals"],
        "top_items": _slim_items(it["top"]), "slow_items": _slim_items(it["slow"]),
        "rising": _slim_items(it["rising"]), "falling": _slim_items(it["falling"]), "unsold": it["unsold"],
        "pairs": it["pairs"][:3], "categories": it["categories"],
        "busy_peaks": d["busy"]["peaks"], "orders_by_weekday": dict(zip(d["busy"]["days"], d["busy"]["by_day"])),
        "operations": {k: v for k, v in d["operations"].items() if k != "tables"},
        "customers": {"repeat_rate": d["customers"]["repeat_rate"], "at_risk_regulars": len(d["customers"]["at_risk"]),
                      "top_spenders": [c["name"] for c in d["customers"]["top"][:3]]},
        "ai_companion": d["ai"],
        "menu": [{k: m[k] for k in ("id", "name", "category", "price", "available")} for m in db.list_menu()],
    }


def _parse_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


async def briefing(period_key: str = "7d") -> Dict[str, Any]:
    p = analytics.period(period_key)
    data = _briefing_data(p)
    prompt = BRIEFING_PROMPT.format(period=p.key, data=json.dumps(data, ensure_ascii=False, default=str))
    msg = await gateway.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
                             None, max_tokens=3000, json_mode=True)
    try:
        parsed = _parse_json(msg.get("content") or "{}")
    except ValueError as e:
        log.warning("briefing: model returned unparseable JSON (%s): %.200s", e, msg.get("content"))
        raise ServiceUnavailable("The AI returned an unreadable briefing — please try again.") from e
    recs = []
    for r in (parsed.get("recommendations") or [])[:6]:
        rec = {k: r.get(k) for k in ("title", "why", "impact", "effort", "area")}
        a = r.get("action")
        if isinstance(a, dict) and a.get("kind") in ("price_change", "availability", "promotion", "new_item"):
            try:
                action = db.add_agent_action(a["kind"], _validate_proposal(a["kind"], a), rec.get("why") or "")
                rec["action_id"] = action["id"]
                rec["action"] = action
            except Exception as e:  # noqa: BLE001 — keep the advice even if the action is malformed
                log.info("dropped invalid briefing action: %s", e)
        recs.append(rec)
    log.info("briefing generated for %s: %d recommendations, %d with actions", p.key, len(recs),
             sum(1 for r in recs if r.get("action_id")))
    return db.save_insights(p.key, {"headline": parsed.get("headline", ""), "recommendations": recs})
