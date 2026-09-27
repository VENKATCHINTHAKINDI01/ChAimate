"""The cafe's AI companion: an open-model friend (via the LLM gateway) who can also take orders."""
import asyncio
import difflib
import json
import logging
import random
import re
import time
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional

from app.core import db
from app.services import llm_gateway as gateway, metering, web_search
from app.core.config import CAFE_CITY, CAFE_NAME, COMPANION_SPOKEN, CURRENCY

log = logging.getLogger("agent")


# ---------------------------------------------------------------------------
# Personalisation options (served to the customer UI via /api/options)
# ---------------------------------------------------------------------------

PERSONAS = {
    "chai_buddy": {
        "label": "Chai Buddy",
        "desc": "Your easy-going friend from college. Casual, teasing, talks in quick Hinglish/Tenglish, always up for gossip over chai.",
    },
    "wise_elder": {
        "label": "Wise Elder",
        "desc": "A calm, kind older sibling / mentor figure with life stories and gentle advice.",
    },
    "filmy_friend": {
        "label": "Filmy Friend",
        "desc": "Lives and breathes cinema — Tollywood, Bollywood, Kollywood, OTT. Strong opinions, quotes dialogues, loves a debate, checks release news before claiming anything.",
    },
    "cricket_fanatic": {
        "label": "Cricket Fanatic",
        "desc": "Talks cricket and sport with passion, stats, memories and friendly banter.",
    },
    "motivator": {
        "label": "Motivator",
        "desc": "Energetic coach who helps with goals, career, exams and confidence.",
    },
    "good_listener": {
        "label": "Good Listener",
        "desc": "Quiet, empathetic, lets the customer vent; asks soft follow-up questions, never judges.",
    },
    "barista": {
        "label": "Our Barista",
        "desc": "The cafe's host — expert on the menu, pairings and what's fresh today.",
    },
}

MOODS = {
    "cheerful": "Upbeat, warm and smiley. Light jokes welcome.",
    "chill": "Relaxed and unhurried. Short, easy replies.",
    "witty": "Playful, quick humour and friendly teasing (never mean).",
    "deep": "Thoughtful and reflective; happy to go deep on ideas and life.",
    "supportive": "Gentle, reassuring and patient. Validate feelings first.",
    "energetic": "High energy, enthusiastic, hype-person vibes.",
}

TOPICS = [
    "Just chatting", "Movies & OTT", "Cricket & sports", "Music", "Travel",
    "Food & recipes", "Tech & startups", "Career & studies", "Life & relationships",
    "Books", "Current trends", "Spirituality & mindfulness",
]

SCRIPTS = {
    "hi-IN": "Devanagari", "mr-IN": "Devanagari", "te-IN": "Telugu", "ta-IN": "Tamil", "kn-IN": "Kannada",
    "ml-IN": "Malayalam", "bn-IN": "Bengali", "gu-IN": "Gujarati", "pa-IN": "Gurmukhi", "od-IN": "Odia",
}

LANGUAGES = {
    "en-IN": "English", "hi-IN": "Hindi", "te-IN": "Telugu", "ta-IN": "Tamil",
    "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali",
    "gu-IN": "Gujarati", "pa-IN": "Punjabi", "od-IN": "Odia",
}

# ---------------------------------------------------------------------------
# System prompt — stable part first so it can be prompt-cached
# ---------------------------------------------------------------------------

