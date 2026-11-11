"""Planner notes safety net (the Owner, 3 Nov 2026: a BA lost her notes).

Every planner save used to overwrite the whole week from whatever the phone
had in memory, so a stale copy (the planner left open in another tab, or a
note added from Notes while the planner was open) could wipe newer notes,
and nothing kept the old text. Now:

- ``merge_slot_notes``: a save never drops a slot note the phone didn't know
  about. A note only goes when the phone says it removed it.
- ``snapshot``: before a save takes anything away (or every few minutes while
  typing), the week as it was goes into ``planner_history``.
- ``removed_notes``: what history holds that the planner no longer does, so
  the person (or the Owner for them) can put it back from Notes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from database import db

KEEP_PER_WEEK = 80          # snapshots kept per person per week
EVERY = timedelta(minutes=5)  # a plain save snapshots at most this often
KEEP_FOR = timedelta(days=30)  # Recently removed keeps a note this long, then it's gone (the Owner, 11 Nov 2026)
TEXT_FIELDS_SKIP = ("_cod",)  # COD picks aren't note text


def _now() -> datetime:
    return datetime.now(timezone.utc)


def merge_slot_notes(server: dict | None, client: dict, removed_ids) -> dict:
    """Client's notes win, plus any note the server has that the client
    neither sent nor said it removed (added elsewhere since it loaded)."""
    removed = {str(i) for i in (removed_ids or []) if i}
    out = {k: list(v) for k, v in (client or {}).items()}
    sent = {str(n.get("id")) for v in out.values() for n in v if isinstance(n, dict)}
    for k, notes in (server or {}).items():
        for n in notes or []:
            nid = str((n or {}).get("id") or "")
            if nid and nid not in sent and nid not in removed:
                out.setdefault(k, []).append(n)
    return out


def _texts(doc: dict) -> dict:
    """Every piece of note text in a planner week, keyed by where it lives."""
    out: dict = {}
    for d, day in (doc.get("days") or {}).items():
        for box, v in (day or {}).items():
            if isinstance(v, str) and v.strip() and not box.endswith(TEXT_FIELDS_SKIP):
                out[f"box:{d}:{box}"] = v
    if (doc.get("notes") or "").strip():
        out["extra"] = doc["notes"]
    for k, notes in (doc.get("slot_notes") or {}).items():
        for n in notes or []:
            if isinstance(n, dict) and n.get("id"):
                out[f"note:{k}:{n['id']}"] = n
    return out


def loses_anything(before: dict, after: dict) -> bool:
    """True when the save removes a note or shortens/changes away text."""
    a, b = _texts(before), _texts(after)
    for key, old in a.items():
        new = b.get(key)
        if new is None:
            return True
        if isinstance(old, str) and isinstance(new, str) and len(new.strip()) < len(old.strip()):
            return True
        if isinstance(old, dict) and isinstance(new, dict) and len((new.get("body") or "").strip()) < len((old.get("body") or "").strip()):
            return True
    return False


async def snapshot(existing: dict, after: dict | None = None, reason: str = "save") -> None:
    """Keep the week as it was before this change. Never fails a save."""
    try:
        if not existing or not _texts(existing):
            return
        uid, week = str(existing.get("user_id") or ""), existing.get("week_ending") or ""
        losing = after is not None and loses_anything(existing, after)
        if not losing:
            last = await db.planner_history.find_one({"user_id": uid, "week_ending": week}, sort=[("at", -1)])
            if last and last.get("at") and datetime.fromisoformat(last["at"]) > _now() - EVERY:
                return
        await db.planner_history.insert_one({
            "id": uuid.uuid4().hex, "user_id": uid, "office_id": existing.get("office_id") or "",
            "week_ending": week, "at": _now().isoformat(), "reason": reason, "losing": losing,
            "days": existing.get("days") or {}, "notes": existing.get("notes") or "",
            "slot_notes": existing.get("slot_notes") or {}, "folder": existing.get("folder") or {},
        })
        old = [h["_id"] async for h in db.planner_history.find(
            {"user_id": uid, "week_ending": week}, {"_id": 1}).sort("at", -1).skip(KEEP_PER_WEEK)]
        if old:
            await db.planner_history.delete_many({"_id": {"$in": old}})
    except Exception as ex:  # noqa: BLE001
        print(f"[notes-safety] snapshot failed: {ex}")


async def removed_notes(user_id: str, weeks_back: int = 8) -> list[dict]:
    """Note text that was in a past version of a planner week but isn't now.
    Newest first; the latest version of each removed item only. History older
    than 30 days is cleared out, so a removed note is gone after that."""
    cutoff = (_now() - KEEP_FOR).isoformat()
    try:
        await db.planner_history.delete_many({"user_id": user_id, "at": {"$lt": cutoff}})
    except Exception as ex:  # noqa: BLE001
        print(f"[notes-safety] purge failed: {ex}")
    since = (_now() - timedelta(weeks=weeks_back)).date().isoformat()
    current: dict = {}
    async for p in db.weekly_planners.find({"user_id": user_id, "week_ending": {"$gte": since}}, {"_id": 0}):
        current[p["week_ending"]] = _texts(p)
    seen: set = set()
    out: list = []
    async for h in db.planner_history.find({"user_id": user_id, "week_ending": {"$gte": since}, "at": {"$gte": cutoff}},
                                           {"_id": 0}).sort("at", -1):
        week = h["week_ending"]
        now_t = current.get(week, {})
        for key, old in _texts(h).items():
            if (week, key) in seen:
                continue
            new = now_t.get(key)
            if isinstance(old, dict):
                body, title = old.get("body") or "", old.get("title") or ""
                gone = new is None or (body.strip() and body.strip() not in ((new or {}).get("body") or ""))
            else:
                body, title = old, ""
                gone = new is None or old.strip() not in (new or "")
            if not gone or not (body.strip() or title):
                continue
            seen.add((week, key))
            out.append({"history_id": h["id"], "week_ending": week, "key": key, "at": h["at"],
                        "title": title, "body": body, "photos": (old.get("photos") if isinstance(old, dict) else []) or []})
    return out[:100]


async def restore(user_id: str, history_id: str, key: str) -> dict | None:
    """Put one removed item back into its planner week. Text boxes that have
    something in them now get the old text added underneath, never replaced."""
    h = await db.planner_history.find_one({"id": history_id, "user_id": user_id}, {"_id": 0})
    if not h:
        return None
    old = _texts(h).get(key)
    if old is None:
        return None
    p = await db.weekly_planners.find_one({"user_id": user_id, "week_ending": h["week_ending"]})
    if not p:
        return None
    await snapshot(p, None, reason="restore")
    upd: dict = {}
    if key.startswith("note:"):
        _, d, box, nid = key.split(":", 3)
        slot = f"{d}:{box}"
        slot_notes = {k: list(v) for k, v in (p.get("slot_notes") or {}).items()}
        notes = slot_notes.setdefault(slot, [])
        i = next((j for j, n in enumerate(notes) if n.get("id") == nid), None)
        if i is None:
            notes.append(old)
        else:
            cur = notes[i].get("body") or ""
            notes[i] = {**notes[i], "body": f"{cur}\n\n{old.get('body') or ''}".strip() if cur.strip() else old.get("body") or ""}
        upd["slot_notes"] = slot_notes
    elif key == "extra":
        cur = p.get("notes") or ""
        upd["notes"] = f"{cur}\n\n{old}".strip() if cur.strip() else old
    else:
        _, d, box = key.split(":", 2)
        days = dict(p.get("days") or {})
        day = dict(days.get(d) or {})
        cur = day.get(box) or ""
        day[box] = f"{cur}\n\n{old}".strip() if cur.strip() else old
        days[d] = day
        upd["days"] = days
    upd["updated_at"] = _now().isoformat()
    await db.weekly_planners.update_one({"_id": p["_id"]}, {"$set": upd})
    p.update(upd)
    p.pop("_id", None)
    return p
