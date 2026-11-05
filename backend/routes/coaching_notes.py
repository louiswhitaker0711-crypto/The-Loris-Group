"""Private coaching notes about a person (the Owner, 5 Nov 2026).

The Owner, or someone's Coach, writes what a person is struggling with ("rushes
the close when nervous", "goes quiet after a no"). The notes are private:

  * only Admins and the people above them (their Coach and up the chain,
    `get_subtree_ids`) can write, read or mark one sorted;
  * the person never sees them, in the app or through their Claude link;
  * their own AI coach uses them indirectly, to shape its tips, and is told
    never to quote them or say they exist (routes/ai_assistant.py);
  * the AI of an Admin or their Coach sees them openly (core/ai_context.py),
    and so do focus suggestions for their sector set-up.

A note stays live until someone marks it sorted.

  GET  /api/coaching-notes/{user_id}                  live notes (+ recently sorted)
  POST /api/coaching-notes/{user_id}                  add one {text}
  PUT  /api/coaching-notes/{user_id}/{note_id}/sorted  mark it sorted
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, get_subtree_ids
from database import db

router = APIRouter()

MAX_NOTE = 1000
MAX_LIVE_PER_PERSON = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def may_note(actor: dict, subject_id: str) -> dict:
    """The subject, if `actor` may read and write notes about them; else 403/404."""
    if actor.get("is_viewer"):
        raise HTTPException(status_code=403, detail="Read-only account")
    if str(subject_id) == str(actor.get("id")):
        raise HTTPException(status_code=403, detail="Coaching notes are about other people")
    if not ObjectId.is_valid(str(subject_id)):
        raise HTTPException(status_code=404, detail="Person not found")
    subject = await db.users.find_one({"_id": ObjectId(str(subject_id)), "deleted": {"$ne": True}},
                                      {"name": 1, "office_id": 1})
    if not subject:
        raise HTTPException(status_code=404, detail="Person not found")
    if subject.get("office_id") != actor.get("office_id") and not actor.get("is_super_admin"):
        raise HTTPException(status_code=404, detail="Person not found")
    if (actor.get("role") or "").lower() == "admin":
        return subject
    if str(subject_id) in {str(x) for x in await get_subtree_ids(str(actor["id"]))}:
        return subject
    raise HTTPException(status_code=403, detail="Only their Coach or an Admin can see coaching notes")


async def noteable_ids(actor: dict, among: set[str]) -> set[str]:
    """Which of `among` the actor may read notes about (never themselves)."""
    if actor.get("is_viewer"):
        return set()
    me = str(actor.get("id"))
    if (actor.get("role") or "").lower() == "admin":
        return {i for i in among if i != me}
    sub = {str(x) for x in await get_subtree_ids(me)}
    return {i for i in among if i in sub and i != me}


async def live_notes(subject_ids: set[str] | list[str]) -> dict[str, list[str]]:
    """{subject_id: [note text, newest first]} for notes not yet sorted."""
    ids = [str(i) for i in subject_ids]
    if not ids:
        return {}
    out: dict[str, list[str]] = {}
    async for n in db.coaching_notes.find({"subject_id": {"$in": ids}, "sorted_at": None},
                                          {"_id": 0, "subject_id": 1, "text": 1}).sort("created_at", -1):
        out.setdefault(n["subject_id"], []).append(n["text"])
    return out


@router.get("/coaching-notes/{user_id}")
async def list_notes(user_id: str, request: Request):
    actor = await get_current_user(request)
    subject = await may_note(actor, user_id)
    live, done = [], []
    async for n in db.coaching_notes.find({"subject_id": str(user_id)}, {"_id": 0}).sort("created_at", -1).limit(60):
        (done if n.get("sorted_at") else live).append(n)
    return {"name": subject.get("name"), "notes": live, "sorted": done[:10]}


@router.post("/coaching-notes/{user_id}")
async def add_note(user_id: str, request: Request):
    actor = await get_current_user(request)
    subject = await may_note(actor, user_id)
    body = await request.json()
    text = " ".join(str((body or {}).get("text") or "").split())[:MAX_NOTE]
    if not text:
        raise HTTPException(status_code=400, detail="Write what they're struggling with first")
    if await db.coaching_notes.count_documents({"subject_id": str(user_id), "sorted_at": None}) >= MAX_LIVE_PER_PERSON:
        raise HTTPException(status_code=400, detail="That's a lot of live notes: mark some as sorted first")
    note = {"id": uuid.uuid4().hex, "subject_id": str(user_id), "office_id": subject.get("office_id"),
            "text": text, "author_id": str(actor["id"]), "author_name": actor.get("name") or "",
            "created_at": _now(), "sorted_at": None}
    await db.coaching_notes.insert_one(dict(note))
    # A fresh note changes what the AI should suggest for their set-up today.
    await db.ai_setup_suggestions.delete_many({"user_id": str(user_id)})
    return note


@router.put("/coaching-notes/{user_id}/{note_id}/sorted")
async def sort_note(user_id: str, note_id: str, request: Request):
    actor = await get_current_user(request)
    await may_note(actor, user_id)
    res = await db.coaching_notes.update_one(
        {"id": note_id, "subject_id": str(user_id), "sorted_at": None},
        {"$set": {"sorted_at": _now(), "sorted_by": str(actor["id"]), "sorted_by_name": actor.get("name") or ""}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.ai_setup_suggestions.delete_many({"user_id": str(user_id)})
    return {"ok": True}
