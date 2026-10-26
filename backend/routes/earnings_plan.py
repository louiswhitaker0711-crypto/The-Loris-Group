"""Plan your earnings (core/earnings_plan.py).

    GET /api/earnings-plan[?user_id=]
      → {user_id, name, needs, wants, updated_at, weekly_needs, weekly_wants,
         per_sign_up, breakeven, target, read_only}
      Your own; with user_id, someone you coach (an Admin: anyone in the
      office; a Coach: their team), read-only.
    PUT /api/earnings-plan  {needs: [{label, amount, per}], wants: [...]}
      Save your own; returns the same as GET.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, get_subtree_ids
from core.earnings_plan import clean_rows, compute
from database import db

router = APIRouter()


async def office_fees(office_id: Optional[str]) -> Optional[dict]:
    return (await db.commission_fees.find_one({"office_id": office_id}, {"_id": 0})
            or await db.commission_fees.find_one({}, {"_id": 0}))


def _out(u: dict, fees: Optional[dict], read_only: bool) -> dict:
    plan = u.get("earnings_plan") or {}
    return {"user_id": str(u["_id"]), "name": u.get("name") or "",
            "needs": plan.get("needs") or [], "wants": plan.get("wants") or [],
            "updated_at": plan.get("updated_at"), "read_only": read_only, **compute(plan, fees)}


@router.get("/earnings-plan")
async def get_plan(request: Request, user_id: Optional[str] = None):
    me = await get_current_user(request)
    target_id = str(user_id or me["id"])
    try:
        u = await db.users.find_one({"_id": ObjectId(target_id), "deleted": {"$ne": True}},
                                    {"name": 1, "office_id": 1, "earnings_plan": 1})
    except (InvalidId, TypeError):
        u = None
    if not u:
        raise HTTPException(status_code=404, detail="Person not found")
    other = target_id != str(me["id"])
    if other:
        same_office = u.get("office_id") == me.get("office_id") or me.get("is_super_admin")
        role = (me.get("role") or "").lower()
        allowed = same_office and (role == "admin" or (role == "leader" and target_id in set(await get_subtree_ids(me["id"]))))
        if not allowed:
            raise HTTPException(status_code=403, detail="You can only see your own team's plans")
    return _out(u, await office_fees(u.get("office_id")), other)


@router.put("/earnings-plan")
async def save_plan(request: Request):
    me = await get_current_user(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Send needs and wants")
    plan = {"needs": clean_rows(body.get("needs")), "wants": clean_rows(body.get("wants")),
            "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.users.update_one({"_id": ObjectId(me["id"])}, {"$set": {"earnings_plan": plan}})
    u = await db.users.find_one({"_id": ObjectId(me["id"])}, {"name": 1, "office_id": 1, "earnings_plan": 1})
    return _out(u, await office_fees(u.get("office_id")), False)
