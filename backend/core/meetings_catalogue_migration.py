"""Once per database (the Owner, 26 Nov 2026): re-file every planner week so
morning and leaders meetings move out of Other into their own catalogues."""
import logging

from bson import ObjectId

logger = logging.getLogger(__name__)
FLAG = "notes_meetings_catalogue_v2"


async def run_meetings_catalogue(db) -> None:
    if await db.migrations.find_one({"id": FLAG}):
        return
    from routes.notes_folder import sync_planner
    users: dict = {}
    n = 0
    async for p in db.weekly_planners.find({}, {"_id": 0, "user_id": 1, "week_ending": 1, "days": 1,
                                                  "notes": 1, "folder": 1, "slot_notes": 1}):
        uid = str(p.get("user_id") or "")
        if not uid or not p.get("week_ending"):
            continue
        if uid not in users:
            try:
                u = await db.users.find_one({"_id": ObjectId(uid)})
            except Exception:  # noqa: BLE001
                u = None
            if u:
                u["id"] = str(u["_id"])
            users[uid] = u
        u = users[uid]
        if not u:
            continue
        try:
            await sync_planner(u, p["week_ending"], p.get("days") or {}, p.get("notes") or "",
                               p.get("folder") or {}, p.get("slot_notes") or {})
            n += 1
        except Exception:  # noqa: BLE001
            logger.exception("re-filing planner %s %s failed", uid, p.get("week_ending"))
    await db.migrations.insert_one({"id": FLAG, "weeks": n})
    logger.info("Meetings catalogue: re-filed %s planner weeks", n)
