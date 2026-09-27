"""Voice samples for the setup screen and the little "hmm / achha" listening sounds."""
import logging
from typing import Dict, List

from fastapi import APIRouter, HTTPException, Query

from app.core.errors import VoiceError
from app.services import voice

router = APIRouter(prefix="/api/voice", tags=["voice"])
log = logging.getLogger("main")


_preview_cache: Dict[str, str] = {}
PREVIEW_LINES = {   # the companion introduces itself by name (Chaimate — said "chai-mate")
    "en-IN": "Hi! I'm Chaimate, your chai-mate for today. Shall we start with a chai?",
    "hi-IN": "नमस्ते! मैं चायमेट हूँ, आज आपका चाय-साथी। चलो, एक चाय के साथ बातें शुरू करें?",
    "te-IN": "నమస్తే! నేను చాయ్‌మేట్, ఈరోజు మీ చాయ్ తోడు. ఒక చాయ్ తో మొదలుపెడదామా?",
    "ta-IN": "வணக்கம்! நான் சாய்மேட், இன்று உங்கள் டீ தோழன். ஒரு டீயுடன் தொடங்கலாமா?",
}


@router.get("/preview")
async def voice_preview(voice_id: str = Query("priya", alias="voice"), lang: str = "en-IN", pace: float = 1.0):
    """Short sample of a voice for the setup screen (cached, so repeated previews cost nothing)."""
    if not voice.enabled():
        raise HTTPException(404, "Server voice not configured")
    speaker = voice_id
    if speaker not in voice.VOICES:
        raise HTTPException(400, "Unknown voice")
    lang = lang if lang in PREVIEW_LINES else "en-IN"
    pace = min((0.9, 1.0, 1.15), key=lambda p: abs(p - pace))   # keep the cache small and bounded
    key = f"{speaker}:{lang}:{pace}"
    if key not in _preview_cache:
        _preview_cache[key] = await voice.synthesize(PREVIEW_LINES.get(lang, PREVIEW_LINES["en-IN"]), lang, speaker, pace)
    return {"audio": _preview_cache[key]}


# Little listening noises played while the companion thinks, so a pause feels like someone mulling it over.
BACKCHANNELS = {
    "en-IN": ["Hmm.", "Achha.", "Mm, okay.", "Oh, nice."],
    "hi-IN": ["हम्म।", "अच्छा।", "हाँ हाँ।"],
    "te-IN": ["హ్మ్.", "అవునా.", "ఓహ్, సరే."],
    "ta-IN": ["ம்ம்.", "அப்படியா.", "சரி சரி."],
}
_backchannel_cache: Dict[str, List[Dict[str, str]]] = {}


@router.get("/backchannels")
async def voice_backchannels(voice_id: str = Query("priya", alias="voice"), lang: str = "en-IN"):
    """A handful of tiny clips ("hmm", "achha") in the chosen voice — made once per voice and language, then cached."""
    if not voice.enabled() or voice_id not in voice.VOICES:
        return {"clips": []}
    lang = lang if lang in BACKCHANNELS else "en-IN"
    key = f"{voice_id}:{lang}"
    if key not in _backchannel_cache:
        clips = []
        for text in BACKCHANNELS[lang]:
            try:
                clips.append({"text": text, "audio": await voice.synthesize(text, lang, voice_id, 1.0)})
            except VoiceError as e:
                log.info("backchannel %r not available: %s", text, e)
        _backchannel_cache[key] = clips
    return {"clips": _backchannel_cache[key]}
