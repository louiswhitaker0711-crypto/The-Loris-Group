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

A meeting can also carry a title, one PDF (e.g. the plan written elsewhere;
stored in GridFS like the Library's PDFs, readable by anyone who can read the
recap) and the COD topics it covered (`coaching_impacts` ids). When there is a
PDF, the AI reads it alongside any typed notes.

Collection `meeting_notes`, one document per (office, block, date):
    {id, office_id, block_id, block_title, title, date, groups, min_rank,
     raw_notes, recap, cod_topics: [{id, title, stage}],
     pdf: {gridfs_id, file_name, file_size} | null,
     status: draft|published, created_by_id, created_by_name, updated_at,
     published_at}
"""
from __future__ import annotations

import base64
import io
import logging
import os
import re
import tempfile
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from bson import ObjectId
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
MAX_TITLE = 120
MAX_TOPICS = 12
MAX_PDF_BYTES = 15 * 1024 * 1024

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
    pdf = out.get("pdf")
    out["pdf"] = {"file_name": pdf.get("file_name"), "file_size": pdf.get("file_size")} if pdf else None
    out.setdefault("cod_topics", [])
    out["title"] = out.get("title") or out.get("block_title") or "Meeting"
    return out


def _gridfs():
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket
    return AsyncIOMotorGridFSBucket(db, bucket_name="meeting_pdfs")


async def clean_topics(ids) -> list:
    """Keep only real COD topics, in the order given, as {id, title, stage}."""
    want = [str(i) for i in (ids or []) if i][:MAX_TOPICS]
    if not want:
        return []
    found = {}
    async for d in db.coaching_impacts.find({"id": {"$in": want}}, {"_id": 0, "id": 1, "title": 1, "stage": 1}):
        found[d["id"]] = {"id": d["id"], "title": d.get("title") or "Untitled", "stage": int(d.get("stage") or 1)}
    out, seen = [], set()
    for i in want:
        if i in found and i not in seen:
            seen.add(i)
            out.append(found[i])
    return out


async def _note_for_write(user: dict, block_id: str, date_val) -> tuple[dict, dict, Optional[dict]]:
    block = await _block_for(user, str(block_id or ""))
    d = _clean_date(date_val)
    key = {"office_id": block["office_id"], "block_id": block["id"], "date": d}
    existing = await db.meeting_notes.find_one(key, {"_id": 0})
    return block, key, existing


async def _upsert(user: dict, block: dict, key: dict, existing: Optional[dict], update: dict) -> dict:
    groups = block_groups(block)
    update = {"block_title": block.get("title") or "Meeting", "groups": groups,
              "min_rank": min_rank(groups), "updated_at": _now(), **update}
    if existing:
        await db.meeting_notes.update_one(key, {"$set": update})
        existing.update(update)
        return existing
    doc = {"id": str(uuid.uuid4()), **key, "title": "", "raw_notes": "", "recap": "", "cod_topics": [],
           "pdf": None, "status": "draft", "created_by_id": str(user.get("id")),
           "created_by_name": user.get("name") or "", "published_at": None, **update}
    await db.meeting_notes.insert_one(dict(doc))
    return doc


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
    block, key, existing = await _note_for_write(user, body.get("block_id"), body.get("date"))
    update: dict = {}
    if "raw_notes" in body:
        update["raw_notes"] = str(body.get("raw_notes") or "")[:MAX_NOTES]
    if "recap" in body:
        update["recap"] = str(body.get("recap") or "")[:MAX_RECAP]
    if "title" in body:
        update["title"] = str(body.get("title") or "").strip()[:MAX_TITLE]
    if "cod_topic_ids" in body:
        update["cod_topics"] = await clean_topics(body.get("cod_topic_ids") or [])
    note = await _upsert(user, block, key, existing, update)
    return _public(note, user)


def _decode_pdf(b64: str) -> bytes:
    raw_s = (b64 or "").strip()
    if raw_s.startswith("data:") and "," in raw_s:
        raw_s = raw_s.split(",", 1)[1]
    try:
        raw = base64.b64decode(raw_s, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="That file couldn't be read")
    # Opened on the app's own origin, so it must really be a PDF.
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="That file isn't a PDF. Upload a .pdf file.")
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="That PDF is over 15 MB. Try a smaller one.")
    return raw


async def _drop_pdf(note: Optional[dict]) -> None:
    gid = ((note or {}).get("pdf") or {}).get("gridfs_id")
    if gid:
        try:
            await _gridfs().delete(ObjectId(gid))
        except Exception:
            pass


@router.post("/meeting-notes/pdf")
async def upload_meeting_pdf(request: Request):
    """Attach a PDF to a meeting (replaces any earlier one)."""
    user = await get_current_user(request)
    if not can_write(user):
        raise HTTPException(status_code=403, detail="Only Coaches and the Owner add meeting notes")
    body = await request.json()
    block, key, existing = await _note_for_write(user, body.get("block_id"), body.get("date"))
    raw = _decode_pdf(body.get("file_b64") or "")
    name = re.sub(r"[\\/\x00-\x1f]", "", str(body.get("file_name") or "meeting.pdf")).strip()[:120] or "meeting.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    gid = await _gridfs().upload_from_stream(name, io.BytesIO(raw))
    await _drop_pdf(existing)
    update = {"pdf": {"gridfs_id": str(gid), "file_name": name, "file_size": len(raw)}}
    if not (existing or {}).get("title") and body.get("title") is None:
        update["title"] = re.sub(r"\.pdf$", "", name, flags=re.I)[:MAX_TITLE]
    note = await _upsert(user, block, key, existing, update)
    return _public(note, user)


@router.delete("/meeting-notes/{note_id}/pdf")
async def remove_meeting_pdf(note_id: str, request: Request):
    user = await get_current_user(request)
    if not can_write(user):
        raise HTTPException(status_code=403, detail="Only Coaches and the Owner add meeting notes")
    note = await db.meeting_notes.find_one({"id": note_id}, {"_id": 0})
    if not note or not can_read(user, note):
        raise HTTPException(status_code=404, detail="Notes not found")
    await _drop_pdf(note)
    await db.meeting_notes.update_one({"id": note_id}, {"$set": {"pdf": None, "updated_at": _now()}})
    note["pdf"] = None
    return _public(note, user)


async def _pdf_bytes(note: dict) -> Optional[bytes]:
    gid = (note.get("pdf") or {}).get("gridfs_id")
    if not gid:
        return None
    buf = io.BytesIO()
    await _gridfs().download_to_stream(ObjectId(gid), buf)
    return buf.getvalue()


@router.get("/meeting-notes/{note_id}/pdf")
async def get_meeting_pdf(note_id: str, request: Request):
    """The meeting's PDF as base64 (same shape as the Library's file route)."""
    user = await get_current_user(request)
    note = await db.meeting_notes.find_one({"id": note_id}, {"_id": 0})
    if not note or not can_read(user, note) or not note.get("pdf"):
        raise HTTPException(status_code=404, detail="PDF not found")
    try:
        raw = await _pdf_bytes(note)
    except Exception:
        raise HTTPException(status_code=404, detail="PDF not found")
    return {"file_name": note["pdf"].get("file_name") or "meeting.pdf", "mime_type": "application/pdf",
            "file_b64": base64.b64encode(raw or b"").decode("ascii")}


def recap_prompt(note: dict, notes: str, has_pdf: bool) -> str:
    title = note.get("title") or note.get("block_title") or "Meeting"
    parts = [f"Meeting: {title} ({note.get('block_title')}) on {note.get('date')}"]
    topics = note.get("cod_topics") or []
    if topics:
        parts.append("COD topics this meeting covered: " + "; ".join(t.get("title", "") for t in topics))
    if has_pdf:
        parts.append("The attached PDF is the meeting plan or notes. Recap what it says.")
    if notes:
        parts.append("Notes:\n" + notes)
    return "\n\n".join(parts)


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
    has_pdf = bool(note.get("pdf"))
    if len(notes) < 20 and not has_pdf:
        raise HTTPException(status_code=400, detail="Add a few lines of notes or a PDF first")
    from core.llm_keys import anthropic_api_key
    api_key = anthropic_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="AI isn't switched on yet: add an Anthropic API key on Railway. You can still write the recap yourself.")
    take_ai_quota(user)
    from emergentintegrations.llm.chat import FileContentWithMimeType, LlmChat, UserMessage
    from core.llm_guard import acquire_llm_slot
    chat = LlmChat(api_key=api_key, session_id=f"recap-{note_id}-{uuid.uuid4().hex[:6]}",
                   system_message=RECAP_SYSTEM).with_model("anthropic")
    prompt = recap_prompt(note, notes, has_pdf)
    tmp_path = None
    try:
        files = None
        if has_pdf:
            raw = await _pdf_bytes(note)
            fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw or b"")
            files = [FileContentWithMimeType(file_path=tmp_path, mime_type="application/pdf")]
        async with acquire_llm_slot():
            text = await chat.send_message(UserMessage(text=prompt, file_contents=files))
    except HTTPException:
        raise
    except Exception as ex:
        logger.warning("meeting recap AI call failed: %s", ex)
        raise HTTPException(status_code=502, detail="The AI call failed. Try again shortly.")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
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
async def recap_library(request: Request, limit: int = 100, topic_id: Optional[str] = None):
    """Published recaps this person can read, newest first. With topic_id,
    only those tagged with that COD topic."""
    user = await get_current_user(request)
    q: dict = {"status": "published"}
    if topic_id:
        q["cod_topics.id"] = str(topic_id)
    if not user.get("is_super_admin"):
        q["office_id"] = user.get("office_id")
        if not can_write(user):
            q["min_rank"] = {"$lte": user_rank(user)}
    out = []
    async for n in db.meeting_notes.find(q, {"_id": 0, "raw_notes": 0}).sort("date", -1).limit(max(1, min(limit, 300))):
        out.append(_public(n, user))
    return {"recaps": out}
