"""Customer accounts & memory across visits, and what each staff role may do."""
import time

import pytest

from app.agents import companion
from app.core import db
from tests.conftest import drain, login_staff

PHONE = "9876543210"


@pytest.fixture
def scripted(fake_llm, monkeypatch):
    systems = []

    async def script(session, last):
        await session._refresh_context()
        systems.append(session._system()["content"])
        if "RCB" in last:
            await session.run_tool("remember", {"fact": "Supports RCB", "category": "preference"})
            yield "RCB fan! Ee sala cup namde."
        elif "order" in last:
            await session.run_tool("add_to_cart", {"item": "Masala Chai", "qty": 1})        # bar
            await session.run_tool("add_to_cart", {"item": "Chicken Biryani", "qty": 1})    # kitchen
            await session.run_tool("place_order", {})
            yield "Order placed!"
        else:
            yield "Hello friend!"
        session.history.append({"role": "assistant", "content": "ok"})

    async def summary(msgs):
        return "We talked about RCB; they ordered chai and biryani."

    fake_llm(script)
    monkeypatch.setattr(companion, "summarize", summary)
    return systems


def test_customer_is_remembered_across_visits(client, scripted):
    r = client.post("/api/customer/auth", json={"phone": "+91 98765 43210", "pin": "4321", "name": "Ravi"})
    assert r.status_code == 200 and r.json()["name"] == "Ravi"
    assert client.post("/api/customer/auth", json={"phone": PHONE, "pin": "1111", "name": "X"}).status_code == 409

    with client.websocket_connect("/ws/table/3") as ws:
        ws.send_json({"type": "start", "prefs": {"persona": "cricket_fanatic", "persona_name": "Chintu"}})
        drain(ws)
        ws.send_json({"type": "text", "text": "I support RCB"})
        assert "memory_saved" in [m["type"] for m in drain(ws)]
        ws.send_json({"type": "text", "text": "place an order please"})
        assert "order_placed" in [m["type"] for m in drain(ws)]
    me = client.get("/api/customer/me").json()
    for _ in range(30):                                   # the chat summary is written in the background
        if db.recent_summaries(me["customer"]["id"]):
            break
        time.sleep(0.1)
    assert me["customer"]["prefs"]["persona_name"] == "Chintu"
    assert [m["fact"] for m in me["memories"]] == ["Supports RCB"]
    assert db.recent_summaries(me["customer"]["id"])

    client.post("/api/customer/logout")
    assert client.get("/api/customer/me").status_code == 401
    assert client.post("/api/customer/auth", json={"phone": PHONE, "pin": "0000"}).status_code == 401
    client.post("/api/customer/auth", json={"phone": PHONE, "pin": "4321"})
    with client.websocket_connect("/ws/table/5") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
    prompt = scripted[-1]
    assert "Supports RCB" in prompt and "We talked about RCB" in prompt and "Chintu" in prompt
    assert "Chicken Biryani" in prompt.split("Their usual orders")[1][:200]
    client.post("/api/customer/logout")


def test_orders_are_routed_to_stations_and_roles_are_enforced(client, scripted):
    with client.websocket_connect("/ws/table/7") as ws:
        ws.send_json({"type": "start", "prefs": {}})
        drain(ws)
        ws.send_json({"type": "text", "text": "place an order please"})
        drain(ws)
    order = next(o for o in db.list_orders(active_only=True) if o["table_id"] == 7)
    assert {i["name"]: i["station"] for i in order["items"]} == {"Masala Chai": "bar", "Chicken Biryani": "kitchen"}

    kitchen, bar = login_staff("kitchen", "1111"), login_staff("bar", "2222")
    waiter, manager = login_staff("waiter", "3333"), login_staff("manager", "1234")
    oid = order["id"]
    assert kitchen.post(f"/api/staff/orders/{oid}/station/bar", json={"status": "ready"}).status_code == 403
    assert kitchen.post(f"/api/staff/orders/{oid}/station/kitchen", json={"status": "preparing"}).json()["status"] == "preparing"
    bar.post(f"/api/staff/orders/{oid}/station/bar", json={"status": "ready"})
    with waiter.websocket_connect("/ws/staff") as staff_ws:
        assert kitchen.post(f"/api/staff/orders/{oid}/station/kitchen", json={"status": "ready"}).json()["status"] == "ready"
        assert staff_ws.receive_json()["type"] == "order_ready"
    assert kitchen.post(f"/api/staff/orders/{oid}/status", json={"status": "served"}).status_code == 403
    assert waiter.post(f"/api/staff/orders/{oid}/status", json={"status": "served"}).json()["status"] == "served"

    biryani = next(m for m in db.list_menu() if m["name"] == "Chicken Biryani")
    chai = next(m for m in db.list_menu() if m["name"] == "Masala Chai")
    assert kitchen.patch(f"/api/staff/menu/{biryani['id']}", json={"price": 1}).status_code == 403
    assert kitchen.patch(f"/api/staff/menu/{biryani['id']}", json={"available": 0}).status_code == 200
    assert kitchen.patch(f"/api/staff/menu/{chai['id']}", json={"available": 0}).status_code == 403
    kitchen.patch(f"/api/staff/menu/{biryani['id']}", json={"available": 1})
    assert waiter.post("/api/staff/menu", json={"name": "x", "category": "y", "price": 1}).status_code == 403

    overview = manager.get("/api/staff/overview").json()
    assert {"sales_today", "customers", "staff"} <= set(overview)
    assert "sales_today" not in kitchen.get("/api/staff/overview").json()
    assert manager.post("/api/staff/users", json={"username": "priya", "name": "Priya", "role": "waiter", "pin": "5678"}).status_code == 200
    login_staff("priya", "5678")
