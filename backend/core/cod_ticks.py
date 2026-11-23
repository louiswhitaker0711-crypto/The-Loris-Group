"""Ticks that reach a person's COD from somewhere other than the COD sheet.

The Owner, 23 Nov 2026: anything already proven elsewhere in the Hub should
land on the COD on its own, so the COD is one record, not a second checklist.

  • BA Academy (Days 1-2): an item graded "Learnt" means they've been taught
    it, so its COD item gets Know (ACADEMY_TO_COD below). The field days
    (3-8) already move COD 1 up to Do and Deliver (core/cod_day_sync.py).
  • Primetime: being in a Primetime on a COD topic (learning it, or running
    it) gets that item Know. Planned, it's "Know pending"; it only ticks
    once that day has happened and they were scheduled in (not off, a no
    show or exited). Any COD stage. Know only: Do and above stay the Coach's.

Everything here only ever moves a COD item UP, stamps the rung's date like
ticking it on the sheet, and never raises: the thing that triggered it must
still save.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

KNOW = 1

# BA Academy item (Days 1-2) → the COD items it teaches. Graded "Learnt" = Know.
ACADEMY_TO_COD: dict[str, list[str]] = {
    "Reliability": ["Professional Reliability"],
    "Student Mentality": ["Student Mentality"],
    "SEE Factors": ["SEE Principle"],
    "Body Language": ["Accurate Body Positioning"],
    "G.I.F.T.S.": ["Impulses"],
    "Field IQ": ["Field IQ"],
    "Law of Averages": ["Law of Averages"],
    "What Good Looks Like": ["Quality KPIs"],
    "Retention Standards": ["Quality KPIs"],
    "Signup Process Overview": ["5-Step Sign-Up Process"],
    "Pitch Introduction": ["5-Step Sign-Up Process"],
    "Presentation & Short Story": ["5-Step Sign-Up Process"],
}
LEARNT = "Learnt"


def norm(s: Optional[str]) -> str:
    """Topic names compared loosely: case, punctuation and spacing ignored."""
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def academy_items(rows: Iterable[dict]) -> list[str]:
    """COD item names a day's Academy rows prove at Know (graded Learnt)."""
    out: list[str] = []
    for r in rows:
        if (r.get("grade") or "") != LEARNT:
            continue
        for item in ACADEMY_TO_COD.get((r.get("topic") or "").strip(), []):
            if item not in out:
                out.append(item)
    return out


async def office_modules(office_id: Optional[str], stages: Optional[Iterable[int]] = None) -> list[dict]:
    """The live COD items for an office (the office's own, else the shared ones)."""
    from database import db
    q: dict = {"retired": {"$ne": True}, "archived_at": {"$exists": False}}
    if stages:
        q["stage"] = {"$in": list(stages)}
    own = await db.training_modules.find({**q, "office_id": office_id},
                                         {"_id": 0, "id": 1, "topic": 1, "stage": 1, "sequence": 1}).to_list(500)
    if own:
        return own
    return await db.training_modules.find({**q, "office_id": None},
                                          {"_id": 0, "id": 1, "topic": 1, "stage": 1, "sequence": 1}).to_list(500)


def match_module(topic: str, modules: list[dict]) -> Optional[dict]:
    """The COD item a free-text topic names (a Primetime topic), or None."""
    t = norm(topic)
    if not t:
        return None
    for m in modules:
        if norm(m.get("topic")) == t:
            return m
    return None


async def raise_rung(target: str, module: dict, rung: int, by_id: str, on: str, source: str) -> bool:
    """Move one person's COD item up to `rung` (never down), stamping `on` as
    the date of every rung newly reached. True if it moved."""
    from database import db
    from routes.modules import _apply_ladder_dates, _compute_completed
    existing = await db.module_progress.find_one({"$or": [
        {"target_user_id": target, "module_id": module["id"]},
        {"user_id": target, "module_id": module["id"], "target_user_id": {"$exists": False}},
    ]})
    if int((existing or {}).get("ladder") or 0) >= rung:
        return False
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "ladder": rung,
        "ladder_dates": _apply_ladder_dates((existing or {}).get("ladder_dates") or {}, rung, None, 0, on),
        "last_assessed_at": now, "last_assessed_by_id": by_id, "assessor_id": by_id,
        "target_user_id": target, "ticked_from": source,
    }
    update["completed"] = _compute_completed({**(existing or {}), **update})
    if existing:
        await db.module_progress.update_one({"_id": existing["_id"]}, {"$set": update})
    else:
        await db.module_progress.insert_one({"id": str(uuid.uuid4()), "user_id": target,
                                             "module_id": module["id"], "stage": int(module.get("stage") or 0), **update})
    return True


