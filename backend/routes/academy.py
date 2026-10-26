"""BA Academy workbook — a new start's notes, gaps and quizzes for Days 1-2.

The Owner's call (26 Oct 2026): at the start of product coaching every new
start opens their workbook on their own phone and fills it in as the Owner
teaches. Their answers save to their account; the Owner sees the class's
progress, quiz scores and questions on Home.

The workbook's content (sections, gaps, quizzes) lives in the app
(frontend/src/academy/). The server stores what each person writes, keyed by
the ids the content gives each field, and never interprets it.

    GET /api/academy/workbook/{day}[?user_id=]
      → {"day", "user_id", "name", "fields": {id: text}, "done": {section: bool},
         "quiz": {quiz: {question_index: option_index}}, "updated_at", "read_only",
         "academy_day"}   (academy_day: 1 or 2, which day they're on; see below)
      Your own workbook; with user_id, someone else's (read-only) if you can
      already see their first days (can_access_hire).
    PUT /api/academy/workbook/{day}   {fields, done, quiz}
      Save your own workbook (whole state; limits below).
    GET /api/academy/class
      → {"people": [{hire_id, user_id, name, day_number, academy_day,
                     workbooks: {"1": {...}, "2": {...}}}]}
      Admin only: every active new start in the office on an Academy day
      (Days 1-2), with what they've done in each day's workbook.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, can_access_hire
from core.app_time import APP_TZ
from database import db

router = APIRouter()

DAYS = (1, 2)
ACADEMY_DAYS = 2
MAX_FIELDS = 300
MAX_TEXT = 6000
MAX_SECTIONS = 60
MAX_QUIZZES = 30
MAX_QUESTIONS = 40
_KEY = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def _day(day: int) -> int:
    if day not in DAYS:
        raise HTTPException(status_code=404, detail="There's a workbook for Day 1 and Day 2 only")
    return day


def clean_state(body: Any) -> dict:
    """The parts of a saved workbook the server keeps, within limits.

    fields: {id: text} — text trimmed to MAX_TEXT; non-strings dropped.
    done:   {section: true} — only true values kept.
    quiz:   {quiz: {"0": 2, …}} — whole-number answers only.
    Bad keys are dropped rather than refused, so one odd field never loses
    someone's notes."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Send the workbook as an object")
    fields_in = body.get("fields") or {}
    done_in = body.get("done") or {}
    quiz_in = body.get("quiz") or {}
    if not all(isinstance(x, dict) for x in (fields_in, done_in, quiz_in)):
        raise HTTPException(status_code=400, detail="fields, done and quiz must be objects")
    if len(fields_in) > MAX_FIELDS or len(done_in) > MAX_SECTIONS or len(quiz_in) > MAX_QUIZZES:
        raise HTTPException(status_code=400, detail="Too many items in the workbook")
    fields = {k: v[:MAX_TEXT] for k, v in fields_in.items()
              if isinstance(k, str) and _KEY.match(k) and isinstance(v, str)}
    done = {k: True for k, v in done_in.items() if isinstance(k, str) and _KEY.match(k) and v is True}
    quiz: dict[str, dict[str, int]] = {}
    for k, answers in quiz_in.items():
        if not (isinstance(k, str) and _KEY.match(k) and isinstance(answers, dict)):
            continue
        a = {str(i): int(j) for i, j in list(answers.items())[:MAX_QUESTIONS]
             if str(i).isdigit() and isinstance(j, int) and not isinstance(j, bool) and 0 <= j < 20}
        if a:
            quiz[k] = a
    return {"fields": fields, "done": done, "quiz": quiz}


def academy_day(hire: Optional[dict], today: Optional[str] = None) -> int:
    """Which workbook a new start is on: Day 2 once their Day 1 is graded
    (current_day 2+) or from the day after their start date, whichever comes
    first, so Tuesday opens Day 2 even if Monday hasn't been graded yet."""
    if not hire:
        return 1
    try:
        if int(hire.get("current_day") or 1) >= 2:
            return 2
    except (TypeError, ValueError):
        pass
    today = today or datetime.now(APP_TZ).date().isoformat()
    try:
        start = date.fromisoformat(str(hire.get("start_date") or "")[:10]).isoformat()
    except ValueError:
        return 1
    return 2 if today > start else 1


