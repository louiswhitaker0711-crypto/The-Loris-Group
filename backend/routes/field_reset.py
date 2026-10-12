"""The 6pm reset (the Owner's idea, Oct 2026).

At 18:00 UK time, Monday to Friday, everyone out in the field gets a push:
reset for the last stretch. They answer three things in the app — how many
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
    return {
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


async def reset_push_tick() -> int:
    """18:00 UK, Monday to Friday: push everyone out in the field today. People
    marked not scheduled / no show / off sick for today on Bells are skipped."""
    from core.push import send_push_to_user
    now = datetime.now(APP_TZ)
    if now.weekday() > 4:  # Saturday's field ends at 17:00
        return 0
    d = now.date()
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    idx = d.weekday()
    away: set[str] = set()
    async for e in db.bells_entries.find({"week_ending": week_ending}, {"user_id": 1, "days": 1}):
        days = e.get("days") or []
        if idx < len(days) and (days[idx] or {}).get("status") in ("ab", "ns", "rt"):
            away.add(str(e.get("user_id")))
    sent = 0
    async for u in db.users.find({"role": {"$in": ["trainee", "leader"]}, "deleted": {"$ne": True},
                                  "is_active": {"$ne": False}, "is_demo": {"$ne": True}}, {"_id": 1}):
        uid = str(u["_id"])
        if uid in away:
            continue
        try:
            await send_push_to_user(
                uid, "🔄 6pm reset",
                "How many more are you going for, and what's your focus? Set it and share it with the team.",
                {"type": "field_reset", "url": "/field-reset"},
            )
            sent += 1
        except Exception as ex:
            logger.warning("6pm reset push failed for %s: %s", uid, ex)
    return sent

