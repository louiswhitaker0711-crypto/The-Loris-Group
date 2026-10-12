"""The Owner's Law of Averages for a day in the field (Oct 2026):

    120 doors · 70 spoken to · 25 pitched · 15 closed · 4+ sign-ups

The booklet said 120 / 80 / 20 qualified / 15–20 / 3+. REPLACEMENTS turns
every place that wording appears into the Owner's numbers. It was applied to
the seed files once (the seeds now carry the new text) and runs once on each
live database (run_loa_update, marker `loa_targets_2026_10` in `migrations`)
over Campaign Knowledge, coaching impacts, the BA Academy manual and modules,
and the day targets. Only these exact phrases change; anything else an admin
wrote is left as it is.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

MARKER = "loa_targets_2026_10"

DAILY = {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "sign_ups": 4}

REPLACEMENTS: list[tuple[str, str]] = [
    ("- **80** people spoken to\n- **20** qualified customers\n- **15–20** phones / closes\n- **3+** sign-ups",
     "- **70** people spoken to\n- **25** pitched\n- **15** closed\n- **4+** sign-ups"),
    ("80 people spoken to · 20 qualified customers · 15–20 phones / closes · 3+ sign-ups",
     "70 people spoken to · 25 pitched · 15 closed · 4+ sign-ups"),
    ("80 people spoken to · 20 qualified customers · 15–20 closes · 3+ sign-ups",
     "70 people spoken to · 25 pitched · 15 closed · 4+ sign-ups"),
    ("80 people spoken to, 20 qualified customers, 15–20 phones / closes, 3+ sign-ups",
     "70 people spoken to, 25 pitched, 15 closed, 4+ sign-ups"),
    ("> On average, 40 people won't be home that day for various reasons, and 50–60 people won't qualify for different reasons.",
     "> On average, 50 people won't be home that day for various reasons, and around 45 people won't qualify for different reasons."),
    ("On average 40 people won't be home that day and 50–60 won't qualify",
     "On average 50 people won't be home that day and around 45 won't qualify"),
    ("Trying to speak to 80 people in a day? Break it down into 12 people an hour",
     "Trying to speak to 70 people in a day? Break it down into 11 people an hour"),
    ("| Spoken | 80 |\n| Presented | 20 |\n| Closed | 15–20 |\n| Sign-ups | 3+ a day |",
     "| Spoken | 70 |\n| Pitched | 25 |\n| Closed | 15 |\n| Sign-ups | 4+ a day |"),
    ("Spoken: 80", "Spoken: 70"),
    ("Presented: 20", "Pitched: 25"),
    ("Closed: 15–20", "Closed: 15"),
    ("Sign-ups: 3+ a day", "Sign-ups: 4+ a day"),
    ("Doors (target 120–140), Spoken (80–90), Presented (20–25), Closed (15–20), Flow (5–7), Sign-ups (3–5)",
     "Doors (target 120), Spoken (70), Pitched (25), Closed (15), Flow (5–7), Sign-ups (4+)"),
    ("doors 120–140, spoken 80–90, presented 20–25, closed 15–20, flow 5–7, sign-ups 3–5",
     "doors 120, spoken 70, pitched 25, closed 15, flow 5–7, sign-ups 4+"),
    ("80 spoken, 20 presented, 15 closed, 5 flow, 3 sign-ups",
     "70 spoken, 25 pitched, 15 closed, 5 flow, 4 sign-ups"),
    ("80 spoken, 20 presented, 15 closed, 3 sign-ups", "70 spoken, 25 pitched, 15 closed, 4 sign-ups"),
    ("15 closes, 3 sign-ups", "15 closes, 4 sign-ups"),
    ("daily minimum of 3 sign-ups", "daily minimum of 4 sign-ups"),
]


def apply_text(s: str) -> str:
    for old, new in REPLACEMENTS:
        if old in s:
            s = s.replace(old, new)
    return s


def apply_value(v):
    """Every string inside v (dicts and lists included) with REPLACEMENTS applied."""
    if isinstance(v, str):
        return apply_text(v)
    if isinstance(v, list):
        return [apply_value(x) for x in v]
    if isinstance(v, dict):
        return {k: apply_value(x) for k, x in v.items()}
    return v


# Day targets from Day 4 on (the first day on badge): the old booklet day.
_OLD_TARGETS = {"target_introductions": 80, "target_presentations": 20, "target_closes": 15, "target_sales": 3}
_NEW_TARGETS = {"target_introductions": 70, "target_presentations": 25, "target_closes": 15, "target_sales": 4}

COLLECTIONS = ("product_knowledge_topics", "coaching_impacts", "training_manual", "training_modules")


async def run_loa_update(db) -> dict:
    """Once per database: rewrite the old Law of Averages wording and the
    Day 4+ targets to the Owner's numbers."""
    if await db.migrations.find_one({"_id": MARKER}):
        return {"skipped": True}
    out = {"docs": 0, "targets": 0}
    for col in COLLECTIONS:
        async for doc in db[col].find({}):
            body = {k: v for k, v in doc.items() if k != "_id"}
            new = apply_value(body)
            changed = {k: v for k, v in new.items() if v != body.get(k)}
            if changed:
                await db[col].update_one({"_id": doc["_id"]}, {"$set": changed})
                out["docs"] += 1
    res = await db.targets.update_many(
        {"day_number": {"$gte": 4}, **_OLD_TARGETS}, {"$set": _NEW_TARGETS})
    out["targets"] = res.modified_count
    await db.migrations.insert_one({"_id": MARKER, **out})
    logger.info("LOA targets updated: %s", out)
    return out
