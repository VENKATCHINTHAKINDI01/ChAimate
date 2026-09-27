"""Supabase Realtime: stream database changes to the staff app.

The app already pushes live updates for changes it makes itself. This listener adds the database's own change
feed, so edits made anywhere else — the Supabase table editor, a second server, a script — also appear on staff
screens instantly. Bursts of changes are coalesced into one refresh.

Enabled when DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY are all set.
"""
import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, Optional

from app.core import db
from app.core.config import DB_SCHEMA, SUPABASE_SERVICE_KEY, SUPABASE_URL

log = logging.getLogger("supabase.realtime")
# the client logs every reconnect attempt as ERROR; we report the outcome ourselves, once
logging.getLogger("realtime").setLevel(logging.CRITICAL)

OnChange = Callable[[Dict[str, Any]], Awaitable[None]]

_client = None
_status: Dict[str, Any] = {"enabled": False, "state": "off", "events": 0}
_pending: Dict[str, str] = {}          # table -> last event type, flushed together
_flush_task: Optional[asyncio.Task] = None
DEBOUNCE_S = 0.4


def enabled() -> bool:
    return bool(db.IS_PG and SUPABASE_URL and SUPABASE_SERVICE_KEY)


def status() -> Dict[str, Any]:
    return dict(_status)


async def start(on_change: OnChange) -> None:
    """Connect and subscribe; never raises — the app works without the feed (it has its own push)."""
    global _client
    if not enabled():
        log.info("Supabase Realtime feed off (needs DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY)")
        return
    from realtime import AsyncRealtimeClient

    _status.update(enabled=True, state="connecting")
    loop = asyncio.get_running_loop()

    def on_db_change(payload: Dict[str, Any]) -> None:
        data = payload.get("data", payload) if isinstance(payload, dict) else {}
        table, event = data.get("table", "?"), data.get("type") or data.get("eventType", "?")
        _status["events"] += 1
        _pending[table] = event
        log.debug("db change: %s on %s", event, table)
        loop.call_soon_threadsafe(_schedule_flush, on_change)

    def on_subscribe(state, err: Optional[Exception] = None) -> None:
        _status["state"] = str(getattr(state, "value", state)).lower()
        if err:
            log.warning("Supabase Realtime subscription problem: %s (%s)", _status["state"], err)
        else:
            log.info("Supabase Realtime: %s — streaming %s", _status["state"], ", ".join(db.REALTIME_TABLES))

    try:
        _client = AsyncRealtimeClient(f"{SUPABASE_URL}/realtime/v1", token=SUPABASE_SERVICE_KEY, auto_reconnect=True)
        await _client.connect()
        channel = _client.channel("cafe-db-changes")
        for table in db.REALTIME_TABLES:
            channel.on_postgres_changes("*", on_db_change, table=table, schema=DB_SCHEMA)
        await channel.subscribe(on_subscribe)
    except Exception as e:  # noqa: BLE001
        _status["state"] = "error"
        log.warning("could not start Supabase Realtime (%s: %s) — staff screens still update from the app's own "
                    "events", type(e).__name__, e)


def _schedule_flush(on_change: OnChange) -> None:
    global _flush_task
    if _flush_task is None or _flush_task.done():
        _flush_task = asyncio.ensure_future(_flush(on_change))


async def _flush(on_change: OnChange) -> None:
    await asyncio.sleep(DEBOUNCE_S)
    changes = dict(_pending)
    _pending.clear()
    try:
        await on_change({"type": "db_change", "tables": changes})
    except Exception:  # noqa: BLE001
        log.exception("forwarding realtime change failed")


async def stop() -> None:
    global _client
    if _client is not None:
        try:
            await _client.close()
        except Exception as e:  # noqa: BLE001
            log.debug("realtime close: %s", e)
        _client = None
        _status["state"] = "off"
