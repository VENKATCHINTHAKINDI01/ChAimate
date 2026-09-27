"""Application errors and safe background tasks.

Raise an AppError subclass anywhere in a request path; the global handler in main.py turns it into a JSON response
with the right status code and the request id, and logs it at the right level. Unknown exceptions become a
generic 500 (details go to the log, never to the client).
"""
import asyncio
import logging
from typing import Any, Awaitable, Dict, Optional

log = logging.getLogger("errors")


class AppError(Exception):
    status = 400
    code = "bad_request"
    log_level = logging.INFO

    def __init__(self, message: str, *, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.details = details or {}


class NotFound(AppError):
    status, code = 404, "not_found"


class Conflict(AppError):
    status, code = 409, "conflict"


class Forbidden(AppError):
    status, code = 403, "forbidden"


class ServiceUnavailable(AppError):
    """A dependency (LLM, voice, Redis) is down or rate-limited — usually worth retrying later."""
    status, code, log_level = 503, "service_unavailable", logging.WARNING


class LLMUnavailable(ServiceUnavailable):
    code = "llm_unavailable"


class VoiceError(ServiceUnavailable):
    code = "voice_unavailable"


# ---------------------------------------------------------------------------
# Background tasks that never fail silently
# ---------------------------------------------------------------------------

_background: "set[asyncio.Task]" = set()


def spawn(coro: Awaitable[Any], name: str) -> asyncio.Task:
    """Run a coroutine in the background, keep a reference (so it isn't garbage-collected mid-flight)
    and log any exception it raises instead of losing it as 'Task exception was never retrieved'."""
    task = asyncio.ensure_future(coro)
    try:
        task.set_name(name)
    except AttributeError:  # pragma: no cover
        pass
    _background.add(task)

    def _done(t: asyncio.Task) -> None:
        _background.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            log.error("background task %r failed: %s", name, exc, exc_info=exc)

    task.add_done_callback(_done)
    return task


def friendly(exc: BaseException) -> str:
    """A short, customer-safe explanation of what went wrong."""
    if isinstance(exc, LLMUnavailable):
        return "I'm having a little trouble thinking right now — give me a moment and try again."
    if isinstance(exc, VoiceError):
        return "My voice isn't working for a moment — I'll reply in text."
    if isinstance(exc, ServiceUnavailable):
        return "Something is busy right now — please try again in a moment."
    if isinstance(exc, AppError):
        return exc.message
    return "Sorry, I had a glitch. Please try again."
