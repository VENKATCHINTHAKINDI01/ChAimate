"""Health check and browser error reporting."""
import logging
import time
from typing import Any, Dict, List

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core import db
from app.services import llm_gateway as gateway, metering, realtime_sync, voice

router = APIRouter(tags=["system"])
log = logging.getLogger("main")


@router.get("/api/health")
async def health():
    """For uptime monitors: 200 when the database works; Redis/AI issues are reported as degraded."""
    checks: Dict[str, Any] = {}
    try:
        with db.db() as conn:
            conn.execute("SELECT 1").fetchone()
        checks["database"] = "ok"
    except Exception as e:  # noqa: BLE001
        log.error("health: database check failed: %s", e)
        checks["database"] = "error"
    checks["database_backend"] = db.backend()
    checks["realtime"] = realtime_sync.status()["state"]
    checks["redis"] = "ok" if await metering.ping() else "unavailable"
    checks["voice"] = "sarvam" if voice.enabled() else "browser"
    checks["llm"] = gateway.PRIMARY
    ok = checks["database"] == "ok"
    status = "ok" if ok and checks["redis"] == "ok" else "degraded" if ok else "down"
    return JSONResponse({"status": status, "checks": checks}, status_code=200 if ok else 503)


class ClientError(BaseModel):
    message: str
    source: str = ""
    page: str = ""
    stack: str = ""


_client_log_budget: Dict[str, List[float]] = {}


@router.post("/api/client-log", status_code=204)
async def client_log(body: ClientError, request: Request):
    """Browser errors from the customer and staff apps, so they show up in the server log (rate-limited)."""
    ip = request.client.host if request.client else "?"
    now = time.time()
    recent = [t for t in _client_log_budget.get(ip, []) if now - t < 60]
    if len(recent) >= 10:
        return Response(status_code=204)
    _client_log_budget[ip] = recent + [now]
    logging.getLogger("browser").warning("[%s] %s | %s | %s", body.page[:40], body.message[:300], body.source[:120],
                                         body.stack[:500].replace("\n", " / "))
    return Response(status_code=204)
