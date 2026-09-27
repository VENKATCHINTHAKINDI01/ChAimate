"""Public customer-app API: options, menu, table bill, staff requests and table QR codes."""
import io
import re
import time
from typing import Any, Dict

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.agents import companion as agent
from app.core import db
from app.core.config import AI_FREE_MINUTES, AI_PRICE_PER_MINUTE, CAFE_NAME, COMPANION_NAME, CURRENCY, PUBLIC_BASE_URL, STATIC_DIR
from app.realtime.hub import hub
from app.services import voice
from app.services.billing import full_bill

router = APIRouter(tags=["public"])


@router.get("/api/options")
def options():
    return {
        "cafe_name": CAFE_NAME,
        "companion_name": COMPANION_NAME,
        "currency": CURRENCY,
        "voice_mode": "sarvam" if voice.enabled() else "browser",
        "personas": agent.PERSONAS,
        "moods": agent.MOODS,
        "topics": agent.TOPICS,
        "languages": agent.LANGUAGES,
        "voices": voice.VOICES,
        "free_minutes": AI_FREE_MINUTES,
        "price_per_minute": AI_PRICE_PER_MINUTE,
    }


MENU_PHOTOS = STATIC_DIR / "img" / "menu"
_bestsellers: Dict[str, Any] = {"at": 0.0, "ids": set()}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\(.*?\)", "", name.lower())).strip("-")


@router.get("/api/menu")
def public_menu():
    """The menu with a real photo (when we have one of that exact dish) and a Bestseller mark (top 3 sold, 30 days)."""
    if time.time() - _bestsellers["at"] > 600:
        _bestsellers["ids"], _bestsellers["at"] = set(db.bestseller_ids(days=30, limit=3)), time.time()
    items = db.list_menu(only_available=True)
    for m in items:
        slug = _slug(m["name"])
        m["photo"] = f"/static/img/menu/{slug}.jpg" if (MENU_PHOTOS / f"{slug}.jpg").exists() else None
        m["bestseller"] = m["id"] in _bestsellers["ids"]
    return items


@router.get("/api/tables/{table_id}/bill")
async def public_bill(table_id: int):
    return await full_bill(table_id)


class RequestBody(BaseModel):
    kind: str = "waiter"
    message: str = ""


@router.post("/api/tables/{table_id}/request")
async def table_request(table_id: int, body: RequestBody):
    if not db.get_table(table_id) or body.kind not in {"waiter", "bill", "help"}:
        raise HTTPException(400, "Bad request")
    req = db.create_request(table_id, body.kind, body.message[:200])
    await hub.to_staff({"type": "request_new", "request": req})
    return req


@router.get("/api/tables/{table_id}/qr.svg")
def table_qr(table_id: int):
    img = qrcode.make(f"{PUBLIC_BASE_URL}/table?t={table_id}", image_factory=qrcode.image.svg.SvgPathImage, box_size=12)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")
