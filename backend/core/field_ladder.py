"""Field-day checklist grades on the COD ladder (the Owner, 26 Oct 2026).

Days 3-8 (field days) are marked Not Learnt · Know · Do · Deliver, the same
as the COD ladder, instead of Competent / Learnt / Not Learnt or Excellent /
Average / Needs Work. Academy Days 1-2 stay Learnt / Not Learnt.

`migrate()` runs once (marker in `content_migrations`): every field-day
manual row gets the ladder, and so does every checklist row on a day that
isn't completed yet, with any grade already picked moved to its nearest
rung. Completed days keep the grades they were given. Only rows on the
standard presets change: Day 8's own options (Advance / Needs More Time /
Release, Met / Below / Well Above) and 1-10 rows are left alone.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

# Kept here, not imported from scoring (which needs the database), so seed_data stays light.
FIELD_GRADE_OPTIONS = ["Not Learnt", "Know", "Do", "Deliver"]

logger = logging.getLogger(__name__)

MARKER = "field_days_cod_ladder_v1"
# The standard presets the ladder replaces, as stored.
OLD_PRESETS = [
    ["Competent", "Learnt", "Not Learnt"],
    ["Excellent", "Average", "Below Average"],
    ["Learnt", "Not Learnt"],
]
OLD_TO_NEW = {
    "Competent": "Deliver", "Excellent": "Deliver", "Independent": "Deliver", "Done": "Do",
    "Learnt": "Know", "Average": "Do",
    "Below Average": "Know", "Extend Training": "Know",
    "Not Learnt": "Not Learnt", "Not Done": "Not Learnt", "Incompetent": "Not Learnt",
}


async def migrate(db) -> dict:
    if await db.content_migrations.find_one({"id": MARKER}):
        return {"skipped": True}
    opts = list(FIELD_GRADE_OPTIONS)
    manual = await db.training_manual.update_many(
        {"day_number": {"$gte": 3}, "grade_options": {"$in": OLD_PRESETS}}, {"$set": {"grade_options": opts}})
    open_ids = [a["id"] async for a in db.daily_assessments.find(
        {"day_number": {"$gte": 3}, "completed": {"$ne": True}}, {"_id": 0, "id": 1})]
    rows = 0
    if open_ids:
        async for r in db.delivery_checklist.find(
                {"assessment_id": {"$in": open_ids}, "grade_options": {"$in": OLD_PRESETS}},
                {"_id": 0, "id": 1, "grade": 1}):
            g = r.get("grade")
            new_g = OLD_TO_NEW.get(g, g if g in opts else None) if g else None
            await db.delivery_checklist.update_one({"id": r["id"]}, {"$set": {"grade_options": opts, "grade": new_g}})
            rows += 1
    await db.content_migrations.insert_one({"id": MARKER, "at": datetime.now(timezone.utc).isoformat()})
    out = {"manual_rows": manual.modified_count, "checklist_rows": rows}
    logger.info(f"field_ladder: {out}")
    return out


def apply_to_seed(rows: list[dict]) -> list[dict]:
    """The same change on the seed manual for new offices."""
    for r in rows:
        if int(r.get("day_number") or 0) >= 3 and (r.get("grade_options") or []) in OLD_PRESETS:
            r["grade_options"] = list(FIELD_GRADE_OPTIONS)
    return rows
