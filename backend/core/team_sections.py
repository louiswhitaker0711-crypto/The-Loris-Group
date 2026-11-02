"""Who has their own team (the Owner, 2 Nov 2026).

Anyone, BA or Coach, gets their own team section the moment someone reports
to them (`reports_to`, any role). They keep it for 4 weeks after the last
person leaves their team, then fold back into the team above.

How the 4 weeks are tracked: whenever a team is worked out and someone has at
least one active report, `users.team_last_member_on` is stamped with today's
UK date. Someone with no active reports still counts as a team while that
stamp is less than GRACE_DAYS old.

Teams still roll up: a team inside another team counts in both (Next Gen in
Rockodia), because every screen walks the `reports_to` chain.

A team with no name set shows as "<first name>'s team" (`display_team_name`).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from core.app_time import APP_TZ

GRACE_DAYS = 28


def today_iso() -> str:
    return datetime.now(APP_TZ).date().isoformat()


def display_team_name(user: Optional[dict]) -> str:
    """The team's name, or "<first name>'s team" when none is set."""
    u = user or {}
    name = (u.get("team_name") or "").strip()
    if name:
        return name
    first = (u.get("name") or "").strip().split(" ")[0]
    return f"{first}'s team" if first else "Team"


def within_grace(stamp: Optional[str], today: Optional[str] = None) -> bool:
    """True while the last day this person had someone on their team is less
    than GRACE_DAYS ago."""
    if not stamp:
        return False
    try:
        last = date.fromisoformat(str(stamp)[:10])
        now = date.fromisoformat(today or today_iso())
    except ValueError:
        return False
    return timedelta(0) <= (now - last) < timedelta(days=GRACE_DAYS)


def has_team(user: Optional[dict], active_report_count: int, today: Optional[str] = None) -> bool:
    """Someone leads a team if anyone reports to them now, or did within the
    last 4 weeks."""
    if not user:
        return False
    if active_report_count > 0:
        return True
    return within_grace(user.get("team_last_member_on"), today)


ACTIVE = {"is_active": {"$ne": False}, "deleted": {"$ne": True}}


async def stamp_team_leaders(db, leader_ids: Iterable[str]) -> None:
    """Record today as a day these people had someone on their team."""
    from bson import ObjectId
    ids = [ObjectId(x) for x in {str(i) for i in leader_ids} if ObjectId.is_valid(x)]
    if not ids:
        return
    today = today_iso()
    try:
        await db.users.update_many(
            {"_id": {"$in": ids}, "team_last_member_on": {"$ne": today}},
            {"$set": {"team_last_member_on": today}},
        )
    except Exception:
        # Best effort: a missed stamp only shortens the grace by a day.
        pass


async def user_has_team(db, user: dict) -> bool:
    """For one person (Profile): do they lead a team right now?"""
    uid = str(user.get("_id") or user.get("id") or "")
    if not uid:
        return False
    n = await db.users.count_documents({"reports_to": uid, **ACTIVE})
    if n > 0:
        await stamp_team_leaders(db, [uid])
    return has_team(user, n)


async def hand_on_team(db, exited: dict, fallback_id: Optional[str], on: Optional[str] = None) -> dict:
    """When someone exits, their people move up a level (the Owner, 2 Nov 2026).

    Everyone who reported to them now reports to the person above them; if
    there's nobody above (or that person has gone), to `fallback_id` (the
    Admin doing the exit). Sub-teams move whole: only direct reports change,
    so a sub-leader keeps their own people. Their Coach-of-record on new-start
    records moves the same way. The exited person's team section goes
    straight away (no 4-week grace). No notifications.

    Returns {"to": <new coach id or None>, "moved": <number of people>}.
    """
    from bson import ObjectId
    uid = str(exited.get("_id") or "")
    office = exited.get("office_id")
    if not uid:
        return {"to": None, "moved": 0}

    async def _active(pid: Optional[str]) -> Optional[dict]:
        if not pid or not ObjectId.is_valid(str(pid)) or str(pid) == uid:
            return None
        u = await db.users.find_one({"_id": ObjectId(str(pid)), **ACTIVE})
        if not u or (office and u.get("office_id") not in (office, None)):
            return None
        return u

    heir = await _active(exited.get("reports_to")) or await _active(fallback_id)
    heir_id = str(heir["_id"]) if heir else None
    heir_name = (heir or {}).get("name") or "Unassigned"

    q = {"reports_to": uid}
    if office:
        q["office_id"] = office
    from core.team_history import record_move
    moved = await db.users.count_documents({**q, **ACTIVE})
    # Log each move (dated the exit day) so past weeks keep the old team.
    async for r in db.users.find(q, {"_id": 1}):
        to = heir_id if heir_id and str(r["_id"]) != heir_id else None
        await record_move(db, str(r["_id"]), office, uid, to, why="exit", on=on)
    if heir_id:
        # Never make someone their own Coach (the heir was on the exited person's team).
        await db.users.update_many({**q, "_id": {"$ne": ObjectId(heir_id)}},
                                   {"$set": {"reports_to": heir_id}})
        await db.users.update_one({**q, "_id": ObjectId(heir_id)}, {"$unset": {"reports_to": ""}})
    else:
        await db.users.update_many(q, {"$unset": {"reports_to": ""}})

    # New-start records: by id, and legacy ones that only carry the name.
    hire_set = {"leader": heir_name, "leader_user_id": heir_id}
    await db.new_hires.update_many({"leader_user_id": uid}, {"$set": hire_set})
    name = (exited.get("name") or "").strip()
    if name and office:
        await db.new_hires.update_many(
            {"leader": name, "office_id": office,
             "$or": [{"leader_user_id": None}, {"leader_user_id": {"$exists": False}}]},
            {"$set": hire_set})

    # Their own section goes now, not in 4 weeks.
    await db.users.update_one({"_id": exited["_id"]}, {"$unset": {"team_last_member_on": ""}})
    if heir_id and moved:
        await stamp_team_leaders(db, [heir_id])
    return {"to": heir_id, "moved": moved}
