"""The live voice conversation at a table: speech-to-text → LLM (streamed) → sentence-by-sentence text-to-speech,
with barge-in, proactive turns, direct cart edits from the menu, memory and usage metering."""
import asyncio
import base64
import binascii
import logging
import random
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import WebSocket

from app.agents import companion as agent
from app.core import db
from app.core.errors import LLMUnavailable, ServiceUnavailable, VoiceError, friendly, spawn
from app.realtime.hub import hub
from app.services import llm_gateway as gateway, metering, voice

log = logging.getLogger("main")


MAX_AUDIO_B64 = 4 * 1024 * 1024     # ~30 s of 16 kHz WAV, base64-encoded (with headroom)

# Sentence boundary: ., !, ?, Hindi danda, newline — followed by whitespace.
SENTENCE_END = re.compile(r"(?<=[.!?।॥\n])\s+")
# For the very first chunk of a reply we don't wait for the sentence to end: voicing a long sentence takes ~2 s,
# so we cut at the first clause break (comma, dash, colon…) once there are enough words to sound natural.
CLAUSE_END = re.compile(r"(?<=[,;:—–])\s+")
# no punctuation yet? break before a joining word, where a speaker would naturally take a breath
BREATH = re.compile(r"\s+(?=(?:and|but|so|that|where|which|because|while|when|with|or|aur|lekin|par)\b)", re.I)
FIRST_CHUNK_MIN = 40
MARKDOWN = re.compile(r"(\*\*|__|`|^#+\s*|^\s*(?:[-*•]|\d+[.)])\s+|\[([^\]]*)\]\([^)]*\))", re.M)


# Guests have no account, so their chat can't come back from the database. Keep each table's guest conversation in
# memory for a while, so a page reload, a dropped connection or "End" then "Talk" again carries on the same chat.
# Cleared when the table's bill is settled (the guest has left).
GUEST_TRAIL_TTL = 3 * 3600
GUEST_TRAIL_MESSAGES = 30
_guest_trails: Dict[int, Dict[str, Any]] = {}


def remember_guest_chat(table_id: int, history: List[Dict[str, Any]], name: str) -> None:
    tail = list(history[-GUEST_TRAIL_MESSAGES:])
    while tail and tail[0]["role"] != "user":          # history must start with a user turn (tool calls stay paired)
        tail.pop(0)
    if any(m["role"] == "user" for m in tail):
        _guest_trails[table_id] = {"at": time.time(), "history": tail, "name": name}


def guest_chat(table_id: int) -> Optional[Dict[str, Any]]:
    trail = _guest_trails.get(table_id)
    if trail and time.time() - trail["at"] > GUEST_TRAIL_TTL:
        _guest_trails.pop(table_id, None)
        return None
    return trail


def forget_guest_chat(table_id: int) -> None:
    _guest_trails.pop(table_id, None)


def speakable(text: str) -> str:
    """Strip markdown the model sometimes slips in, so the voice never reads out asterisks or bullet dashes."""
    return MARKDOWN.sub(lambda m: m.group(2) or "", text).replace("*", "").strip()
FIRST_CHUNK_BREATH = 55


_OPENINGS = [
    "Open with something about the time of day or the vibe of the café right now.",
    "Open by asking how their day is going, in your own words.",
    "Open with a light, fun question that fits your persona.",
    "Open with a quick, warm observation, then one easy question.",
    "Open by sharing a small opinion of yours that fits your persona, and ask theirs.",
]


def _opening_angle() -> str:
    """A different way in each visit, so the companion doesn't greet everyone with the same line."""
    return random.choice(_OPENINGS) + " Don't open with 'any good movies lately' or a generic 'how can I help'."


