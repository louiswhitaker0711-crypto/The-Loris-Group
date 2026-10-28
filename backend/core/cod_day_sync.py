"""A new start's field days feed their COD (the Owner's call, 28 Oct 2026).

Field-day checklist rows (Days 3-8) are graded on the COD ladder: Not Learnt
· Know · Do · Deliver. Each row is linked to a COD Stage 1 (Foundation) item
below. When a day is completed, every linked COD item moves up to the rung
that day showed, with today's date on the rung, the same as ticking it on the
COD sheet:

  • whoever grades the day moves it (their Coach, the Owner, or the leader on
    their bunny hop), up to Deliver;
  • several rows feeding one item (all five steps → 5-Step Sign-Up Process)
    count as the LOWEST of them that day: one step at Know holds it at Know;
  • it only ever moves up; a Coach can still change the COD by hand;
  • one good day is never Deliver (the Owner, 28 Oct 2026): Deliver means
    doing it consistently, so it needs Deliver on DELIVER_DAYS separate field
    days. Until then a Deliver day moves the COD to Do.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

RUNG = {"Not Learnt": 0, "Know": 1, "Do": 2, "Deliver": 3}
STAGE = 1
MAX_RUNG = 3   # Stage 1 tops out at Deliver
DELIVER_DAYS = 3

# Field-day checklist topic → the COD Stage 1 items it proves.
FIELD_TO_COD: dict[str, list[str]] = {
    "Introduction": ["5-Step Sign-Up Process"],
    "Presentation": ["5-Step Sign-Up Process"],
    "Short Story": ["5-Step Sign-Up Process"],
    "Close": ["5-Step Sign-Up Process", "Clear Close"],
    "Rehash": ["5-Step Sign-Up Process"],
    "Full Cycle Solo": ["5-Step Sign-Up Process"],
    "Law of Averages": ["Law of Averages"],
    "Daily Funnel Targets": ["Law of Averages"],
    "Field Activity Minimum": ["Law of Averages"],
    "Daily KPI Standard": ["Law of Averages"],
    "Replicate the Day": ["Law of Averages"],
    "Field IQ": ["Field IQ"],
    "Field IQ Accuracy": ["Field IQ"],
    "Impulse Factors": ["Impulses"],
    "Identify the G.I.F.T.S Impulse": ["Impulses"],
    "Objection Cycle": ["Question Handling"],
    "Blocks vs Objections": ["Question Handling"],
    "Advanced Objections": ["Question Handling"],
    "The App & The Round": ["Quality KPIs"],
    "Sign-ups per Hour": ["Quality KPIs"],
    "Daily Self-Accountability": ["Professional Reliability"],
    "Consistency & Grit": ["Professional Reliability"],
    "3 Types of Days": ["Resilience After Rejection"],
}
# The COD rows added to the first 8 days (core/field_cod_rows.py) feed their own item.
from core.field_cod_rows import NEW_ROW_COD  # noqa: E402
FIELD_TO_COD.update(NEW_ROW_COD)


def rungs_for_day(rows: Iterable[dict]) -> dict[str, int]:
    """COD item → the rung this day's graded rows show (lowest of its rows).
    Rows not graded, or not on the ladder, don't count."""
    seen: dict[str, list[int]] = {}
    for r in rows:
        g = r.get("grade")
        if g not in RUNG:
            continue
        for item in FIELD_TO_COD.get((r.get("topic") or "").strip(), []):
            seen.setdefault(item, []).append(RUNG[g])
    return {item: min(v) for item, v in seen.items()}


def cap_rung(rung: int, deliver_days: int) -> int:
    """Deliver only once it's been Deliver on DELIVER_DAYS separate days."""
    rung = min(rung, MAX_RUNG)
    if rung >= MAX_RUNG and deliver_days < DELIVER_DAYS:
        return MAX_RUNG - 1
    return rung


async def _module(office_id: Optional[str], topic: str) -> Optional[dict]:
    from database import db
    q = {"stage": STAGE, "topic": topic, "retired": {"$ne": True}}
    return (await db.training_modules.find_one({**q, "office_id": office_id})
            or await db.training_modules.find_one({**q, "office_id": None}))


async def sync_day_to_cod(assessment: dict, grader: dict) -> int:
    """Move the new start's COD up from one completed field day. Returns how
    many COD items moved. Never raises: the day's grading must still save."""
    from database import db
    try:
        if int(assessment.get("day_number") or 0) < 3:
            return 0
        hire = await db.new_hires.find_one({"id": assessment.get("new_hire_id")},
                                           {"_id": 0, "trainee_user_id": 1, "office_id": 1})
        target = str((hire or {}).get("trainee_user_id") or "")
        if not target:
            return 0
        rows = await db.delivery_checklist.find({"assessment_id": assessment["id"]},
                                                {"_id": 0, "topic": 1, "grade": 1}).to_list(200)
        # Every completed field day so far, for the Deliver-needs-3-days rule.
        day_ids = {a["id"] async for a in db.daily_assessments.find(
            {"new_hire_id": assessment.get("new_hire_id"), "day_number": {"$gte": 3}, "completed": True},
            {"_id": 0, "id": 1})} | {assessment["id"]}
        delivered_days: dict[str, int] = {}
        for aid in day_ids:
            day_rows = rows if aid == assessment["id"] else await db.delivery_checklist.find(
                {"assessment_id": aid}, {"_id": 0, "topic": 1, "grade": 1}).to_list(200)
            for item, r in rungs_for_day(day_rows).items():
                if r >= MAX_RUNG:
                    delivered_days[item] = delivered_days.get(item, 0) + 1
        from routes.modules import _apply_ladder_dates, _compute_completed, _today_iso, _sales_path_recompute
        today = _today_iso()
        grader_id = str(grader.get("id") or grader.get("_id") or "")
        moved = 0
        for topic, rung in rungs_for_day(rows).items():
            rung = cap_rung(rung, delivered_days.get(topic, 0))
            if rung <= 0:
                continue
            m = await _module(hire.get("office_id"), topic)
            if not m:
                continue
            existing = await db.module_progress.find_one({"$or": [
                {"target_user_id": target, "module_id": m["id"]},
                {"user_id": target, "module_id": m["id"], "target_user_id": {"$exists": False}},
            ]})
            if int((existing or {}).get("ladder") or 0) >= rung:
                continue   # only ever moves up
            now = datetime.now(timezone.utc).isoformat()
            update = {
                "ladder": rung,
                "ladder_dates": _apply_ladder_dates((existing or {}).get("ladder_dates") or {}, rung, None, 0, today),
                "last_assessed_at": now, "last_assessed_by_id": grader_id, "assessor_id": grader_id,
                "target_user_id": target, "ready_for_check": False,
                "from_field_day": int(assessment.get("day_number") or 0),
            }
            update["completed"] = _compute_completed({**(existing or {}), **update})
            if existing:
                await db.module_progress.update_one({"_id": existing["_id"]}, {"$set": update})
            else:
                await db.module_progress.insert_one({"id": str(uuid.uuid4()), "user_id": target,
                                                     "module_id": m["id"], "stage": STAGE, **update})
            moved += 1
        if moved:
            await _sales_path_recompute(target, STAGE)
        return moved
    except Exception as e:
        logger.warning(f"cod_day_sync: day {assessment.get('id')} not synced: {e}")
        return 0
