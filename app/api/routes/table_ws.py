"""The customer's live conversation socket: /ws/table/{table_id}."""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core import db
from app.core import security as auth
from app.core.errors import friendly, spawn
from app.core.logging_config import request_id
from app.realtime.conversation import VoiceConnection
from app.realtime.hub import hub

router = APIRouter()
log = logging.getLogger("main")


@router.websocket("/ws/table/{table_id}")
async def table_ws(ws: WebSocket, table_id: int):
    token = ws.cookies.get("cust_token")

    def lookup():
        if not db.get_table(table_id):
            return False, None
        cid_ = db.token_user(token, "customer", auth.CUSTOMER_TOKEN_AGE) if token else None
        return True, (db.get_customer(cid_) if cid_ else None)

    table_ok, customer = await asyncio.to_thread(lookup)
    if not table_ok:
        await ws.close(code=4404)
        return
    await ws.accept()
    hub.tables.setdefault(table_id, set()).add(ws)
    conn = VoiceConnection(ws, table_id, customer)
    hub.companions.setdefault(table_id, set()).add(conn)
    request_id.set(f"t{table_id}-{conn.session_key[:6]}")   # every log line of this session carries it
    log.info("table %s connected (%s)", table_id, f"customer #{customer['id']}" if customer else "guest")
    started = time.time()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                if not isinstance(msg, dict):
                    raise ValueError("message must be a JSON object")
            except ValueError:
                log.warning("table %s sent an invalid message (%d bytes)", table_id, len(raw))
                continue
            try:
                await conn.handle(msg)
            except WebSocketDisconnect:
                raise
            except Exception as e:  # noqa: BLE001 — one bad message must not end the customer's session
                log.exception("error handling %r message from table %s", msg.get("type"), table_id)
                try:
                    await conn.send({"type": "error", "message": friendly(e)})
                except Exception:  # noqa: BLE001
                    break
    except WebSocketDisconnect as e:
        log.info("table %s disconnected after %.0fs (code %s)", table_id, time.time() - started, e.code)
    except Exception:  # noqa: BLE001
        log.exception("table %s connection crashed", table_id)
    finally:
        hub.tables.get(table_id, set()).discard(ws)
        hub.companions.get(table_id, set()).discard(conn)
        # cleanup runs as its own task: if this handler is being cancelled (client vanished, server shutting down)
        # the metering close and the end-of-chat summary must still happen
        spawn(_after_disconnect(conn, table_id), f"cleanup-table-{table_id}")


async def _after_disconnect(conn: VoiceConnection, table_id: int) -> None:
    await conn.close()
    await hub.to_staff({"type": "table_live", "table_id": table_id, "live": bool(hub.tables.get(table_id))})
