"""Swap the live COD for the Owner's COD sheet (core/cod_sheet.py), once per
database (marker `cod_sheet_2026_10` in `migrations`).

For every office copy (and the global template):
  • an item the sheet carries over from the earlier COD is renamed and moved
    in place, so it keeps its id, any notes the office edited, and everyone's
    progress (their progress rows follow it to its new stage);
  • every other earlier item is archived, never deleted: `retired: True`,
    its old stage kept in `archived_stage`, and its stage (and its progress
    rows' stage) moved to 100 + the old stage so no stage list ever shows it;
  • the sheet's new items are added (the normal additive seeding).
Running it twice changes nothing.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from core.cod_sheet import sheet_items

logger = logging.getLogger(__name__)
MARKER = "cod_sheet_2026_10"
ARCHIVE_OFFSET = 100


async def migrate_scope(db, office_id) -> dict:
    items = sheet_items()
    wanted = {(i["stage"], i["topic"]) for i in items}
    out = {"moved": 0, "archived": 0}

    async def live(stage, topic):
        return await db.training_modules.find_one(
            {"office_id": office_id, "stage": stage, "topic": topic, "retired": {"$ne": True}})

    # 1. Carry-overs: rename / move in place.
    for it in items:
        src = it["source"]
        new_key = (it["stage"], it["topic"])
        if not src:
            continue
        doc = await live(*src)
        if not doc:
            continue
        if src != new_key and await live(*new_key):
            continue  # the new item already exists; the old one gets archived below
        await db.training_modules.update_one({"_id": doc["_id"]}, {"$set": {
            "stage": it["stage"], "category": it["category"], "topic": it["topic"],
            "sequence": it["sequence"],
        }})
        if src[0] != it["stage"] and doc.get("id"):
            await db.module_progress.update_many({"module_id": doc["id"]}, {"$set": {"stage": it["stage"]}})
        out["moved"] += 1

    # 2. Sheet order and sections for items already in place.
    for it in items:
        await db.training_modules.update_many(
            {"office_id": office_id, "stage": it["stage"], "topic": it["topic"], "retired": {"$ne": True}},
            {"$set": {"category": it["category"], "sequence": it["sequence"]}})

    # 3. Archive everything else in the COD stages.
    async for doc in db.training_modules.find(
            {"office_id": office_id, "stage": {"$in": [1, 2, 3, 4, 5, 6]}}):
        if (doc.get("stage"), doc.get("topic")) in wanted and not doc.get("retired"):
            continue
        old_stage = int(doc.get("stage") or 0)
        await db.training_modules.update_one({"_id": doc["_id"]}, {"$set": {
            "retired": True, "archived_stage": old_stage, "stage": ARCHIVE_OFFSET + old_stage,
            "archived_at": datetime.now(timezone.utc).isoformat(), "archived_reason": MARKER,
        }})
        if doc.get("id"):
            await db.module_progress.update_many(
                {"module_id": doc["id"]}, {"$set": {"stage": ARCHIVE_OFFSET + old_stage}})
        out["archived"] += 1
    return out


async def run_cod_sheet_update(db) -> dict:
    if await db.migrations.find_one({"_id": MARKER}):
        return {"skipped": True}
    scopes = await db.training_modules.distinct("office_id")
    totals = {"moved": 0, "archived": 0, "scopes": 0}
    from routes.modules import _ensure_seeded
    for scope in scopes:
        r = await migrate_scope(db, scope)
        totals["moved"] += r["moved"]
        totals["archived"] += r["archived"]
        totals["scopes"] += 1
        await _ensure_seeded(scope)  # adds the sheet's new items
    await db.migrations.insert_one({"_id": MARKER, **totals, "at": datetime.now(timezone.utc).isoformat()})
    logger.info("COD sheet update: %s", totals)
    return totals


NOTES_MARKER = "cod_notes_2026_10"


async def run_cod_notes_update(db) -> dict:
    """Once per database: give live sheet items the Owner's notes
    (core/cod_sheet.OWNER_NOTES), only where an item still has none."""
    if await db.migrations.find_one({"_id": NOTES_MARKER}):
        return {"skipped": True}
    from core.cod_sheet import OWNER_NOTES
    filled = 0
    for (stage, topic), text in OWNER_NOTES.items():
        r = await db.training_modules.update_many(
            {"stage": stage, "topic": topic, "retired": {"$ne": True},
             "$or": [{"trainee_content": {"$in": ["", None]}}, {"trainee_content": {"$exists": False}}]},
            {"$set": {"trainee_content": text}})
        filled += r.modified_count
    await db.migrations.insert_one({"_id": NOTES_MARKER, "filled": filled,
                                    "at": datetime.now(timezone.utc).isoformat()})
    return {"filled": filled}
