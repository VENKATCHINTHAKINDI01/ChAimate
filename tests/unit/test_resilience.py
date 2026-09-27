"""External services failing must degrade gracefully: Sarvam retries, background tasks, Redis outages."""
import asyncio

import httpx
import pytest
import redis.asyncio as aioredis

from app.core import errors
from app.core.errors import VoiceError
from app.services import metering, voice
from tests.conftest import read_log


@pytest.fixture
def sarvam(monkeypatch):
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(503 if "text-to-speech" in str(req.url) else 401, text="busy")

    monkeypatch.setattr(voice, "_client", httpx.AsyncClient(base_url="https://api.sarvam.ai", transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(voice, "SARVAM_API_KEY", "x")
    return calls


def test_tts_503_is_retried_once(sarvam):
    with pytest.raises(VoiceError):
        asyncio.run(voice.synthesize("hi"))
    assert sarvam["n"] == 2


def test_stt_401_is_not_retried_and_explains(sarvam):
    with pytest.raises(VoiceError, match="API key"):
        asyncio.run(voice.transcribe(b"x" * 3000, "a.wav", "audio/wav"))
    assert sarvam["n"] == 1


def test_background_task_failures_are_logged(client):
    async def bad():
        raise ValueError("background kaboom")

    async def run():
        errors.spawn(bad(), "test-task")
        await asyncio.sleep(0.05)

    asyncio.run(run())
    assert "background task 'test-task' failed" in read_log("errors.log")


def test_metering_degrades_without_redis(monkeypatch):
    real = aioredis.from_url
    monkeypatch.setattr(aioredis, "from_url", lambda *a, **k: real("redis://localhost:1/0", socket_connect_timeout=0.2, decode_responses=True))
    metering._clients.clear()

    async def run():
        for _ in range(3):
            await metering.record_turn(1, None, role="assistant", prompt_tokens=10)
        return await metering.visit_usage(1)

    try:
        assert asyncio.run(run()).get("unavailable") is True
    finally:
        metering._clients.clear()
