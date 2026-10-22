"""Bells sign-ups vs the KPI numbers (the Owner's call, 22 Oct 2026).

Bells is the true count of sign-ups. The KPI figures (doors, spoken,
pitched, closed and the ratios) can only come from the people whose numbers
are in and count (core/kpi_rules.py). When the two differ, the screens show
Bells' number as the headline and a line underneath: "KPIs from 15 · 1
missing: <name>". Coaches and Admins see the names; a BA sees the count.
Nobody is nudged about it.

A person is "missing" for a day when they have sign-ups on Bells that day
but no KPI day that counts: either nothing was posted ("not posted") or the
day was left out by the KPI rules ("didn't count").
"""
from __future__ import annotations

from datetime import date, timedelta

from core.kpi_rules import counted_rows

RAW = ("doors_knocked", "spoken_to", "pitches_commenced", "pitches_closed")


def _week_endings(from_date: str, to_date: str) -> list[str]:
    d0, d1 = date.fromisoformat(from_date), date.fromisoformat(to_date)
    first = d0 + timedelta(days=6 - d0.weekday())
    out, w = [], first
    while w <= d1 + timedelta(days=6 - d1.weekday()):
        out.append(w.isoformat())
        w += timedelta(days=7)
    return out


def _day_sales(day: dict | None) -> int:
    if not day:
        return 0
    return int(day.get("under30") or 0) + int(day.get("over30") or 0)


def compare(bells_entries: list[dict], kpi_rows: list[dict], from_date: str, to_date: str,
            show_names: bool) -> dict:
    """Pure: Bells sign-ups in the range against the KPI rows for the same range."""
    d0, d1 = date.fromisoformat(from_date), date.fromisoformat(to_date)
    counted = {(str(r.get("cg1_user_id")), str(r.get("date") or "")[:10])
               for r in counted_rows(kpi_rows) if r.get("cg1_user_id")}
    posted = {(str(r.get("cg1_user_id")), str(r.get("date") or "")[:10])
              for r in kpi_rows if r.get("cg1_user_id") and any(r.get(f) for f in RAW)}
    kpi_sales = sum(int(r.get("sales") or 0) for r in counted_rows(kpi_rows))

    bells_sales = 0
    missing: dict[str, dict] = {}
    for e in bells_entries:
        uid = str(e.get("user_id") or "")
        try:
            wk = date.fromisoformat(str(e.get("week_ending"))[:10])
        except ValueError:
            continue
        monday = wk - timedelta(days=6)
        for i, day in enumerate((e.get("days") or [])[:7]):
            d = monday + timedelta(days=i)
            if d < d0 or d > d1:
                continue
            n = _day_sales(day)
            if not n:
                continue
            bells_sales += n
            iso = d.isoformat()
            if (uid, iso) in counted:
                continue
            m = missing.setdefault(uid, {"user_id": uid, "name": e.get("user_name") or "",
                                         "sales": 0, "reason": "not posted"})
            m["sales"] += n
            if (uid, iso) in posted:
                m["reason"] = "didn't count"

    people = sorted(missing.values(), key=lambda m: (-m["sales"], m["name"]))
    if not show_names:
        people = [{"sales": m["sales"], "reason": m["reason"]} for m in people]
    return {
        "bells_sales": bells_sales,
        "kpi_sales": kpi_sales,
        "missing_count": len(people),
        "missing": people,
        "names_shown": bool(show_names),
        "differs": bells_sales != kpi_sales or bool(people),
    }


async def coverage(db, bells_filter: dict | None, kpi_rows: list[dict], from_date: str, to_date: str,
                   show_names: bool) -> dict:
    """Load the Bells weeks the range touches (within `bells_filter`, the same
    people the caller may see) and compare. `bells_filter=None` means nobody."""
    entries: list[dict] = []
    if bells_filter is not None:
        q = {**bells_filter, "week_ending": {"$in": _week_endings(from_date, to_date)}}
        entries = await db.bells_entries.find(
            q, {"_id": 0, "user_id": 1, "user_name": 1, "week_ending": 1, "days": 1}
        ).to_list(length=5000)
    return compare(entries, kpi_rows, from_date, to_date, show_names)
