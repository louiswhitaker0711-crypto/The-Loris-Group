"""Breakeven pushes (the Owner, 29 Oct 2026).

1. Breakeven hit: the moment someone's sign-ups this week (their Bells row)
   reach their breakeven, they get a push, and so does their own Coach (the
   nearest Coach or Admin above them). Once per person per week: the
   `breakeven_hits` collection remembers (person, week ending).

2. New month: on the 1st, everyone gets one push to update their breakeven
   in the Monthly Goal Planner (`breakeven_months` remembers the month, so a
   restart can't send it twice).

Breakeven is the BE on their Bells row when it's typed there, otherwise the
one worked out from their Plan your earnings (core/earnings_plan.py), the
same rule Bells uses.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId

from core.app_time import APP_TZ
from core.earnings_plan import compute

logger = logging.getLogger(__name__)


def week_ending(today: date) -> str:
    """The Sunday that ends today's Bells week."""
    return (today + timedelta(days=6 - today.weekday())).isoformat()


def week_total(entry: dict) -> int:
    """Sign-ups on a Bells row: Silver + Gold, day by day."""
    return sum(int((d or {}).get("over30") or 0) + int((d or {}).get("under30") or 0)
               for d in (entry.get("days") or [])[:7])


def breakeven_for(entry: dict, plan: Optional[dict], fees: Optional[dict]) -> Optional[int]:
    typed = entry.get("break_even")
    if isinstance(typed, (int, float)) and typed > 0:
        return int(typed)
    if plan:
        be = compute(plan, fees).get("breakeven")
        return int(be) if be else None
    return None


def hit(total: int, be: Optional[int]) -> bool:
    return bool(be) and total >= int(be)


async def run_hits(database, now_uk: Optional[datetime] = None, send=None) -> list[dict]:
    if send is None:
        from core.push import send_push_to_user as send
    from core.zero_alerts import upline_coach_ids

    now_uk = now_uk or datetime.now(APP_TZ)
    week = week_ending(now_uk.date())
    fees_by_office: dict = {}
    sent: list[dict] = []
    async for e in database.bells_entries.find(
            {"week_ending": week, "user_id": {"$nin": [None, ""]}},
            {"_id": 0, "user_id": 1, "days": 1, "break_even": 1, "office_id": 1}):
        uid = str(e["user_id"])
        total = week_total(e)
        if total <= 0:
            continue
        try:
            person = await database.users.find_one({"_id": ObjectId(uid)})
        except Exception:
            person = None
        if not person or person.get("deleted") or person.get("is_active") is False or person.get("is_demo"):
            continue
        office_id = person.get("office_id")
        if office_id not in fees_by_office:
            fees_by_office[office_id] = (await database.commission_fees.find_one({"office_id": office_id}, {"_id": 0})
                                         or await database.commission_fees.find_one({}, {"_id": 0}))
        be = breakeven_for(e, person.get("earnings_plan"), fees_by_office[office_id])
        if not hit(total, be):
            continue
        claim = await database.breakeven_hits.update_one(
            {"_id": f"{uid}:{week}"},
            {"$setOnInsert": {"user_id": uid, "week_ending": week, "breakeven": be, "total": total,
                              "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True)
        if not getattr(claim, "upserted_id", None):
            continue
        name = person.get("name") or "Someone"
        first = name.split(" ")[0]
        try:
            await send(uid, "You've hit your breakeven",
                       f"{total} sign-ups this week against a breakeven of {be}. Everything from here is yours.",
                       {"type": "breakeven_hit", "url": "/ba-week"})
        except Exception as ex:
            logger.warning("breakeven push to %s failed: %s", uid, ex)
        coaches = await upline_coach_ids(database, person)
        if coaches:
            try:
                await send(coaches[0], f"{first} hit their breakeven",
                           f"{name} has {total} sign-ups this week against a breakeven of {be}.",
                           {"type": "breakeven_hit", "url": f"/person/{uid}", "person_id": uid})
            except Exception as ex:
                logger.warning("breakeven push to coach %s failed: %s", coaches[0], ex)
        sent.append({"user_id": uid, "week_ending": week, "breakeven": be, "total": total})
    return sent


async def run_month(database, now_uk: Optional[datetime] = None, send=None) -> int:
    """The 1st of the month: everyone updates their breakeven."""
    if send is None:
        from core.push import send_push_to_user as send
    now_uk = now_uk or datetime.now(APP_TZ)
    month = now_uk.strftime("%Y-%m")
    claim = await database.breakeven_months.update_one(
        {"_id": month}, {"$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    if not getattr(claim, "upserted_id", None):
        return 0
    n = 0
    async for u in database.users.find(
            {"deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_demo": {"$ne": True}, "is_viewer": {"$ne": True}},
            {"_id": 1}):
        try:
            await send(str(u["_id"]), "New month: check your breakeven",
                       "Last month's is filled in on your Monthly Goal Planner. Review it and change anything that's moved.",
                       {"type": "breakeven_month", "url": "/monthly-planner"})
            n += 1
        except Exception as ex:
            logger.warning("monthly breakeven push to %s failed: %s", u["_id"], ex)
    return n