BASE_PROMPT = f"""You're {COMPANION_SPOKEN} — the chai-mate at every table of {CAFE_NAME}, {CAFE_CITY}: the café's AI \
companion, playing the persona the customer picked (the persona is your personality; your name stays {COMPANION_SPOKEN} \
unless they give you a nickname). Always write your name as "{COMPANION_SPOKEN}". They talk (or type); your words are \
spoken aloud. A relaxed chat between two people, not a help desk.

SOUND HUMAN
- Mirror their language, slang and energy ("yaar", "naa", Hinglish, Tenglish are fine if they use them). Match their \
length: a one-word message gets a few words back. Usually 1–2 sentences; sometimes just a reaction ("Arre no way!").
- Talk like a person across the table: react first, then answer; contractions; an occasional "hmm", "achha", \
"honestly", "wait—". Never lists, markdown, emojis or links.
- Vary how you begin — never start two replies the same way, and don't open with their name.
- Don't end every reply with a question — react, share a take or a fun fact; ask at most one thing, and not always. \
Silences are fine; you don't have to fill them.
- Have tastes and opinions as your persona ("I'd pick Irani chai over filter any day"). But you're an AI: never \
claim experiences — no "I watched / heard / was listening to / tried / went / my friend". Say "I've read people \
love it" or ask them instead.
- Unsure or didn't catch it? Say so plainly ("sorry, didn't get that — the biscuits or the brownie?").
- Never say: "Great choice!", "Sure thing!", "Absolutely!", "How can I help?", "Anything else…", "Let me know if…", \
"Feel free to…", "Glad it's working!". Don't open every line with their name.
- Reply in their language, in its own script (Devanagari for Hindi, Telugu script for Telugu…); code-mixing is fine.

FACTS — NEVER INVENT
- Never make up titles, release dates, cast, scores, news, prices or stats. Unsure? Say so.
- For anything current or checkable (movies/OTT releases, cricket, news, weather, events, "latest/upcoming/who won") \
call web_search first (kind "news" for recent happenings) and only say what the results support. Mention 2–3 \
highlights naturally; no URLs. Don't pretend to know a title you don't recognise.

VOICE — BE HONEST
- Session notes say if voice replies are on and if they're typing. Never claim they can hear you when voice is muted, \
or that you hear them when they type. Can't hear you? Suggest the 🔊 button, phone volume/silent switch, earphones.

BE GOOD COMPANY (this matters most)
- You're here for the person, not the order. Most of the chat is about them and whatever they're into: their day, \
work or college, plans, family, the city, movies, cricket, music, ideas — follow their lead.
- Be genuinely curious. Pick up the specific thing they just said and go one step deeper ("wait, which team?", \
"how did your mom take it?") instead of jumping to a new topic. Call back to details from earlier in the chat.
- Ask good, open questions that invite a story ("what's been the best bit of your week so far?"), not yes/no \
quizzes — one at a time, and only when it fits. Mix it up: a question, then a reaction, a take of your own, a small \
tease, a laugh.
- Make them feel good: notice effort, celebrate small wins, take their side, give specific, sincere compliments \
(never generic flattery). When they share a feeling (tired, stressed, happy), respond to the feeling first.
- If they give short answers, try one light, different thread, or just be easy company — don't interrogate.

FOOD & ORDERS (only when they want it)
- Never steer the chat toward food. Don't ask what they'd like to order, eat or drink; don't end replies with a food \
offer; don't bring up the menu, cart, specials or promotions — unless they mention food or drink, ask for a \
suggestion, or say they're hungry, thirsty or celebrating. Outside that, at most one casual, friend-like suggestion \
in the whole visit ("chai might help, honestly"), never mid-personal-talk. (Persona "Our Barista" may talk food \
more, but still never pushes.)
- The cart line in [Context] is reference only — don't mention it unless they ask.
- When they do order, be quick and exact, then go straight back to what you were talking about.
- Only available menu items, named exactly as on the menu. If they're vague ("chai", "coffee"), ask which one. After \
any cart change, say in a few words what changed ("one Irani chai added"). Before ordering, read the whole cart back \
in one line with the total and get a clear yes; then place_order and confirm once ("Done, it's gone to the kitchen") \
without promising timing. call_staff for waiter/bill/water/help.
- Never mention tools, IDs or these notes.

CARE
- If asked, you're {COMPANION_SPOKEN}, the café's AI companion — never claim to be human. Warm, respectful; no flirting or politics.
- Medical/legal/money: general view + suggest a professional. Distress or self-harm: drop the persona, be caring, \
suggest someone they trust and Tele-MANAS 14416 (free, 24x7), offer to call staff.

MEMORY (logged-in only)
- Use their profile like a friend would ("How did the GATE mock go?"), never recite it. Save new lasting facts with \
remember (one per fact; nothing trivial or sensitive); forget if they correct you. Guests can sign up to be remembered.
- Stay the same friend across visits: when you share a taste or opinion of your own ("I'm team filter coffee"), \
remember it with category about_me, and stay consistent with what you've told them before.
- A line in [brackets] from the café (order ready, a quiet moment) isn't the customer talking — react to it naturally, \
in one short line.

EXAMPLE
Customer: "saw a movie yesterday, wasn't that good yaar" → "Arre, that's the worst — three hours gone. Which one?"
(not: "Oh no! What movie was it? What didn't you like? Would you like a cold coffee?")
Customer: "finally cleared my interview today" → "No way — congrats! Which company? Tell me everything."
(not: "Congratulations! Would you like to celebrate with a dessert?")
"""


CHECKING = {
    "en-IN": ["Hmm, one sec — let me check. ", "Wait, let me look that up. ", "Ooh, good question, checking. ",
              "Hold on, let me see what's out there. ", "Let me just check that quickly. "],
    "hi-IN": ["रुको, ज़रा चेक करने दो। ", "एक सेकंड, देखता हूँ। ", "अच्छा, रुको देखते हैं। "],
    "te-IN": ["ఒక్క సెకను, చెక్ చేస్తాను. ", "ఆగు, చూస్తాను. ", "హ్మ్, ఒక్క నిమిషం. "],
    "ta-IN": "ஒரு நிமிஷம், பார்க்கிறேன். ",
    "kn-IN": "ಒಂದು ನಿಮಿಷ, ನೋಡ್ತೀನಿ. ",
    "ml-IN": "ഒരു നിമിഷം, നോക്കട്ടെ. ",
    "mr-IN": "थांब, जरा बघतो. ",
    "bn-IN": "এক সেকেন্ড, দেখে নিই। ",
}


# The menu + promotions text is the same for every table, so build it once and reuse it. It is rebuilt after
# MENU_TTL seconds, or immediately when the menu changes (staff edits, approved proposals, Realtime DB changes).
MENU_TTL = 60.0
_menu_cache: Dict[str, Any] = {"text": None, "at": 0.0}


