"""Back to the original COD, once per database (marker in `migrations`).

On 12 Oct 2026 the live COD was swapped for the Owner's COD sheet
(core/cod_sheet_migration.py): carried-over items were renamed in place and
every other original item archived (`retired`, stage + 100). On 16 Oct the
Owner asked for the original back exactly — the 84 items of
core/module_seed.all_seed_modules(), each with What to learn / What good looks
like / What to teach — and for the sheet's items not to show at all.

For every office copy (and the global template):
  1. each sheet item carried over from an original item is renamed back to it;
  2. each original item the sheet archived is restored;
  3. every original item gets its original content back (category, order,
     What to learn, What good looks like, How measured, What to teach);
  4. everything else in the COD stages — the sheet's own items and its Stage 5
     Business Owner (stored as 6) — is archived, never deleted: `retired`,
     stage moved to 100 + its stage, so no screen lists it.
Then every COD tick (module_progress for COD items, pending quick sign-off
requests) is cleared, as the Owner asked: nobody had started on the COD yet.
Cleared rows are copied to `module_progress_archive` / `cod_test_requests_archive`
first, so nothing is lost for good. Running it twice changes nothing.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MARKER = "cod_original_2026_10_16"
SHEET_MARKER = "cod_sheet_2026_10"
ARCHIVE_OFFSET = 100
COD_STAGES = [1, 2, 3, 4, 5, 6]
CONTENT_FIELDS = ("category", "sequence", "trainee_content", "what_good_looks_like", "how_measured",
                  "leader_coaching_notes", "assessment_prompts", "assessment_bands")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def originals() -> dict:
    from core.module_seed import all_seed_modules
    return {(m["stage"], m["topic"]): m for m in all_seed_modules()}


def carry_overs() -> list[tuple[tuple, tuple]]:
    """[(sheet key, original key)] for sheet items that came from an original."""
    try:
        from core.cod_sheet import sheet_items
    except Exception:
        return []
    out = []
    for it in sheet_items():
        src = it.get("source")
        if src:
            out.append(((it["stage"], it["topic"]), (src[0], src[1])))
    return out


async def migrate_scope(db, office_id, orig: dict | None = None) -> dict:
    orig = orig or originals()
    out = {"renamed": 0, "restored": 0, "archived": 0}

    async def live(stage, topic):
        return await db.training_modules.find_one(
            {"office_id": office_id, "stage": stage, "topic": topic, "retired": {"$ne": True}})

    # 1. Sheet items carried over from an original: rename back.
    for sheet_key, src in carry_overs():
        if src not in orig or sheet_key == src:
            continue
        doc = await live(*sheet_key)
        if not doc or await live(*src):
            continue
        await db.training_modules.update_one({"_id": doc["_id"]}, {"$set": {"stage": src[0], "topic": src[1]}})
        out["renamed"] += 1

    # 2. Originals the sheet archived: restore.
    async for doc in db.training_modules.find(
            {"office_id": office_id, "retired": True, "archived_reason": SHEET_MARKER}):
        key = (doc.get("archived_stage"), doc.get("topic"))
        if key not in orig or await live(*key):
            continue
        await db.training_modules.update_one({"_id": doc["_id"]}, {
            "$set": {"stage": key[0], "retired": False},
            "$unset": {"archived_stage": "", "archived_at": "", "archived_reason": ""}})
        out["restored"] += 1

    # 3. The original content on every original item.
    for (stage, topic), m in orig.items():
        await db.training_modules.update_many(
            {"office_id": office_id, "stage": stage, "topic": topic, "retired": {"$ne": True}},
            {"$set": {f: m.get(f) for f in CONTENT_FIELDS if f in m}})

    # 4. Everything else in the COD stages: archived, out of sight.
    async for doc in db.training_modules.find(
            {"office_id": office_id, "stage": {"$in": COD_STAGES}, "retired": {"$ne": True}}):
        if (doc.get("stage"), doc.get("topic")) in orig:
            continue
        old = int(doc.get("stage") or 0)
        await db.training_modules.update_one({"_id": doc["_id"]}, {"$set": {
            "retired": True, "archived_stage": old, "stage": ARCHIVE_OFFSET + old,
            "archived_at": _now(), "archived_reason": MARKER}})
        out["archived"] += 1
    return out


async def clear_cod_ticks(db) -> dict:
    """Clear every COD tick, keeping a copy in the archive collections."""
    stages = COD_STAGES + [ARCHIVE_OFFSET + s for s in COD_STAGES]
    ids = [i for i in await db.training_modules.distinct("id", {"stage": {"$in": stages}}) if i]
    now = _now()
    moved = 0
    if ids:
        async for row in db.module_progress.find({"module_id": {"$in": ids}}):
            row.pop("_id", None)
            await db.module_progress_archive.insert_one({**row, "archived_at": now, "archived_reason": MARKER})
            moved += 1
        await db.module_progress.delete_many({"module_id": {"$in": ids}})
    requests = 0
    async for row in db.cod_test_requests.find({}):
        row.pop("_id", None)
        await db.cod_test_requests_archive.insert_one({**row, "archived_at": now, "archived_reason": MARKER})
        requests += 1
    await db.cod_test_requests.delete_many({})
    return {"ticks_cleared": moved, "signoff_requests_cleared": requests}


async def run_cod_original_restore(db) -> dict:
    if await db.migrations.find_one({"_id": MARKER}):
        return {"skipped": True}
    orig = originals()
    totals = {"renamed": 0, "restored": 0, "archived": 0, "scopes": 0}
    from routes.modules import _ensure_seeded
    for scope in await db.training_modules.distinct("office_id"):
        r = await migrate_scope(db, scope, orig)
        for k in ("renamed", "restored", "archived"):
            totals[k] += r[k]
        totals["scopes"] += 1
        await _ensure_seeded(scope)          # adds any original item the office never had
        # Freshly seeded copies already carry the original content; re-apply
        # it to be sure every copy matches (step 3 is idempotent).
        for (stage, topic), m in orig.items():
            await db.training_modules.update_many(
                {"office_id": scope, "stage": stage, "topic": topic, "retired": {"$ne": True}},
                {"$set": {f: m.get(f) for f in CONTENT_FIELDS if f in m}})
    totals.update(await clear_cod_ticks(db))
    await db.migrations.insert_one({"_id": MARKER, **totals, "at": _now()})
    logger.info("COD back to the original: %s", totals)
    return totals
