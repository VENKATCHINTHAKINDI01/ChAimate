"""LLM gateway (LiteLLM Router): model routing, retries, cooldowns, cross-provider fallbacks and cost tracking.

Deployments (all optional except the primary):
  primary  -> LLM_MODEL            e.g. groq/openai/gpt-oss-120b
  fallback -> LLM_FALLBACK_MODEL   e.g. groq/openai/gpt-oss-20b   (separate rate-limit bucket)
  backup   -> LLM_BACKUP_MODEL     e.g. openrouter/openai/gpt-oss-120b (different provider, needs its key)
When a deployment returns 429 / 5xx / times out it is cooled down for LLM_COOLDOWN_SECONDS, so the next customer
goes straight to a healthy model instead of paying the failure latency again.
"""
import asyncio
import logging
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import litellm
from litellm import BadRequestError, Router  # noqa: F401 — BadRequestError re-exported for callers

from app.core.errors import LLMUnavailable
from app.core.config import (LLM_BACKUP_MODEL, LLM_COOLDOWN_SECONDS, LLM_FALLBACK_MODEL, LLM_MODEL,
                     LLM_REASONING_EFFORT, LLM_TIMEOUT_SECONDS)

log = logging.getLogger("gateway")
litellm.suppress_debug_info = True
litellm.set_verbose = False
litellm.drop_params = True   # silently drop params a provider doesn't support instead of failing

KNOWN_PROVIDERS = ("groq/", "openrouter/", "cerebras/", "together_ai/", "fireworks_ai/", "anthropic/",
                   "gemini/", "deepinfra/", "sambanova/", "ollama/")


def _qualify(model: str) -> str:
    """'openai/gpt-oss-120b' (a Groq model id) -> 'groq/openai/gpt-oss-120b'."""
    model = (model or "").strip()
    return model if not model or model.startswith(KNOWN_PROVIDERS) else f"groq/{model}"


def _params_for(model: str) -> Dict[str, Any]:
    """Per-model knobs. Reasoning models think before answering; keep it short for live voice."""
    m = model.lower()
    if "gpt-oss" in m:
        return {"reasoning_effort": LLM_REASONING_EFFORT}
    if "qwen" in m:
        return {"reasoning_effort": "none" if LLM_REASONING_EFFORT == "low" else LLM_REASONING_EFFORT}
    return {}


def _deployment(name: str, model: str) -> Dict[str, Any]:
    # max_retries=0: never sit in the provider SDK's back-off (it honours retry-after, often 20+ s) — the router
    # fails over to the next model immediately instead, which matters in a live voice conversation
    # stream_timeout: give up on a model that hasn't started answering within 10 s and fail over
    params: Dict[str, Any] = {"model": model, "timeout": LLM_TIMEOUT_SECONDS, "stream_timeout": 10, "max_retries": 0,
                              **_params_for(model)}
    return {"model_name": name, "litellm_params": params}


PRIMARY = _qualify(LLM_MODEL)
FALLBACK = _qualify(LLM_FALLBACK_MODEL)
BACKUP = _qualify(LLM_BACKUP_MODEL)

_model_list = [_deployment("primary", PRIMARY)]
_chain: List[str] = []
if FALLBACK and FALLBACK != PRIMARY:
    _model_list.append(_deployment("fallback", FALLBACK))
    _chain.append("fallback")
if BACKUP and BACKUP not in (PRIMARY, FALLBACK):
    _model_list.append(_deployment("backup", BACKUP))
    _chain.append("backup")

# 'light' is used for background jobs (chat summaries) so they don't eat the live conversation's rate limit.
_light_model = FALLBACK or PRIMARY
_model_list.append(_deployment("light", _light_model))
_light_chain = [n for n in ("primary", "backup") if n in {d["model_name"] for d in _model_list}]

router = Router(
    model_list=_model_list,
    fallbacks=[{"primary": _chain}, {"light": _light_chain}],
    num_retries=0,                 # live voice: fall back immediately rather than backing off
    allowed_fails=1,
    cooldown_time=LLM_COOLDOWN_SECONDS,
)

log.info("LLM gateway: primary=%s fallbacks=%s", PRIMARY,
         [d["litellm_params"]["model"] for d in _model_list if d["model_name"] in _chain])

_last_rate_limit = 0.0


def recently_limited(window: float = 600) -> bool:
    """True if a provider rate-limited us in the last `window` seconds — optional AI work should hold off."""
    return time.time() - _last_rate_limit < window


def _is_rate_limit(e: Exception) -> bool:
    return (isinstance(e, litellm.RateLimitError) or "ratelimit" in type(e).__name__.lower()
            or "rate limit" in str(e).lower() or "no deployments available" in str(e).lower())


def _translate(e: Exception, what: str) -> Exception:
    """Map provider/router exceptions to our error types, logging the useful detail once."""
    if isinstance(e, BadRequestError):
        return e                                   # caller decides (e.g. retry a malformed tool call)
    if isinstance(e, litellm.AuthenticationError):
        log.error("%s: LLM provider rejected the API key — check GROQ_API_KEY / provider keys", what)
        return LLMUnavailable("The AI service rejected our API key")
    if _is_rate_limit(e):
        log.warning("%s: all models rate-limited (%s)", what, str(e)[:200])
        return LLMUnavailable("The AI is busy (rate limit) — try again in a minute")
    if isinstance(e, (litellm.Timeout, litellm.APIConnectionError, litellm.ServiceUnavailableError,
                      litellm.InternalServerError)):
        log.warning("%s: LLM unavailable — %s: %s", what, type(e).__name__, str(e)[:200])
        return LLMUnavailable("The AI service is temporarily unavailable")
    log.exception("%s: unexpected LLM error", what)
    return LLMUnavailable(f"The AI service failed ({type(e).__name__})")


