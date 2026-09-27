"""Central logging: console + rotating file, request/session correlation ids, secret redaction, optional JSON.

Environment:
  LOG_LEVEL   DEBUG | INFO (default) | WARNING | ERROR
  LOG_FORMAT  text (default) | json   — json is one object per line, ready for Loki/ELK/CloudWatch
  LOG_DIR     directory for cafe.log (default ./logs); set to "" to log to the console only
"""
import contextvars
import json
import logging
import logging.handlers
import os
import re
import time
from typing import Optional

# Correlates every log line with the HTTP request or voice session that produced it.
request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

_SECRET_PATTERNS = [
    re.compile(r"\b(gsk_|sk-ant-|sk-or-|sk-|sk_)[A-Za-z0-9_\-]{8,}"),                     # API keys
    re.compile(r"(api[-_]?(subscription[-_])?key['\"]?\s*[:=]\s*['\"]?)[^\s'\",}]+", re.I),  # key=value forms
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{12,}"),
    re.compile(r"\b(sb_secret_|sb_publishable_)[A-Za-z0-9_\-]{8,}"),                          # Supabase keys
    re.compile(r"\b(eyJ)[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),       # JWTs (service_role)
    re.compile(r"(postgres(?:ql)?://[^:/@\s]+:)[^@\s]+(?=@)"),                                   # DB passwords in URLs
]


def redact(text: str) -> str:
    for pat in _SECRET_PATTERNS:
        text = pat.sub(lambda m: (m.group(1) if m.lastindex else "") + "***", text)
    return text


class ContextFilter(logging.Filter):
    """Adds request_id to every record and scrubs secrets from the final message."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        if isinstance(record.msg, str) and not record.args:
            record.msg = redact(record.msg)
        elif record.args:
            try:
                record.msg = redact(record.getMessage())
                record.args = ()
            except Exception:  # noqa: BLE001 — never let logging itself fail
                pass
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(record.created)) + f".{int(record.msecs):03d}",
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "msg": record.getMessage(),
        }
        for key in ("table_id", "customer_id", "staff", "path", "status", "duration_ms", "model", "event"):
            if hasattr(record, key):
                out[key] = getattr(record, key)
        if record.exc_info:
            out["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(out, ensure_ascii=False, default=str)


TEXT_FORMAT = "%(asctime)s %(levelname)-7s %(name)-14s [%(request_id)s] %(message)s"
_configured = False


def setup_logging(level: Optional[str] = None) -> None:
    global _configured
    if _configured:
        return
    level_name = (level or os.getenv("LOG_LEVEL", "INFO")).upper()
    fmt = os.getenv("LOG_FORMAT", "text").lower()
    log_dir = os.getenv("LOG_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs"))

    formatter: logging.Formatter = JsonFormatter() if fmt == "json" else logging.Formatter(TEXT_FORMAT)
    handlers: list = [logging.StreamHandler()]
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        handlers.append(logging.handlers.RotatingFileHandler(
            os.path.join(log_dir, "cafe.log"), maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"))
        # errors also go to their own file so problems are easy to find
        err = logging.handlers.RotatingFileHandler(
            os.path.join(log_dir, "errors.log"), maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
        err.setLevel(logging.ERROR)
        handlers.append(err)

    root = logging.getLogger()
    root.setLevel(level_name)
    for h in list(root.handlers):
        root.removeHandler(h)
    ctx = ContextFilter()
    for h in handlers:
        h.setFormatter(formatter)
        h.addFilter(ctx)
        root.addHandler(h)

    # Third-party libraries are chatty at INFO; keep their warnings and errors only.
    for noisy in ("httpx", "httpcore", "openai", "urllib3", "asyncio", "multipart", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    # LiteLLM prints multi-page tracebacks for every fallback attempt; the gateway logs one clear line instead
    for noisy in ("LiteLLM", "litellm", "LiteLLM Router", "LiteLLM Proxy"):
        logging.getLogger(noisy).setLevel(logging.CRITICAL)
    # uvicorn's own loggers should flow through our handlers/format
    for name in ("uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
    _configured = True
