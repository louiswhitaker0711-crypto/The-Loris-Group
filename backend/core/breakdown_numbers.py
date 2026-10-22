"""While OwnerIQ is switched off, each person's breakdown is the day's record.

When a breakdown is saved (doors, spoken, pitched, closed, and Silver / Gold /
The Round from Field IQ):

* an `owneriq_kpis` row is written for that person and day (source
  "breakdown"), so Field KPIs, My week / My day, averages, coaching
  suggestions and the 6pm reset read it exactly as they read OwnerIQ's;
* their Bells day is filled (Silver → under30, Gold → over30, The Round →
  memberships). The Owner's WhatsApp paste wins: a Bells day someone has
  changed since the breakdown last wrote it is left alone.

When OwnerIQ is back on, its own pull replaces the breakdown rows for the
days it pulls (owneriq_sync.sync_owneriq).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from database import db

SOURCE = "breakdown"
BELLS_KEYS = ("under30", "over30", "memberships")


def kpi_row(user: dict, iso: str, bd: dict, pin) -> dict:
    uid = str(user["_id"])
    return {
        "owneriq_id": f"bd:{uid}:{iso}", "date": iso, "source": SOURCE,
        "doors_knocked": bd.get("doors"), "spoken_to": bd.get("spoken"),
        "pitches_commenced": bd.get("pitched"), "pitches_closed": bd.get("closed"),
        "sales": bd.get("hit"), "points": None,
        "mc_pin": pin, "badge_number": (user.get("badge_number") or "").strip().upper() or None,
        "test_mode": False, "owneriq_user_id": None, "rep_name": user.get("name") or "",
        "cg1_user_id": uid, "cg1_matched_by": SOURCE, "cg1_suggested_user_id": None,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def bells_values(bd: dict) -> dict | None:
    """The Bells day from a breakdown, or None when it says nothing about
    sign-ups (no Silver/Gold typed and no doors)."""
    silver, gold, rnd = bd.get("silver"), bd.get("gold"), bd.get("round")
    if silver is None and gold is None:
        if not bd.get("doors"):
            return None
        silver = gold = 0
    silver, gold = int(silver or 0), int(gold or 0)
    return {"under30": silver, "over30": gold, "memberships": min(int(rnd or 0), silver + gold), "status": "in"}


def bells_day_writable(day: dict, ours: dict | None, owneriq_val) -> bool:
    """Write over a day nobody's touched, one this breakdown wrote and nobody
    has changed since, or one the OwnerIQ sync filled and nobody changed."""
    empty = day.get("under30") in (None, 0) and day.get("over30") in (None, 0) \
        and day.get("status") in (None, "off", "normal")
    if empty:
        return True
    if ours is not None and all(day.get(k) == ours.get(k) for k in BELLS_KEYS) and day.get("status") == "in":
        return True
    return owneriq_val is not None and day.get("under30") == owneriq_val and day.get("over30") in (None, 0) \
        and day.get("status") == "in"


async def apply_breakdown(user: dict, iso: str, bd: dict) -> None:
    from owneriq_sync import owneriq_on
    if await owneriq_on():
        return
    # A shadow day isn't scored: no KPI row, and Bells stays SD (core/hops.py).
    from core.hops import shadow_ids
    uid = str(user["_id"])
    sec = await db.sectors.find_one({"date": iso, "office_id": user.get("office_id"), "member_ids": uid}, {"hops": 1})
    if uid in shadow_ids(sec):
        return
    from owneriq_config import office_pin
    pin = await office_pin(user.get("office_id"), db)
    row = kpi_row(user, iso, bd, pin)
    await db.owneriq_kpis.update_one({"_id": row["owneriq_id"]},
                                     {"$set": row, "$setOnInsert": {"first_seen_at": row["synced_at"]}}, upsert=True)
    vals = bells_values(bd)
    if not vals:
        return
    from owneriq_performance import _bells_entry, _empty_day
    d = date.fromisoformat(iso)
    entry = await _bells_entry(user, (d + timedelta(days=6 - d.weekday())).isoformat())
    if not entry:
        return
    idx = d.weekday()
    days = list(entry.get("days") or [])
    while len(days) < 7:
        days.append(_empty_day())
    day = dict(days[idx] or {})
    ours = (entry.get("breakdown_days") or {}).get(str(idx))
    if not bells_day_writable(day, ours, (entry.get("owneriq_days") or {}).get(str(idx))):
        return
    day.update(vals)
    days[idx] = day
    await db.bells_entries.update_one({"id": entry["id"]}, {"$set": {
        "days": days, f"breakdown_days.{idx}": {k: vals[k] for k in BELLS_KEYS},
        "updated_at": datetime.now(timezone.utc).isoformat()}})
