"""Learn your pitch (the Owner, 26 Oct 2026).

Everyone has the pitch (a card at the bottom of Home). A new start gets it
from 18:00 on their first day, with a notification; on that first night
it's Read only, because the Owner hasn't gone over it yet. Say it, Learn
and Check open at 18:00 the day after (their BA Academy Day 2). Everyone
else has every tab.

    GET /api/pitch          → {unlocked, unlocks_at, new_start, state, words, can_edit}
    PUT /api/pitch {counts, ladder, quiz, shown}   save your own progress
    PUT /api/pitch/words {words: {line_id: text}}  Admin: the office's own
        wording for the pitch lines (27 Oct 2026: "just the words"; the why
        and how notes stay). Line ids are the app's: "L<step>-<line>" for what
        the BA says, with a "q" suffix for the follow-up ("Perfect."). An
        empty text goes back to the original wording.

pitch_push_tick() sends "Learn your pitch" to today's new starts at 18:00
(once each); server.py runs it at 18:00 and once on start-up after 18:00.
"""
from __future__ import annotations

import logging
import re
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
WORD_KEY = re.compile(r"^L[1-9]-[0-9]{1,2}q?$")
MAX_WORDS = 60
MAX_LINE = 400


def clean_words(body: Any) -> dict:
    """{line_id: text} the office keeps; blank texts dropped (original wording)."""
    words = body.get("words") if isinstance(body, dict) else None
    if not isinstance(words, dict):
        raise HTTPException(status_code=400, detail="Send the pitch words as an object")
    if len(words) > MAX_WORDS:
        raise HTTPException(status_code=400, detail="Too many lines")
    out = {}
    for k, v in words.items():
        if not (isinstance(k, str) and WORD_KEY.match(k) and isinstance(v, str)):
            continue
        text = " ".join(v.split())[:MAX_LINE]
        if text:
            out[k] = text
    return out


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


NEW_START_DAYS = 10   # after this long it's not a first week, whatever the record says


def is_new_start(hire: Optional[dict], today: Optional[date] = None) -> bool:
    """In their first week: a start date in the last NEW_START_DAYS days and
    not past Day 3. An old record with no start date (or a stale one) isn't,
    so it never hides the pitch (28 Oct 2026: a Coach couldn't see it)."""
    if not hire or int(hire.get("current_day") or 1) > 3:
        return False
    try:
        d = date.fromisoformat(str(hire.get("start_date") or "")[:10])
    except ValueError:
        return False
    today = today or datetime.now(APP_TZ).date()
    return 0 <= (today - d).days <= NEW_START_DAYS


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
    new_start = is_new_start(hire)
    at = unlock_at(start) if new_start else None
    doc = await db.users.find_one({"_id": ObjectId(uid)}, {"pitch_progress": 1}) or {}
    office = await db.office_pitch.find_one({"office_id": user.get("office_id")}, {"_id": 0, "words": 1}) or {}
    return {"unlocked": (not new_start) or is_unlocked(start), "unlocks_at": at.isoformat() if at else None,
            "new_start": new_start, "start_date": start,
            "state": doc.get("pitch_progress") or {"counts": {}, "ladder": {}, "quiz": {}, "shown": {}},
            "words": office.get("words") or {}, "can_edit": _can_edit(user),
            "practice": await _practice(user)}


async def _practice(user: dict) -> bool:
    """Say it / Learn / Check are for new starts (COD Stage 1); from Stage 2
    it's the words with why and how (the Owner, 29 Oct 2026). The Owner sees
    everything."""
    role = (user.get("role") or "").lower()
    if role == "admin":
        return True
    if role != "trainee":
        return False
    from routes.modules import _is_stage_unlocked
    try:
        return not await _is_stage_unlocked(user, 2)
    except Exception:
        return True


def _can_edit(user: dict) -> bool:
    return (user.get("role") or "").lower() == "admin" and not user.get("is_viewer")


@router.put("/pitch/words")
async def save_pitch_words(request: Request):
    user = await get_current_user(request)
    if not _can_edit(user):
        raise HTTPException(status_code=403, detail="Only the Owner can change the pitch")
    words = clean_words(await request.json())
    await db.office_pitch.update_one(
        {"office_id": user.get("office_id")},
        {"$set": {"office_id": user.get("office_id"), "words": words,
                  "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": str(user["id"])}},
        upsert=True)
    return {"ok": True, "words": words}


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
