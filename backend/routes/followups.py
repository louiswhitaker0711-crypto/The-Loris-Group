"""Follow-ups (the Owner, 2 Nov 2026).

Writing in the weekly planner, anyone can "Set follow-up": what to follow up
and when (a date, a time if they want one). On that day it shows on that day's
page of their planner and on Home until it's ticked, and a notification goes
out at the time (09:00 when no time was set).

A follow-up is for you, or for you and someone else as well (a Coach can add
someone on their team; the Owner anyone in the office), so after a 1-to-1
both of you are reminded. Each person ticks their own copy.

Collection: followups
  { id, office_id, created_by_id, created_by_name, text, due_date, due_time,
    for_ids: [creator, (other)], for_names: {uid: name},
    source: {week_ending, day_index, key, title},
    done: {uid: iso}, pushed_at, created_at, updated_at }
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user, get_subtree_ids
from core.app_time import APP_TZ
from core.push import send_push_to_user
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_TEXT = 500
DEFAULT_TIME = "09:00"
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _now_uk() -> datetime:
    return datetime.now(APP_TZ)


def _first(n: str) -> str:
    return (n or "").strip().split(" ")[0] or "Someone"


def due_at(f: dict) -> str:
    """'YYYY-MM-DD HH:MM' the notification goes out (09:00 if no time)."""
    return f"{f.get('due_date')} {f.get('due_time') or DEFAULT_TIME}"


def _out(f: dict, me: str) -> dict:
    names = f.get("for_names") or {}
    others = [names.get(u) or "" for u in f.get("for_ids") or [] if u != me]
    return {
        "id": f["id"], "text": f.get("text") or "", "due_date": f.get("due_date"), "due_time": f.get("due_time") or "",
        "done": bool((f.get("done") or {}).get(me)),
        "mine": f.get("created_by_id") == me,
        "from_name": "" if f.get("created_by_id") == me else f.get("created_by_name") or "",
        "with_names": [n for n in others if n],
        "source": f.get("source") or {},
        "url": planner_url(f["due_date"]),
    }


async def _can_add(me: dict, uid: str) -> Optional[dict]:
    """The person this follow-up can also be for, or None."""
    if not ObjectId.is_valid(uid) or uid == str(me["id"]):
        return None
    u = await db.users.find_one({"_id": ObjectId(uid), "office_id": me.get("office_id"),
                                 "deleted": {"$ne": True}, "is_active": {"$ne": False}}, {"name": 1})
    if not u:
        return None
    if (me.get("role") or "") == "admin":
        return u
    return u if uid in set(await get_subtree_ids(me["id"])) else None


@router.get("/followups/people")
async def followup_people(request: Request):
    """Who you can add to a follow-up: your team (the Owner: the office)."""
    me = await get_current_user(request)
    q = {"office_id": me.get("office_id"), "deleted": {"$ne": True}, "is_active": {"$ne": False},
         "is_demo": {"$ne": True}, "role": {"$in": ["trainee", "leader", "admin"]}}
    if (me.get("role") or "") != "admin":
        ids = [ObjectId(i) for i in await get_subtree_ids(me["id"]) if ObjectId.is_valid(i)]
        q["_id"] = {"$in": ids}
    rows = [{"user_id": str(u["_id"]), "name": u.get("name") or ""}
            async for u in db.users.find(q, {"name": 1}) if str(u["_id"]) != str(me["id"])]
    rows.sort(key=lambda r: r["name"].lower())
    return {"people": rows}


class FollowUpBody(BaseModel):
    text: str
    due_date: str
    due_time: Optional[str] = ""
    also_user_id: Optional[str] = None
    source: Optional[dict] = None


def _clean_source(src: Optional[dict]) -> dict:
    s = src or {}
    out = {}
    if isinstance(s.get("week_ending"), str) and _DATE.match(s["week_ending"]):
        out["week_ending"] = s["week_ending"]
    if isinstance(s.get("day_index"), int) and 0 <= s["day_index"] <= 6:
        out["day_index"] = s["day_index"]
    for k in ("key", "title"):
        if isinstance(s.get(k), str):
            out[k] = s[k].strip()[:80]
    return out


@router.post("/followups")
async def create_followup(body: FollowUpBody, request: Request):
    me = await get_current_user(request)
    text = (body.text or "").strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(status_code=400, detail="Write what to follow up first")
    try:
        date.fromisoformat(body.due_date or "")
    except ValueError:
        raise HTTPException(status_code=400, detail="Pick a date")
    tm = (body.due_time or "").strip()
    if tm and not _TIME.match(tm):
        raise HTTPException(status_code=400, detail="Time must be HH:MM")
    if body.due_date < _now_uk().date().isoformat():
        raise HTTPException(status_code=400, detail="Pick today or a day after")
    me_id = str(me["id"])
    for_ids, names = [me_id], {me_id: me.get("name") or ""}
    if body.also_user_id:
        other = await _can_add(me, body.also_user_id)
        if not other:
            raise HTTPException(status_code=403, detail="You can add someone on your team")
        for_ids.append(str(other["_id"]))
        names[str(other["_id"])] = other.get("name") or ""
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "office_id": me.get("office_id"), "created_by_id": me_id,
        "created_by_name": me.get("name") or "", "text": text, "due_date": body.due_date, "due_time": tm,
        "for_ids": for_ids, "for_names": names, "source": _clean_source(body.source),
        "done": {}, "pushed_at": None, "created_at": now, "updated_at": now,
    }
    await db.followups.insert_one(dict(doc))
    return {"ok": True, "followup": _out(doc, me_id)}


@router.get("/followups")
async def list_followups(request: Request, date: Optional[str] = None, due: bool = False):  # noqa: A002
    """`date=`: the follow-ups on that day. `due=true`: today's and any
    earlier ones not yet ticked (Home). Otherwise: what's coming up."""
    me = await get_current_user(request)
    me_id = str(me["id"])
    today = _now_uk().date().isoformat()
    q: dict = {"for_ids": me_id}
    if date:
        if not _DATE.match(date):
            raise HTTPException(status_code=400, detail="Bad date")
        q["due_date"] = date
    elif due:
        q["due_date"] = {"$lte": today}
        q[f"done.{me_id}"] = {"$exists": False}
    else:
        q["due_date"] = {"$gte": today}
    rows = [f async for f in db.followups.find(q, {"_id": 0}).sort([("due_date", 1), ("due_time", 1)]).limit(200)]
    return {"today": today, "followups": [_out(f, me_id) for f in rows]}


