"""Shared test setup.

Every test runs against a throw-away SQLite database, Redis database 15 and a temporary log folder, with the
LLM and Sarvam replaced by scripted fakes — so the suite never touches Supabase or spends API quota.
Requires a local Redis (`brew services start redis`), like the app itself.
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="cafe-tests-")
os.environ.update(
    DB_PATH=os.path.join(_TMP, "test.db"), DATABASE_URL="", SUPABASE_URL="", SUPABASE_SERVICE_KEY="",
    SARVAM_API_KEY="", REDIS_URL="redis://localhost:6379/15", LOG_DIR=os.path.join(_TMP, "logs"), LOG_LEVEL="INFO",
    STAFF_PIN="1234",
)
os.environ.setdefault("GROQ_API_KEY", "test-key")   # never used: the LLM is faked below

import asyncio  # noqa: E402
import logging  # noqa: E402

import pytest  # noqa: E402
import redis  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.agents import companion  # noqa: E402
from app.main import app  # noqa: E402

LOG_DIR = os.environ["LOG_DIR"]


def read_log(name: str = "cafe.log") -> str:
    for h in logging.getLogger().handlers:
        h.flush()
    with open(os.path.join(LOG_DIR, name), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="session", autouse=True)
def _clean_redis():
    r = redis.Redis.from_url(os.environ["REDIS_URL"])
    try:
        r.flushdb()
    except redis.ConnectionError:
        pytest.exit("These tests need a local Redis on localhost:6379 (brew services start redis)", returncode=2)
    yield
    r.flushdb()


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:        # runs startup: creates tables, seeds the menu and staff accounts
        yield c


def login_staff(username: str, pin: str) -> TestClient:
    c = TestClient(app)
    assert c.post("/api/staff/login", json={"username": username, "pin": pin}).status_code == 200
    return c


def drain(ws, until: str = "assistant_done"):
    """Read socket messages until one of type `until` (the end of a companion reply by default)."""
    out = []
    while True:
        m = ws.receive_json()
        out.append(m)
        if m["type"] in (until, "error"):
            return out


@pytest.fixture
def fake_llm(monkeypatch):
    """Replace the LLM with a script: `fake_llm(fn)` where fn(session, last_user_text) is an async generator."""
    def install(script):
        async def respond(self):
            # a fake reply adds no assistant turn, so user turns merge — the newest line is the latest message
            last = self.history[-1]["content"].split(self.CONTEXT_MARK)[0].strip().split("\n")[-1] if self.history else ""
            async for piece in script(self, last):
                yield piece
        monkeypatch.setattr(companion.TableSession, "respond", respond)
    install(_default_script)
    return install


async def _default_script(session, last):
    for word in ["Arre, ", "good evening! ", "What should I call you?"]:
        await asyncio.sleep(0)
        yield word
