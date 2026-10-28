"""More COD in a new start's first 8 days (the Owner's call, 28 Oct 2026).

Each COD Stage 1 item the field days didn't already cover gets its own
checklist row, under "COD", graded Not Learnt · Know · Do · Deliver and fed
into the COD by core/cod_day_sync.py:

  Field day 1 (Day 3)  SEE Principle · Follows Standards
  Field day 2 (Day 4)  Accurate Body Positioning · Communicates Clearly
  Field day 3 (Day 5)  Emotional Regulation in the Field · Seeks Support Early & Proactively
  Field day 4 (Day 6)  Resilience After Rejection
  Field day 6 (Day 8)  Stage 1 — The Foundation Standard (the whole of Stage 1, before the decision)

`apply_to_seed()` adds them to the seed manual for new offices; `migrate()`
adds them once to every office's manual and to every field day not yet
completed (marker in `content_migrations`). Rows are added after the day's
existing ones, so nothing already marked moves.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MARKER = "field_days_cod_rows_v1"
LADDER = ["Not Learnt", "Know", "Do", "Deliver"]


def _row(day: int, topic: str, good: str, outcome: str) -> dict:
    return {"day_number": day, "category": "COD", "topic": topic, "what_good_looks_like": good,
            "expected_outcome": outcome, "confidence_expected": "Apply", "required": True,
            "grade_options": list(LADDER)}


NEW_ROWS = [
    _row(3, "SEE Principle",
         "Smile, Eye contact, Enthusiasm at every door. They can hear the smile in your voice, eye contact shows "
         "you're present and trustworthy, enthusiasm shows you believe in it. Watch their first seconds across "
         "several doors, and whether SEE comes back on straight after a no.",
         "You open every door with SEE, and switch it straight back on after a rejection."),
    _row(3, "Follows Standards",
         "Discipline and effort without being watched: on time, full doors, Field IQ done, image right. Ask them "
         "to say the day's standards (the Law of Averages, quality) from memory.",
         "You work to the same standard whether your Coach is with you or not, and can say what good looks like."),
    _row(4, "Accurate Body Positioning",
         "Stands in the right place to open the conversation naturally: a step back, open and confident, hands "
         "and gestures building trust, always respecting personal space. Watch their approach angle and stance "
         "across the day.",
         "Your positioning opens the conversation before you speak, at every door."),
    _row(4, "Communicates Clearly",
         "Updates are short, accurate and on time: check-ins, the WhatsApp breakdown, telling the hop leader "
         "where they are. Issues raised to the right person, at the right time, in the right tone.",
         "Your updates can be trusted and acted on, and any problem comes from you first."),
    _row(5, "Emotional Regulation in the Field",
         "Stays consistent through a slow patch or a rude door: same energy, same effort, and personal stuff "
         "left at home. Watch composure in front of customers when something goes wrong.",
         "You're the same at the door on a low day as on a high one."),
    _row(5, "Seeks Support Early & Proactively",
         "Flags a problem while it's small and asks instead of guessing: an objection they can't handle, a "
         "street that isn't working, Field IQ playing up. Silence in coaching is the warning sign.",
         "You ask early and use your Coach and hop leader to fix things while they're small."),
    _row(6, "Resilience After Rejection",
         "One bad door doesn't touch the next: reset in seconds and stay productive. Watch the pitch straight "
         "after a hard no, and their activity through a slow spell.",
         "A no doesn't change your next door. You reset and go again."),
    _row(8, "Stage 1 — The Foundation Standard",
         "The whole of Stage 1 before the decision: three days in a row with great time ownership and effort; "
         "the 5-step sign-up process and common objections handled live; Field IQ with no missing fields. Go "
         "through their COD Stage 1 together: what's at Do and Deliver, and what's next.",
         "You've proven the Stage 1 standard in the field, and you know your next COD steps."),
]

# What each new row feeds in the COD (merged into core/cod_day_sync.FIELD_TO_COD).
NEW_ROW_COD = {r["topic"]: [r["topic"]] for r in NEW_ROWS}


def apply_to_seed(rows: list[dict]) -> list[dict]:
    have = {(r["day_number"], r["topic"]) for r in rows}
    for new in NEW_ROWS:
        if (new["day_number"], new["topic"]) in have:
            continue
        seq = max((int(r.get("sequence") or 0) for r in rows if r["day_number"] == new["day_number"]), default=0) + 1
        rows.append({**new, "sequence": seq})
    return rows


async def migrate(db) -> dict:
    if await db.content_migrations.find_one({"id": MARKER}):
        return {"skipped": True}
    added_manual = 0
    added_rows = 0
    office_ids = await db.training_manual.distinct("office_id")
    for oid in office_ids:
        for new in NEW_ROWS:
            day = new["day_number"]
            if await db.training_manual.find_one({"office_id": oid, "day_number": day, "topic": new["topic"]}):
                continue
            last = await db.training_manual.find_one({"office_id": oid, "day_number": day}, sort=[("sequence", -1)])
            if not last:
                continue   # this office has no manual for that day
            seq = int(last.get("sequence") or 0) + 1
            await db.training_manual.insert_one({**new, "sequence": seq, "office_id": oid})
            added_manual += 1
    # Field days not completed yet get the new rows too.
    async for a in db.daily_assessments.find(
            {"day_number": {"$in": sorted({r["day_number"] for r in NEW_ROWS})}, "completed": {"$ne": True}},
            {"_id": 0, "id": 1, "day_number": 1, "new_hire_id": 1}):
        hire = await db.new_hires.find_one({"id": a.get("new_hire_id")}, {"_id": 0, "office_id": 1})
        oid = (hire or {}).get("office_id")
        for new in [r for r in NEW_ROWS if r["day_number"] == a["day_number"]]:
            if await db.delivery_checklist.find_one({"assessment_id": a["id"], "topic": new["topic"]}):
                continue
            m = (await db.training_manual.find_one({"office_id": oid, "day_number": a["day_number"], "topic": new["topic"]})
                 or await db.training_manual.find_one({"office_id": None, "day_number": a["day_number"], "topic": new["topic"]}))
            if not m:
                continue
            await db.delivery_checklist.insert_one({
                "id": str(uuid.uuid4()), "assessment_id": a["id"], "office_id": oid,
                "manual_item_id": f"D{a['day_number']}-{int(m.get('sequence') or 0):02d}",
                "topic": new["topic"], "category": new["category"],
                "confidence_expected": new["confidence_expected"],
                "taught": False, "outcome_achieved": False, "confidence_level": "Not yet", "grade": None,
                "grade_options": list(LADDER), "notes": None,
            })
            added_rows += 1
    await db.content_migrations.insert_one({"id": MARKER, "at": datetime.now(timezone.utc).isoformat()})
    out = {"manual_rows": added_manual, "checklist_rows": added_rows}
    logger.info(f"field_cod_rows: {out}")
    return out
