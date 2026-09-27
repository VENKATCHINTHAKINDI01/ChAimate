"""Deccan House website API: table availability, reservations, private-event enquiries and the newsletter."""
import logging
import re
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.deps import staff
from app.core import db
from app.realtime.hub import hub

router = APIRouter(tags=["website"])
log = logging.getLogger("main")

SLOT_CAPACITY = 40                      # guests the house seats per half-hour slot
SEATINGS = {"main", "bar", "courtyard", "lounge", "private"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[\d\s-]{8,16}$")


def _slots(day: str) -> List[str]:
    """Half-hour seatings from 7:30; last seating an hour before close (23:00 weekdays, 00:00 weekends)."""
    d = datetime.strptime(day, "%Y-%m-%d")
    last = 22 * 60 + 30 if d.weekday() >= 5 else 21 * 60 + 30
    return [f"{m // 60:02d}:{m % 60:02d}" for m in range(7 * 60 + 30, last + 1, 30)]


def _parse_day(day: str) -> datetime:
    try:
        d = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Choose a valid date")
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    if d < today or d > today + timedelta(days=60):
        raise HTTPException(400, "We take reservations for the next 60 days")
    return d


@router.get("/api/reservations/availability")
def availability(date: str = Query(...), guests: int = Query(2, ge=1, le=12)):
    _parse_day(date)
    booked, now = db.covers_booked(date), datetime.now()
    out = []
    for s in _slots(date):
        at = datetime.strptime(f"{date} {s}", "%Y-%m-%d %H:%M")
        label = at.strftime("%I:%M %p").lstrip("0")
        out.append({"time": s, "label": label,
                    "available": at - now > timedelta(minutes=45) and booked.get(s, 0) + guests <= SLOT_CAPACITY})
    return {"date": date, "slots": out}


class ReservationIn(BaseModel):
    date: str
    time: str
    guests: int = Field(ge=1, le=12)
    seating: str = "main"
    occasion: str = Field("", max_length=40)
    name: str = Field(min_length=2, max_length=80)
    phone: str
    email: str
    notes: str = Field("", max_length=500)


@router.post("/api/reservations")
async def reserve(body: ReservationIn):
    day = _parse_day(body.date)
    if body.time not in _slots(body.date):
        raise HTTPException(400, "Choose one of the available times")
    if datetime.strptime(f"{body.date} {body.time}", "%Y-%m-%d %H:%M") - datetime.now() < timedelta(minutes=45):
        raise HTTPException(400, "That time is too soon — please pick a later one")
    if body.seating not in SEATINGS or (body.seating == "private" and body.guests < 6):
        raise HTTPException(400, "Choose a seating area")
    if not PHONE_RE.match(body.phone.strip()) or not EMAIL_RE.match(body.email.strip()):
        raise HTTPException(400, "Please check your phone number and email")
    reference = "DH-" + "".join(secrets.choice("ACDEFGHJKLMNPQRTUVWXY34679") for _ in range(4))
    res = db.create_reservation({"reference": reference, "day": day.strftime("%Y-%m-%d"), "slot": body.time, "guests": body.guests,
                                 "seating": body.seating, "occasion": body.occasion.strip(), "name": body.name.strip(),
                                 "phone": body.phone.strip(), "email": body.email.strip().lower(), "notes": body.notes.strip()},
                                SLOT_CAPACITY)
    if not res:
        raise HTTPException(409, "That time has just filled up — please choose another")
    log.info("reservation %s: %s at %s for %d (%s)", reference, body.date, body.time, body.guests, body.seating)
    await hub.to_staff({"type": "reservation_new", "reservation": res})
    return {"reference": reference, "date": res["day"], "time": res["slot"], "guests": res["guests"], "seating": res["seating"], "name": res["name"]}


class EnquiryIn(BaseModel):
    kind: str = Field(max_length=40)
    date: str
    guests: int = Field(ge=2, le=150)
    name: str = Field(min_length=2, max_length=80)
    phone: str
    email: str
    details: str = Field("", max_length=1500)


@router.post("/api/events/enquiry")
async def event_enquiry(body: EnquiryIn):
    _parse_day(body.date)
    if not PHONE_RE.match(body.phone.strip()) or not EMAIL_RE.match(body.email.strip()):
        raise HTTPException(400, "Please check your phone number and email")
    enq = db.create_event_enquiry({"kind": body.kind, "day": body.date, "guests": body.guests, "name": body.name.strip(),
                                   "phone": body.phone.strip(), "email": body.email.strip().lower(), "details": body.details.strip()})
    log.info("event enquiry #%s: %s for %d on %s", enq["id"], body.kind, body.guests, body.date)
    await hub.to_staff({"type": "event_enquiry", "enquiry": enq})
    return {"ok": True}


class NewsletterIn(BaseModel):
    email: str


@router.post("/api/newsletter")
def newsletter(body: NewsletterIn):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 200:
        raise HTTPException(400, "Please enter a valid email")
    return {"ok": True, "new": db.add_newsletter(email)}


# ---- staff: the manager and waiters see the book ----

@router.get("/api/staff/reservations")
def staff_reservations(days: int = Query(7, ge=1, le=60), user: Dict[str, Any] = Depends(staff("manager", "waiter"))):
    today = datetime.now().strftime("%Y-%m-%d")
    until = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")
    return {"reservations": db.list_reservations(today, until), "enquiries": db.list_event_enquiries() if user["role"] == "manager" else []}


class ResStatus(BaseModel):
    status: str


@router.post("/api/staff/reservations/{res_id}/status")
async def staff_reservation_status(res_id: int, body: ResStatus, user: Dict[str, Any] = Depends(staff("manager", "waiter"))):
    if body.status not in {"confirmed", "seated", "cancelled", "no_show"}:
        raise HTTPException(400, "Bad status")
    res = db.set_reservation_status(res_id, body.status)
    if not res:
        raise HTTPException(404)
    await hub.to_staff({"type": "refresh"})
    return res
