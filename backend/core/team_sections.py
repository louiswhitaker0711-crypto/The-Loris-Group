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
