"""Staff app API: login, live overview, kitchen/bar tickets, tables, requests, menu and team — role-checked."""
import logging
import re
import time
from typing import Dict, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.agents import companion as agent
from app.api.deps import PIN_RE, staff, staff_from_token
from app.core import db
from app.core import security as auth
from app.core.config import CURRENCY
from app.realtime.conversation import forget_guest_chat
from app.realtime.hub import broadcast_order, hub
from app.services import llm_gateway as gateway, metering
from app.services.billing import full_bill

router = APIRouter(tags=["staff"])
log = logging.getLogger("main")


class StaffLogin(BaseModel):
    username: str
    pin: str


@router.post("/api/staff/login")
def staff_login(body: StaffLogin, response: Response):
    key = f"staff:{body.username.lower()}"
    if auth.locked(key):
        raise HTTPException(429, "Too many wrong PINs. Try again in 5 minutes.")
    user = db.get_staff_by_username(body.username.strip())
    if not user or not auth.verify_pin(body.pin, user["pin_hash"]):
        auth.record_failure(key)
        log.warning("staff login failed for %r", body.username[:30])
        raise HTTPException(401, "Wrong username or PIN")
    auth.clear_failures(key)
    log.info("staff %s (%s) logged in", user["username"], user["role"])
    token = auth.new_token("staff", user["id"])
    response.set_cookie("staff_token", token, httponly=True, samesite="lax", max_age=auth.STAFF_TOKEN_AGE)
    return db.get_staff(user["id"])


@router.post("/api/staff/logout")
def staff_logout(response: Response, staff_token: Optional[str] = Cookie(default=None)):
    if staff_token:
        db.delete_token(staff_token)
    response.delete_cookie("staff_token")
    return {"ok": True}


@router.get("/api/staff/overview")
async def staff_overview(user=Depends(staff())):
    start_of_day = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    data = {
        "me": user,
        "tables": db.list_tables(),
        "orders": db.list_orders(active_only=True),
        "requests": db.list_requests(open_only=True),
        "menu": db.list_menu(),
        "live_tables": sorted(t for t, s in hub.tables.items() if s),
    }
    if user["role"] in ("manager", "waiter"):
        data["ai_by_table"] = {t["id"]: await metering.visit_usage(t["id"]) for t in data["tables"]}
    if user["role"] == "manager":
        data["sales_today"] = db.sales_summary(start_of_day)
        data["ai_settled_today"] = db.ai_usage_summary(start_of_day)
        data["staff"] = db.list_staff()
        data["customers"] = db.list_customers()
    return data


class StatusBody(BaseModel):
    status: str


STATION_STATUSES = {"queued", "preparing", "ready"}


@router.post("/api/staff/orders/{order_id}/station/{station}")
async def set_station_status(order_id: int, station: str, body: StatusBody, user=Depends(staff("kitchen", "bar", "manager"))):
    """Kitchen / bar update their own part of an order."""
    if body.status not in STATION_STATUSES or station not in ("kitchen", "bar"):
        raise HTTPException(400, "Bad status")
    if user["role"] in ("kitchen", "bar") and user["role"] != station:
        raise HTTPException(403, "That's another station's ticket")
    before = db.get_order(order_id)
    if not before:
        raise HTTPException(404)
    order = db.update_station_status(order_id, station, body.status)
    announce = None
    if order["status"] == "ready" and before["status"] != "ready":
        announce = f"Your order #{order_id} is ready and on its way!"
        await hub.to_staff({"type": "order_ready", "order": order})
    elif order["status"] == "preparing" and before["status"] == "new":
        announce = f"Your order #{order_id} is being prepared."
    await broadcast_order(order, announce)
    return order


ORDER_STATUSES = {"served", "paid", "cancelled"}


@router.post("/api/staff/orders/{order_id}/status")
async def set_order_status(order_id: int, body: StatusBody, user=Depends(staff("waiter", "manager"))):
    if body.status not in ORDER_STATUSES:
        raise HTTPException(400, "Bad status")
    order = db.update_order_status(order_id, body.status)
    if not order:
        raise HTTPException(404)
    await broadcast_order(order, {"served": f"Order #{order_id} served. Enjoy!",
                                   "cancelled": f"Order #{order_id} was cancelled — please ask staff if unsure."}
                           .get(body.status))
    return order


