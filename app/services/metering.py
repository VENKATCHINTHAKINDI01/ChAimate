"""Redis-backed live metering of AI conversations: chat minutes, tokens, speech usage and cost.

Billing unit = "chat minutes": each clock minute in which the table actually talked with the AI counts once
(idle time with the app open is free). Every table visit gets AI_FREE_MINUTES free, then AI_PRICE_PER_MINUTE.

Keys
  visit:{table}                  current visit id for a table (cleared when the bill is settled)
  usage:{visit}                  hash: table_id, started_at, turns, tokens_in, tokens_out, llm_cost_usd,
                                       stt_seconds, tts_chars, last_model, last_active
  usage:{visit}:minutes          set of minute buckets with activity
  usage:{visit}:customers        set of logged-in customer ids at that visit
  usage:customer:{id}            lifetime hash per customer (turns, tokens, cost, minutes)
  usage:day:{YYYYMMDD}           daily totals hash (+ :minutes set of "visit:minute")
  live:sessions                  hash session_id -> JSON of who is talking right now
  chat:events                    stream of per-turn events for the manager's live monitor
"""
import json
import logging
import time
from typing import Any, Dict, Optional

import redis.asyncio as aioredis

from app.core.config import AI_FREE_MINUTES, AI_PRICE_PER_MINUTE, MONITOR_CHAT_TEXT, REDIS_URL

log = logging.getLogger("metering")
_last_warn: Dict[str, float] = {}


def _warn(what: str, e: BaseException) -> None:
    """Metering must never break a conversation, but a Redis outage shouldn't flood the log either:
    one warning per operation per minute, full traceback at DEBUG."""
    now = time.time()
    if now - _last_warn.get(what, 0) > 60:
        _last_warn[what] = now
        log.warning("%s failed (%s: %s) — AI usage metering degraded; is Redis running at %s?",
                    what, type(e).__name__, e, REDIS_URL.split("@")[-1])
    log.debug("%s failed", what, exc_info=e)

_clients: Dict[int, aioredis.Redis] = {}


