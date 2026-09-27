"""When every model is rate-limited, the gateway waits briefly and retries once on the lighter model."""
import asyncio

import litellm
import pytest

from app.core.errors import LLMUnavailable
from app.services import llm_gateway as gateway


@pytest.fixture(autouse=True)
def _no_wait(monkeypatch):
    real_sleep = asyncio.sleep
    monkeypatch.setattr(gateway.asyncio, "sleep", lambda s: real_sleep(0))


async def _refuse(**kw):
    raise litellm.RateLimitError("No deployments available for selected model, Try again in 1114 seconds", "groq", "x")


def test_rate_limit_retries_once_on_fallback(monkeypatch):
    calls = []

    async def ok(**kw):
        calls.append(kw["model"])
        return "RAW"

    monkeypatch.setattr(gateway.router, "acompletion", _refuse)
    monkeypatch.setattr(gateway.litellm, "acompletion", ok)
    asyncio.run(gateway.chat_stream([{"role": "user", "content": "hi"}]))
    assert calls == [gateway.FALLBACK]
    assert gateway.recently_limited()


def test_still_limited_gives_friendly_error(monkeypatch):
    async def still(**kw):
        raise litellm.RateLimitError("Rate limit reached: tokens per minute", "groq", "x")

    monkeypatch.setattr(gateway.router, "acompletion", _refuse)
    monkeypatch.setattr(gateway.litellm, "acompletion", still)
    with pytest.raises(LLMUnavailable, match="busy"):
        asyncio.run(gateway.chat_stream([{"role": "user", "content": "hi"}]))