class DoneBody(BaseModel):
    done: bool = True


@router.put("/followups/{fid}/done")
async def tick_followup(fid: str, body: DoneBody, request: Request):
    me = await get_current_user(request)
    me_id = str(me["id"])
    f = await db.followups.find_one({"id": fid, "for_ids": me_id})
    if not f:
        raise HTTPException(status_code=404, detail="That follow-up isn't yours")
    upd = ({"$set": {f"done.{me_id}": datetime.now(timezone.utc).isoformat()}} if body.done
           else {"$unset": {f"done.{me_id}": ""}})
    await db.followups.update_one({"id": fid}, upd)
    return {"ok": True}


@router.delete("/followups/{fid}")
async def delete_followup(fid: str, request: Request):
    me = await get_current_user(request)
    r = await db.followups.delete_one({"id": fid, "created_by_id": str(me["id"])})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Only whoever set it can delete it")
    return {"ok": True}


def push_text(f: dict, uid: str) -> tuple[str, str]:
    by = f.get("created_by_id")
    title = "Follow-up" if by == uid else f"Follow-up from {_first(f.get('created_by_name'))}"
    return title, (f.get("text") or "")[:180]


async def followup_push_tick(now: Optional[datetime] = None) -> int:
    """Send every follow-up whose time has come (once)."""
    now = now or _now_uk()
    stamp = now.strftime("%Y-%m-%d %H:%M")
    # Only look a day back: nothing older is sent late.
    since = (now.date() - timedelta(days=1)).isoformat()
    sent = 0
    async for f in db.followups.find({"pushed_at": None, "due_date": {"$gte": since, "$lte": now.date().isoformat()}}):
        if due_at(f) > stamp:
            continue
        await db.followups.update_one({"id": f["id"], "pushed_at": None}, {"$set": {"pushed_at": now.isoformat()}})
        for uid in f.get("for_ids") or []:
            if (f.get("done") or {}).get(uid):
                continue
            title, body = push_text(f, uid)
            url = planner_url(f["due_date"])
            try:
                await send_push_to_user(uid, title, body, {"type": "followup", "url": url, "followup_id": f["id"]})
                sent += 1
            except Exception as ex:  # best effort
                logger.warning("follow-up push failed: %s", ex)
    return sent


def planner_url(iso: str) -> str:
    """The due day's page of the weekly planner."""
    d = date.fromisoformat(iso)
    sunday = d + timedelta(days=6 - d.weekday())
    return f"/weekly-planner?week={sunday.isoformat()}&day={min(d.weekday(), 5)}"
