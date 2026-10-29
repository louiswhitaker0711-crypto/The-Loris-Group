"""Notes folder (the Owner, 29 Oct 2026).

Everything people write in their planner's note boxes (Coaches Meeting,
Morning Meeting news/topic/customer service/Bells, Extra Notes) files itself
into a folder, under a heading: a COD topic, or one of the pitch headings
(Introduction, Presentation, Short story, Close, Sign-up process, Rehash,
Sales tip, Other). Each note has a title and a date. People's own notes are
theirs alone; the Owner can post a note to everyone in the office.

The planner stays the place notes are written: on each save the planner's
note boxes are mirrored here (`sync_planner`), one note per box with text,
keyed by `ref` so editing the box edits the note and emptying it removes it.

Planner notes (the Owner, 29 Oct 2026): any time slot on a day page (and
the big Notes box at the bottom of each day, slot "day") can hold several
notes besides its plan, each with a title, a heading and photos. They're
kept on the planner as `slot_notes` {"<day>:<slot>": [note]} and file here
the same way, one note each (`ref` …:<day>:n:<note id>).

    POST /api/notes/photo  {image}  → {url}   a photo for a note

Collection `folder_notes`:
  {id, ref, office_id, user_id, author_name, head, head_label, stage,
   category, title, body, photos, date, source_label, shared, created_at, updated_at}
  head: "cod:<module id>" | "pitch:<key>"

    GET /api/notes/folder              the folder: pitch headings and the COD
                                       (stage → section → topic) with counts
    GET /api/notes?head=…&q=…          notes under a heading, or found by words
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from database import db

router = APIRouter()

PITCH_HEADS = [
    ("intro", "Introduction"), ("presentation", "Presentation"), ("short_story", "Short story"),
    ("close", "Close"), ("signup", "Sign-up process"), ("rehash", "Rehash"),
    ("sales_tip", "Sales tips"), ("other", "Other"),
]
PITCH_LABEL = dict(PITCH_HEADS)
STAGE_NAMES = {1: "Stage 1 · Foundation", 2: "Stage 2 · Self Management", 3: "Stage 3 · Leader",
               5: "SL · Sector-Site Leader", 4: "Stage 4 · Team Builder", 6: "Stage 5"}
STAGE_ORDER = [1, 2, 3, 5, 4, 6]

# The planner's note boxes that file into the folder, with their labels.
NOTE_BOXES = {
    "leaders_meeting": "Coaches Meeting", "morning_news": "Morning Meeting · News",
    "morning_topic": "Morning Meeting · Topic", "morning_cs": "Morning Meeting · Customer Service",
    "morning_bells": "Morning Meeting · Bells",
}
EXTRA = "notes"     # the planner's Extra Notes page (week-level)
_HEAD = re.compile(r"^(cod:[A-Za-z0-9_-]{1,64}|pitch:[a-z_]{1,20})$")
MAX_TITLE = 120
MAX_BODY = 8000


def clean_folder(raw) -> dict:
    """The planner's folder settings per box: {"<day>:<key>" | "x:notes":
    {head, title, share}} — bad entries dropped."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in list(raw.items())[:60]:
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        day, _, box = k.partition(":")
        if not ((day.isdigit() and 0 <= int(day) <= 5 and box in NOTE_BOXES) or (day == "x" and box == EXTRA)):
            continue
        head = str(v.get("head") or "")
        out[k] = {"head": head if _HEAD.match(head) else "",
                  "title": " ".join(str(v.get("title") or "").split())[:MAX_TITLE],
                  "share": v.get("share") is True}
    return out


_SLOT = re.compile(r"^[0-5]:[A-Za-z0-9_]{1,40}$")
_NOTE_ID = re.compile(r"^[A-Za-z0-9_-]{6,40}$")
MAX_NOTES_PER_SLOT = 10
MAX_PHOTOS = 4
MAX_DATA_URI = 900_000      # local runs only (no bucket): photos kept inline


def _photo_ok(url) -> bool:
    if not isinstance(url, str):
        return False
    if url.startswith("data:image/"):
        return len(url) <= MAX_DATA_URI
    from core.media_store import MEDIA_ROUTE, servable
    return MEDIA_ROUTE in url and servable(url.split(MEDIA_ROUTE, 1)[1]) and url.split(MEDIA_ROUTE, 1)[1].startswith("notes/")


def clean_slot_notes(raw) -> dict:
    """The planner's extra notes per slot: {"<day>:<slot>": [{id, title, head,
    body, photos, share, label}]}; bad entries dropped, sizes capped."""
    out: dict = {}
    if not isinstance(raw, dict):
        return out
    for k, notes in list(raw.items())[:80]:
        if not isinstance(k, str) or not _SLOT.match(k) or not isinstance(notes, list):
            continue
        keep = []
        for n in notes[:MAX_NOTES_PER_SLOT]:
            if not isinstance(n, dict):
                continue
            nid = str(n.get("id") or "")
            if not _NOTE_ID.match(nid):
                nid = uuid.uuid4().hex[:16]
            head = str(n.get("head") or "")
            photos = [p for p in (n.get("photos") or []) if _photo_ok(p)][:MAX_PHOTOS] if isinstance(n.get("photos"), list) else []
            body = str(n.get("body") or "")[:MAX_BODY]
            title = " ".join(str(n.get("title") or "").split())[:MAX_TITLE]
            if not (body.strip() or photos or title):
                continue
            keep.append({"id": nid, "title": title, "head": head if _HEAD.match(head) else "", "body": body,
                         "photos": photos, "share": n.get("share") is True,
                         "label": " ".join(str(n.get("label") or "").split())[:60]})
        if keep:
            out[k] = keep
    return out


