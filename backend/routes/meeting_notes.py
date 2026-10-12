"""Meeting notes and recaps.

A Coach or the Owner adds notes to one meeting on one day (a block on the
office Schedule + a date): typed, pasted, or read from a photo (the Planner's
photo reader). AI turns them into a one-page recap for anyone who missed it;
they check it, edit it, and publish.

Who sees a published recap: the people the meeting is for and everyone above
them. Each meeting covers lanes on the timetable (Stage 1, Stage 2, Coaches,
Stage 4+); a recap is visible to anyone whose own lane is at or above the
lowest lane it covers. So when someone advances to Stage 3 they can read every
Coaches recap there has been, and Stage 1 notes stay readable as people move
up. Admins see everything in their office. The raw notes are only shown to the
people who can write recaps.

Collection `meeting_notes`, one document per (office, block, date):
    {id, office_id, block_id, block_title, date, groups, min_rank,
     raw_notes, recap, status: draft|published, created_by_id,
     created_by_name, updated_at, published_at}
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from core.brand import BRITISH_ENGLISH, SELF_EMPLOYED_TERMS
from core.rate_limit import take_ai_quota
from core.schedule_template import block_groups, user_group
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

RANK = {"s1": 1, "s2": 2, "ld": 3, "s4": 4}
MAX_NOTES = 12000
MAX_RECAP = 8000

RECAP_SYSTEM = (
    "You write a one-page recap of a team meeting for self-employed Brand Ambassadors "
    "who missed it. Use ONLY what is in the notes: never add facts, figures, names or "
    "advice that are not there. Write in Markdown with exactly these sections:\n"
    "## What we covered\nShort paragraphs or bullets, the key points in the order they came up.\n"
    "## What to do in the field\n3 to 6 bullets: specific actions to take from tomorrow.\n"
    "## Check yourself\n3 short questions someone could answer if they understood the meeting.\n"
    "Keep it under 350 words, plain and direct, like a good coach talking. Keep the team's "
    "own words for things (Close, Rehash, Primetime, Bells, Sector, COD, BA, Pitched). "
    "If the notes are too thin to recap, say so in one line under What we covered.\n\n"
    + BRITISH_ENGLISH + "\n\n" + SELF_EMPLOYED_TERMS
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def can_write(user: dict) -> bool:
    return user.get("role") in ("admin", "leader") or bool(user.get("is_super_admin"))


def user_rank(user: dict) -> int:
    if user.get("role") == "admin" or user.get("is_super_admin"):
        return 99
    return RANK[user_group(user.get("role"), user.get("owneriq_stage"))]


def min_rank(groups: list) -> int:
    ranks = [RANK[g] for g in groups or [] if g in RANK]
    return min(ranks) if ranks else 1


def can_read(user: dict, note: dict) -> bool:
    if user.get("is_super_admin"):
        return True
    if (note.get("office_id") or "") != (user.get("office_id") or ""):
        return False
    if can_write(user):
        return True
    return note.get("status") == "published" and user_rank(user) >= int(note.get("min_rank") or 1)


def _public(note: dict, user: dict) -> dict:
    out = {k: v for k, v in note.items() if k != "_id"}
    if not can_write(user):
        out.pop("raw_notes", None)
    return out


def _clean_date(v) -> str:
    try:
        return date.fromisoformat(str(v or "")[:10]).isoformat()
    except Exception:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")


async def _block_for(user: dict, block_id: str) -> dict:
    block = await db.schedule_blocks.find_one({"id": block_id}, {"_id": 0})
    if not block or (block.get("audience") or "").lower() == "personal":
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not user.get("is_super_admin") and block.get("office_id") != user.get("office_id"):
        raise HTTPException(status_code=404, detail="Meeting not found")
    return block


@router.get("/meeting-notes")
async def get_meeting_note(request: Request, block_id: str, date: str):
    """The notes for one meeting on one day (null when there are none, or the
    viewer can't see them yet)."""
    user = await get_current_user(request)
    block = await _block_for(user, block_id)
    d = _clean_date(date)
    note = await db.meeting_notes.find_one({"office_id": block["office_id"], "block_id": block_id, "date": d}, {"_id": 0})
    return {
        "can_write": can_write(user),
        "block": {"id": block["id"], "title": block.get("title"), "start_time": block.get("start_time"),
                  "end_time": block.get("end_time"), "groups": block_groups(block)},
        "note": _public(note, user) if note and can_read(user, note) else None,
    }


@router.put("/meeting-notes")
async def save_meeting_note(request: Request):
    """Save notes and/or the recap (draft). Coaches and the Owner only."""
    user = await get_current_user(request)
    if not can_write(user):
        raise HTTPException(status_code=403, detail="Only Coaches and the Owner add meeting notes")
    body = await request.json()
    block = await _block_for(user, str(body.get("block_id") or ""))
    d = _clean_date(body.get("date"))
    groups = block_groups(block)
    key = {"office_id": block["office_id"], "block_id": block["id"], "date": d}
    existing = await db.meeting_notes.find_one(key, {"_id": 0})
    update = {
        "block_title": block.get("title") or "Meeting",
        "groups": groups,
        "min_rank": min_rank(groups),
        "updated_at": _now(),
    }
    if "raw_notes" in body:
        update["raw_notes"] = str(body.get("raw_notes") or "")[:MAX_NOTES]
    if "recap" in body:
        update["recap"] = str(body.get("recap") or "")[:MAX_RECAP]
    if existing:
        await db.meeting_notes.update_one(key, {"$set": update})
        existing.update(update)
        return _public(existing, user)
    doc = {"id": str(uuid.uuid4()), **key, "raw_notes": "", "recap": "", "status": "draft",
           "created_by_id": str(user.get("id")), "created_by_name": user.get("name") or "",
           "published_at": None, **update}
    await db.meeting_notes.insert_one(dict(doc))
    return _public(doc, user)


@router.post("/meeting-notes/{note_id}/recap")
async def write_recap(note_id: str, request: Request):
    """AI writes the recap from the notes. Returns it; the person checks and
    saves it (nothing is published here)."""
    user = await get_current_user(request)
    if not can_write(user):
        raise HTTPException(status_code=403, detail="Only Coaches and the Owner add meeting notes")
    note = await db.meeting_notes.find_one({"id": note_id}, {"_id": 0})
    if not note or not can_read(user, note):
        raise HTTPException(status_code=404, detail="Notes not found")
    notes = (note.get("raw_notes") or "").strip()
    if len(notes) < 20:
        raise HTTPException(status_code=400, detail="Add a few lines of notes first")
    from core.llm_keys import anthropic_api_key
    api_key = anthropic_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="AI isn't switched on yet: add an Anthropic API key on Railway. You can still write the recap yourself.")
    take_ai_quota(user)
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    from core.llm_guard import acquire_llm_slot
    chat = LlmChat(api_key=api_key, session_id=f"recap-{note_id}-{uuid.uuid4().hex[:6]}",
                   system_message=RECAP_SYSTEM).with_model("anthropic")
    prompt = f"Meeting: {note.get('block_title')} on {note.get('date')}\n\nNotes:\n{notes}"
    try:
        async with acquire_llm_slot():
            text = await chat.send_message(UserMessage(text=prompt))
    except Exception as ex:
        logger.warning("meeting recap AI call failed: %s", ex)
        raise HTTPException(status_code=502, detail="The AI call failed. Try again shortly.")
    text = (text if isinstance(text, str) else str(text)).strip()
    text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text)
    recap = text[:MAX_RECAP]
    await db.meeting_notes.update_one({"id": note_id}, {"$set": {"recap": recap, "updated_at": _now()}})
    return {"recap": recap}


