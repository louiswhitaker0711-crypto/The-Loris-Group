"""One-off cleanup after the Hub history first went in (16 Oct 2026).

Userscript v1.5 sent 11 earlier Performance Hub weeks as "view only" at
10:40 UK time, but Railway was still running the previous version, which
filled Bells from every week it was sent. For the 10 weeks before last week
(27 Jul – 4 Oct 2026) that made Bells rows for linked people who had none that
week, marked from OwnerIQ's day plan.

This deletes only rows that are ALL of:
  • made by the OwnerIQ sync (created_by_id "owneriq-sync"),
  • made in that window (16 Oct 2026, 09:39–09:42 UTC) and not changed since,
  • for a week ending 2 Aug – 4 Oct 2026 (last week is synced normally),
  • with no sign-ups on any day.

Rows that existed before, or that anyone has touched since, are kept. Runs
once (settings key below); safe to call again.
"""
import logging

logger = logging.getLogger(__name__)

MARKER = "relay_history_bells_cleanup_v1"
WINDOW_FROM = "2026-10-16T09:39:00"
WINDOW_TO = "2026-10-16T09:42:00"
WEEK_ENDING_FROM = "2026-08-02"
WEEK_ENDING_TO = "2026-10-04"
_NUMBER_FIELDS = ("over30", "under30", "memberships")


def has_signups(entry: dict) -> bool:
    for d in entry.get("days") or []:
        for k in _NUMBER_FIELDS:
            try:
                if int((d or {}).get(k) or 0) != 0:
                    return True
            except (TypeError, ValueError):
                return True   # anything odd in a number field: keep the row
    return False


def matches(entry: dict) -> bool:
    created = str(entry.get("created_at") or "")
    updated = str(entry.get("updated_at") or created)
    we = str(entry.get("week_ending") or "")
    return (entry.get("created_by_id") == "owneriq-sync"
            and WINDOW_FROM <= created < WINDOW_TO
            and updated < WINDOW_TO
            and WEEK_ENDING_FROM <= we <= WEEK_ENDING_TO
            and not has_signups(entry))


async def run(db) -> dict:
    if await db.settings.find_one({"key": MARKER}):
        return {"skipped": "already ran"}
    q = {"created_by_id": "owneriq-sync",
         "created_at": {"$gte": WINDOW_FROM, "$lt": WINDOW_TO},
         "week_ending": {"$gte": WEEK_ENDING_FROM, "$lte": WEEK_ENDING_TO}}
    ids = [e["id"] async for e in db.bells_entries.find(q) if matches(e)]
    removed = 0
    if ids:
        res = await db.bells_entries.delete_many({"id": {"$in": ids}})
        removed = res.deleted_count
    from datetime import datetime, timezone
    await db.settings.insert_one({"key": MARKER, "ran_at": datetime.now(timezone.utc).isoformat(),
                                  "removed": removed})
    logger.info("Relay history cleanup: removed %d Bells row(s) made by the 16 Oct sync", removed)
    return {"removed": removed}