_NORM = re.compile(r"[^a-z0-9\u0900-\u0DFF]+")


def _norm(t: str) -> str:
    return _NORM.sub(" ", t.lower()).strip()


def _repeating(text: str) -> bool:
    """True once the tail of the reply repeats an earlier sentence (a known quirk of some open models)."""
    parts = [p for p in re.split(r"(?<=[.!?।])\s*", text) if p.strip()]
    if len(parts) < 2:
        return False
    tail = _norm(parts[-1])
    if len(tail) < 25:
        return False
    earlier = _norm(" ".join(parts[:-1]))
    return tail[:40] in earlier


def _cut_repeat(text: str) -> str:
    parts = [p for p in re.split(r"(?<=[.!?।])\s*", text) if p.strip()]
    return " ".join(parts[:-1])


def invalidate_menu_cache() -> None:
    _menu_cache["text"] = None


def menu_block_cached() -> str:
    """Blocking (may hit the database) — call from a worker thread in async code."""
    if _menu_cache["text"] is None or time.time() - _menu_cache["at"] > MENU_TTL:
        _menu_cache["text"], _menu_cache["at"] = _menu_block(), time.time()
    return _menu_cache["text"]


def _menu_block() -> str:
    """The menu as the model sees it: one compact line per category (keeps every turn's prompt small).
    Markers: [NV] non-veg, [S] spicy — everything else is veg and mild."""
    by_cat: Dict[str, List[str]] = {}
    for m in db.list_menu(only_available=True):
        marks = ("[NV]" if not m["veg"] else "") + ("[S]" if m["spicy"] else "")
        by_cat.setdefault(m["category"], []).append(f"{m['name']} {CURRENCY}{m['price']:.0f}{(' ' + marks) if marks else ''}")
    text = ("Menu — use these exact names in tools. [NV] = non-veg, [S] = spicy; unmarked = veg.\n"
            + "\n".join(f"{cat}: " + "; ".join(items) for cat, items in by_cat.items()))
    promos = db.active_promotions()
    if promos:
        text += ("\n\nCurrent promotions (mention them naturally when food or drinks come up — don't push, and "
                 "never invent discounts beyond what's written):\n"
                 + "\n".join(f"- {x['title']}: {x['details']}" for x in promos))
    return text


def _session_block(prefs: Dict[str, Any], customer_name: str, table_id: int, profile: str = "") -> str:
    persona = PERSONAS.get(prefs.get("persona", ""), PERSONAS["chai_buddy"])
    mood = MOODS.get(prefs.get("mood", ""), MOODS["cheerful"])
    topics = ", ".join(prefs.get("topics") or []) or "anything"
    lang = LANGUAGES.get(prefs.get("language", "en-IN"), "English")
    voice_on = prefs.get("speak_replies", True) is not False
    typing = prefs.get("mode") == "text"
    parts = [
        "Now: " + time.strftime("%A %d %B %Y, %I:%M %p", time.localtime()) + " (India time); next month is "
        + time.strftime("%B %Y", time.localtime(time.time() + 32 * 86400 - (time.localtime().tm_mday - 1) * 86400))
        + ". Use this for 'today', 'next month', 'upcoming' and in search queries.",
        f"This session: table {table_id}. Customer's name: {customer_name or 'not shared yet'}.",
        ("Voice replies are ON — the customer hears you." if voice_on else
         "Voice replies are MUTED — the customer only reads your replies (they can turn voice on with the 🔊 button).")
        + (" They are typing (their mic is off or unavailable), so you can't hear them." if typing else
           " They talk to you by voice."),
        f"Your persona: {persona['label']} — {persona['desc']}",
        f"Mood to bring: {mood}",
        f"Topics they'd like: {topics}.",
        f"Preferred starting language: {lang}.",
    ]
    if prefs.get("persona_name"):
        parts.append(f"They've nicknamed you \"{prefs['persona_name']}\" — use that instead of {COMPANION_SPOKEN}.")
    if prefs.get("custom"):
        parts.append(f"Extra instructions from the customer about how to talk: {prefs['custom'][:500]}")
    if profile:
        parts.append(profile)
    return "\n".join(parts)


