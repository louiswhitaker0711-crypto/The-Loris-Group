"""This week's COD focus: one COD item each person works on for the week.

The Owner's rule (20 Oct 2026): a Coach picks their own; Coaches pick for
their BAs (an Admin for anyone in the office). It shows on the COD screen and
in Coaching, and fills the sector set-up: a Stage 1-2's "Learning from the
COD", a Stage 3+'s "What I'm being an example of".

One document per person per week in `cod_focus`:
  {user_id, office_id, week_ending (Sunday), module_id, topic, stage,
   set_by_id, set_by_name, at}
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, get_subtree_ids, sees_whole_office
from core.app_time import APP_TZ
from database import db

router = APIRouter()

COD_STAGES = [1, 2, 3, 4, 5]
LIVE = {"deleted": {"$ne": True}, "is_active": {"$ne": False}}


def week_ending_of(d: date) -> str:
    return (d + timedelta(days=6 - d.weekday())).isoformat()


def _week(week: Optional[str]) -> str:
    if week:
        try:
            return week_ending_of(date.fromisoformat(week[:10]))
        except ValueError:
            raise HTTPException(status_code=400, detail="week must be a date (YYYY-MM-DD)")
    return week_ending_of(datetime.now(APP_TZ).date())


async def cod_items(office_id) -> list[dict]:
    """The office's live COD items, in order."""
    return [{"id": m["id"], "stage": m.get("stage"), "topic": m.get("topic"), "category": m.get("category")}
            async for m in db.training_modules.find(
                {"office_id": office_id, "stage": {"$in": COD_STAGES}, "retired": {"$ne": True}},
                {"_id": 0, "id": 1, "stage": 1, "topic": 1, "category": 1, "sequence": 1}).sort([("stage", 1), ("sequence", 1)])
            if m.get("id")]


async def focus_for(user_ids: list[str], week_ending: str) -> dict[str, dict]:
    """user_id -> this week's focus (or nothing)."""
    out = {}
    async for f in db.cod_focus.find({"user_id": {"$in": user_ids}, "week_ending": week_ending}, {"_id": 0}):
        if f.get("module_id"):
            out[f["user_id"]] = {k: f.get(k) for k in ("module_id", "topic", "stage", "set_by_name", "at")}
    return out


async def can_set(caller: dict, target: dict) -> bool:
    """Who may set someone's focus: a Coach their own; an Admin anyone in their
    office; a Coach anyone under them. Nobody sets a BA's own from their side."""
    cid, tid = str(caller["id"]), str(target["_id"])
    role = (caller.get("role") or "").lower()
    if cid == tid:
        return role in ("leader", "admin")
    if target.get("deleted") or target.get("is_active") is False:
        return False
    if role == "admin":
        return bool(caller.get("is_super_admin")) or caller.get("office_id") == target.get("office_id")
    if role == "leader":
        return tid in set(await get_subtree_ids(cid))
    return False


async def can_see(caller: dict, target: dict) -> bool:
    if str(caller["id"]) == str(target["_id"]):
        return True
    if (caller.get("role") or "").lower() == "admin" or sees_whole_office(caller):
        return bool(caller.get("is_super_admin")) or caller.get("office_id") == target.get("office_id")
    return await can_set(caller, target)


async def _user(user_id: str) -> dict:
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"name": 1, "role": 1, "office_id": 1, "deleted": 1,
                                                          "is_active": 1, "reports_to": 1}) \
        if ObjectId.is_valid(user_id) else None
    if not u:
        raise HTTPException(status_code=404, detail="Person not found")
    return u


@router.get("/cod-focus/me")
async def my_focus(request: Request, week: Optional[str] = None):
    user = await get_current_user(request)
    we = _week(week)
    uid = str(user["id"])
    mine = (await focus_for([uid], we)).get(uid)
    setter = (user.get("role") or "").lower() in ("leader", "admin")
    return {"week_ending": we, "user_id": uid, "focus": mine, "can_set": setter,
            "options": await cod_items(user.get("office_id")) if setter else []}


@router.get("/cod-focus/team")
async def team_focus(request: Request, week: Optional[str] = None):
    """For Coaching: everyone the caller picks for, with their focus."""
    user = await get_current_user(request)
    role = (user.get("role") or "").lower()
    if role not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coaches and Admins pick the COD focus")
    we = _week(week)
    if role == "admin":
        q = {"office_id": user.get("office_id"), "role": {"$in": ["trainee", "leader"]}, **LIVE}
    else:
        ids = [i for i in await get_subtree_ids(str(user["id"])) if ObjectId.is_valid(i) and i != str(user["id"])]
        q = {"_id": {"$in": [ObjectId(i) for i in ids]}, **LIVE}
    people = [{"user_id": str(u["_id"]), "user_name": u.get("name") or "", "role": u.get("role")}
              async for u in db.users.find(q, {"name": 1, "role": 1}).sort("name", 1)]
    focus = await focus_for([p["user_id"] for p in people], we)
    for p in people:
        p["focus"] = focus.get(p["user_id"])
    return {"week_ending": we, "people": people, "options": await cod_items(user.get("office_id"))}


@router.put("/cod-focus/{user_id}")
async def set_focus(user_id: str, request: Request, week: Optional[str] = None):
    user = await get_current_user(request)
    target = await _user(user_id)
    if not await can_set(user, target):
        raise HTTPException(status_code=403, detail="Coaches pick their BAs' COD focus, and their own")
    body = await request.json()
    we = _week(week or body.get("week"))
    module_id = str(body.get("module_id") or "").strip()[:64]
    if not module_id:
        await db.cod_focus.delete_one({"user_id": user_id, "week_ending": we})
        return {"week_ending": we, "focus": None}
    item = await db.training_modules.find_one(
        {"id": module_id, "office_id": target.get("office_id"), "stage": {"$in": COD_STAGES}, "retired": {"$ne": True}},
        {"_id": 0, "id": 1, "topic": 1, "stage": 1})
    if not item:
        raise HTTPException(status_code=400, detail="Pick an item from the COD")
    doc = {"user_id": user_id, "office_id": target.get("office_id"), "week_ending": we,
           "module_id": item["id"], "topic": item.get("topic"), "stage": item.get("stage"),
           "set_by_id": str(user["id"]), "set_by_name": user.get("name") or "",
           "at": datetime.now(timezone.utc).isoformat()}
    await db.cod_focus.update_one({"user_id": user_id, "week_ending": we}, {"$set": doc}, upsert=True)
    return {"week_ending": we, "focus": {k: doc[k] for k in ("module_id", "topic", "stage", "set_by_name", "at")}}


@router.get("/cod-focus/{user_id}")
async def person_focus(user_id: str, request: Request, week: Optional[str] = None):
    user = await get_current_user(request)
    target = await _user(user_id)
    if not await can_see(user, target):
        raise HTTPException(status_code=403, detail="Not someone you coach")
    we = _week(week)
    return {"week_ending": we, "focus": (await focus_for([user_id], we)).get(user_id),
            "can_set": await can_set(user, target)}
