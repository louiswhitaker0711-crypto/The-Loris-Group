"""Put back who was on an exited person's team (the Owner, 2 Nov 2026).

Moves from before the team history log existed weren't recorded, so a past
week can't know someone's old team. Here an Admin ticks who was directly on
an exited person's team: each is logged as moving off that team on the exit
day (core/team_history.py), so weeks before it show the old team again.
Anyone ticked with no Coach now goes to the person above the exited person
(or the Admin), as an exit does today.
"""
from __future__ import annotations

from datetime import date, timedelta

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import require_admin
from core.team_history import record_move, set_coach, today_iso
from database import db

router = APIRouter()

ACTIVE = {"is_active": {"$ne": False}, "deleted": {"$ne": True}, "is_demo": {"$ne": True}}


def _office_q(admin: dict) -> dict:
    return {} if admin.get("is_super_admin") and not admin.get("office_id") else {"office_id": admin.get("office_id")}


@router.get("/admin/exited-teams")
async def exited_teams(request: Request):
    """People exited in the last 60 days, who's recorded as on their team when
    they left, and the office's people to choose from."""
    admin = await require_admin(request)
    oq = _office_q(admin)
    since = (date.fromisoformat(today_iso()) - timedelta(days=60)).isoformat()
    exited = []
    async for u in db.users.find({**oq, "deleted": True, "is_demo": {"$ne": True},
                                  "role": {"$ne": "viewer"}, "left_on": {"$gte": since}},
                                 {"_id": 1, "name": 1, "left_on": 1}).sort("left_on", -1):
        uid = str(u["_id"])
        team = [m["user_id"] async for m in db.team_moves.find({"from": uid, "on": str(u.get("left_on"))[:10]}, {"user_id": 1})]
        exited.append({"id": uid, "name": u.get("name") or "", "left_on": str(u.get("left_on"))[:10], "team": sorted(set(team))})
    people = [{"id": str(p["_id"]), "name": p.get("name") or ""}
              async for p in db.users.find({**oq, **ACTIVE, "role": {"$ne": "viewer"}}, {"_id": 1, "name": 1}).sort("name", 1)]
    return {"exited": exited, "people": people}


@router.put("/admin/users/{user_id}/past-team")
async def set_past_team(user_id: str, request: Request):
    """{member_ids: [...]}: who was directly on this exited person's team."""
    admin = await require_admin(request)
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user id")
    gone = await db.users.find_one({"_id": ObjectId(user_id), "deleted": True})
    if not gone:
        raise HTTPException(status_code=404, detail="That person hasn't been exited")
    if not admin.get("is_super_admin") and gone.get("office_id") != admin.get("office_id"):
        raise HTTPException(status_code=403, detail="You can only fix teams in your own office")
    left = str(gone.get("left_on") or "")[:10]
    if not left:
        raise HTTPException(status_code=400, detail="No exit day recorded for them")
    body = await request.json()
    wanted = {str(x) for x in (body.get("member_ids") or []) if ObjectId.is_valid(str(x)) and str(x) != user_id}

    # Who to hand anyone with no Coach to: the person above them, else you.
    heir = None
    if gone.get("reports_to") and ObjectId.is_valid(str(gone["reports_to"])):
        heir = await db.users.find_one({"_id": ObjectId(str(gone["reports_to"])), **ACTIVE})
    heir_id = str(heir["_id"]) if heir else str(admin.get("_id") or admin.get("id") or "") or None

    # Untick: drop the logged move off their team on the exit day.
    await db.team_moves.delete_many({"from": user_id, "on": left, "user_id": {"$nin": list(wanted)}, "why": {"$in": ["exit", "past team"]}})
    done = 0
    for mid in wanted:
        m = await db.users.find_one({"_id": ObjectId(mid)})
        if not m or (gone.get("office_id") and m.get("office_id") != gone.get("office_id")):
            continue
        if not m.get("reports_to") and heir_id and heir_id != mid:
            await set_coach(db, m, heir_id, why="past team")
            # That move is the same one as leaving the team: date it the exit day.
            await db.team_moves.delete_many({"user_id": mid, "why": "past team", "on": today_iso(), "from": None})
        already = await db.team_moves.find_one({"user_id": mid, "from": user_id, "on": left})
        if not already:
            to = (await db.users.find_one({"_id": ObjectId(mid)}, {"reports_to": 1}) or {}).get("reports_to")
            await record_move(db, mid, gone.get("office_id"), user_id, to, why="past team", on=left)
        done += 1
    return {"ok": True, "team": sorted(wanted), "message": f"{done} on their team up to {left}"}
