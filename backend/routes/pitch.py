"""Learn your pitch (the Owner, 26 Oct 2026).

Everyone has the pitch (a card at the bottom of Home). A new start gets it
from 18:00 on their first day, with a notification; on that first night
it's Read only, because the Owner hasn't gone over it yet. Say it, Learn
and Check open at 18:00 the day after (their BA Academy Day 2). Everyone
else has every tab.

    GET /api/pitch          → {unlocked, unlocks_at, new_start, state}
    PUT /api/pitch {counts, ladder, quiz, shown}   save your own progress

pitch_push_tick() sends "Learn your pitch" to today's new starts at 18:00
(once each); server.py runs it at 18:00 and once on start-up after 18:00.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from core.app_time import APP_TZ
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

UNLOCK_HOUR = 18
COUNTERS = ("read", "mirror", "record")


def unlock_at(start_date: Optional[str]) -> Optional[datetime]:
    """18:00 UK time on the day after their first day."""
    try:
        d = date.fromisoformat(str(start_date)[:10])
    except (TypeError, ValueError):
        return None
    return datetime.combine(d + timedelta(days=1), time(UNLOCK_HOUR), tzinfo=APP_TZ)


def is_unlocked(start_date: Optional[str], now: Optional[datetime] = None) -> bool:
    at = unlock_at(start_date)
    return at is None or (now or datetime.now(APP_TZ)) >= at


def clean_state(body: Any) -> dict:
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Send your progress as an object")
    counts = body.get("counts") if isinstance(body.get("counts"), dict) else {}
    ladder = body.get("ladder") if isinstance(body.get("ladder"), dict) else {}
    quiz = body.get("quiz") if isinstance(body.get("quiz"), dict) else {}
    shown = body.get("shown") if isinstance(body.get("shown"), dict) else {}

    def _int(v, hi):
        return max(0, min(hi, v)) if isinstance(v, int) and not isinstance(v, bool) else 0
    return {
        "counts": {k: _int(counts.get(k), 10) for k in COUNTERS},
        "ladder": {str(k)[:8]: True for k, v in list(ladder.items())[:10] if v is True},
        "quiz": {str(k)[:3]: _int(v, 9) for k, v in list(quiz.items())[:10] if str(k).isdigit()},
        "shown": {str(k)[:12]: True for k, v in list(shown.items())[:40] if v is True},
    }


async def _hire(user_id: str) -> Optional[dict]:
    return await db.new_hires.find_one({"trainee_user_id": user_id, "active": True},
                                       {"_id": 0, "start_date": 1, "current_day": 1})


@router.get("/pitch")
async def get_pitch(request: Request):
    user = await get_current_user(request)
    uid = str(user["id"])
    hire = await _hire(uid) if (user.get("role") or "") == "trainee" else None
    start = (hire or {}).get("start_date")
    new_start = bool(hire) and int((hire or {}).get("current_day") or 1) <= 3
    at = unlock_at(start) if new_start else None
    doc = await db.users.find_one({"_id": ObjectId(uid)}, {"pitch_progress": 1}) or {}
    return {"unlocked": (not new_start) or is_unlocked(start), "unlocks_at": at.isoformat() if at else None,
            "new_start": new_start, "start_date": start,
            "state": doc.get("pitch_progress") or {"counts": {}, "ladder": {}, "quiz": {}, "shown": {}}}


@router.put("/pitch")
async def save_pitch(request: Request):
    user = await get_current_user(request)
    state = clean_state(await request.json())
    await db.users.update_one({"_id": ObjectId(str(user["id"]))},
                              {"$set": {"pitch_progress": {**state, "updated_at": datetime.now(timezone.utc).isoformat()}}})
    return {"ok": True}


async def pitch_push_tick(now: Optional[datetime] = None) -> int:
    """'Learn your pitch' to every new start whose first day is today, once."""
    now = now or datetime.now(APP_TZ)
    if now.hour < UNLOCK_HOUR:
        return 0
    today = now.date().isoformat()
    from core.push import send_push_to_user
    sent = 0
    async for h in db.new_hires.find({"active": True, "start_date": today, "trainee_user_id": {"$nin": [None, ""]}},
                                     {"_id": 0, "trainee_user_id": 1}):
        uid = str(h["trainee_user_id"])
        try:
            res = await db.users.update_one(
                {"_id": ObjectId(uid), "deleted": {"$ne": True}, "pitch_push_sent_on": {"$ne": today}},
                {"$set": {"pitch_push_sent_on": today}})
        except Exception:
            continue
        if not res.modified_count:
            continue
        try:
            await send_push_to_user(uid, "Learn your pitch for tomorrow",
                                    "Read it through tonight, with the notes on why and how. We'll go over it together tomorrow.",
                                    {"type": "learn_pitch", "url": "/pitch"})
            sent += 1
        except Exception as e:
            logger.warning(f"pitch push failed for {uid}: {e}")
    return sent
