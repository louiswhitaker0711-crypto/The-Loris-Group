"""Bells is the record of sign-ups (the Owner, 12 Nov 2026).

A breakdown's sign-ups can be missing or wrong (forgotten, typed before the
day was in), and the Owner fixes the day on Bells. Wherever KPIs are read,
a person's sign-ups for a day come from their Bells day (Silver + Gold) when
Bells has been filled in for it, so a fix on Bells shows in Field KPIs, the
ratios to one sign-up, averages, reports and the AI straight away.

The breakdown's own number stays only when Bells is empty for the day, or
when Bells still holds exactly what that breakdown wrote into it (a breakdown
with a plain "hit" and no Silver/Gold split writes 0/0 there, so that 0 must
not wipe the hit).
"""
from __future__ import annotations

from datetime import date, timedelta

from database import db


def _week_ending(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return (d + timedelta(days=6 - d.weekday())).isoformat()


def bells_total(entry: dict, iso: str):
    """Silver + Gold on a Bells day, or None when the day has no sign-ups
    typed, or still holds just what the breakdown put there."""
    idx = date.fromisoformat(iso[:10]).weekday()
    days = entry.get("days") or []
    day = days[idx] if idx < len(days) else None
    if not day or (day.get("under30") is None and day.get("over30") is None):
        return None
    ours = (entry.get("breakdown_days") or {}).get(str(idx))
    if ours is not None and day.get("under30") == ours.get("under30") and day.get("over30") == ours.get("over30"):
        return None
    return int(day.get("under30") or 0) + int(day.get("over30") or 0)


async def bells_wins(rows: list[dict]) -> list[dict]:
    """Set each KPI row's `sales` from Bells (see module docstring). A person
    with several rows on one day gets the Bells total once: on their breakdown
    row if they have one, else their first row, the rest 0."""
    rows = list(rows or [])
    keys = {(str(r.get("cg1_user_id")), str(r.get("date") or "")[:10]) for r in rows
            if r.get("cg1_user_id") and len(str(r.get("date") or "")) >= 10}
    if not keys:
        return rows
    uids = list({k[0] for k in keys})
    weeks = list({_week_ending(k[1]) for k in keys})
    entries: dict[tuple, dict] = {}
    async for e in db.bells_entries.find({"user_id": {"$in": uids}, "week_ending": {"$in": weeks}},
                                         {"_id": 0, "user_id": 1, "week_ending": 1, "days": 1, "breakdown_days": 1}):
        entries[(str(e["user_id"]), e["week_ending"])] = e
    totals: dict[tuple, int] = {}
    for uid, iso in keys:
        e = entries.get((uid, _week_ending(iso)))
        t = bells_total(e, iso) if e else None
        if t is not None:
            totals[(uid, iso)] = t
    if not totals:
        return rows
    # Which row carries the day's total: the breakdown row first.
    carrier: dict[tuple, int] = {}
    for i, r in enumerate(rows):
        k = (str(r.get("cg1_user_id")), str(r.get("date") or "")[:10])
        if k not in totals:
            continue
        if k not in carrier or (r.get("source") == "breakdown" and rows[carrier[k]].get("source") != "breakdown"):
            carrier[k] = i
    out = []
    for i, r in enumerate(rows):
        k = (str(r.get("cg1_user_id")), str(r.get("date") or "")[:10])
        if k in totals:
            r = {**r, "sales": totals[k] if carrier.get(k) == i else 0}
        out.append(r)
    return out