def default_head(day: dict, box: str) -> str:
    """No heading picked: the meeting's COD pick if it has one, else Other."""
    cod = (day or {}).get(f"{box}_cod") or ""
    return f"cod:{cod}" if cod else "pitch:other"


def day_date(week_ending: str, day_index: int) -> str:
    return (date.fromisoformat(week_ending) - timedelta(days=6 - day_index)).isoformat()


def planner_entries(user_id: str, week_ending: str, days: dict, extra: str, folder: dict,
                    slot_notes: Optional[dict] = None) -> list[dict]:
    """The notes a planner week files: one per box with text, and one per
    extra note on a slot."""
    out = []
    for k, notes in (slot_notes or {}).items():
        d, _, slot = k.partition(":")
        for n in notes:
            label = n.get("label") or ("Day notes" if slot == "day" else "Notes")
            out.append({"ref": f"planner:{user_id}:{week_ending}:{d}:n:{n['id']}", "body": n.get("body") or "",
                        "head": n.get("head") or "pitch:other", "title": n.get("title") or label,
                        "share": bool(n.get("share")), "date": day_date(week_ending, int(d)),
                        "source_label": label, "photos": n.get("photos") or []})
    for d in range(6):
        day = (days or {}).get(str(d)) or {}
        for box, label in NOTE_BOXES.items():
            text = (day.get(box) or "").strip()
            if not text:
                continue
            meta = folder.get(f"{d}:{box}") or {}
            out.append({"ref": f"planner:{user_id}:{week_ending}:{d}:{box}", "body": text[:MAX_BODY],
                        "head": meta.get("head") or default_head(day, box),
                        "title": meta.get("title") or label, "share": bool(meta.get("share")),
                        "date": day_date(week_ending, d), "source_label": label})
    if (extra or "").strip():
        meta = folder.get(f"x:{EXTRA}") or {}
        out.append({"ref": f"planner:{user_id}:{week_ending}:x:{EXTRA}", "body": extra.strip()[:MAX_BODY],
                    "head": meta.get("head") or "pitch:other", "title": meta.get("title") or "Extra notes",
                    "share": bool(meta.get("share")), "date": day_date(week_ending, 0),
                    "source_label": "Extra notes"})
    return out


async def _cod_lookup(office_id, module_ids: list[str]) -> dict:
    if not module_ids:
        return {}
    return {m["id"]: m async for m in db.training_modules.find(
        {"id": {"$in": module_ids}, "office_id": office_id}, {"_id": 0, "id": 1, "topic": 1, "stage": 1, "category": 1})}


