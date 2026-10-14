"""The 6pm reset (the Owner's idea, Oct 2026).

At 18:00 UK time, Monday to Friday, everyone out in the field gets a push:
reset for the last stretch. Anyone who hasn't done it gets a reminder every
10 minutes until they do (last one 19:50). They answer three things in the app — how many
more sign-ups they're going for, the number (KPI) they're focusing on, and a
general focus for the rest of the field — and can share it straight to the
team's WhatsApp group. Coaches and the Owner see their people's resets for
the day and can share them all in one message.

Collection `field_resets`, one per (user, date):
    {id, office_id, user_id, user_name, date, more_signups, kpi, focus,
     created_at, updated_at}
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, get_subtree_ids
from core.app_time import APP_TZ
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

KPI_OPTIONS = [
    "Doors", "Spoken to", "Pitched", "Closed", "Call backs",
    "Order value", "The Round", "Rehash & quality",
]
MAX_FOCUS = 200


def today_iso() -> str:
    return datetime.now(APP_TZ).date().isoformat()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_reset(body: dict) -> dict:
    """Validate the three answers."""
    try:
        more = int(body.get("more_signups"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="How many more sign-ups? Enter a number")
    if not 0 <= more <= 20:
        raise HTTPException(status_code=400, detail="More sign-ups must be between 0 and 20")
    kpi = str(body.get("kpi") or "").strip()
    if kpi not in KPI_OPTIONS:
        raise HTTPException(status_code=400, detail="Pick the number you're focusing on")
    focus = " ".join(str(body.get("focus") or "").split())[:MAX_FOCUS]
    return {"more_signups": more, "kpi": kpi, "focus": focus}


def first_name(name: str) -> str:
    return (name or "").strip().split(" ")[0] or "Someone"


def reset_line(r: dict) -> str:
    """One person's reset as a WhatsApp line."""
    more = int(r.get("more_signups") or 0)
    going = f"going for {more} more" if more else "holding the standard"
    line = f"• {first_name(r.get('user_name'))}: {going} · focus on {r.get('kpi')}"
    if r.get("focus"):
        line += f" · {r['focus']}"
    return line


def my_whatsapp_text(r: dict, date_label: str) -> str:
    more = int(r.get("more_signups") or 0)
    lines = [f"🔄 6pm reset · {date_label}", ""]
    lines.append(f"Going for {more} more sign-up{'s' if more != 1 else ''}" if more else "Holding the standard")
    lines.append(f"Number I'm focusing on: {r.get('kpi')}")
    if r.get("focus"):
        lines.append(f"Focus: {r['focus']}")
    lines += ["", "Tomorrow is a new day, but tonight isn't over 💪"]
    return "\n".join(lines)


def team_whatsapp_text(rows: list, date_label: str) -> str:
    total = sum(int(r.get("more_signups") or 0) for r in rows)
    lines = [f"🔄 6pm reset · {date_label}", f"Going for {total} more as a team", ""]
    lines += [reset_line(r) for r in sorted(rows, key=lambda x: (x.get("user_name") or "").lower())]
    return "\n".join(lines)


def date_label(iso: str) -> str:
    d = datetime.fromisoformat(iso).date()
    return d.strftime("%a %-d %b")


@router.get("/field-reset/today")
async def get_my_reset(request: Request):
    user = await get_current_user(request)
    d = today_iso()
    doc = await db.field_resets.find_one({"user_id": str(user["id"]), "date": d}, {"_id": 0})
    from routes.sector import my_setup
    return {
        "setup": await my_setup(str(user["id"]), d),
        "date": d,
        "kpi_options": KPI_OPTIONS,
        "reset": doc,
        "whatsapp_text": my_whatsapp_text(doc, date_label(d)) if doc else None,
    }


@router.put("/field-reset/today")
async def save_my_reset(request: Request):
    user = await get_current_user(request)
    vals = clean_reset(await request.json())
    d = today_iso()
    key = {"user_id": str(user["id"]), "date": d}
    now = _now()
    await db.field_resets.update_one(key, {
        "$set": {**vals, "office_id": user.get("office_id"), "user_name": user.get("name") or "", "updated_at": now},
        "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now},
    }, upsert=True)
    doc = await db.field_resets.find_one(key, {"_id": 0})
    return {"reset": doc, "whatsapp_text": my_whatsapp_text(doc, date_label(d))}


@router.get("/field-reset/team")
async def team_resets(request: Request, date: Optional[str] = None):
    """Coaches see their team's resets; Admins see the office's."""
    user = await get_current_user(request)
    role = (user.get("role") or "").lower()
    if role not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coach or admin access required")
    d = (date or today_iso())[:10]
    q: dict = {"date": d, "office_id": user.get("office_id")}
    if role == "leader" and not user.get("is_super_admin"):
        q["user_id"] = {"$in": list(await get_subtree_ids(str(user["id"])))}
    rows = [r async for r in db.field_resets.find(q, {"_id": 0}).sort("user_name", 1)]
    return {"date": d, "resets": rows,
            "whatsapp_text": team_whatsapp_text(rows, date_label(d)) if rows else None}


REMIND_UNTIL = (19, 50)   # last reminder before the field ends at 20:00


def in_reset_window(now: datetime) -> bool:
    """Monday to Friday, 18:00 until the field ends at 20:00."""
    return now.weekday() <= 4 and (18, 0) <= (now.hour, now.minute) < (20, 0)


def done_names_text(names: list[str]) -> str:
    """'Sam', 'Sam and Ayo', 'Sam, Ayo and Jo', 'Sam, Ayo and 3 others'."""
    names = [first_name(n) for n in names]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) <= 3:
        return ", ".join(names[:-1]) + " and " + names[-1]
    return f"{names[0]}, {names[1]} and {len(names) - 2} others"


