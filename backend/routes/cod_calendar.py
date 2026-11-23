"""The COD 2 calendar (core/cod_calendar.py): see it, start it, watch everyone's.

- GET  /cod-calendar/me            your own
- GET  /cod-calendar/person/{id}   someone you coach (Coach: under them; Admin: their office)
- GET  /cod-calendar/office        everyone with a calendar you can see: today's topics, done, behind
- POST /cod-calendar/start         start or restart someone's from a date (Coach/Admin)
- DELETE /cod-calendar/person/{id} stop it (Coach/Admin)
- POST /cod-calendar/know          tick Know on a COD 2 item from the calendar, at the breakdown
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user, get_subtree_ids
from core import cod_calendar as cal
from core.app_time import APP_TZ
from database import db
from routes.cod_focus import can_set, can_see

router = APIRouter()


def _today() -> str:
    return datetime.now(APP_TZ).date().isoformat()


async def _target(user_id: str) -> dict:
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"name": 1, "role": 1, "office_id": 1, "deleted": 1,
                                                          "is_active": 1, "reports_to": 1}) \
        if ObjectId.is_valid(user_id) else None
    if not u:
        raise HTTPException(status_code=404, detail="Person not found")
    return u


async def _view(user_id: str) -> Optional[dict]:
    doc = await db.cod_calendars.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        return None
    lad = await cal.ladders(user_id, cal.module_ids_of(doc))
    return {**doc, **cal.status(doc, lad, _today())}


@router.get("/cod-calendar/me")
async def my_calendar(request: Request):
    me = await get_current_user(request)
    return {"calendar": await _view(str(me["id"]))}


@router.get("/cod-calendar/person/{user_id}")
async def person_calendar(user_id: str, request: Request):
    me = await get_current_user(request)
    if not await can_see(me, await _target(user_id)):
        raise HTTPException(status_code=403, detail="You can't see this person's COD")
    return {"calendar": await _view(user_id)}


@router.get("/cod-calendar/office")
async def office_calendars(request: Request):
    """Everyone the caller can watch with a calendar running: today's topics,
    taught so far, days behind. Admins: their office; Coaches: their people."""
    me = await get_current_user(request)
    role = (me.get("role") or "").lower()
    if role == "admin":
        q: dict = {} if me.get("is_super_admin") else {"office_id": me.get("office_id")}
    elif role == "leader":
        ids = [i for i in await get_subtree_ids(str(me["id"])) if i != str(me["id"])]
        q = {"user_id": {"$in": ids}}
    else:
        raise HTTPException(status_code=403, detail="Coaches and Admins only")
    docs = await db.cod_calendars.find(q, {"_id": 0}).to_list(500)
    ids = [ObjectId(d["user_id"]) for d in docs if ObjectId.is_valid(d["user_id"])]
    live = {str(u["_id"]): u.get("name") or "" async for u in db.users.find(
        {"_id": {"$in": ids}, "deleted": {"$ne": True}, "is_active": {"$ne": False}}, {"name": 1})}
    today = _today()
    out = []
    for d in docs:
        if d["user_id"] not in live:
            continue
        st = cal.status(d, await cal.ladders(d["user_id"], cal.module_ids_of(d)), today)
        if st["finished"] and st["ends"] and st["ends"] < today:
            continue  # done and over: off the watch list
        out.append({"user_id": d["user_id"], "name": live[d["user_id"]], "start_date": d.get("start_date"),
                    "ends": st["ends"], "total": st["total"], "done": st["done"], "behind": st["behind"],
                    "current_day": st["current_day"], "today": [i["topic"] for i in st["today"]],
                    "finished": st["finished"]})
    out.sort(key=lambda r: (-r["behind"], r["name"].lower()))
    # BAs without one, to start it by hand (a Needs More Time who's now ready, say).
    has = {d["user_id"] for d in docs}
    if role == "admin":
        bq: dict = {"role": "trainee", "deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_demo": {"$ne": True}}
        if not me.get("is_super_admin"):
            bq["office_id"] = me.get("office_id")
    else:
        bq = {"_id": {"$in": [ObjectId(i) for i in q["user_id"]["$in"] if ObjectId.is_valid(i)]}, "role": "trainee",
              "deleted": {"$ne": True}, "is_active": {"$ne": False}}
    others = [{"user_id": str(u["_id"]), "name": u.get("name") or ""}
              async for u in db.users.find(bq, {"name": 1}).sort("name", 1).limit(300) if str(u["_id"]) not in has]
    return {"people": out, "today": today, "others": others}


class StartBody(BaseModel):
    user_id: str
    start_date: Optional[str] = None  # YYYY-MM-DD; default the next field day


@router.post("/cod-calendar/start")
async def start_calendar(body: StartBody, request: Request):
    me = await get_current_user(request)
    if (me.get("role") or "").lower() not in ("admin", "leader"):
        raise HTTPException(status_code=403, detail="Coaches and Admins only")
    target = await _target(body.user_id)
    if str(target["_id"]) == str(me["id"]) and (me.get("role") or "") != "admin":
        raise HTTPException(status_code=403, detail="Your Coach starts your COD 2 calendar")
    if not await can_set(me, target):
        raise HTTPException(status_code=403, detail="You can't start this person's COD")
    try:
        on = date.fromisoformat(body.start_date[:10]) if body.start_date else \
            cal.next_field_day(datetime.now(APP_TZ).date())
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date must be a date (YYYY-MM-DD)")
    await cal.start(body.user_id, target.get("office_id"), on, me, "manual")
    return {"calendar": await _view(body.user_id)}


@router.delete("/cod-calendar/person/{user_id}")
async def stop_calendar(user_id: str, request: Request):
    me = await get_current_user(request)
    if (me.get("role") or "").lower() not in ("admin", "leader") or not await can_set(me, await _target(user_id)):
        raise HTTPException(status_code=403, detail="You can't stop this person's COD")
    await db.cod_calendars.delete_one({"user_id": user_id})
    return {"stopped": True}


class KnowBody(BaseModel):
    user_id: Optional[str] = None   # default: yourself
    module_id: str
    know: bool = True


@router.post("/cod-calendar/know")
async def tick_know(body: KnowBody, request: Request):
    """At the breakdown (the Owner, 23 Nov 2026): a BA ticks Know on today's
    COD 2 item, or an earlier one still behind. Know only: Do and Deliver stay
    with their Coach on the COD screen. Only items on their own calendar. The
    person themselves, their Coach (or an Admin), or today's sector leader
    filling in their breakdown. Unticking only takes back a Know given here."""
    me = await get_current_user(request)
    uid = body.user_id or str(me["id"])
    target = await _target(uid)
    allowed = await can_set(me, target)
    if not allowed:
        from routes.coverage import sector_of
        sec = await sector_of(uid, _today(), target.get("office_id"))
        allowed = bool(sec) and str(sec.get("leader_id") or "") == str(me["id"])
    if not allowed:
        raise HTTPException(status_code=403, detail="Only for yourself, or someone you're doing the breakdown with")
    doc = await db.cod_calendars.find_one({"user_id": uid}, {"_id": 0})
    if not doc or body.module_id not in cal.module_ids_of(doc):
        raise HTTPException(status_code=404, detail="That item isn't on their COD 2 calendar")
    if body.know:
        mod = await db.training_modules.find_one({"id": body.module_id}, {"_id": 0, "id": 1, "stage": 1})
        if not mod:
            raise HTTPException(status_code=404, detail="COD item not found")
        from core.cod_ticks import raise_rung
        await raise_rung(uid, mod, 1, str(me["id"]), _today(), "cod2_breakdown")
    else:
        row = await db.module_progress.find_one({"target_user_id": uid, "module_id": body.module_id},
                                                {"_id": 1, "ladder": 1, "ticked_from": 1, "ladder_dates": 1})
        if row and int(row.get("ladder") or 0) == 1 and row.get("ticked_from") == "cod2_breakdown":
            from routes.modules import _apply_ladder_dates
            await db.module_progress.update_one({"_id": row["_id"]}, {"$set": {
                "ladder": 0, "completed": False,
                "ladder_dates": _apply_ladder_dates(row.get("ladder_dates") or {}, 0, None, 0, _today())}})
    lad = await cal.ladders(uid, cal.module_ids_of(doc))
    return {"cod2": cal.day_view(doc, lad, _today())}