def cost_usd(model: Optional[str], prompt_tokens: int, completion_tokens: int) -> float:
    try:
        p, c = litellm.cost_per_token(model=model or PRIMARY, prompt_tokens=prompt_tokens,
                                      completion_tokens=completion_tokens)
        return float(p + c)
    except Exception:  # noqa: BLE001 — unknown model price: track tokens, cost 0
        return 0.0


class ChatStream:
    """Wraps a streaming completion; after iteration exposes .usage, .model and .cost."""

    def __init__(self, raw: Any, started: float):
        self._raw = raw
        self.started = started
        self.first_token_s: Optional[float] = None
        self.prompt_tokens = 0
        self.completion_tokens = 0
        hidden = getattr(raw, "_hidden_params", {}) or {}
        self.model: str = hidden.get("litellm_model_name") or PRIMARY

    def __aiter__(self):
        return self._iter()

    async def _iter(self) -> AsyncIterator[Any]:
        try:
            async for chunk in self._gen():
                yield chunk
        except LLMUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 — provider dropped the stream mid-reply
            raise _translate(e, f"stream from {self.model}") from e
        if self.model != PRIMARY:
            log.warning("reply served by fallback model %s (primary %s unavailable)", self.model, PRIMARY)
        log.debug("llm %s: %s in / %s out tokens, first token %.2fs", self.model, self.prompt_tokens,
                  self.completion_tokens, self.first_token_s or 0)

    async def _gen(self) -> AsyncIterator[Any]:
        async for chunk in self._raw:
            usage = getattr(chunk, "usage", None)
            if usage:
                self.prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
                self.completion_tokens = getattr(usage, "completion_tokens", 0) or 0
            if self.first_token_s is None and chunk.choices:
                d = chunk.choices[0].delta
                if getattr(d, "content", None) or getattr(d, "tool_calls", None):
                    self.first_token_s = time.time() - self.started
            yield chunk

    @property
    def cost(self) -> float:
        return cost_usd(self.model, self.prompt_tokens, self.completion_tokens)


async def chat_stream(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None,
                      max_tokens: int = 2048) -> ChatStream:
    kwargs: Dict[str, Any] = {"messages": messages, "stream": True, "max_tokens": max_tokens,
                              "stream_options": {"include_usage": True}}
    if tools:
        kwargs.update(tools=tools, tool_choice="auto")
    started = time.time()
    try:
        raw = await router.acompletion(model="primary", **kwargs)
    except Exception as e:  # noqa: BLE001
        if not _is_rate_limit(e):
            raise _translate(e, "chat_stream") from e
        global _last_rate_limit
        _last_rate_limit = time.time()
        # Every model is cooling down. Groq's per-minute budget refills within seconds, so rather than failing
        # the customer's turn, wait briefly and make one direct attempt on the lighter model (the router would
        # still refuse it while its cooldown timer runs). A daily-limit block on the big model is left alone.
        await asyncio.sleep(4)
        target = FALLBACK or PRIMARY
        try:
            raw = await litellm.acompletion(**{**_deployment("retry", target)["litellm_params"], **kwargs})
            log.info("chat_stream: served by %s after a short rate-limit wait", target)
        except Exception as e2:  # noqa: BLE001
            raise _translate(e2, "chat_stream") from e2
    return ChatStream(raw, started)


async def complete(prompt: str, max_tokens: int = 400) -> Tuple[str, Dict[str, Any]]:
    """Non-streaming call on the light model (with fallbacks). Returns (text, usage)."""
    try:
        resp = await router.acompletion(model="light", messages=[{"role": "user", "content": prompt}],
                                        max_tokens=max_tokens)
    except Exception as e:  # noqa: BLE001
        raise _translate(e, "complete") from e
    usage = getattr(resp, "usage", None)
    pt = getattr(usage, "prompt_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", 0) or 0
    model = (getattr(resp, "_hidden_params", {}) or {}).get("litellm_model_name") or _light_model
    text = resp.choices[0].message.content or ""
    return text, {"model": model, "prompt_tokens": pt, "completion_tokens": ct, "cost_usd": cost_usd(model, pt, ct)}


def health() -> List[Dict[str, Any]]:
    return [{"name": d["model_name"], "model": d["litellm_params"]["model"]} for d in _model_list]


async def chat(messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None,
               max_tokens: int = 2048, json_mode: bool = False) -> Dict[str, Any]:
    """Non-streaming call on the primary route (with fallbacks) for back-office agents.
    Returns the assistant message as a plain dict: {content, tool_calls: [{id, function: {name, arguments}}]}."""
    kwargs: Dict[str, Any] = {"messages": messages, "max_tokens": max_tokens}
    if tools:
        kwargs.update(tools=tools, tool_choice="auto")
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    started = time.time()
    try:
        resp = await router.acompletion(model="primary", **kwargs)
    except Exception as e:  # noqa: BLE001
        raise _translate(e, "chat") from e
    served = (getattr(resp, "_hidden_params", {}) or {}).get("litellm_model_name") or PRIMARY
    if served != PRIMARY:
        log.warning("back-office reply served by fallback model %s", served)
    log.debug("llm chat %s in %.2fs", served, time.time() - started)
    m = resp.choices[0].message
    calls = [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments or "{}"}}
             for c in (getattr(m, "tool_calls", None) or [])]
    return {"content": m.content or "", "tool_calls": calls}
