"""Live internet search for the AI companion (movies, cricket scores, news, weather, events…).

Uses DuckDuckGo through the `ddgs` package: free, no API key. Results are cached for a few minutes (the same
question from several tables costs one search) and every search has a hard time limit, so a slow search engine
can never freeze a spoken conversation.
"""
import asyncio
import html
import logging
import re
import time
from typing import Any, Dict, List, Tuple

log = logging.getLogger("web_search")

TIMEOUT_S = 8.0
CACHE_TTL_S = 600
MAX_RESULTS = 5
TEXT_BACKENDS = ("yahoo", "brave", "auto", "bing")   # ranked by result quality in our tests
_cache: Dict[Tuple[str, str], Tuple[float, List[Dict[str, Any]]]] = {}


def _search_sync(query: str, kind: str) -> List[Dict[str, Any]]:
    from ddgs import DDGS
    with DDGS(timeout=int(TIMEOUT_S)) as d:
        if kind == "news":
            raw = d.news(query, region="in-en", max_results=MAX_RESULTS)
            return [{"title": r.get("title", ""), "snippet": r.get("body", ""), "source": r.get("source", ""),
                     "date": (r.get("date") or "")[:10], "url": r.get("url", "")} for r in raw or []]
        last: Exception = RuntimeError("no search engine answered")
        for backend in TEXT_BACKENDS:          # engines come and go (blocks, TLS changes) — use the first that works
            try:
                raw = d.text(query, region="in-en", max_results=MAX_RESULTS, backend=backend)
                if raw:
                    return [{"title": r.get("title", ""), "snippet": r.get("body", ""), "url": r.get("href", "")}
                            for r in raw]
            except Exception as e:  # noqa: BLE001
                last = e
                log.debug("search engine %s failed: %s", backend, e)
        raise last


_DROP = re.compile(r"<(script|style|noscript|nav|header|footer|aside|form|svg)\b.*?</\1>", re.I | re.S)
_BREAK = re.compile(r"</(p|li|tr|h[1-6]|div|section|dt|dd)>|<br\s*/?>", re.I)
_CELL = re.compile(r"</t[dh]>", re.I)
_STRIP = re.compile(r"<[^>]+>")
_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
           "november", "december"]
_STOP = {"what", "when", "where", "which", "latest", "today", "news", "list", "with", "from", "that", "this", "upcoming",
         "releasing", "release", "releases", "movies", "movie", "films", "film", "best", "top", "about", "2025", "2026",
         "2027", "india", "indian", "week", "month", "next"}
PAGE_TIMEOUT_S = 4.0
EXCERPT_CHARS = 900


def _page_text(raw_html: str) -> str:
    t = _DROP.sub(" ", raw_html[:600_000])
    t = _CELL.sub(" | ", _BREAK.sub("\n", t))
    t = html.unescape(_STRIP.sub(" ", t))
    lines = [" ".join(line.split()) for line in t.splitlines()]
    return "\n".join(line for line in lines if len(line) > 2)


def _focus(text: str, query: str) -> str:
    """The part of the page that answers the question: start at the month (or rarest query word) it mentions."""
    low, q = text.lower(), query.lower()
    anchors = [m for m in _MONTHS if m in q] + sorted(
        {w for w in re.findall(r"[a-z]{4,}", q) if w not in _STOP and w not in _MONTHS}, key=len, reverse=True)
    for a in anchors:
        i = low.find(a, 200)                     # skip the page title area
        if i >= 0:
            return text[max(0, i - 80): i - 80 + EXCERPT_CHARS]
    return text[:EXCERPT_CHARS]


async def _page_excerpt(client, url: str, query: str) -> str:
    try:
        r = await client.get(url, timeout=PAGE_TIMEOUT_S, follow_redirects=True,
                             headers={"User-Agent": "Mozilla/5.0 (compatible; CafeCompanion/1.0)"})
        if r.status_code >= 400 or "html" not in r.headers.get("content-type", ""):
            return ""
        excerpt = " ".join(_focus(_page_text(r.text), query).split())
        return re.sub(r"\S*[\"{}\[\]]\S*[:=]\S*|</?\w+[^ ]*>", "", excerpt)   # drop leaked markup/JSON fragments
    except Exception as e:  # noqa: BLE001 — a page that won't load just contributes nothing
        log.debug("could not read %s: %s", url, e)
        return ""


async def search(query: str, kind: str = "web") -> Dict[str, Any]:
    """Returns {"results": [...]} or {"error": "..."} — never raises."""
    query = " ".join(query.split())[:200]
    kind = "news" if kind == "news" else "web"
    if not query:
        return {"error": "empty query"}
    key = (query.lower(), kind)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return {"query": query, "results": hit[1], "cached": True}
    started = time.time()
    try:
        results = await asyncio.wait_for(asyncio.to_thread(_search_sync, query, kind), TIMEOUT_S + 1)
    except asyncio.TimeoutError:
        log.warning("web search timed out after %.0fs: %r", TIMEOUT_S, query)
        return {"error": "the search took too long"}
    except Exception as e:  # noqa: BLE001 — rate limits, network errors, parser changes
        log.warning("web search failed for %r: %s: %s", query, type(e).__name__, e)
        return {"error": "search is unavailable right now"}
    # keep only what the model needs, trimmed, so the prompt stays small (and the rate limit happy)
    for r in results:
        r["snippet"] = (r.get("snippet") or "")[:300]
        r["title"] = (r.get("title") or "")[:120]
    # snippets are often generic ("the complete list of…"); read the relevant part of the top two pages
    import httpx
    async with httpx.AsyncClient() as client:
        pages = await asyncio.gather(*[_page_excerpt(client, r["url"], query) for r in results[:2] if r.get("url")])
    for r, excerpt in zip(results[:2], pages):
        if excerpt:
            r["page_excerpt"] = excerpt
    _cache[key] = (time.time(), results)
    if len(_cache) > 200:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:50]:
            _cache.pop(k, None)
    log.info("web search (%s) %r -> %d results in %.1fs", kind, query, len(results), time.time() - started)
    return {"query": query, "results": results}
