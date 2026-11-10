"""The scorecard for the weekly review (the Owner, 10 Nov 2026).

  GET  /api/scorecard?week=YYYY-MM-DD   the scorecard for the 4 weeks to that
                                        week ending, plus its saved summary
  POST /api/scorecard/summary           write the short AI paragraph for that
                                        week (saved, so it's written once)

Admins and Coaches only, for the people they can see; BAs never see it.
How people are scored lives in core/scorecard.py.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from core.ai_context import today_uk, visible_ids, week_ending_of
from core.llm_keys import llm_configured
from core.scorecard import scorecard, slim
from database import db

router = APIRouter()

SUMMARY_PROMPT = (
    "Here is the office scorecard for the 4 weeks to the week ending {week} (JSON), scored against what good "
    "looks like, not against each other:\n{card}\n\n"
    "Write the weekly review's paragraph for the Owner: 3 or 4 short sentences, plain text, no headings, no "
    "bullets. Say who the best three are and why from their numbers, who's slipping and on what, and one thing "
    "to do this week (who should lead a sector, who should take the next new start, or who needs a word). Use "
    "first names. Never invent a number that isn't in the data."
)


def _week(raw: str | None) -> str:
    if not raw:
        return week_ending_of(today_uk())
    try:
        return week_ending_of(date.fromisoformat(str(raw)[:10]))
    except ValueError:
        raise HTTPException(status_code=400, detail="week must be a date like 2026-11-08")


async def _viewer(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") not in ("admin", "leader") or user.get("is_viewer"):
        raise HTTPException(status_code=403, detail="The scorecard is for the Owner and Coaches")
    return user


async def _card(user: dict, week: str) -> dict:
    ids, _ = await visible_ids(user)
    through = min(date.fromisoformat(week), today_uk())
    return await scorecard(user.get("office_id"), set(ids), through)


@router.get("/scorecard")
async def get_scorecard(request: Request, week: str | None = None):
    user = await _viewer(request)
    wk = _week(week)
    card = await _card(user, wk)
    saved = await db.scorecard_summaries.find_one({"user_id": str(user["id"]), "week_ending": wk}, {"_id": 0})
    return {"week_ending": wk, "scorecard": card, "summary": (saved or {}).get("text"),
            "ai": llm_configured()}


@router.post("/scorecard/summary")
async def write_summary(request: Request):
    from routes.ai_assistant import ABOUT, _ask
    user = await _viewer(request)
    if not llm_configured():
        raise HTTPException(status_code=503, detail="The AI isn't switched on yet. The Owner needs to add the AI key.")
    body = await request.json()
    wk = _week((body or {}).get("week") if isinstance(body, dict) else None)
    uid = str(user["id"])
    saved = await db.scorecard_summaries.find_one({"user_id": uid, "week_ending": wk}, {"_id": 0})
    if saved and not (isinstance(body, dict) and body.get("refresh")):
        return {"summary": saved["text"]}
    card = await _card(user, wk)
    if not card.get("people"):
        raise HTTPException(status_code=400, detail="Nobody has enough field days to score yet")
    text = await _ask(user, ABOUT, SUMMARY_PROMPT.format(week=wk, card=json.dumps(slim(card), ensure_ascii=False)))
    text = " ".join(str(text or "").split())
    await db.scorecard_summaries.update_one(
        {"user_id": uid, "week_ending": wk},
        {"$set": {"text": text, "updated_at": datetime.now(timezone.utc).isoformat()},
         "$setOnInsert": {"id": str(uuid.uuid4())}}, upsert=True)
    return {"summary": text}