async def sync_academy_day(assessment: dict, grader: dict) -> int:
    """An Academy day (1-2) completed: its Learnt items give their COD item Know."""
    from database import db
    try:
        if int(assessment.get("day_number") or 0) not in (1, 2):
            return 0
        hire = await db.new_hires.find_one({"id": assessment.get("new_hire_id")},
                                           {"_id": 0, "trainee_user_id": 1, "office_id": 1})
        target = str((hire or {}).get("trainee_user_id") or "")
        if not target:
            return 0
        rows = await db.delivery_checklist.find({"assessment_id": assessment["id"]},
                                                {"_id": 0, "topic": 1, "grade": 1}).to_list(200)
        names = academy_items(rows)
        if not names:
            return 0
        modules = await office_modules(hire.get("office_id"), (1, 2))
        on = datetime.now().date().isoformat()
        try:
            from core.app_time import APP_TZ
            on = datetime.now(APP_TZ).date().isoformat()
        except Exception:
            pass
        by = str(grader.get("id") or grader.get("_id") or "")
        moved = 0
        for name in names:
            m = match_module(name, modules)
            if m and await raise_rung(target, m, KNOW, by, on, f"academy_day_{assessment.get('day_number')}"):
                moved += 1
        return moved
    except Exception as e:
        logger.warning(f"cod_ticks: academy day {assessment.get('id')} not synced: {e}")
        return 0


# ── Primetime → Know ──────────────────────────────────────────────────────

# Who in a Primetime has been taught the topic: the learner, and whoever ran it.
PRIMETIME_KNOW_MODES = ("learning", "teaching")


async def _status_on(office_id: str, user_id: str, day: str) -> str:
    """Their Bells status that day ('' when nothing is filled in, which counts as in)."""
    from database import db
    d = date.fromisoformat(day)
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    e = await db.bells_entries.find_one({"office_id": office_id, "user_id": user_id, "week_ending": week_ending},
                                        {"_id": 0, "days": 1})
    days = (e or {}).get("days") or []
    i = d.weekday()
    return ((days[i] or {}).get("status") or "") if i < len(days) and isinstance(days[i], dict) else ""


async def tick_primetime_day(day: str) -> int:
    """Give Know for every Primetime on a COD topic held on `day` (YYYY-MM-DD),
    to the people in it who were scheduled in. Each row is done once."""
    from database import db
    from routes.primetime import is_not_in
    ticked = 0
    modules_by_office: dict = {}
    async for e in db.primetime_entries.find({"day_date": day, "mode": {"$in": list(PRIMETIME_KNOW_MODES)},
                                              "cod_know_done": {"$ne": True}}):
        oid = e.get("office_id")
        if oid not in modules_by_office:
            modules_by_office[oid] = await office_modules(oid)
        m = match_module(e.get("topic") or "", modules_by_office[oid])
        done = {"cod_know_done": True}
        if m:
            uid = str(e.get("subject_user_id") or "")
            if uid and not is_not_in(await _status_on(oid, uid, day)):
                if await raise_rung(uid, m, KNOW, str(e.get("updated_by_id") or ""), day, "primetime"):
                    ticked += 1
                done["cod_know_module_id"] = m["id"]
        await db.primetime_entries.update_one({"_id": e["_id"]}, {"$set": done})
    return ticked


async def primetime_know_tick(now: Optional[datetime] = None) -> int:
    """The scheduled job: today's Primetime (once it's over) and the last week's,
    in case a day was missed."""
    from core.app_time import APP_TZ
    now = now or datetime.now(APP_TZ)
    total = 0
    for back in range(0, 8):
        d = now.date() - timedelta(days=back)
        if back == 0 and (now.hour, now.minute) < (11, 45):
            continue   # today's Primetime isn't over yet
        total += await tick_primetime_day(d.isoformat())
    return total


async def pending_for(user_id: str, office_id: Optional[str]) -> dict:
    """module_id → the date of a planned Primetime on it still to come (Know pending)."""
    from database import db
    from core.app_time import APP_TZ
    today = datetime.now(APP_TZ).date().isoformat()
    modules = await office_modules(office_id)
    out: dict = {}
    async for e in db.primetime_entries.find({"office_id": office_id, "subject_user_id": user_id,
                                              "mode": {"$in": list(PRIMETIME_KNOW_MODES)},
                                              "day_date": {"$gte": today}, "cod_know_done": {"$ne": True}},
                                             {"_id": 0, "topic": 1, "day_date": 1}):
        m = match_module(e.get("topic") or "", modules)
        if m and (m["id"] not in out or e["day_date"] < out[m["id"]]):
            out[m["id"]] = e["day_date"]
    return out