@router.post("/meeting-notes/{note_id}/publish")
async def publish_recap(note_id: str, request: Request):
    """Publish (or unpublish) the recap. With notify, everyone it's for gets a
    notification."""
    user = await get_current_user(request)
    if not can_write(user):
        raise HTTPException(status_code=403, detail="Only Coaches and the Owner publish recaps")
    body = await request.json()
    note = await db.meeting_notes.find_one({"id": note_id}, {"_id": 0})
    if not note or not can_read(user, note):
        raise HTTPException(status_code=404, detail="Notes not found")
    publish = bool(body.get("publish", True))
    if publish and not (note.get("recap") or "").strip():
        raise HTTPException(status_code=400, detail="Write or create the recap first")
    upd = {"status": "published" if publish else "draft", "updated_at": _now(),
           "published_at": _now() if publish else None}
    await db.meeting_notes.update_one({"id": note_id}, {"$set": upd})
    note.update(upd)
    notified = 0
    if publish and body.get("notify"):
        from core.push import send_push_to_user
        async for u in db.users.find({"office_id": note["office_id"], "deleted": {"$ne": True}},
                                     {"_id": 1, "role": 1, "owneriq_stage": 1, "office_id": 1}):
            uu = {**u, "id": str(u["_id"])}
            if str(u["_id"]) == str(user.get("id")) or not can_read(uu, note):
                continue
            await send_push_to_user(
                str(u["_id"]), f"Recap: {note.get('block_title')}",
                "Missed it? The notes are up.",
                {"type": "meeting_recap", "url": f"/meeting-notes?block_id={note['block_id']}&date={note['date']}"})
            notified += 1
    return {**_public(note, user), "notified": notified}


@router.get("/meeting-notes/library")
async def recap_library(request: Request, limit: int = 100):
    """Published recaps this person can read, newest first."""
    user = await get_current_user(request)
    q: dict = {"status": "published"}
    if not user.get("is_super_admin"):
        q["office_id"] = user.get("office_id")
        if not can_write(user):
            q["min_rank"] = {"$lte": user_rank(user)}
    out = []
    async for n in db.meeting_notes.find(q, {"_id": 0, "raw_notes": 0}).sort("date", -1).limit(max(1, min(limit, 300))):
        out.append(n)
    return {"recaps": out}
