"""Sarvam AI speech services: Saaras (speech-to-text) and Bulbul (text-to-speech)."""
import asyncio
import logging
import time
from typing import Any, Dict, Optional, Tuple

import httpx

from app.core.errors import VoiceError
from app.core.config import SARVAM_API_KEY, SARVAM_STT_MODEL, SARVAM_TTS_MODEL

log = logging.getLogger("voice")

SARVAM_BASE = "https://api.sarvam.ai"

# Languages Bulbul can speak. STT can detect more; anything else is spoken in en-IN.
TTS_LANGUAGES = {
    "en-IN", "hi-IN", "te-IN", "ta-IN", "kn-IN", "ml-IN",
    "mr-IN", "bn-IN", "gu-IN", "pa-IN", "od-IN",
}

# Bulbul v3 voices offered in the customer UI (id -> label)
VOICES = {
    "priya": "Priya (female, warm)",
    "ritu": "Ritu (female, friendly)",
    "kavya": "Kavya (female, soft)",
    "neha": "Neha (female, bright)",
    "shubh": "Shubh (male, friendly)",
    "aditya": "Aditya (male, calm)",
    "rahul": "Rahul (male, energetic)",
    "kabir": "Kabir (male, deep)",
}

_client: Optional[httpx.AsyncClient] = None


def enabled() -> bool:
    return bool(SARVAM_API_KEY)


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=SARVAM_BASE,
            headers={"api-subscription-key": SARVAM_API_KEY},
            timeout=httpx.Timeout(30.0, connect=5.0),
        )
    return _client


RETRYABLE = {429, 500, 502, 503, 504}


async def _post(path: str, what: str, **kwargs: Any) -> Dict[str, Any]:
    """POST to Sarvam with one retry on timeouts / 5xx / 429. Raises VoiceError with a clear reason."""
    if not enabled():
        raise VoiceError("Sarvam voice is not configured (SARVAM_API_KEY is empty)")
    last: Optional[BaseException] = None
    for attempt in (1, 2):
        started = time.time()
        try:
            resp = await _http().post(path, **kwargs)
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last = e
            log.warning("Sarvam %s %s on attempt %d: %s", what, type(e).__name__, attempt, e)
        else:
            ms = (time.time() - started) * 1000
            if resp.status_code < 400:
                log.debug("Sarvam %s ok in %.0f ms", what, ms)
                try:
                    return resp.json()
                except ValueError as e:
                    raise VoiceError(f"Sarvam {what} returned invalid JSON") from e
            body = resp.text[:300]
            if resp.status_code in (401, 403):
                log.error("Sarvam %s rejected the API key (%s) — check SARVAM_API_KEY", what, resp.status_code)
                raise VoiceError("Voice service rejected our API key", details={"status": resp.status_code})
            if resp.status_code not in RETRYABLE:
                log.warning("Sarvam %s failed %s: %s", what, resp.status_code, body)
                raise VoiceError(f"Voice service error {resp.status_code}", details={"status": resp.status_code})
            last = VoiceError(f"Voice service busy ({resp.status_code})")
            log.warning("Sarvam %s %s on attempt %d: %s", what, resp.status_code, attempt, body)
        if attempt == 1:
            await asyncio.sleep(0.4)
    raise VoiceError(f"Voice service unavailable for {what}") from last


async def transcribe(audio: bytes, filename: str = "speech.webm", mime: str = "audio/webm",
                     language_code: str = "unknown") -> Tuple[str, str]:
    """Returns (transcript, detected_language_code). language_code='unknown' auto-detects."""
    if not audio:
        raise VoiceError("No audio to transcribe")
    body = await _post("/speech-to-text", "speech-to-text",
                       files={"file": (filename, audio, mime)},
                       data={"model": SARVAM_STT_MODEL, "language_code": language_code, "mode": "transcribe"})
    return (body.get("transcript") or "").strip(), body.get("language_code") or "en-IN"


async def synthesize(text: str, language_code: str = "en-IN", speaker: str = "priya",
                     pace: float = 1.0) -> str:
    """Returns base64-encoded MP3 audio."""
    lang = language_code if language_code in TTS_LANGUAGES else "en-IN"
    payload = {
        "text": text[:2500],
        "language_code": lang,
        "model": SARVAM_TTS_MODEL,
        "speaker": speaker if speaker in VOICES else "priya",
        "pace": max(0.5, min(pace, 2.0)),
        "speech_sample_rate": 24000,
        "output_audio_codec": "mp3",
    }
    body = await _post("/text-to-speech", "text-to-speech", json=payload)
    audio = "".join(body.get("audios") or [])
    if not audio:
        raise VoiceError("Voice service returned no audio")
    return audio