async def sync_planner(user: dict, week_ending: str, days: dict, extra: str, folder: dict,
                       slot_notes: Optional[dict] = None) -> int:
    """Mirror one planner week's note boxes (and slot notes) into the folder."""
    uid = str(user["id"])
    office_id = user.get("office_id")
    entries = planner_entries(uid, week_ending, days, extra, folder, slot_notes)
    cods = await _cod_lookup(office_id, [e["head"][4:] for e in entries if e["head"].startswith("cod:")])
    can_share = (user.get("role") or "").lower() == "admin" and not user.get("is_viewer")
    now = datetime.now(timezone.utc).isoformat()
    keep = []
    for e in entries:
        head, stage, category = e["head"], None, ""
        if head.startswith("cod:"):
            m = cods.get(head[4:])
            if not m:
                head = "pitch:other"
            else:
                stage, category = m.get("stage"), m.get("category") or ""
        label = (cods.get(head[4:]) or {}).get("topic") if head.startswith("cod:") else PITCH_LABEL.get(head[6:], "Other")
        keep.append(e["ref"])
        await db.folder_notes.update_one(
            {"ref": e["ref"]},
            {"$set": {"office_id": office_id, "user_id": uid, "author_name": user.get("name") or "",
                      "head": head, "head_label": label or "Other", "stage": stage, "category": category,
                      "title": e["title"], "body": e["body"], "photos": e.get("photos") or [],
                      "date": e["date"], "source_label": e["source_label"],
                      "shared": bool(e["share"] and can_share), "updated_at": now},
             "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}},
            upsert=True)
    gone = await db.folder_notes.delete_many({"ref": {"$regex": f"^planner:{re.escape(uid)}:{re.escape(week_ending)}:",
                                                      "$nin": keep}})
    return len(keep) + gone.deleted_count


def _visible(user: dict) -> dict:
    """Your own notes, and the notes posted to everyone in your office."""
    return {"$or": [{"user_id": str(user["id"])},
                    {"shared": True, "office_id": user.get("office_id")}]}


def _out(n: dict, me: str) -> dict:
    return {k: n.get(k) for k in ("id", "head", "head_label", "stage", "category", "title", "body", "date",
                                  "source_label", "shared", "author_name")} | {"mine": n.get("user_id") == me,
                                                                               "photos": n.get("photos") or []}


@router.get("/notes/folder")
async def notes_folder(request: Request):
    user = await get_current_user(request)
    me = str(user["id"])
    counts: dict = {}
    owner_counts: dict = {}
    latest = None
    async for n in db.folder_notes.find(_visible(user), {"_id": 0, "head": 1, "shared": 1, "user_id": 1,
                                                          "title": 1, "date": 1, "head_label": 1, "id": 1}):  # noqa: E501
        h = n.get("head") or "pitch:other"
        counts[h] = counts.get(h, 0) + 1
        if n.get("shared") and n.get("user_id") != me:
            owner_counts[h] = owner_counts.get(h, 0) + 1
            if latest is None or (n.get("date") or "") > (latest.get("date") or ""):
                latest = {"id": n.get("id"), "title": n.get("title"), "date": n.get("date"),
                          "head": h, "head_label": n.get("head_label")}
    pitch = [{"head": f"pitch:{k}", "label": lab, "count": counts.get(f"pitch:{k}", 0),
              "from_owner": owner_counts.get(f"pitch:{k}", 0)} for k, lab in PITCH_HEADS]
    stages: dict = {}
    async for m in db.training_modules.find(
            {"office_id": user.get("office_id"), "stage": {"$in": STAGE_ORDER}, "retired": {"$ne": True}},
            {"_id": 0, "id": 1, "stage": 1, "topic": 1, "category": 1, "sequence": 1}).sort([("stage", 1), ("sequence", 1)]):
        if not m.get("id"):
            continue
        st = stages.setdefault(m["stage"], {"stage": m["stage"], "name": STAGE_NAMES.get(m["stage"], f"Stage {m['stage']}"),
                                            "count": 0, "from_owner": 0, "sections": []})
        cat = m.get("category") or "Other"
        sec = next((x for x in st["sections"] if x["category"] == cat), None)
        if not sec:
            sec = {"category": cat, "topics": []}
            st["sections"].append(sec)
        h = f"cod:{m['id']}"
        sec["topics"].append({"head": h, "topic": m.get("topic") or "", "count": counts.get(h, 0),
                              "from_owner": owner_counts.get(h, 0)})
        st["count"] += counts.get(h, 0)
        st["from_owner"] += owner_counts.get(h, 0)
    cod = [stages[s] for s in STAGE_ORDER if s in stages]
    owner_name = ""
    try:
        from routes.training_routes import office_owner_doc
        owner = await office_owner_doc(user.get("office_id"))
        owner_name = ((owner or {}).get("name") or "").split(" ")[0]
    except Exception:  # noqa: BLE001
        pass
    return {"latest_from_owner": latest, "pitch": pitch, "cod": cod, "total": sum(counts.values()),
            "owner_name": owner_name or "the Owner"}


@router.get("/notes")
async def list_notes(request: Request, head: Optional[str] = None, q: Optional[str] = None):
    user = await get_current_user(request)
    me = str(user["id"])
    query: dict = _visible(user)
    if head:
        if not _HEAD.match(head):
            raise HTTPException(status_code=400, detail="Unknown heading")
        query = {"$and": [query, {"head": head}]}
    words = " ".join(str(q or "").split())[:80]
    if words:
        rx = {"$regex": re.escape(words), "$options": "i"}
        query = {"$and": [query, {"$or": [{"title": rx}, {"body": rx}, {"head_label": rx}]}]}
    if not head and not words:
        raise HTTPException(status_code=400, detail="Pick a heading or search")
    notes = await db.folder_notes.find(query, {"_id": 0}).sort([("date", -1), ("updated_at", -1)]).to_list(300)
    out = [_out(n, me) for n in notes]
    # The Owner's notes for everyone first, then your own.
    out.sort(key=lambda n: (0 if n["shared"] and not n["mine"] else 1))
    return {"notes": out}


@router.post("/notes/photo")
async def note_photo(request: Request):
    """A photo for a planner note: saved and its URL returned; the note keeps
    the URL when the planner saves."""
    user = await get_current_user(request)
    if user.get("is_viewer"):
        raise HTTPException(status_code=403, detail="Read-only account")
    body = await request.json()
    image = (body or {}).get("image") if isinstance(body, dict) else None
    if not isinstance(image, str) or not image:
        raise HTTPException(status_code=400, detail="Send a photo")
    if len(image) > 12_000_000:
        raise HTTPException(status_code=400, detail="That photo is too big")
    from core import media_store
    try:
        url = await media_store.store_note_photo(str(user["id"]), image)
    except ValueError:
        raise HTTPException(status_code=400, detail="Couldn't read that photo. Try a JPEG or PNG.")
    except RuntimeError:
        raise HTTPException(status_code=502, detail="Couldn't save the photo right now. Try again.")
    return {"url": url}