def reminder_text(done_names: list[str]) -> tuple[str, str]:
    """The reminder after the first push, naming who's already done it."""
    who = done_names_text(done_names)
    if not who:
        return ("🔄 Your reset's still to do",
                "Take a minute: how many more, your number and your focus. This keeps coming until it's done.")
    did = "has" if len(done_names) == 1 else "have"
    return (f"🔄 {who} {did} done their 6pm reset", "Do yours: how many more, your number and your focus.")


@router.get("/field-reset/board")
async def reset_board(request: Request):
    """For Home from 18:00: everyone in the office who's done their reset
    and what they're going for, and who's still to do it."""
    from bson import ObjectId
    user = await get_current_user(request)
    now = datetime.now(APP_TZ)
    d = now.date()
    office = user.get("office_id")
    rows = [r async for r in db.field_resets.find({"date": d.isoformat(), "office_id": office}, {"_id": 0})]
    rows.sort(key=lambda r: r.get("updated_at") or "")
    done_ids = {r["user_id"] for r in rows}
    todo = []
    if in_reset_window(now):
        ids = [ObjectId(i) for i in await out_today(d) - done_ids if ObjectId.is_valid(i)]
        async for u in db.users.find({"_id": {"$in": ids}, "office_id": office, "deleted": {"$ne": True},
                                      "is_active": {"$ne": False}, "is_demo": {"$ne": True}}, {"name": 1}):
            todo.append({"user_id": str(u["_id"]), "name": u.get("name") or ""})
        todo.sort(key=lambda x: x["name"].lower())
    return {"date": d.isoformat(), "window": in_reset_window(now),
            "mine_done": str(user["id"]) in done_ids,
            "total_more": sum(int(r.get("more_signups") or 0) for r in rows),
            "done": [{"user_id": r["user_id"], "name": r.get("user_name") or "", "more": int(r.get("more_signups") or 0),
                      "kpi": r.get("kpi") or "", "focus": r.get("focus") or ""} for r in rows],
            "todo": todo}


async def out_today(d) -> set[str]:
    """Who's out in the field today: Coaches and BAs not marked away on Bells,
    anyone (Admins and the Owner included) Bells has in today, plus anyone
    with real signs of being out:
    a set-up, a sector, or doors on Field IQ today. Those signs beat Bells,
    so going out when you weren't scheduled still counts."""
    iso = d.isoformat()
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    idx = d.weekday()
    away: set[str] = set()
    out: set[str] = set()
    async for e in db.bells_entries.find({"week_ending": week_ending}, {"user_id": 1, "days": 1}):
        days = e.get("days") or []
        st = (days[idx] or {}).get("status") if idx < len(days) else None
        if st in ("ab", "ns", "rt", "pc"):
            away.add(str(e.get("user_id")))
        elif st == "in":
            out.add(str(e.get("user_id")))   # an Admin who's in the field today too
    async for u in db.users.find({"role": {"$in": ["trainee", "leader"]}, "deleted": {"$ne": True},
                                  "is_active": {"$ne": False}, "is_demo": {"$ne": True}}, {"_id": 1}):
        if str(u["_id"]) not in away:
            out.add(str(u["_id"]))
    async for x in db.sector_days.find({"date": iso, "setup": {"$ne": None}}, {"user_id": 1}):
        out.add(str(x["user_id"]))
    async for sec in db.sectors.find({"date": iso}, {"leader_id": 1, "member_ids": 1}):
        out.add(str(sec.get("leader_id")))
        out.update(str(m) for m in sec.get("member_ids") or [])
    async for r in db.owneriq_kpis.find({"date": iso, "cg1_user_id": {"$nin": [None, ""]}, "test_mode": {"$ne": True},
                                        "cg1_matched_by": {"$ne": "name"}}, {"cg1_user_id": 1, "doors_knocked": 1}):
        if int(r.get("doors_knocked") or 0) > 0:
            out.add(str(r["cg1_user_id"]))
    out.discard("None")
    return out


async def reset_push_tick() -> int:
    """From 18:00 UK, Monday to Friday, every 10 minutes until 19:50: push
    everyone out in the field today who hasn't done their reset yet. The
    first is the 6pm reset; after that it's a reminder until they do it."""
    from bson import ObjectId
    from core.push import send_push_to_user
    now = datetime.now(APP_TZ)
    if now.weekday() > 4:  # Saturday's field ends at 17:00
        return 0
    if (now.hour, now.minute) < (18, 0) or (now.hour, now.minute) > REMIND_UNTIL:
        return 0
    d = now.date()
    targets = await out_today(d)
    done_rows = [r async for r in db.field_resets.find({"date": d.isoformat()}, {"user_id": 1, "user_name": 1, "office_id": 1, "updated_at": 1})]
    done_rows.sort(key=lambda r: r.get("updated_at") or "")
    done = {r["user_id"] for r in done_rows}
    first = now.hour == 18 and now.minute < 10
    sent = 0
    for uid in targets - done:
        try:
            u = await db.users.find_one({"_id": ObjectId(uid)}, {"deleted": 1, "is_active": 1, "is_demo": 1, "office_id": 1})
        except Exception:
            u = None
        if not u or u.get("deleted") or u.get("is_active") is False or u.get("is_demo"):
            continue
        if first:
            title, body = ("🔄 6pm reset",
                           "How many more are you going for, and what's your focus? Set it and share it with the team.")
        else:
            title, body = reminder_text([r.get("user_name") or "" for r in done_rows
                                         if r.get("office_id") == u.get("office_id")])
        try:
            await send_push_to_user(uid, title, body, {"type": "field_reset", "url": "/field-reset"})
            sent += 1
        except Exception as ex:
            logger.warning("6pm reset push failed for %s: %s", uid, ex)
    return sent

