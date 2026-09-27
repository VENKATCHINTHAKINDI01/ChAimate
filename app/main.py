"""Café Companion — FastAPI application entrypoint.

Builds the app: logging, request context & error handling, startup/shutdown, the API routers and static files.
The routes live in app/api/routes/, the live voice engine in app/realtime/, integrations in app/services/.
"""
import asyncio
import logging
import os
import time
import uuid
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging_config import request_id, setup_logging

setup_logging()   # before the other modules start logging

from app.agents import companion as agent  # noqa: E402
from app.api.routes import customer, manager, pages, public, staff, system, table_ws, voice as voice_routes, website  # noqa: E402
from app.core import config, db  # noqa: E402
from app.core import security as auth  # noqa: E402
from app.core.config import (AI_FREE_MINUTES, AI_PRICE_PER_MINUTE, CAFE_NAME, FRONTEND_DIST, PUBLIC_BASE_URL,  # noqa: E402
                             STAFF_PIN, STATIC_DIR)
from app.core.errors import AppError, spawn  # noqa: E402
from app.realtime.hub import hub  # noqa: E402
from app.services import llm_gateway as gateway, metering, realtime_sync, voice  # noqa: E402

log = logging.getLogger("main")
access_log = logging.getLogger("access")

app = FastAPI(title=CAFE_NAME, version="1.0.0",
              description="AI café companion: talk to a friend at your table, order by voice; staff & manager apps.")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
for module in (pages, system, public, voice_routes, customer, staff, manager, table_ws, website):
    app.include_router(module.router)
# `next dev` on :3000 calls this API directly while developing the website
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"], allow_credentials=True)


# ---------------------------------------------------------------------------
# Request ids, access log, error handling
# ---------------------------------------------------------------------------

SLOW_REQUEST_MS = 2000


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Tag every log line with a request id, log each request once, and turn crashes into a clean 500."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    token = request_id.set(rid)
    started = time.time()
    try:
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 — anything not handled by the exception handlers below
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            response = JSONResponse({"detail": "Something went wrong on our side. Please try again.",
                                     "code": "internal_error", "request_id": rid}, status_code=500)
        ms = (time.time() - started) * 1000
        response.headers["X-Request-ID"] = rid
        # always revalidate pages and assets (cheap 304s via ETag) so a new UI release shows up without a hard refresh
        if request.url.path.startswith("/static") or request.url.path in ("/table", "/staff", "/"):
            response.headers["Cache-Control"] = "no-cache"
        path = request.url.path
        if not path.startswith("/static"):
            level = logging.ERROR if response.status_code >= 500 else logging.WARNING if (
                response.status_code >= 400 and response.status_code not in (401, 404)) or ms > SLOW_REQUEST_MS else logging.INFO
            access_log.log(level, "%s %s -> %s in %.0f ms", request.method, path, response.status_code, ms,
                           extra={"path": path, "status": response.status_code, "duration_ms": round(ms)})
        return response
    finally:
        request_id.reset(token)   # only after the access line is written, so it carries the id


def _error_body(message: str, code: str, **extra: Any) -> Dict[str, Any]:
    return {"detail": message, "code": code, "request_id": request_id.get(), **extra}


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    log.log(exc.log_level, "%s on %s %s: %s", type(exc).__name__, request.method, request.url.path, exc.message)
    return JSONResponse(_error_body(exc.message, exc.code), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    problems = [f"{'.'.join(str(p) for p in e.get('loc', [])[1:]) or 'body'}: {e.get('msg')}" for e in exc.errors()][:5]
    log.info("invalid request to %s: %s", request.url.path, "; ".join(problems))
    return JSONResponse(_error_body("Some of the information sent was invalid.", "validation_error", problems=problems),
                        status_code=422)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        log.error("HTTP %s on %s: %s", exc.status_code, request.url.path, exc.detail)
    return JSONResponse(_error_body(str(exc.detail), f"http_{exc.status_code}"), status_code=exc.status_code,
                        headers=getattr(exc, "headers", None))


# ---------------------------------------------------------------------------
# Startup & shutdown
# ---------------------------------------------------------------------------

def _config_report() -> None:
    """Log what is (and isn't) configured — names only, never secret values."""
    if not os.getenv("GROQ_API_KEY") and gateway.PRIMARY.startswith("groq/"):
        log.error("GROQ_API_KEY is not set — the AI companion and store manager cannot reply")
    if not voice.enabled():
        log.info("SARVAM_API_KEY not set — customers will use the browser's built-in voice")
    if STAFF_PIN == "1234":
        log.warning("STAFF_PIN is still the default 1234 — change it in .env before going live")
    if PUBLIC_BASE_URL.startswith("http://localhost"):
        log.info("PUBLIC_BASE_URL is localhost — table QR codes will only work on this machine")
    log.info("config: db=%s redis=%s llm=%s fallbacks=%s voice=%s free_min=%s price/min=%s",
             db.backend(), config.REDIS_URL.split("@")[-1], gateway.PRIMARY,
             [d["model"] for d in gateway.health()[1:]], "sarvam" if voice.enabled() else "browser",
             AI_FREE_MINUTES, AI_PRICE_PER_MINUTE)


@app.on_event("startup")
async def _startup() -> None:
    _config_report()
    await metering.clear_sessions()
    if not await metering.ping():
        log.warning("Redis is not reachable at startup — AI usage metering/billing is paused until it is")
    db.init_db(seed_staff=[
        {"username": "manager", "name": "Manager", "role": "manager", "pin_hash": auth.hash_pin(STAFF_PIN)},
        {"username": "kitchen", "name": "Kitchen", "role": "kitchen", "pin_hash": auth.hash_pin("1111")},
        {"username": "bar", "name": "Bar", "role": "bar", "pin_hash": auth.hash_pin("2222")},
        {"username": "waiter", "name": "Waiter", "role": "waiter", "pin_hash": auth.hash_pin("3333")},
    ])
    async def on_db_change(msg: Dict[str, Any]) -> None:
        if "menu_items" in (msg.get("tables") or {}):
            agent.invalidate_menu_cache()          # an outside edit (e.g. Supabase table editor) changed the menu
        await hub.to_staff(msg)

    spawn(realtime_sync.start(on_db_change), "supabase-realtime")
    spawn(_loop_watchdog(), "loop-watchdog")
    log.info("%s is ready", CAFE_NAME)


async def _loop_watchdog() -> None:
    """Warn when the event loop is blocked (every table's audio and every staff screen freeze while it is)."""
    while True:
        t = time.monotonic()
        await asyncio.sleep(0.5)
        lag = time.monotonic() - t - 0.5
        if lag > 1.0:
            log.warning("event loop was blocked for %.1fs — something ran synchronously on the server's main loop", lag)


@app.on_event("shutdown")
async def _shutdown() -> None:
    log.info("shutting down — %d live table connection(s)", sum(len(s) for s in hub.tables.values()))
    await realtime_sync.stop()
    db.close()


# The Deccan House website (Next.js static export in frontend/out) is served at "/" — mounted last, so the
# API, /table, /staff and /static routes above always take precedence.
if (FRONTEND_DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="website")
else:
    log.info("website not built yet (cd frontend && npm run build) — / redirects to the table app")
