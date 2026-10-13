"""Quality retrain alert: fails 20%+ two weeks running → "Retrain needed".

When a week's quality report is saved, anyone whose fail rate was FAIL_ALERT
or more in that week AND the week before (both with MIN_SIGNUPS sign-ups or
more) is flagged once to the Owner (office Admins) and every Coach above
them, the same people as the two-zeroes alert (core/zero_alerts.py).

Only a current report alerts (a week ending within RECENT_DAYS of today), so
loading old weeks never sends anything. The `quality_alerts` collection
remembers (person, week) so each run alerts once.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from core.quality import signups

logger = logging.getLogger(__name__)

FAIL_ALERT = 20.0      # % fails
MIN_SIGNUPS = 3        # too few sign-ups to judge below this
RECENT_DAYS = 15       # a week ending older than this is back-filling


def is_current(week_ending: str, today: date) -> bool:
    try:
        return (today - date.fromisoformat(week_ending)).days <= RECENT_DAYS
    except ValueError:
        return False


def _high(m: dict | None) -> bool:
    m = m or {}
    f, g = m.get("fail_rate"), signups(m)
    return f is not None and g is not None and f >= FAIL_ALERT and g >= MIN_SIGNUPS


def fail_runs(this_bas: list[dict], prev_bas: list[dict]) -> list[dict]:
    """People (linked to the app) with high fails in both weeks."""
    prev = {b.get("user_id"): b.get("metrics") or {} for b in prev_bas if b.get("user_id")}
    out = []
    for b in this_bas:
        uid = b.get("user_id")
        if uid and _high(b.get("metrics")) and _high(prev.get(uid)):
            out.append({"user_id": uid, "now": b["metrics"]["fail_rate"], "before": prev[uid]["fail_rate"]})
    return out


async def run(database, office_id: str, week: str, today: date, send=None) -> list[dict]:
    """Check a just-saved week against the week before it."""
    if not is_current(week, today):
        return []
    from bson import ObjectId
    if send is None:
        from core.push import send_push_to_user as send
    from core.admin_scope import office_level_admin_ids
    from core.zero_alerts import upline_coach_ids

    this = await database.quality_weeks.find_one({"office_id": office_id, "week_ending": week}, {"bas": 1})
    prev_week = (date.fromisoformat(week) - timedelta(days=7)).isoformat()
    prev = await database.quality_weeks.find_one({"office_id": office_id, "week_ending": prev_week}, {"bas": 1})
    if not this or not prev:
        return []
    admins = [str(a["_id"]) for a in await office_level_admin_ids(office_id, database=database)]
    sent = []
    for r in fail_runs(this.get("bas") or [], prev.get("bas") or []):
        uid = r["user_id"]
        try:
            person = await database.users.find_one({"_id": ObjectId(uid)})
        except Exception:
            person = None
        if not person or person.get("deleted") or person.get("is_active") is False or person.get("is_demo"):
            continue
        claim = await database.quality_alerts.update_one(
            {"_id": f"{uid}:{week}"},
            {"$setOnInsert": {"user_id": uid, "week": week, "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True)
        if not getattr(claim, "upserted_id", None):
            continue
        to = [t for t in dict.fromkeys(admins + await upline_coach_ids(database, person)) if t != uid]
        name = person.get("name") or "Someone"
        title = f"Retrain needed: {name}"
        body = (f"{name}'s fails were {r['before']:g}% then {r['now']:g}% in the last two quality reports "
                f"(target under 10%). Go over who not to sign up and the close.")
        data = {"type": "zero_days", "url": f"/person/{uid}", "person_id": uid}
        for target in to:
            try:
                await send(target, title, body, data)
            except Exception as ex:
                logger.warning("quality alert to %s failed: %s", target, ex)
        sent.append({"user_id": uid, "name": name, "to": to})
    return sent