class _LoopLocalRedis:
    """One async Redis client per event loop (async clients can't be shared across loops)."""

    def __getattr__(self, name: str):
        import asyncio
        loop_id = id(asyncio.get_event_loop())
        client = _clients.get(loop_id)
        if client is None:
            client = _clients[loop_id] = aioredis.from_url(
                REDIS_URL, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
        return getattr(client, name)


r = _LoopLocalRedis()
EVENTS_MAXLEN = 5000
DAY_TTL = 60 * 60 * 24 * 120


def _day(ts: Optional[float] = None) -> str:
    return time.strftime("%Y%m%d", time.localtime(ts or time.time()))


async def ping() -> bool:
    try:
        return bool(await r.ping())
    except Exception:  # noqa: BLE001
        return False


def price_for(minutes: int) -> Dict[str, Any]:
    billable = max(0, minutes - AI_FREE_MINUTES)
    return {
        "minutes": minutes,
        "free_minutes": AI_FREE_MINUTES,
        "free_left": max(0, AI_FREE_MINUTES - minutes),
        "billable_minutes": billable,
        "price_per_minute": AI_PRICE_PER_MINUTE,
        "amount": round(billable * AI_PRICE_PER_MINUTE, 2),
    }


async def visit_id(table_id: int) -> str:
    key = f"visit:{table_id}"
    vid = await r.get(key)
    if not vid:
        vid = f"{table_id}-{int(time.time())}"
        if await r.set(key, vid, nx=True):
            await r.hset(f"usage:{vid}", mapping={"table_id": table_id, "started_at": time.time()})
        else:
            vid = await r.get(key)
    return vid


async def _mark_minute(vid: str, customer_id: Optional[int]) -> None:
    minute = int(time.time() // 60)
    added = await r.sadd(f"usage:{vid}:minutes", minute)
    if added:
        day = _day()
        await r.hincrby(f"usage:day:{day}", "minutes", 1)
        await r.expire(f"usage:day:{day}", DAY_TTL)
        if customer_id:
            await r.hincrby(f"usage:customer:{customer_id}", "minutes", 1)


async def record_turn(table_id: int, customer: Optional[Dict[str, Any]], *, role: str, text: str = "",
                      model: str = "", prompt_tokens: int = 0, completion_tokens: int = 0, cost_usd: float = 0.0,
                      latency_s: Optional[float] = None, stt_seconds: float = 0.0, tts_chars: int = 0) -> None:
    """Called once per user utterance and once per AI reply (tokens/cost summed over its tool round-trips)."""
    try:
        vid = await visit_id(table_id)
        cid = customer["id"] if customer else None
        now = time.time()
        await _mark_minute(vid, cid)
        tokens = prompt_tokens + completion_tokens
        pipe = r.pipeline()
        u = f"usage:{vid}"
        pipe.hset(u, mapping={"last_active": now, **({"last_model": model} if model else {})})
        if role == "assistant":
            pipe.hincrby(u, "turns", 1)
        if tokens:
            pipe.hincrby(u, "tokens_in", prompt_tokens)
            pipe.hincrby(u, "tokens_out", completion_tokens)
        if cost_usd:
            pipe.hincrbyfloat(u, "llm_cost_usd", cost_usd)
        if stt_seconds:
            pipe.hincrbyfloat(u, "stt_seconds", round(stt_seconds, 2))
        if tts_chars:
            pipe.hincrby(u, "tts_chars", tts_chars)
        if cid:
            pipe.sadd(f"{u}:customers", cid)
            c = f"usage:customer:{cid}"
            if role == "assistant":
                pipe.hincrby(c, "turns", 1)
            if tokens:
                pipe.hincrby(c, "tokens", tokens)
            if cost_usd:
                pipe.hincrbyfloat(c, "llm_cost_usd", cost_usd)
        d = f"usage:day:{_day()}"
        if role == "assistant":
            pipe.hincrby(d, "turns", 1)
        if tokens:
            pipe.hincrby(d, "tokens", tokens)
        if cost_usd:
            pipe.hincrbyfloat(d, "llm_cost_usd", cost_usd)
        if stt_seconds:
            pipe.hincrbyfloat(d, "stt_seconds", round(stt_seconds, 2))
        if tts_chars:
            pipe.hincrby(d, "tts_chars", tts_chars)
        pipe.expire(d, DAY_TTL)
        event = {"ts": now, "table": table_id, "visit": vid, "role": role,
                 "customer": customer["name"] if customer else "guest", "tokens": tokens,
                 "cost": round(cost_usd, 6), "model": model or "", "chars": len(text)}
        if latency_s is not None:
            event["latency"] = round(latency_s, 2)
        if MONITOR_CHAT_TEXT and text:
            event["text"] = text[:160]
        pipe.xadd("chat:events", event, maxlen=EVENTS_MAXLEN, approximate=True)
        await pipe.execute()
    except Exception as e:  # noqa: BLE001 — metering must never break the conversation
        _warn("metering", e)


async def visit_usage(table_id: int) -> Dict[str, Any]:
    """Current visit's usage + price for a table (zeros if nothing yet / Redis down)."""
    try:
        vid = await r.get(f"visit:{table_id}")
        if not vid:
            return {"visit": None, **price_for(0)}
        h = await r.hgetall(f"usage:{vid}")
        minutes = await r.scard(f"usage:{vid}:minutes")
        return {
            "visit": vid,
            "turns": int(h.get("turns", 0)),
            "tokens_in": int(h.get("tokens_in", 0)),
            "tokens_out": int(h.get("tokens_out", 0)),
            "llm_cost_usd": round(float(h.get("llm_cost_usd", 0)), 6),
            "stt_seconds": round(float(h.get("stt_seconds", 0)), 1),
            "tts_chars": int(h.get("tts_chars", 0)),
            "started_at": float(h.get("started_at", 0) or 0),
            "last_active": float(h.get("last_active", 0) or 0),
            "last_model": h.get("last_model", ""),
            "customer_ids": sorted(int(c) for c in await r.smembers(f"usage:{vid}:customers")),
            **price_for(minutes),
        }
    except Exception as e:  # noqa: BLE001
        _warn("visit_usage", e)
        return {"visit": None, **price_for(0), "unavailable": True}


async def close_visit(table_id: int) -> Optional[Dict[str, Any]]:
    """On bill settlement: return the final usage and start a fresh visit next time."""
    usage = await visit_usage(table_id)
    if not usage.get("visit"):
        return None
    try:
        vid = usage["visit"]
        await r.delete(f"visit:{table_id}")
        for k in (f"usage:{vid}", f"usage:{vid}:minutes", f"usage:{vid}:customers"):
            await r.expire(k, 60 * 60 * 24 * 7)   # keep a week for audits; SQLite has the permanent record
    except Exception as e:  # noqa: BLE001
        _warn("close_visit", e)
    return usage


# ---------- live sessions (who is talking right now) ----------

async def session_open(session_id: str, table_id: int, customer: Optional[Dict[str, Any]]) -> None:
    try:
        await r.hset("live:sessions", session_id, json.dumps({
            "table_id": table_id, "customer": customer["name"] if customer else "guest",
            "customer_id": customer["id"] if customer else None, "since": time.time()}))
    except Exception as e:  # noqa: BLE001
        _warn("session_open", e)


async def session_close(session_id: str) -> None:
    try:
        await r.hdel("live:sessions", session_id)
    except Exception as e:  # noqa: BLE001
        _warn("session_close", e)


async def clear_sessions() -> None:
    """Server restart: nobody is connected any more."""
    try:
        await r.delete("live:sessions")
    except Exception as e:  # noqa: BLE001
        _warn("clear_sessions", e)


# ---------- manager monitor ----------

async def dashboard() -> Dict[str, Any]:
    try:
        sessions = [json.loads(v) for v in (await r.hgetall("live:sessions")).values()]
        tables = sorted({s["table_id"] for s in sessions})
        live = []
        for t in tables:
            u = await visit_usage(t)
            live.append({**u, "table_id": t, "people": [s["customer"] for s in sessions if s["table_id"] == t]})
        day = await r.hgetall(f"usage:day:{_day()}")
        raw_events = await r.xrevrange("chat:events", count=40)
        events = [{"id": i, **f} for i, f in raw_events]
        return {
            "redis": True,
            "live": live,
            "today": {
                "turns": int(day.get("turns", 0)),
                "tokens": int(day.get("tokens", 0)),
                "minutes": int(day.get("minutes", 0)),
                "llm_cost_usd": round(float(day.get("llm_cost_usd", 0)), 4),
                "stt_minutes": round(float(day.get("stt_seconds", 0)) / 60, 1),
                "tts_chars": int(day.get("tts_chars", 0)),
            },
            "events": events,
        }
    except Exception as e:  # noqa: BLE001
        _warn("dashboard", e)
        return {"redis": False, "live": [], "today": {}, "events": []}


async def customer_totals(customer_id: int) -> Dict[str, Any]:
    try:
        h = await r.hgetall(f"usage:customer:{customer_id}")
        return {"turns": int(h.get("turns", 0)), "tokens": int(h.get("tokens", 0)),
                "minutes": int(h.get("minutes", 0)), "llm_cost_usd": round(float(h.get("llm_cost_usd", 0)), 4)}
    except Exception as e:  # noqa: BLE001
        _warn("customer_totals", e)
        return {}
