"""Customer accounts: phone + PIN login, profile, preferences and what the companion remembers."""
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel

from app.api.deps import PHONE_RE, PIN_RE, _clean_phone, current_customer
from app.core import db
from app.core import security as auth
from app.services import metering

router = APIRouter(prefix="/api/customer", tags=["customer"])
log = logging.getLogger("main")


class CustomerAuth(BaseModel):
    phone: str
    pin: str
    name: Optional[str] = None     # present => sign up


@router.post("/auth")
def customer_auth(body: CustomerAuth, response: Response):
    phone = _clean_phone(body.phone)
    if not PHONE_RE.match(phone):
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    if not PIN_RE.match(body.pin):
        raise HTTPException(400, "PIN must be 4–6 digits")
    key = f"cust:{phone}"
    if auth.locked(key):
        log.warning("customer login locked out for ••%s (too many wrong PINs)", phone[-4:])
        raise HTTPException(429, "Too many wrong PINs. Try again in 5 minutes.")

    existing = db.get_customer_by_phone(phone)
    if body.name is not None:                       # sign up
        if existing:
            raise HTTPException(409, "This number already has an account — log in instead")
        name = body.name.strip()[:40]
        if not name:
            raise HTTPException(400, "Tell us your name")
        customer = db.create_customer(phone, name, auth.hash_pin(body.pin))
        log.info("new customer #%s signed up", customer["id"])
    else:                                           # log in
        if not existing or not auth.verify_pin(body.pin, existing["pin_hash"]):
            auth.record_failure(key)
            log.info("customer login failed for ••%s", phone[-4:])
            raise HTTPException(401, "Wrong number or PIN")
        auth.clear_failures(key)
        customer = db.get_customer(existing["id"])

    token = auth.new_token("customer", customer["id"])
    response.set_cookie("cust_token", token, httponly=True, samesite="lax", max_age=auth.CUSTOMER_TOKEN_AGE)
    return customer


@router.post("/logout")
def customer_logout(response: Response, cust_token: Optional[str] = Cookie(default=None)):
    if cust_token:
        db.delete_token(cust_token)
    response.delete_cookie("cust_token")
    return {"ok": True}


@router.get("/me")
async def customer_me(customer=Depends(current_customer)):
    cid = customer["id"]
    return {
        "customer": customer,
        "memories": db.list_memories(cid),
        "favourites": db.favourite_items(cid),
        "orders": db.list_orders(customer_id=cid, limit=10),
        "messages": db.recent_messages(cid, 30),
        "ai_totals": await metering.customer_totals(cid),
    }


@router.put("/prefs")
def customer_prefs(prefs: Dict[str, Any], customer=Depends(current_customer)):
    db.save_customer_prefs(customer["id"], {k: v for k, v in prefs.items() if k not in ("text_only",)})
    return {"ok": True}


@router.delete("/memories/{memory_id}")
def customer_forget(memory_id: int, customer=Depends(current_customer)):
    if not db.delete_memory(customer["id"], memory_id):
        raise HTTPException(404)
    return {"ok": True}


@router.delete("/data")
def customer_forget_all(customer=Depends(current_customer)):
    db.delete_customer_data(customer["id"])
    return {"ok": True}