async def _hire_of(user_id: str, office_id: Optional[str]) -> Optional[dict]:
    return await db.new_hires.find_one(
        {"trainee_user_id": user_id, "office_id": office_id},
        {"_id": 0, "id": 1, "name": 1, "current_day": 1, "active": 1, "start_date": 1})


@router.get("/academy/workbook/{day}")
async def get_workbook(day: int, request: Request, user_id: Optional[str] = None):
    user = await get_current_user(request)
    _day(day)
    me = str(user["id"])
    target = str(user_id or me)
    read_only = target != me
    name = user.get("name") or ""
    hire: Optional[dict] = None
    if read_only:
        # Users are keyed by Mongo _id (the app's user id is its string form).
        try:
            other = await db.users.find_one({"_id": ObjectId(target), "deleted": {"$ne": True}},
                                            {"_id": 1, "name": 1, "office_id": 1})
        except (InvalidId, TypeError):
            other = None
        if not other or (other.get("office_id") != user.get("office_id") and not user.get("is_super_admin")):
            raise HTTPException(status_code=404, detail="Not found")
        hire = await _hire_of(target, other.get("office_id"))
        if not hire or not await can_access_hire(user, hire["id"]):
            raise HTTPException(status_code=403, detail="You can't see this person's workbook")
        name = other.get("name") or hire.get("name") or ""
    else:
        hire = await _hire_of(me, user.get("office_id"))
    doc = await db.academy_workbooks.find_one({"user_id": target, "day": day}, {"_id": 0}) or {}
    return {
        "day": day, "user_id": target, "name": name,
        "fields": doc.get("fields") or {}, "done": doc.get("done") or {}, "quiz": doc.get("quiz") or {},
        "updated_at": doc.get("updated_at"), "read_only": read_only,
        "academy_day": academy_day(hire),
    }


@router.put("/academy/workbook/{day}")
async def save_workbook(day: int, request: Request):
    user = await get_current_user(request)
    _day(day)
    state = clean_state(await request.json())
    now = datetime.now(timezone.utc).isoformat()
    await db.academy_workbooks.update_one(
        {"user_id": str(user["id"]), "day": day},
        {"$set": {**state, "office_id": user.get("office_id"), "updated_at": now},
         "$setOnInsert": {"user_id": str(user["id"]), "day": day, "created_at": now}},
        upsert=True)
    return {"ok": True, "updated_at": now}


def summary(doc: Optional[dict]) -> dict:
    """What the Owner's class card needs from one workbook."""
    doc = doc or {}
    fields = doc.get("fields") or {}
    return {
        "done": doc.get("done") or {},
        "quiz": doc.get("quiz") or {},
        "questions": (fields.get("questions") or "").strip(),
        "updated_at": doc.get("updated_at"),
    }


@router.get("/academy/class")
async def academy_class(request: Request):
    user = await get_current_user(request)
    if (user.get("role") or "").lower() != "admin":
        return {"people": []}
    hires = await db.new_hires.find(
        {"active": True, "office_id": user.get("office_id"), "current_day": {"$lte": ACADEMY_DAYS},
         "trainee_user_id": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "name": 1, "current_day": 1, "trainee_user_id": 1, "start_date": 1},
    ).to_list(60)
    if not hires:
        return {"people": []}
    ids = [str(h["trainee_user_id"]) for h in hires]
    docs = await db.academy_workbooks.find({"user_id": {"$in": ids}}, {"_id": 0}).to_list(200)
    by = {(d.get("user_id"), d.get("day")): d for d in docs}
    people = []
    for h in hires:
        uid = str(h["trainee_user_id"])
        people.append({
            "hire_id": h["id"], "user_id": uid, "name": h.get("name") or "",
            "day_number": int(h.get("current_day") or 1),
            "academy_day": academy_day(h),
            "workbooks": {str(d): summary(by.get((uid, d))) for d in DAYS},
        })
    people.sort(key=lambda p: p["name"].lower())
    return {"people": people}
