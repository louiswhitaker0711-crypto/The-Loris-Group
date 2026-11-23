"""The COD 2 calendar: COD 2 taught day by day straight after the evaluation.

The Owner, 23 Nov 2026: the six field days ARE COD 1 (the evaluation signs
it off); from the next day the COD isn't dropped, it's the curriculum. Stage
2 is taught one topic a day, two when they sit together, so a good BA can
be ready for Stage 3 about three weeks from their first day. The plan is
the same for everyone and can be watched for everyone: what's on today,
what's been taught (the item at Know or above), and who's behind (a past
day whose items aren't at Know yet). If someone isn't learning fast enough,
their Coach restarts it from a later date.

Days are field days, Monday to Saturday (no Sundays).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from core.cod_ticks import norm, office_modules

# Day by day, related items together. "The 8 Steps" gets two days.
PLAN: list[list[str]] = [
    ["Close Variations", "Improved Question Handling"],
    ["Rehash & Consolidation", "Territory Awareness & Adaptability"],
    ["Daily Inputs & Weekly Outputs", "Using Numbers to Self-Coach"],
    ["Clean Data You Can Trust", "Personal Planning"],
    ["Profitability"],
    ["Student Mentality", "Problem-Solving Mindset"],
    ["The 8 Steps"],
    ["The 8 Steps"],
    ["GRASP"],
    ["Leading by Example", "Assuming the Role"],
    ["Stage 2 — The Self Management Standard"],
]


def field_days_from(start: date, n: int) -> list[date]:
    """n field days from `start` (itself included if it's one), skipping Sundays."""
    out, d = [], start
    while len(out) < n:
        if d.weekday() != 6:
            out.append(d)
        d += timedelta(days=1)
    return out


def next_field_day(after: date) -> date:
    d = after + timedelta(days=1)
    while d.weekday() == 6:
        d += timedelta(days=1)
    return d


def build_days(start: date, modules: list[dict]) -> list[dict]:
    """The plan laid on the calendar from `start`, matched to the office's COD 2 items.
    An item the office doesn't have is left out (a day left with nothing is skipped)."""
    by_name = {norm(m.get("topic")): m for m in modules if int(m.get("stage") or 0) == 2}
    seen: dict = {}
    days: list[list[dict]] = []
    for names in PLAN:
        items = []
        for n in names:
            m = by_name.get(norm(n))
            if not m:
                continue
            seen[m["id"]] = seen.get(m["id"], 0) + 1
            items.append({"module_id": m["id"], "topic": m.get("topic") or n,
                          "part": seen[m["id"]] if PLAN_COUNT.get(norm(n), 1) > 1 else None})
        if items:
            days.append(items)
    dates = field_days_from(start, len(days))
    return [{"date": d.isoformat(), "items": items} for d, items in zip(dates, days)]


PLAN_COUNT: dict = {}
for _names in PLAN:
    for _n in _names:
        PLAN_COUNT[norm(_n)] = PLAN_COUNT.get(norm(_n), 0) + 1


def status(cal: dict, ladder: dict, today: str) -> dict:
    """Each day with whether it's been taught (every item at Know or above),
    plus today's items, how many are done, and how many past days are behind."""
    days = []
    behind = done = 0
    today_items: list = []
    for i, d in enumerate(cal.get("days") or []):
        taught = all(int(ladder.get(it["module_id"]) or 0) >= 1 for it in d["items"])
        late = d["date"] < today and not taught
        behind += int(late)
        done += int(taught)
        if d["date"] == today:
            today_items = d["items"]
        days.append({**d, "day": i + 1, "taught": taught, "behind": late, "is_today": d["date"] == today,
                     "items": [{**it, "ladder": int(ladder.get(it["module_id"]) or 0)} for it in d["items"]]})
    total = len(days)
    current = next((x["day"] for x in days if x["date"] >= today), total + 1 if total else 0)
    return {"days": days, "total": total, "done": done, "behind": behind, "today": today_items,
            "current_day": current, "finished": bool(total) and done == total,
            "ends": days[-1]["date"] if days else None}


async def ladders(user_id: str, module_ids: list[str]) -> dict:
    """Highest rung per COD item for this person (old rows keyed by user_id count too)."""
    from database import db
    out: dict = {}
    if not module_ids:
        return out
    async for r in db.module_progress.find({"module_id": {"$in": module_ids},
                                            "$or": [{"target_user_id": user_id},
                                                    {"target_user_id": {"$exists": False}, "user_id": user_id}]},
                                           {"_id": 0, "module_id": 1, "ladder": 1}):
        out[r["module_id"]] = max(out.get(r["module_id"], 0), int(r.get("ladder") or 0))
    return out


def module_ids_of(cal: dict) -> list[str]:
    return sorted({it["module_id"] for d in (cal.get("days") or []) for it in d["items"]})


async def start(user_id: str, office_id: Optional[str], start_on: date, by: dict, source: str) -> dict:
    """Lay out (or re-lay) someone's COD 2 calendar from `start_on`."""
    from database import db
    modules = await office_modules(office_id, (2,))
    doc = {
        "user_id": user_id, "office_id": office_id, "start_date": start_on.isoformat(),
        "days": build_days(start_on, modules), "source": source,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "set_by_id": str(by.get("id") or by.get("_id") or ""), "set_by_name": by.get("name") or "",
    }
    existing = await db.cod_calendars.find_one({"user_id": user_id})
    if existing:
        await db.cod_calendars.update_one({"_id": existing["_id"]}, {"$set": doc})
        doc["id"] = existing["id"]
    else:
        doc["id"] = str(uuid.uuid4())
        await db.cod_calendars.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def start_after_evaluation(assessment: dict, grader: dict) -> Optional[dict]:
    """Day 8 (the sixth field day) completed: start COD 2 the next field day,
    unless the Day 8 Decision is Release or Needs More Time, or they already
    have a calendar. Never raises."""
    from database import db
    try:
        if int(assessment.get("day_number") or 0) != 8:
            return None
        hire = await db.new_hires.find_one({"id": assessment.get("new_hire_id")},
                                           {"_id": 0, "trainee_user_id": 1, "office_id": 1})
        uid = str((hire or {}).get("trainee_user_id") or "")
        if not uid or await db.cod_calendars.find_one({"user_id": uid}, {"_id": 1}):
            return None
        decision = await db.delivery_checklist.find_one({"assessment_id": assessment["id"], "topic": "Day 8 Decision"},
                                                        {"_id": 0, "grade": 1})
        if (decision or {}).get("grade") in ("Release", "Needs More Time"):
            return None  # not through COD 1 yet: the Coach starts it by hand when they are
        from core.app_time import APP_TZ
        today = datetime.now(APP_TZ).date()
        return await start(uid, hire.get("office_id"), next_field_day(today), grader, "evaluation")
    except Exception:
        import logging
        logging.getLogger(__name__).warning("cod_calendar: not started after evaluation", exc_info=True)
        return None
