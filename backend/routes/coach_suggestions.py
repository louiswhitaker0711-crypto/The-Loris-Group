"""Suggested for today: coaching suggestions for the people a Coach looks
after (an Admin: the office), from their numbers (core/coach_suggestions).

  GET /api/coach/suggestions
"""
from __future__ import annotations

from datetime import datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Request

from auth import get_subtree_ids, require_admin_or_leader
from core.app_time import APP_TZ
from core.coach_suggestions import bells_days, suggest
from core.zero_alerts import judged_through
from database import db

router = APIRouter()


@router.get("/coach/suggestions")
async def coach_suggestions(request: Request):
    me = await require_admin_or_leader(request)
    now = datetime.now(APP_TZ)
    through = judged_through(now)
    q: dict = {"deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_demo": {"$ne": True},
               "role": {"$in": ["trainee", "leader"]}}
    if (me.get("role") or "").lower() == "admin":
        q["office_id"] = me.get("office_id")
    else:
        ids = [ObjectId(i) for i in await get_subtree_ids(str(me["id"])) if ObjectId.is_valid(str(i))]
        q["_id"] = {"$in": ids}
    people = {str(u["_id"]): u.get("name") or "" async for u in db.users.find(q, {"_id": 1, "name": 1})}
    people.pop(str(me["id"]), None)
    if not people:
        return {"through": through.isoformat(), "suggestions": []}
    ids = list(people)
    since_week = (through - timedelta(days=20)).isoformat()
    entries: dict = {}
    async for e in db.bells_entries.find({"user_id": {"$in": ids}, "week_ending": {"$gte": since_week}},
                                         {"_id": 0, "user_id": 1, "week_ending": 1, "days": 1}):
        entries.setdefault(str(e["user_id"]), []).append(e)
    field: dict = {}
    since = (through - timedelta(days=21)).isoformat()
    async for r in db.owneriq_kpis.find({"cg1_user_id": {"$in": ids}, "date": {"$gte": since, "$lte": through.isoformat()},
                                        "test_mode": {"$ne": True}, "cg1_matched_by": {"$ne": "name"}}):
        uid = str(r["cg1_user_id"])
        try:
            d = datetime.fromisoformat(str(r["date"])[:10]).date()
        except ValueError:
            continue
        cur = field.setdefault(uid, {}).setdefault(d, {"date": d, "doors": 0, "spoken": 0, "pitched": 0, "closed": 0, "sales": 0})
        cur["doors"] += int(r.get("doors_knocked") or 0)
        cur["spoken"] += int(r.get("spoken_to") or 0)
        cur["pitched"] += int(r.get("pitches_commenced") or 0)
        cur["closed"] += int(r.get("pitches_closed") or 0)
        cur["sales"] += int(r.get("sales") or 0)
    # The latest weekly quality report (routes/quality.py), within 3 weeks.
    quality: dict = {}
    qweek = ""
    qdoc = await db.quality_weeks.find_one(
        {"office_id": me.get("office_id"), "week_ending": {"$gte": (through - timedelta(days=21)).isoformat()}},
        {"_id": 0, "week_ending": 1, "bas": 1}, sort=[("week_ending", -1)])
    if qdoc:
        d = datetime.fromisoformat(qdoc["week_ending"])
        qweek = f"WE {d.day} {d.strftime('%b')}"
        quality = {b["user_id"]: b.get("metrics") or {} for b in qdoc.get("bas") or [] if b.get("user_id")}
    out = []
    for uid, name in people.items():
        for s in suggest(name, bells_days(entries.get(uid, [])), list((field.get(uid) or {}).values()), through,
                         quality.get(uid), qweek):
            out.append({**s, "user_id": uid, "name": name})
    out.sort(key=lambda s: (s["priority"], s["name"].lower()))
    return {"through": through.isoformat(), "suggestions": out}
