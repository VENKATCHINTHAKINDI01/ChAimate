"""Shared FastAPI dependencies: who is calling (customer or staff) and input helpers."""
import re
from typing import Any, Dict, Optional

from fastapi import Cookie, HTTPException

from app.core import db
from app.core import security as auth

PHONE_RE = re.compile(r"^[6-9]\d{9}$")   # Indian mobile numbers
PIN_RE = re.compile(r"^\d{4,6}$")


def _clean_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits


def current_customer(cust_token: Optional[str] = Cookie(default=None)) -> Dict[str, Any]:
    cid = db.token_user(cust_token, "customer", auth.CUSTOMER_TOKEN_AGE) if cust_token else None
    customer = db.get_customer(cid) if cid else None
    if not customer:
        raise HTTPException(401, "Please log in")
    return customer


def staff_from_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    sid = db.token_user(token, "staff", auth.STAFF_TOKEN_AGE) if token else None
    user = db.get_staff(sid) if sid else None
    return user if user and user["active"] else None


def staff(*roles: str):
    """Dependency: require a logged-in staff member, optionally with one of the given roles."""
    def dep(staff_token: Optional[str] = Cookie(default=None)) -> Dict[str, Any]:
        user = staff_from_token(staff_token)
        if not user:
            raise HTTPException(401, "Staff login required")
        if roles and user["role"] not in roles:
            raise HTTPException(403, "Not allowed for your role")
        return user
    return dep
