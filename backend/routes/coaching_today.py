"""Coaching today — the new start you're with, at the top of a Coach's Home.

The Owner's call (22 Oct 2026): when a Coach is coaching a new start in the
field, Home leads with that person's day plan and what the Coach needs to do
with them, all day.

Who: any new start (an active hire on Days 1-8) in the caller's bunny hop
today; if the caller isn't in a hop (or hops aren't set), anyone in the
caller's sector today. On BA Academy days (Days 1-2, in the office) an
Admin gets every new start on those days: the Owner runs the Academy.

    GET /api/coaching/today
      → {"date", "people": [{hire_id, name, day_number, day_label,
           objective, assessment_id, done, can_grade,
           checklist: [{id, topic, category, confidence_expected, taught,
                        what_good_looks_like, expected_outcome}]}]}
    PUT /api/coaching/today/taught   {item_id, taught}
      Tick "taught" on one of today's checklist rows, for someone in your hop
      or sector today (or anyone you can already grade). Grading itself stays
      on the assessment screen, with the new start's own Coach.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, can_access_hire
from core.app_time import APP_TZ
from core.grading_time import latest_field_start
from database import db

router = APIRouter()

FIRST_DAYS = 8
ACADEMY_DAYS = 2


def _today() -> str:
    return datetime.now(APP_TZ).date().isoformat()


def graded_before_today(when, now: Optional[datetime] = None) -> bool:
    """True when a day was graded before the latest field start (13:30, or
    10:00 on a Saturday): it belongs to an earlier day, not today."""
    try:
        dt = datetime.fromisoformat(str(when))
    except (TypeError, ValueError):
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=APP_TZ)
    return dt < latest_field_start(now)


def day_label(day: int) -> str:
    """Days 1-2 are the BA Academy; 3-8 are field days 1-6."""
    return f"BA Academy Day {day}" if day <= 2 else f"Field day {day - 2}"


def people_with(sec: Optional[dict], me: str) -> list[str]:
    """Who the caller is working with today: their bunny hop, else the sector."""
    if not sec:
        return []
    for h in sec.get("hops") or []:
        ids = [str(i) for i in (h.get("member_ids") or [])]
        if me in ids:
            return [i for i in ids if i != me]
    everyone = [str(i) for i in (sec.get("member_ids") or [])] + [str(sec.get("leader_id") or "")]
    return [i for i in dict.fromkeys(everyone) if i and i != me]


def hop_mates(sec: Optional[dict], me: str) -> list[str]:
    """The others on the caller's own bunny hop today (not if they're its shadow)."""
    for h in (sec or {}).get("hops") or []:
        ids = [str(i) for i in (h.get("member_ids") or [])]
        if me in ids and me not in [str(i) for i in (h.get("shadow_ids") or [])]:
            return [i for i in ids if i != me]
    return []


async def _my_sector(user: dict, iso: str) -> Optional[dict]:
    from routes.coverage import sector_of
    return await sector_of(str(user["id"]), iso, user.get("office_id"))


async def _objective(day: int) -> str:
    doc = await db.targets.find_one({"day_number": day}, {"_id": 0, "day_objective": 1})
    if doc and doc.get("day_objective"):
        return doc["day_objective"]
    from seed_data import DAY_TARGETS
    t = next((t for t in DAY_TARGETS if t.get("day_number") == day), None)
    return (t or {}).get("day_objective") or ""


async def _manual_notes(office_id: Optional[str], day: int) -> dict[str, dict]:
    manuals = await db.training_manual.find({"day_number": day, "office_id": office_id}).to_list(200)
    if not manuals:
        manuals = await db.training_manual.find({"day_number": day, "office_id": None}).to_list(200)
    return {f"D{day}-{m.get('sequence', 0):02d}": m for m in manuals}


@router.get("/coaching/today")
async def coaching_today(request: Request):
    user = await get_current_user(request)
    iso = _today()
    role = (user.get("role") or "").lower()
    if role not in ("leader", "admin", "trainee"):
        return {"date": iso, "people": []}
    sec = await _my_sector(user, iso)
    if role == "trainee":
        # A BA leading a new start's bunny hop (the Owner's call, 26 Oct 2026):
        # only the people on their own hop, and only if they aren't a new start.
        ids = hop_mates(sec, str(user["id"]))
        if not ids:
            return {"date": iso, "people": []}
    else:
        ids = people_with(sec, str(user["id"]))
    proj = {"_id": 0, "id": 1, "name": 1, "current_day": 1, "office_id": 1}
    hires = await db.new_hires.find(
        {"active": True, "office_id": user.get("office_id"), "trainee_user_id": {"$in": ids}}, proj,
    ).to_list(50) if ids else []
    # The BA Academy (Days 1-2) is in the office, run by the Owner: an Admin
    # gets everyone on an Academy day to tick off, sector or not.
    if (user.get("role") or "").lower() == "admin":
        seen = {h["id"] for h in hires}
        hires += [h for h in await db.new_hires.find(
            {"active": True, "office_id": user.get("office_id"), "current_day": {"$lte": ACADEMY_DAYS}}, proj,
        ).to_list(50) if h["id"] not in seen]
    if not hires:
        return {"date": iso, "people": []}
    out = []
    for h in hires:
        day = int(h.get("current_day") or 1)
        if day > FIRST_DAYS:
            continue
        if role == "trainee" and not await can_access_hire(user, h["id"]):
            continue
        a = await db.daily_assessments.find_one(
            {"new_hire_id": h["id"], "day_number": day},
            {"_id": 0, "id": 1, "completed": 1, "assessment_date": 1})
        # Graded before today's field started: that day is over (e.g. their
        # Day 8 was signed off yesterday), so it isn't today's coaching.
        if a and a.get("completed") and graded_before_today(a.get("assessment_date")):
            continue
        items = []
        if a:
            notes = await _manual_notes(h.get("office_id"), day)
            for it in await db.delivery_checklist.find({"assessment_id": a["id"]}, {"_id": 0}).to_list(100):
                m = notes.get(it.get("manual_item_id")) or {}
                items.append({
                    "order": str(it.get("manual_item_id") or ""),
                    "id": it.get("id"), "topic": it.get("topic") or "", "category": it.get("category") or "",
                    "confidence_expected": it.get("confidence_expected") or "",
                    "taught": bool(it.get("taught")),
                    "what_good_looks_like": m.get("what_good_looks_like") or None,
                    "expected_outcome": m.get("expected_outcome") or None,
                })
            items.sort(key=lambda x: x.pop("order"))
        out.append({
            "hire_id": h["id"], "name": h.get("name") or "",
            "day_number": day, "day_label": day_label(day),
            "objective": await _objective(day),
            "assessment_id": (a or {}).get("id"),
            "done": bool((a or {}).get("completed")),
            "can_grade": await can_access_hire(user, h["id"]),
            "checklist": items,
        })
    out.sort(key=lambda p: (p["day_number"], p["name"].lower()))
    return {"date": iso, "people": out}


@router.put("/coaching/today/taught")
async def tick_taught(request: Request):
    user = await get_current_user(request)
    if (user.get("role") or "").lower() not in ("leader", "admin", "trainee"):
        raise HTTPException(status_code=403, detail="For Coaches")
    body = await request.json()
    item = await db.delivery_checklist.find_one({"id": str(body.get("item_id") or "")}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    a = await db.daily_assessments.find_one({"id": item.get("assessment_id")}, {"_id": 0})
    hire = await db.new_hires.find_one({"id": (a or {}).get("new_hire_id")}, {"_id": 0}) if a else None
    if not a or not hire or hire.get("office_id") != user.get("office_id"):
        raise HTTPException(status_code=404, detail="Checklist item not found")
    ok = await can_access_hire(user, hire["id"])
    if not ok:
        # Someone you're with in the field today, on their day today.
        with_me = people_with(await _my_sector(user, _today()), str(user["id"]))
        ok = hire.get("trainee_user_id") in with_me and int(a.get("day_number") or 0) == int(hire.get("current_day") or 0)
    if not ok:
        raise HTTPException(status_code=403, detail="Only for someone you're coaching today")
    taught = bool(body.get("taught"))
    await db.delivery_checklist.update_one({"id": item["id"]}, {"$set": {"taught": taught}})
    from scoring import calculate_checklist_grade
    gs = await calculate_checklist_grade(item["assessment_id"])
    await db.daily_assessments.update_one({"id": item["assessment_id"]}, {"$set": {"checklist_grade_score": gs}})
    return {"id": item["id"], "taught": taught}
