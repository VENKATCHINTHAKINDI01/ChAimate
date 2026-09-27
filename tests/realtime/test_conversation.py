"""The live conversation socket: ordering by name, menu taps & undo, proactive turns and resilience."""
import pytest

from app.core import db
from app.core.errors import LLMUnavailable
from app.realtime.conversation import VoiceConnection
from app.services import llm_gateway as gateway, voice
from tests.conftest import drain, login_staff


def next_cart(ws):
    while True:
        m = ws.receive_json()
        if m["type"] == "cart":
            return m


def item_id(name_start):
    return next(m["id"] for m in db.list_menu() if m["name"].startswith(name_start))


def test_ai_orders_by_name_and_asks_when_vague(client, fake_llm):
    said = []

    async def script(s, last):
        said.append(await s.run_tool("add_to_cart", {"item": "discuits", "qty": 2}))
        said.append(await s.run_tool("add_to_cart", {"item": "chai", "qty": 1}))
        said.append(await s.run_tool("add_to_cart", {"item": "Irani Chai", "qty": 1, "menu_item_id": 19}))  # wrong id
        said.append(await s.run_tool("remove_from_cart", {"item": "brownie"}))
        yield "ok"

    with client.websocket_connect("/ws/table/6") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        fake_llm(script)
        ws.send_json({"type": "text", "text": "two osmania biscuits and a chai"})
        carts = [m for m in drain(ws) if m["type"] == "cart"]
    assert sorted((c["name"], c["qty"]) for c in carts[-1]["cart"]) == [("Irani Chai", 1), ("Osmania Biscuits (4 pcs)", 2)]
    assert "Ask the customer which one" in said[1]
    assert "isn't in the cart" in said[3]
    assert carts[0]["change"] == {"menu_item_id": item_id("Osmania"), "name": "Osmania Biscuits (4 pcs)",
                                  "before": 0, "after": 2, "by": "ai"}


def test_menu_taps_undo_and_acknowledgement(client, fake_llm):
    samosa = item_id("Samosa")
    with client.websocket_connect("/ws/table/8") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        ws.send_json({"type": "cart_set", "menu_item_id": samosa, "qty": 1, "by": "menu"})
        assert next_cart(ws)["change"]["after"] == 1
        ws.send_json({"type": "cart_set", "menu_item_id": samosa, "qty": 0, "by": "undo"})
        m = next_cart(ws)
        assert m["change"]["after"] == 0 and m["cart"] == []
        ws.send_json({"type": "cart_set", "menu_item_id": samosa, "qty": 2, "by": "menu"})
        next_cart(ws)
        ws.send_json({"type": "menu_done"})
        assert any(x["type"] == "assistant_delta" for x in drain(ws))      # the companion notices, briefly


def test_quiet_check_ins_are_capped_at_two(client, fake_llm):
    notes = []

    async def script(s, last):
        notes.append(last)
        yield "hi"

    fake_llm(script)
    with client.websocket_connect("/ws/table/9") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        ws.send_json({"type": "nudge"})
        drain(ws)
        ws.send_json({"type": "nudge"})
        drain(ws)
        ws.send_json({"type": "nudge"})                                  # third in a row: ignored
        ws.send_json({"type": "text", "text": "hello"})
        drain(ws)
    assert sum("Quiet moment" in n for n in notes) == 2 and notes[-1] == "hello"


def test_companion_mentions_ready_order(client, fake_llm):
    notes = []

    async def script(s, last):
        notes.append(last)
        yield "Arre, your chai is here!"

    fake_llm(script)
    with client.websocket_connect("/ws/table/10") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        order = db.create_order(10, "Ravi", [{"menu_item_id": item_id("Chicken Biryani"), "qty": 1, "notes": ""}])
        login_staff("manager", "1234").post(f"/api/staff/orders/{order['id']}/station/kitchen", json={"status": "ready"})
        drain(ws)
    assert any("Café update" in n and "Chicken Biryani" in n for n in notes)


def test_llm_outage_gives_friendly_message(client, monkeypatch):
    async def failing(*a, **k):
        raise LLMUnavailable("The AI is busy (rate limit) — try again in a minute")

    monkeypatch.setattr(gateway, "chat_stream", failing)
    with client.websocket_connect("/ws/table/2") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        assert "trouble thinking" in drain(ws)[-1]["message"]


def test_session_survives_bad_input_and_handler_crashes(client, fake_llm, monkeypatch):
    with client.websocket_connect("/ws/table/4") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        ws.send_text("{not json")
        ws.send_text("[1,2]")
        monkeypatch.setattr(voice, "enabled", lambda: True)
        ws.send_json({"type": "audio", "data": "!!!not-base64!!!", "mime": "audio/wav"})
        assert "Couldn't read" in drain(ws, "error")[-1]["message"]
        ws.send_json({"type": "audio", "data": "A" * (4 * 1024 * 1024 + 8), "mime": "audio/wav"})
        assert "too long" in drain(ws, "error")[-1]["message"]

        async def boom(self, *a, **k):
            raise RuntimeError("simulated bug")

        real_start_turn = VoiceConnection.start_turn
        monkeypatch.setattr(VoiceConnection, "start_turn", boom)
        ws.send_json({"type": "text", "text": "crash please"})
        assert "glitch" in drain(ws, "error")[-1]["message"]
        monkeypatch.setattr(VoiceConnection, "start_turn", real_start_turn)
        ws.send_json({"type": "text", "text": "still there?"})
        assert drain(ws)[-1]["type"] == "assistant_done"


@pytest.mark.parametrize("kind", ["nudge", "menu_done", "interrupt"])
def test_control_messages_before_start_are_rejected_politely(client, kind):
    with client.websocket_connect("/ws/table/1") as ws:
        ws.send_json({"type": kind})
        assert ws.receive_json()["type"] == "error"


def test_guest_chat_carries_on_after_reconnect_until_the_bill_is_settled(client, fake_llm):
    seen = []

    async def script(s, last):
        seen.append(" ".join(m["content"] for m in s.history if m["role"] == "user"))
        yield "hi"

    fake_llm(script)
    with client.websocket_connect("/ws/table/7") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        ws.send_json({"type": "text", "text": "my driving test is tomorrow"})
        drain(ws)
    with client.websocket_connect("/ws/table/7") as ws:              # page reload: same chat, picked back up
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
    assert "driving test" in seen[-1] and "reopened the companion" in seen[-1]

    login_staff("manager", "1234").post("/api/staff/tables/7/settle")   # guests left: the next ones start fresh
    with client.websocket_connect("/ws/table/7") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
    assert "driving test" not in seen[-1] and "just sat down" in seen[-1]