@router.post("/api/staff/tables/{table_id}/settle")
async def settle(table_id: int, user=Depends(staff("waiter", "manager"))):
    bill = await full_bill(table_id)
    usage = await metering.close_visit(table_id)
    if usage:
        db.save_ai_usage(table_id, usage)
    db.settle_table(table_id)
    forget_guest_chat(table_id)             # the guests have left: the next ones start a fresh chat
    log.info("table %s settled by %s: food %s%.0f + AI %s%.0f", table_id, user["username"], CURRENCY, bill["total"],
             CURRENCY, bill["ai"]["amount"])
    await hub.to_staff({"type": "refresh"})
    await hub.to_table(table_id, {"type": "settled"})
    return {"ok": True, "bill": bill}


@router.post("/api/staff/requests/{req_id}/resolve")
async def resolve(req_id: int, user=Depends(staff("waiter", "manager"))):
    db.resolve_request(req_id)
    await hub.to_staff({"type": "refresh"})
    return {"ok": True}


@router.get("/api/staff/ai-usage")
async def ai_usage(user=Depends(staff("manager"))):
    start_of_day = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    return {
        **await metering.dashboard(),
        "settled_today": db.ai_usage_summary(start_of_day),
        "models": gateway.health(),
        "pricing": metering.price_for(0),
    }


class MenuItemBody(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    description: Optional[str] = None
    veg: Optional[int] = None
    spicy: Optional[int] = None
    available: Optional[int] = None
    station: Optional[str] = None


@router.post("/api/staff/menu")
async def add_menu_item(body: MenuItemBody, user=Depends(staff("manager"))):
    data = body.model_dump(exclude_none=True)
    if not data.get("name") or not data.get("category") or data.get("price") is None:
        raise HTTPException(400, "name, category and price are required")
    item = db.upsert_menu_item(data)
    agent.invalidate_menu_cache()
    await hub.to_staff({"type": "refresh"})
    return item


@router.patch("/api/staff/menu/{item_id}")
async def edit_menu_item(item_id: int, body: MenuItemBody, user=Depends(staff())):
    data = body.model_dump(exclude_none=True)
    if user["role"] != "manager":
        # kitchen / bar may only mark their own items in or out of stock
        item = db.get_menu_item(item_id)
        if set(data) != {"available"} or not item or item["station"] != user["role"]:
            raise HTTPException(403, "Only the manager can edit menu details")
    item = db.upsert_menu_item(data, item_id)
    agent.invalidate_menu_cache()
    await hub.to_staff({"type": "refresh"})
    return item


@router.delete("/api/staff/menu/{item_id}")
async def remove_menu_item(item_id: int, user=Depends(staff("manager"))):
    db.delete_menu_item(item_id)
    agent.invalidate_menu_cache()
    await hub.to_staff({"type": "refresh"})
    return {"ok": True}


class NewStaff(BaseModel):
    username: str
    name: str
    role: str
    pin: str


@router.post("/api/staff/users")
def add_staff_user(body: NewStaff, user=Depends(staff("manager"))):
    if body.role not in auth.STAFF_ROLES or not PIN_RE.match(body.pin) or not re.match(r"^[a-zA-Z0-9_.]{3,30}$", body.username):
        raise HTTPException(400, "Username (3–30 letters/digits), a valid role and a 4–6 digit PIN are required")
    if db.get_staff_by_username(body.username):
        raise HTTPException(409, "Username taken")
    return db.add_staff(body.username, body.name.strip()[:40] or body.username, body.role, auth.hash_pin(body.pin))


@router.post("/api/staff/users/{staff_id}/active")
def toggle_staff(staff_id: int, body: Dict[str, bool], user=Depends(staff("manager"))):
    if staff_id == user["id"]:
        raise HTTPException(400, "You can't deactivate yourself")
    db.set_staff_active(staff_id, bool(body.get("active")))
    return {"ok": True}


@router.websocket("/ws/staff")
async def staff_ws(ws: WebSocket):
    if not staff_from_token(ws.cookies.get("staff_token")):
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.staff.add(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive pings
    except WebSocketDisconnect:
        pass
    finally:
        hub.staff.discard(ws)