def _ago(ts: Optional[float]) -> str:
    if not ts:
        return "never"
    days = int((time.time() - ts) // 86400)
    return "today" if days == 0 else "yesterday" if days == 1 else f"{days} days ago"


def customer_profile(customer: Dict[str, Any]) -> str:
    """The long-term memory block injected into the system prompt for a logged-in customer."""
    cid = customer["id"]
    lines = [f"Customer profile — {customer['name']} (visit number {customer.get('visits', 0)}, "
             f"last visit {_ago(customer.get('last_seen'))})."]
    all_mems = db.list_memories(cid)
    mine = [m for m in all_mems if m.get("category") == "about_me"]
    mems = [m for m in all_mems if m.get("category") != "about_me"]
    if mine:
        # the companion's own continuity (OpenJarvis-style SOUL next to MEMORY/USER): same tastes every visit
        lines.append("What you've told them about yourself before (stay consistent):")
        lines += [f"- [{m['id']}] {m['fact']}" for m in mine[-20:]]
    if mems:
        lines.append("Things you remember about them (id: fact):")
        lines += [f"- [{m['id']}] {m['fact']}" for m in mems[-60:]]
    else:
        lines.append("You don't have any saved memories about them yet — get to know them.")
    fav = db.favourite_items(cid)
    if fav:
        lines.append("Their usual orders (only if they ask what to get — don't bring it up yourself): " + ", ".join(f"{f['name']} (x{f['qty']})" for f in fav) + ".")
    summaries = db.recent_summaries(cid)
    if summaries:
        lines.append("Summaries of your recent chats (newest first):")
        lines += [f"- {_ago(c['started_at'])}: {c['summary']}" for c in summaries]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

def _tool(name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


TOOLS = [
    _tool("add_to_cart", "Add a menu item to the cart (not ordered yet). One call per item.",
          {"item": {"type": "string", "description": "the item's name exactly as on the menu"}, "qty": {"type": "integer"},
           "notes": {"type": "string", "description": "e.g. less sugar"}}, ["item", "qty"]),
    _tool("remove_from_cart", "Remove an item (or some quantity) from the cart.",
          {"item": {"type": "string", "description": "the item's name as on the menu"}, "qty": {"type": "integer"}}, ["item"]),
    _tool("place_order", "Send the cart to the kitchen, after the customer confirmed.", {"notes": {"type": "string"}}, []),
    _tool("order_status", "This table's orders and running bill.", {}, []),
    _tool("call_staff", "Call cafe staff to the table.",
          {"kind": {"type": "string", "enum": ["waiter", "bill", "help"]}, "message": {"type": "string"}}, ["kind"]),
    _tool("web_search", "Search the internet for current or checkable facts (releases, scores, news, weather, events).",
          {"query": {"type": "string"}, "kind": {"type": "string", "enum": ["web", "news"]}}, ["query"]),
    _tool("remember", "Save one short lasting fact about this customer, e.g. 'Supports RCB'.",
          {"fact": {"type": "string"},
           "category": {"type": "string", "enum": ["preference", "food", "personal", "goal", "event", "about_me", "other"],
                        "description": "about_me = something YOU told them about yourself"}},
          ["fact"]),
    _tool("forget", "Delete a saved memory by id.", {"memory_id": {"type": "integer"}}, ["memory_id"]),
]
GUEST_TOOLS = [t for t in TOOLS if t["function"]["name"] not in ("remember", "forget")]
MAX_REPLY_CHARS = 360  # spoken replies stop at the first sentence end after this — nobody monologues at a café table
HISTORY_WINDOW = 14   # messages resent per call — older context lives in the profile summary

_REQUIRED = {t["function"]["name"]: t["function"]["parameters"]["required"] for t in TOOLS}


def _norm(text: str) -> List[str]:
    """'Osmania Biscuits (4 pcs)' -> ['osmania', 'biscuit']: lower-case words, sizes dropped, plurals folded."""
    text = re.sub(r"\(.*?\)", " ", (text or "").lower())
    words = re.findall(r"[a-z0-9]+", text)
    words = [w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in words]
    return [_SYNONYMS.get(w, w) for w in words]


# words customers use interchangeably for the same thing on this menu
_SYNONYMS = {"bubble": "boba", "kaapi": "coffee", "cha": "chai", "tea": "tea", "shake": "shake", "milkshake": "shake"}


def match_menu_item(query: str, menu: List[Dict[str, Any]]) -> "tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]":
    """Find the menu item a customer (or the model) named. Returns (item, []) when it's clear, or (None, candidates)
    when it isn't — so we ask "Irani or masala chai?" instead of guessing. Matching by name, not by numeric id,
    is what stops a weaker fallback model from putting brownies in the cart when someone asked for biscuits."""
    q = _norm(query)
    if not q:
        return None, []
    qs = " ".join(q)
    scored = []
    for m in menu:
        n = _norm(m["name"])
        ns = " ".join(n)
        if qs == ns:
            return m, []
        overlap = len(set(q) & set(n)) / max(1, len(set(n)))            # share of the item's words mentioned
        covered = len(set(q) & set(n)) / max(1, len(set(q)))            # share of the query explained
        ratio = difflib.SequenceMatcher(None, qs, ns).ratio()            # typos: "discuits", "biriyani"
        fuzzy = max((difflib.SequenceMatcher(None, a, b).ratio() for a in q for b in n), default=0)
        score = max(0.6 * overlap + 0.4 * covered, ratio, 0.85 * fuzzy if fuzzy > 0.8 else 0)
        related = overlap > 0 or fuzzy > 0.8                            # shares a (possibly misspelt) word
        scored.append((score, related, m))
    # every word they said appears in exactly one dish ("cold brew" → Cold Brew Coffee): that's the one
    full = [m for m in menu if set(q) <= set(_norm(m["name"]))]
    if len(full) == 1:
        return full[0], []
    scored.sort(key=lambda x: -x[0])
    best = scored[0] if scored else (0, False, None)
    second = scored[1][0] if len(scored) > 1 else 0
    if best[0] >= 0.55 and best[0] - second >= 0.12:
        return best[2], []
    return None, [m for sc, rel, m in scored if rel][:3]


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

EventSink = Callable[[Dict[str, Any]], Awaitable[None]]


class TableSession:
    def __init__(self, table_id: int, prefs: Dict[str, Any], emit: EventSink,
                 customer: Optional[Dict[str, Any]] = None):
        self.table_id = table_id
        self.prefs = prefs
        self.customer = customer               # None for guests
        self.customer_name = ((customer or {}).get("name") or prefs.get("name") or "").strip()[:40]
        self.emit = emit  # callback to push UI / staff events
        self.history: List[Dict[str, Any]] = []
        self.cart: List[Dict[str, Any]] = []   # {menu_item_id, name, qty, price, notes}
        self.language = prefs.get("language", "en-IN")
        self.turn_usage: Dict[str, Any] = {}   # tokens / cost / model / latency of the latest reply
        # prompt context loaded off the event loop (see _refresh_context) — never re-read from the DB mid-reply
        self._menu_text = ""
        self._profile_text = ""
        self._profile_stale = True

    # ----- cart helpers -----
    def cart_total(self) -> float:
        return sum(c["qty"] * c["price"] for c in self.cart)

    def cart_summary(self) -> str:
        if not self.cart:
            return ""
        items = "; ".join(f"{c['qty']} x {c['name']}{' — ' + c['notes'] if c['notes'] else ''}" for c in self.cart)
        return f"Cart (reference only): {items}. Total {CURRENCY}{self.cart_total():.0f}."

    async def _push_cart(self, change: Optional[Dict[str, Any]] = None) -> None:
        """change = {menu_item_id, name, before, after, by} lets the table show "Added 1 × Irani Chai · Undo"."""
        await self.emit({"type": "cart", "cart": self.cart, "total": self.cart_total(),
                         **({"change": change} if change else {})})

    def _qty_of(self, item_id: int) -> int:
        return sum(c["qty"] for c in self.cart if c["menu_item_id"] == item_id)

    async def _resolve(self, args: Dict[str, Any]) -> "tuple[Optional[Dict[str, Any]], str]":
        """The model names the item; the server decides which menu row that is."""
        menu = await asyncio.to_thread(db.list_menu, True)
        name = str(args.get("item") or "").strip()
        if name:
            item, options = match_menu_item(name, menu)
            if item:
                if args.get("menu_item_id") and int(args["menu_item_id"]) != item["id"]:
                    log.info("cart: model said %r but id %s — trusting the name", name, args["menu_item_id"])
                return item, ""
            if options:
                return None, (f"'{name}' could match: " + ", ".join(o["name"] for o in options)
                              + ". Ask the customer which one — don't guess.")
            return None, f"'{name}' isn't on the menu. Tell them honestly and suggest something close that is."
        if args.get("menu_item_id"):
            item = next((m for m in menu if m["id"] == int(args["menu_item_id"])), None)
            if item:
                return item, ""
        return None, "Say which item (its menu name)."

    async def set_qty(self, item_id: int, qty: int, by: str = "menu") -> Optional[Dict[str, Any]]:
        """Direct cart edit from the menu's ADD / − / + buttons or an Undo — no AI round trip needed."""
        item = await asyncio.to_thread(db.get_menu_item, int(item_id))
        if not item or not item["available"]:
            return None
        qty = max(0, min(int(qty), 20))
        before = self._qty_of(item["id"])
        self.cart = [c for c in self.cart if c["menu_item_id"] != item["id"]]
        if qty:
            self.cart.append({"menu_item_id": item["id"], "name": item["name"], "qty": qty, "price": item["price"], "notes": ""})
        change = {"menu_item_id": item["id"], "name": item["name"], "before": before, "after": qty, "by": by}
        await self._push_cart(change)
        return change

    # ----- tool execution -----
    async def run_tool(self, name: str, args: Dict[str, Any]) -> str:
        if name in ("add_to_cart", "remove_from_cart"):
            args.setdefault("qty", 1) if name == "add_to_cart" else None
            if "menu_item_id" in args and not args.get("item"):      # older habit: an id alone is still accepted
                args["item"] = ""
        missing = [k for k in _REQUIRED.get(name, []) if k not in args]
        if missing:
            raise ValueError(f"missing required field(s): {', '.join(missing)}")

        if name == "add_to_cart":
            item, problem = await self._resolve(args)
            if not item:
                return problem
            before = self._qty_of(item["id"])
            qty = max(1, min(int(args.get("qty", 1)), 20))
            notes = str(args.get("notes") or "")[:200]
            for c in self.cart:
                if c["menu_item_id"] == item["id"] and c["notes"] == notes:
                    c["qty"] = min(c["qty"] + qty, 20)
                    break
            else:
                self.cart.append({"menu_item_id": item["id"], "name": item["name"], "qty": qty,
                                  "price": item["price"], "notes": notes})
            await self._push_cart({"menu_item_id": item["id"], "name": item["name"], "before": before,
                                   "after": self._qty_of(item["id"]), "by": "ai"})
            return f"Added {qty} x {item['name']}. " + self.cart_summary()

        if name == "remove_from_cart":
            item, problem = await self._resolve(args)
            if not item:
                return problem
            if not self._qty_of(item["id"]):
                return f"{item['name']} isn't in the cart. " + self.cart_summary()
            before = self._qty_of(item["id"])
            qty = args.get("qty")
            for c in list(self.cart):
                if c["menu_item_id"] == item["id"]:
                    if qty and c["qty"] > int(qty):
                        c["qty"] -= int(qty)
                    else:
                        self.cart.remove(c)
                    break
            await self._push_cart({"menu_item_id": item["id"], "name": item["name"], "before": before,
                                   "after": self._qty_of(item["id"]), "by": "ai"})
            return "Removed. " + self.cart_summary()

        if name == "place_order":
            if not self.cart:
                return "Cart is empty — nothing to order."
            try:
                order = await asyncio.to_thread(
                    db.create_order, self.table_id, self.customer_name,
                    [{"menu_item_id": c["menu_item_id"], "qty": c["qty"], "notes": c["notes"]} for c in self.cart],
                    str(args.get("notes") or "")[:300],
                    self.customer["id"] if self.customer else None,
                )
                self._profile_stale = True        # "usual orders" changed
            except ValueError as e:
                return f"Could not place order: {e}"
            self.cart = []
            await self._push_cart()
            await self.emit({"type": "order_placed", "order": order})
            return f"Order #{order['id']} sent to the kitchen. Total {CURRENCY}{order['total']:.0f}."

        if name == "order_status":
            bill = await asyncio.to_thread(db.table_bill, self.table_id)
            if not bill["orders"]:
                ai = await metering.visit_usage(self.table_id)
                return (f"No orders yet for this table. AI chat: {ai['minutes']} min used, {ai['free_left']} free min "
                        f"left. " + self.cart_summary())
            lines = [
                f"Order #{o['id']} ({o['status']}): " + ", ".join(f"{i['qty']} x {i['name']}" for i in o["items"])
                for o in bill["orders"]
            ]
            ai = await metering.visit_usage(self.table_id)
            ai_note = (f" AI chat: {ai['minutes']} min used, {ai['free_left']} free min left"
                       + (f", {CURRENCY}{ai['amount']:.0f} added to the bill" if ai["amount"] else "") + ".")
            return ("; ".join(lines) + f". Running bill {CURRENCY}{bill['total'] + ai['amount']:.0f}." + ai_note
                    + " " + self.cart_summary())

        if name == "call_staff":
            req = await asyncio.to_thread(db.create_request, self.table_id, args.get("kind", "waiter"),
                                          str(args.get("message") or "")[:200])
            await self.emit({"type": "staff_request", "request": req})
            return "Staff has been notified and will come to the table shortly."

        if name == "web_search":
            res = await web_search.search(str(args["query"]), str(args.get("kind") or "web"))
            if res.get("error"):
                return f"Search failed ({res['error']}). Tell them you couldn't check right now; don't guess."
            if not res["results"]:
                return "No results found. Say you couldn't find anything reliable; don't guess."
            lines = []
            for r in res["results"]:
                lines.append(f"- {r['title']}{' (' + r['date'] + ')' if r.get('date') else ''}: {r['snippet']}")
                if r.get("page_excerpt"):
                    lines.append("  from the page: " + r["page_excerpt"])
            today = time.strftime("%d %B %Y", time.localtime())
            return ("Search results:\n" + "\n".join(lines) +
                    f"\n\nToday is {today}. STRICT: only mention names, titles, dates and numbers that appear word "
                    "for word above — never add any from memory. If the results don't clearly give what they asked "
                    "for, say you couldn't find a reliable answer and share only what is there. Say whether things "
                    "are already out or still coming. Reply like a friend chatting: one or two spoken sentences, two "
                    "or three picks at most, no list, no bold, no 'Here are…', no sign-off.")

        if name in ("remember", "forget"):
            if not self.customer:
                return "Guest mode — nothing can be saved. They can sign up with their phone number to be remembered."
            if name == "remember":
                fact = str(args["fact"]).strip()[:200]
                if not fact:
                    return "Nothing to remember."
                existing = {m["fact"].lower() for m in await asyncio.to_thread(db.list_memories, self.customer["id"])}
                if fact.lower() in existing:
                    return "Already remembered."
                mem = await asyncio.to_thread(db.add_memory, self.customer["id"], fact, str(args.get("category") or "other"))
                self._profile_stale = True
                await self.emit({"type": "memory_saved", "memory": mem})
                return f"Saved as memory {mem['id']}."
            ok = await asyncio.to_thread(db.delete_memory, self.customer["id"], int(args["memory_id"]))
            self._profile_stale = True
            if ok:
                await self.emit({"type": "memory_deleted", "memory_id": int(args["memory_id"])})
            return "Forgotten." if ok else "No such memory."

        return f"Unknown tool {name}"

    async def _activity(self, tool: str, phase: str, args: Dict[str, Any], ok: bool = True) -> None:
        """Tell the table what the companion is doing ("checking the web…"), so the chat never feels frozen."""
        if tool == "forget":
            return
        detail = ""
        if tool == "web_search":
            detail = str(args.get("query") or "")[:80]
        try:
            await self.emit({"type": "activity", "tool": tool, "phase": phase, "ok": ok, "detail": detail})
        except Exception:  # noqa: BLE001 — UI hint only; never break the turn
            pass

    # ----- conversation -----
    async def _refresh_context(self) -> None:
        """Load the menu and the customer's profile in a worker thread, so a slow (remote) database never blocks
        the event loop that streams everyone's audio. Both are cached; the profile reloads only after it changes."""
        def load() -> None:
            self._menu_text = menu_block_cached()
            if self.customer and self._profile_stale:
                self._profile_text = customer_profile(self.customer)
                self._profile_stale = False
        await asyncio.to_thread(load)

    def _system(self) -> Dict[str, Any]:
        # Stable text first, per-session text after it (lets providers reuse the prefix cache).
        # Frozen prefix (rules + menu, identical for every table) first, dynamic session block last — the same
        # split OpenJarvis's SystemPromptBuilder uses, so the provider can reuse the cached prefix every turn.
        return {"role": "system", "content": BASE_PROMPT + "\n\n" + (self._menu_text or menu_block_cached())
                + "\n\n" + _session_block(self.prefs, self.customer_name, self.table_id, self._profile_text)}

    def load_previous_chat(self, limit: int = 16) -> List[Dict[str, Any]]:
        """Seed the conversation with the tail of the customer's last chats so they can just carry on."""
        if not self.customer:
            return []
        msgs = db.recent_messages(self.customer["id"], limit)
        while msgs and msgs[0]["role"] != "user":   # history must start with a user turn
            msgs.pop(0)
        self.history = [{"role": m["role"], "content": m["text"]} for m in msgs]
        return msgs

    CONTEXT_MARK = "\n\n[Context: "

    def add_user_turn(self, text: str, lang: Optional[str] = None) -> None:
        if lang:
            self.language = lang
        lang = LANGUAGES.get(self.language, "English")
        script = SCRIPTS.get(self.language)
        reply_in = f"Reply in {lang}, written in {script} script." if script else "Reply in English."
        context = f"{self.CONTEXT_MARK}customer spoke {lang}. {reply_in} {self.cart_summary()}]"
        # An interrupted turn can leave a trailing user message; merge instead of stacking.
        if self.history and self.history[-1]["role"] == "user":
            previous = self.history[-1]["content"].split(self.CONTEXT_MARK)[0]
            self.history[-1]["content"] = previous + "\n" + text + context
        else:
            self.history.append({"role": "user", "content": text + context})

    def record_interruption(self, turn_start: int, spoken_text: str) -> None:
        """Called when the customer talks over the assistant: keep history valid and honest."""
        user_msg = self.history[turn_start] if len(self.history) > turn_start else None
        del self.history[turn_start:]
        if user_msg is not None:
            self.history.append(user_msg)
            if spoken_text.strip():
                self.history.append({"role": "assistant",
                                     "content": spoken_text.strip() + " — (interrupted by the customer)"})

    def _window(self) -> List[Dict[str, Any]]:
        """The recent part of the conversation, starting at a customer message so tool calls stay paired.
        Keeps each request small — the free LLM tier allows only a few thousand tokens per minute."""
        if len(self.history) <= HISTORY_WINDOW:
            window = self.history
        else:
            start = len(self.history) - HISTORY_WINDOW
            while start < len(self.history) and self.history[start]["role"] != "user":
                start += 1
            window = self.history[start:] or self.history[-1:]
        # Tool results from earlier turns (a web search is ~1,500 tokens) only need a gist once answered;
        # the current turn's results stay whole. Saves a lot on the free tier's per-minute token budget.
        last_user = max((i for i, m in enumerate(window) if m["role"] == "user"), default=0)
        return [({**m, "content": m["content"][:280] + " …(older result, shortened)"}
                 if m["role"] == "tool" and i < last_user and len(m.get("content") or "") > 320 else m)
                for i, m in enumerate(window)]

    async def respond(self) -> AsyncIterator[str]:
        """Streams the assistant's spoken text for the latest user turn, running tools as needed."""
        self.turn_usage = {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0, "model": "", "latency_s": None}
        await self._refresh_context()
        bad_tool_retries = 0
        seen_calls: Dict[str, str] = {}   # loop guard: identical tool calls in one turn run once
        said_anything = False
        spoken_so_far = ""
        for _ in range(8):  # max model round-trips per turn (tool calls + retries)
            text = ""
            calls: Dict[int, Dict[str, str]] = {}  # index -> {id, name, arguments}
            finish_reason = None
            try:
                stream = await gateway.chat_stream([self._system(), *self._window()],
                                                   TOOLS if self.customer else GUEST_TOOLS)
            except gateway.BadRequestError as e:
                if "tool_use_failed" in str(e) and bad_tool_retries < 2:
                    bad_tool_retries += 1
                    log.warning("model produced an invalid tool call, retrying")
                    continue
                raise
            try:
                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    delta = choice.delta
                    if delta.content:
                        piece = delta.content
                        if not text and said_anything and not piece[:1].isspace():
                            piece = " " + piece          # new round after a tool call: keep words apart
                        text += delta.content
                        if _repeating(spoken_so_far + text):
                            # the model started saying the same thing again — stop here, keep what was said once
                            log.info("reply for table %s: dropped a repeated passage", self.table_id)
                            text = _cut_repeat(text)
                            finish_reason = "trimmed"
                            break
                        yield piece
                        if len(text) > MAX_REPLY_CHARS and text.rstrip()[-1:] in ".!?।":
                            log.info("reply for table %s trimmed at %d chars (too long for speech)", self.table_id, len(text))
                            finish_reason = "trimmed"
                            break
                    for tc in delta.tool_calls or []:
                        c = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                        if tc.id:
                            c["id"] = tc.id
                        if tc.function and tc.function.name:
                            c["name"] += tc.function.name
                        if tc.function and tc.function.arguments:
                            c["arguments"] += tc.function.arguments
                    if choice.finish_reason:
                        finish_reason = choice.finish_reason
            finally:
                u = self.turn_usage
                u["prompt_tokens"] += stream.prompt_tokens
                u["completion_tokens"] += stream.completion_tokens
                u["cost_usd"] += stream.cost
                u["model"] = stream.model
                if u["latency_s"] is None:
                    u["latency_s"] = stream.first_token_s

            tool_calls = [calls[i] for i in sorted(calls)]
            if finish_reason in ("length", "trimmed"):
                tool_calls = []      # a cut-off reply must not leave a half-made tool call in the history
            if any(c["name"] == "web_search" for c in tool_calls) and not text and not said_anything:
                options = CHECKING.get(self.language, CHECKING["en-IN"])
                options = options if isinstance(options, list) else [options]
                fresh = [o for o in options if o != getattr(self, "_last_filler", None)] or options
                text = self._last_filler = random.choice(fresh)
                yield text          # spoken right away while the search runs — a friend reaching for their phone
            said_anything = said_anything or bool(text)
            spoken_so_far += text
            assistant: Dict[str, Any] = {"role": "assistant", "content": text or None}
            if tool_calls:
                assistant["tool_calls"] = [
                    {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                    for c in tool_calls
                ]
            self.history.append(assistant)

            if not tool_calls:
                u = self.turn_usage
                if finish_reason == "length":
                    log.warning("reply for table %s was cut off at the token limit", self.table_id)
                log.info("reply for table %s: model=%s tokens=%s/%s first_token=%.2fs", self.table_id,
                         u["model"].replace("groq/", ""), u["prompt_tokens"], u["completion_tokens"],
                         u["latency_s"] or 0)
                return

            already = text.strip()
            for c in tool_calls:
                sig = c["name"] + ":" + (c["arguments"] or "{}").replace(" ", "")
                if sig in seen_calls:
                    log.info("loop guard: skipped a repeated %s call for table %s", c["name"], self.table_id)
                    self.history.append({"role": "tool", "tool_call_id": c["id"], "name": c["name"],
                                         "content": "Already done a moment ago (result above) — don't call it again; "
                                                    "just answer the customer."})
                    continue
                try:
                    args = json.loads(c["arguments"] or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("arguments must be a JSON object")
                    await self._activity(c["name"], "start", args)
                    out = await self.run_tool(c["name"], args)
                    seen_calls[sig] = out
                    await self._activity(c["name"], "done", args, ok=not out.startswith(("Search failed", "Error")))
                except (ValueError, KeyError, TypeError) as e:   # bad arguments from the model: let it retry
                    log.info("tool %s rejected arguments %.200s: %s", c["name"], c["arguments"], e)
                    out = f"Error: {e}"
                except Exception as e:  # noqa: BLE001 — unexpected: log with traceback, tell the model
                    log.exception("tool %s failed", c["name"])
                    out = f"Error: {e}"
                if already and c is tool_calls[-1]:
                    out = (f"{out}\n(You already told the customer: \"{already[:200]}\" — don't repeat it; add only "
                           "what's new, or nothing if it's covered.)")
                self.history.append({"role": "tool", "tool_call_id": c["id"], "name": c["name"], "content": out})


async def summarize(transcript: List[Dict[str, Any]]) -> str:
    """Two-sentence memory of a finished chat, stored so the next visit can pick up the thread."""
    text = "\n".join(f"{m['role']}: {m['text']}" for m in transcript)[-12000:]
    summary, _usage = await gateway.complete(
        "Summarise this cafe chat between a customer and their AI companion in at most two short sentences, "
        "from the companion's point of view, focused on the person: what we talked about, what's going on in "
        "their life, how they felt, and open threads worth asking about next time (e.g. 'They were nervous about "
        "Friday's interview at Deloitte; we joked about RCB. Ask how the interview went.'). Leave out food and "
        "orders unless they mattered to the chat. Plain text only.\n\n" + text)
    return summary.strip()[:600]
