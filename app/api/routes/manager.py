"""Manager-only API: the analytics board and the AI store manager (chat, briefings, proposals, promotions)."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.agents import companion as agent
from app.agents import store_manager as manager_agent
from app.api.deps import staff
from app.core import db
from app.core.errors import AppError, ServiceUnavailable
from app.realtime.hub import hub
from app.services import analytics

router = APIRouter(prefix="/api/staff", tags=["manager"])
log = logging.getLogger("main")


@router.get("/analytics")
def staff_analytics(period: str = "7d", user=Depends(staff("manager"))):
    return analytics.dashboard(period)


class AgentMessage(BaseModel):
    message: str


def _agent_error(e: Exception) -> Exception:
    if isinstance(e, AppError):
        return e                                    # carries its own status; logged by the handler
    log.exception("store manager agent failed")
    return ServiceUnavailable(f"The AI store manager hit an error ({type(e).__name__}) — please try again.")


@router.post("/agent/chat")
async def agent_chat(body: AgentMessage, user=Depends(staff("manager"))):
    if not body.message.strip():
        raise HTTPException(400, "Ask something")
    try:
        return await manager_agent.chat(user["id"], body.message.strip())
    except Exception as e:  # noqa: BLE001
        raise _agent_error(e)


@router.post("/agent/reset")
def agent_reset(user=Depends(staff("manager"))):
    manager_agent.reset(user["id"])
    return {"ok": True}


@router.get("/agent/briefing")
def agent_latest_briefing(user=Depends(staff("manager"))):
    return db.latest_insights() or {}


class BriefingBody(BaseModel):
    period: str = "7d"


@router.post("/agent/briefing")
async def agent_briefing(body: BriefingBody, user=Depends(staff("manager"))):
    try:
        return await manager_agent.briefing(body.period)
    except Exception as e:  # noqa: BLE001
        raise _agent_error(e)


@router.get("/agent/actions")
def agent_actions(status: Optional[str] = "pending", user=Depends(staff("manager"))):
    return db.list_agent_actions(status or None)


@router.post("/agent/actions/{action_id}/{decision}")
async def agent_decide(action_id: int, decision: str, user=Depends(staff("manager"))):
    action = db.get_agent_action(action_id)
    if not action or decision not in ("apply", "dismiss"):
        raise HTTPException(404)
    if action["status"] != "pending":
        raise HTTPException(409, f"Already {action['status']}")
    if decision == "dismiss":
        db.decide_agent_action(action_id, "dismissed", user["username"])
        return {"ok": True, "message": "Dismissed."}
    try:
        message = manager_agent.apply_action(action)
        agent.invalidate_menu_cache()
    except Exception as e:  # noqa: BLE001
        log.warning("could not apply proposal #%s (%s): %s", action_id, action["kind"], e, exc_info=True)
        raise AppError(f"Couldn't apply this proposal: {e}")
    db.decide_agent_action(action_id, "applied", user["username"])
    log.info("proposal #%s (%s) applied by %s: %s", action_id, action["kind"], user["username"], message)
    await hub.to_staff({"type": "refresh"})
    return {"ok": True, "message": message}


@router.get("/promotions")
def promotions(user=Depends(staff("manager"))):
    return db.active_promotions()


@router.post("/promotions/{promo_id}/end")
def end_promotion(promo_id: int, user=Depends(staff("manager"))):
    db.end_promotion(promo_id)
    agent.invalidate_menu_cache()
    return {"ok": True}