class VoiceConnection:
    """One customer's live conversation: STT -> LLM (streaming) -> sentence-by-sentence TTS, with memory."""

    def __init__(self, ws: WebSocket, table_id: int, customer: Optional[Dict[str, Any]]):
        self.ws = ws
        self.table_id = table_id
        self.customer = customer
        self.session: Optional[agent.TableSession] = None
        self.conversation_id: Optional[int] = None
        self.turn_task: Optional[asyncio.Task] = None
        self.send_lock = asyncio.Lock()
        self.session_key = uuid.uuid4().hex
        self.nudges = 0                          # proactive check-ins since the customer last spoke
        self.menu_changes: List[Dict[str, Any]] = []   # cart edits made from the menu, acknowledged on close
        self.pending_note: Optional[str] = None  # a café update that arrived mid-reply, said right after it

    async def send(self, msg: Dict[str, Any]) -> None:
        async with self.send_lock:
            await self.ws.send_json(msg)

    async def emit(self, event: Dict[str, Any]) -> None:
        """Events raised by agent tools: forward to this table and to staff."""
        await self.send(event)
        if event["type"] == "order_placed":
            await hub.to_staff({"type": "order_new", "order": event["order"]})
        elif event["type"] == "staff_request":
            await hub.to_staff({"type": "request_new", "request": event["request"]})

    def _save(self, role: str, text: str) -> None:
        """Store a chat message in the background — the conversation never waits on the database."""
        if self.conversation_id and text.strip():
            spawn(asyncio.to_thread(db.add_chat_message, self.conversation_id, self.customer["id"], role, text.strip()),
                  f"save-msg-{self.conversation_id}")

    # ----- turn handling -----
    async def interrupt(self) -> None:
        if self.turn_task and not self.turn_task.done():
            self.turn_task.cancel()
            try:
                await self.turn_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    def busy(self) -> bool:
        return bool(self.turn_task and not self.turn_task.done())

    async def proactive(self, note: str) -> None:
        """Speak up without being asked (order ready, a long quiet moment). Never talks over a reply in progress."""
        if not self.session:
            return
        if self.busy():
            self.pending_note = note
            return
        await self.start_turn(note, self.session.language, save_user=False)

    async def start_turn(self, text: str, lang: Optional[str], save_user: bool = True, stt_seconds: float = 0.0) -> None:
        await self.interrupt()
        if save_user:
            self.nudges = 0
        self.session.add_user_turn(text, lang)
        if save_user:
            self._save("user", text)
            await metering.record_turn(self.table_id, self.customer, role="user", text=text, stt_seconds=stt_seconds)
        self.turn_task = asyncio.create_task(self._run_turn())

    async def _meter(self, full_text: str, tts_chars: int) -> None:
        """Record the AI reply's usage in Redis, update the table's meter and the manager's live monitor."""
        u = self.session.turn_usage or {}
        await metering.record_turn(
            self.table_id, self.customer, role="assistant", text=full_text, model=u.get("model", ""),
            prompt_tokens=u.get("prompt_tokens", 0), completion_tokens=u.get("completion_tokens", 0),
            cost_usd=u.get("cost_usd", 0.0), latency_s=u.get("latency_s"), tts_chars=tts_chars)
        meter = await metering.visit_usage(self.table_id)
        await hub.to_table(self.table_id, {"type": "meter", **{k: meter[k] for k in (
            "minutes", "free_minutes", "free_left", "billable_minutes", "price_per_minute", "amount")}})
        await hub.to_staff({"type": "ai_usage", "table_id": self.table_id})

    async def _run_turn(self) -> None:
        s = self.session
        turn_start = len(s.history) - 1
        spoken: List[str] = []           # sentences actually handed to TTS
        tts_futs: List[asyncio.Future] = []
        tts_queue: asyncio.Queue = asyncio.Queue()
        speaker = s.prefs.get("voice", "priya")
        try:
            pace = float(s.prefs.get("pace") or 1.0)
        except (TypeError, ValueError):
            pace = 1.0
        use_sarvam = voice.enabled() and s.prefs.get("speak_replies", True) is not False

        async def audio_sender() -> None:
            seq = 0
            while True:
                item = await tts_queue.get()
                if item is None:
                    return
                sentence, fut = item
                tts_failed = False
                try:
                    audio_b64 = await fut
                except Exception as e:  # noqa: BLE001 — speak it with the browser voice instead
                    log.warning("TTS failed for table %s, falling back to browser voice: %s", self.table_id, e)
                    audio_b64, tts_failed = "", True
                await self.send({"type": "audio", "seq": seq, "text": sentence, "data": audio_b64,
                                 "lang": s.language, **({"tts_failed": True} if tts_failed else {})})
                seq += 1

        sender = asyncio.create_task(audio_sender())

        def speak(sentence: str) -> None:
            sentence = speakable(sentence)
            if not sentence:
                return
            spoken.append(sentence)
            if use_sarvam:
                fut = asyncio.ensure_future(voice.synthesize(sentence, s.language, speaker, pace))
                # mark any error as observed; it is handled (and logged) where the future is awaited
                fut.add_done_callback(lambda f: f.cancelled() or f.exception())
                tts_futs.append(fut)
            else:
                fut = asyncio.get_event_loop().create_future()
                fut.set_result("")  # browser speaks it with its own TTS
            tts_queue.put_nowait((sentence, fut))

        buffer = ""
        full = ""
        try:
            await self.send({"type": "status", "state": "thinking"})
            async for delta in s.respond():
                full += delta
                buffer += delta
                await self.send({"type": "assistant_delta", "text": delta})
                parts = SENTENCE_END.split(buffer)
                if len(parts) == 1 and not spoken and len(buffer) >= FIRST_CHUNK_MIN:
                    # nothing voiced yet: start speaking at the first clause break instead of the sentence end
                    clause = CLAUSE_END.split(buffer, maxsplit=1)
                    if len(clause) == 2 and len(clause[0]) >= FIRST_CHUNK_MIN * 0.6:
                        speak(clause[0])
                        buffer = clause[1]
                        continue
                    if len(buffer) >= FIRST_CHUNK_BREATH:
                        cuts = [m.start() for m in BREATH.finditer(buffer) if m.start() >= 30]
                        if cuts:
                            speak(buffer[:cuts[-1]])
                            buffer = buffer[cuts[-1]:].lstrip()
                            continue
                # Everything except the last fragment is a finished sentence; keep short ones joined.
                if len(parts) > 1:
                    ready, buffer = parts[:-1], parts[-1]
                    chunk = " ".join(ready)
                    if len(chunk) >= 12:
                        speak(chunk)
                    else:
                        buffer = chunk + " " + buffer
            speak(buffer)
            tts_queue.put_nowait(None)
            await sender
            self._save("assistant", full)
            await self.send({"type": "assistant_done", "text": full})
            # The turn is complete: meter in the background so a quick follow-up can't "interrupt" a finished reply.
            spawn(self._meter(full, sum(len(x) for x in spoken) if use_sarvam else 0), f"meter-table-{self.table_id}")
            if self.pending_note:
                note, self.pending_note = self.pending_note, None
                spawn(self.proactive(note), f"pending-note-table-{self.table_id}")
        except asyncio.CancelledError:
            sender.cancel()
            for f in tts_futs:
                f.cancel()
            s.record_interruption(turn_start, " ".join(spoken))
            self._save("assistant", " ".join(spoken))
            await self.send({"type": "assistant_done", "text": full, "interrupted": True})
            # tokens were spent even though the customer talked over the reply
            spawn(self._meter(full, sum(len(x) for x in spoken) if use_sarvam else 0), f"meter-table-{self.table_id}")
            log.info("reply interrupted by the customer after %d sentence(s)", len(spoken))
            raise
        except Exception as e:  # noqa: BLE001
            sender.cancel()
            for f in tts_futs:
                f.cancel()
            if isinstance(e, ServiceUnavailable):
                log.warning("turn failed for table %s: %s", self.table_id, e)
            else:
                log.exception("turn failed for table %s", self.table_id)
            s.record_interruption(turn_start, "")
            try:
                await self.send({"type": "error", "message": friendly(e)})
            except Exception:  # noqa: BLE001 — socket already gone
                pass

    # ----- message loop -----
    async def handle(self, msg: Dict[str, Any]) -> None:
        kind = msg.get("type")

        if kind == "start":
            await self.start_session(msg.get("prefs") or {})
            return

        if self.session is None:
            await self.send({"type": "error", "message": "Session not started"})
            return

        if kind == "prefs":
            self.session.prefs.update(msg.get("prefs") or {})
            if self.customer:
                spawn(asyncio.to_thread(db.save_customer_prefs, self.customer["id"], dict(self.session.prefs)),
                      f"save-prefs-{self.customer['id']}")
            return

        if kind == "interrupt":
            await self.interrupt()
            return

        if kind == "cart_set":
            # the menu's ADD / − / + buttons and Undo: exact, instant, no AI call
            try:
                item_id, qty = int(msg["menu_item_id"]), int(msg.get("qty", 0))
            except (KeyError, TypeError, ValueError):
                return
            change = await self.session.set_qty(item_id, qty, by=str(msg.get("by") or "menu")[:10])
            if change and change["by"] == "menu":
                self.menu_changes.append(change)
            return

        if kind == "menu_done":
            # the customer closed the menu after adding things: the companion notices, in a few words
            changes, self.menu_changes = self.menu_changes, []
            final: Dict[int, Dict[str, Any]] = {}
            for c in changes:
                final.setdefault(c["menu_item_id"], {**c}).update(after=c["after"])
            said = [f"{c['after']} × {c['name']}" if c["after"] else f"removed {c['name']}"
                    for c in final.values() if c["after"] != c["before"]]
            if said and not self.busy() and not gateway.recently_limited():
                await self.start_turn(f"[The customer just used the menu themselves: {', '.join(said)} (cart now: "
                                      f"{self.session.cart_summary()}). Acknowledge it in a few natural words — no "
                                      "prices, no list — and carry on.]", self.session.language, save_user=False)
            return

        if kind == "nudge":
            # the browser noticed a long silence after the companion finished talking; at most two check-ins in a row
            if self.busy() or self.nudges >= 2 or gateway.recently_limited():
                return          # optional chatter never spends a rate-limited AI budget
            self.nudges += 1
            log.info("table %s: quiet for a while, companion checks in (%d)", self.table_id, self.nudges)
            await self.start_turn("[Quiet moment, not the customer: they haven't said anything for a while. If it feels "
                                  "natural, say one short, easy thing — pick up an earlier thread about THEM or share a small take. "
                                  "Never about food, the menu or ordering, and never ask if they're still there. If they "
                                  "seemed busy, just say something warm and short.]",
                                  self.session.language, save_user=False)
            return

        if kind == "confirm_order":
            # the customer tapped "Place order": place it directly, then let the companion acknowledge naturally
            await self.interrupt()
            if not self.session.cart:
                await self.send({"type": "error", "message": "Your cart is empty."})
                return
            result = await self.session.run_tool("place_order", {})
            log.info("table %s placed an order from the button: %s", self.table_id, result)
            await self.start_turn(f"[The customer tapped the 'Place order' button. Result: {result} "
                                  "Acknowledge it in one short, natural line — don't list the items again, "
                                  "don't promise a time.]", self.session.language, save_user=False)
            return

        if kind == "text":
            text = (msg.get("text") or "").strip()[:2000]
            if text:
                await self.start_turn(text, msg.get("lang") or self.session.language)
            return

        if kind == "audio":
            if not voice.enabled():
                await self.send({"type": "error", "message": "Server voice is not configured"})
                return
            await self.interrupt()
            data = msg.get("data") or ""
            if len(data) > MAX_AUDIO_B64:
                log.warning("rejected oversized audio from table %s (%d KB)", self.table_id, len(data) // 1024)
                await self.send({"type": "error", "message": "That recording was too long — please keep it under 30 seconds."})
                return
            try:
                audio = base64.b64decode(data, validate=True)
            except (binascii.Error, ValueError):
                log.warning("table %s sent malformed audio data", self.table_id)
                await self.send({"type": "error", "message": "Couldn't read that recording, please try again."})
                return
            if len(audio) < 2000:  # too short to be speech
                await self.send({"type": "status", "state": "listening"})
                return
            await self.send({"type": "status", "state": "transcribing"})
            mime = (msg.get("mime") or "audio/webm").split(";")[0]
            ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav"}.get(mime, "webm")
            try:
                text, lang = await voice.transcribe(audio, f"speech.{ext}", mime)
            except VoiceError as e:
                log.warning("speech-to-text failed for table %s: %s", self.table_id, e)
                await self.send({"type": "error", "message": "Couldn't hear that clearly — please try again, or type."})
                return
            if not text:
                await self.send({"type": "status", "state": "listening"})
                return
            await self.send({"type": "transcript", "text": text, "lang": lang})
            # 16 kHz mono 16-bit WAV from the browser = 32,000 bytes per second
            stt_seconds = max(0, len(audio) - 44) / 32000 if mime == "audio/wav" else 0.0
            await self.start_turn(text, lang, stt_seconds=stt_seconds)
            return

    async def start_session(self, prefs: Dict[str, Any]) -> None:
        if self.session:                    # reconnect on the same socket: keep going
            return
        if self.customer:
            # saved preferences, overridden by anything changed on this device
            prefs = {**self.customer.get("prefs", {}), **prefs}
        self.session = agent.TableSession(self.table_id, prefs, self.emit, self.customer)

        if self.customer:
            cid = self.customer["id"]

            def load_customer_session():
                """All of the returning-customer setup in one worker thread (several DB round trips)."""
                db.save_customer_prefs(cid, {k: v for k, v in prefs.items() if k not in ("text_only",)})
                returning_ = bool(self.session.load_previous_chat())
                db.touch_customer_visit(cid)
                fresh = db.get_customer(cid) or {}
                return returning_, fresh, db.start_conversation(cid, self.table_id)

            returning, fresh, self.conversation_id = await asyncio.to_thread(load_customer_session)
            self.customer = {**self.customer, **fresh}
            self.session.customer = self.customer
            if returning:
                greet = (f"[{self.customer['name']} is back at the cafe (table {self.table_id}) and opened the companion "
                         "again. The earlier messages in this chat are from their previous visit(s). Welcome them back "
                         "like an old friend and pick up ONE specific thread about their life from last time (how "
                         "something went, a plan, something they told you) — not food. {_opening_angle()} One or two short "
                         "sentences.]")
            else:
                greet = (f"[{self.customer['name']} just created their account and sat down at table {self.table_id}. "
                         f"Say hi warmly, in character. {_opening_angle()} One or two short sentences. Don't list the menu.]")
        elif (trail := guest_chat(self.table_id)) is not None:
            # the same guest reopened the companion: carry on the conversation instead of starting over
            self.session.history = [dict(m) for m in trail["history"]]
            if trail["name"] and not self.session.customer_name:
                self.session.customer_name = trail["name"]
            greet = ("[The guest just reopened the companion after a short break; the messages above are your chat "
                     "from a few minutes ago. Carry on naturally from where you left off, like a friend picking the "
                     "thread back up. No re-introductions, and not about food. One short sentence.]")
        else:
            name = self.session.customer_name
            greet = (f"[A guest{(' named ' + name) if name else ''} just sat down and opened the companion. Say hi "
                     f"warmly, in character. {_opening_angle()}"
                     + ("" if name else " Somewhere in it, casually ask what you should call them.")
                     + " One or two short sentences. Don't list the menu.]")
        await metering.session_open(self.session_key, self.table_id, self.customer)
        meter = await metering.visit_usage(self.table_id)
        await self.send({"type": "meter", **{k: meter[k] for k in (
            "minutes", "free_minutes", "free_left", "billable_minutes", "price_per_minute", "amount")}})
        await self.start_turn(greet, prefs.get("language", "en-IN"), save_user=False)
        await hub.to_staff({"type": "table_live", "table_id": self.table_id, "live": True})

    async def close(self) -> None:
        await self.interrupt()
        await metering.session_close(self.session_key)
        if self.session and not self.customer:
            remember_guest_chat(self.table_id, self.session.history, self.session.customer_name)
        if self.conversation_id:
            spawn(summarise_conversation(self.conversation_id), f"summary-{self.conversation_id}")


async def summarise_conversation(conversation_id: int) -> None:
    """Runs after the customer leaves: store a short memory of the chat for their next visit."""
    try:
        msgs = db.conversation_messages(conversation_id)
        if sum(1 for m in msgs if m["role"] == "user") < 1:
            db.end_conversation(conversation_id, "")
            return
        db.end_conversation(conversation_id, await agent.summarize(msgs))
        log.info("conversation %s summarised (%d messages)", conversation_id, len(msgs))
    except LLMUnavailable as e:
        log.warning("could not summarise conversation %s: %s — kept without a summary", conversation_id, e)
        db.end_conversation(conversation_id, "")
    except Exception:  # noqa: BLE001
        log.exception("could not summarise conversation %s", conversation_id)
