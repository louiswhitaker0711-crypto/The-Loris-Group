"""Visitors: leaders from another office who come and work with the office for
a few days (the Owner, 15 Nov 2026).

A visitor is a user doc with `is_visitor: true` AND `is_demo: true`. The
`is_demo` flag is what already keeps someone off Bells, KPIs, the scorecard,
quality, bulletins, rosters and team lists everywhere in the app, so a
visitor's sign-ups never reach the office's figures. Unlike a trial account
a visitor can still save things (auth.demo_user_ids leaves them out of the
read-only guard): they fill in their own sector set-up and breakdown.

What they ARE in, on the days of their visit (`visit_from`..`visit_to`):
sectors, bunny hops and Primetime triangles, and their breakdown's sign-ups
count towards the sector's goal/hit. Stage 3 or above is a Coach (role
`leader`) and can grade a new start they lead on a hop; below Stage 3 they're
a BA and can't grade. After `visit_to` they drop off every picker and can't
sign in; past sectors, hops and grades keep them.
"""
from __future__ import annotations

from datetime import date as Date, datetime
from typing import Iterable, Optional

from core.app_time import APP_TZ
from database import db

COACH_STAGE = 3


def today_iso() -> str:
    return datetime.now(APP_TZ).date().isoformat()


def stage_number(stage) -> int:
    """'3', '3+', 'SL', '4' ... → a whole number; 0 when it isn't one."""
    s = str(stage or "").strip().upper()
    if s in ("SL", "3+"):
        return 3
    digits = "".join(ch for ch in s if ch.isdigit())
    return int(digits) if digits else 0


def role_for_stage(stage) -> str:
    return "leader" if stage_number(stage) >= COACH_STAGE else "trainee"


def on_visit(u: dict, iso: Optional[str] = None) -> bool:
    iso = iso or today_iso()
    return bool(u.get("is_visitor")) and (u.get("visit_from") or "") <= iso <= (u.get("visit_to") or "")


def visit_over(u: dict, iso: Optional[str] = None) -> bool:
    iso = iso or today_iso()
    return bool(u.get("is_visitor")) and bool(u.get("visit_to")) and u["visit_to"] < iso


def field_filter(iso: Optional[str] = None) -> dict:
    """Mongo filter for "can be placed in the field on this day": everyone the
    app normally counts (not a demo/viewer account), plus visitors whose visit
    covers the day. Replaces a bare `"is_demo": {"$ne": True}` in pickers."""
    iso = iso or today_iso()
    return {"$or": [{"is_demo": {"$ne": True}},
                    {"is_visitor": True, "visit_from": {"$lte": iso}, "visit_to": {"$gte": iso}}]}


def with_field_filter(q: dict, iso: Optional[str] = None) -> dict:
    """`q` with any `is_demo` condition swapped for field_filter (kept apart
    from any `$or` already in `q`)."""
    q = {k: v for k, v in q.items() if k != "is_demo"}
    extra = field_filter(iso)
    if "$or" in q:
        return {**{k: v for k, v in q.items() if k != "$or"}, "$and": [{"$or": q["$or"]}, extra]}
    return {**q, **extra}


async def visitor_ids(ids: Iterable[str], dbh=None) -> set[str]:
    from bson import ObjectId
    dbh = dbh if dbh is not None else db
    oids = [ObjectId(str(i)) for i in ids if ObjectId.is_valid(str(i))]
    if not oids:
        return set()
    return {str(u["_id"]) async for u in dbh.users.find({"_id": {"$in": oids}, "is_visitor": True}, {"_id": 1})}


async def visitor_day_numbers(ids: Iterable[str], iso: str, dbh=None) -> dict:
    """A visitor's sign-ups for a day come from their own sector breakdown,
    as they're never on Bells: {user_id: {hit, silver, gold, round}}."""
    dbh = dbh if dbh is not None else db
    vids = await visitor_ids(ids, dbh)
    if not vids:
        return {}
    out: dict = {}
    async for d in dbh.sector_days.find({"date": iso, "user_id": {"$in": list(vids)}}, {"_id": 0, "user_id": 1, "breakdown": 1}):
        bd = d.get("breakdown") or {}
        hit = bd.get("hit")
        if hit is None and (bd.get("silver") is not None or bd.get("gold") is not None):
            hit = int(bd.get("silver") or 0) + int(bd.get("gold") or 0)
        if hit is None:
            continue
        out[str(d["user_id"])] = {"hit": int(hit or 0), "silver": bd.get("silver"),
                                  "gold": bd.get("gold"), "round": bd.get("round")}
    return out


def clean_date(raw) -> Optional[str]:
    try:
        return Date.fromisoformat(str(raw or "")[:10]).isoformat()
    except ValueError:
        return None
