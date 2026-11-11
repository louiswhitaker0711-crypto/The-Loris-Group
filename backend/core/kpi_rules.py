"""Which field days count towards the KPIs (the Owner's rule, 20 Oct 2026).

A day is left out of every KPI figure (Field KPIs, averages, ratios to one
sign-up, coach suggestions, reports) when:
  * fewer than 10 doors were knocked that day, or
  * doors, spoken, pitched and closed are all the same (like 2/2/2/2) —
    numbers typed in to fill the gap, not a real field day.
It applies every day of the week. Sign-ups on Bells are not affected: this is
only about the KPI numbers.
"""
from __future__ import annotations

MIN_DOORS = 10
RAW = ("doors_knocked", "spoken_to", "pitches_commenced", "pitches_closed")


def day_counts(doors, spoken, pitched, closed) -> bool:
    """True when one person's day of numbers counts towards the KPIs."""
    d, s, p, c = (int(x or 0) for x in (doors, spoken, pitched, closed))
    if d < MIN_DOORS:
        return False
    if d == s == p == c:
        return False
    return True


def person_key(row: dict) -> str:
    """Who a KPI row belongs to, so one person is always one person: their app
    account first (the breakdowns and any synced row linked to them), then the
    account an old synced row's name pointed at (display grouping only, never
    access), then the badge / OwnerIQ id / name. Lower-cased so a badge typed
    either way is the same person."""
    return str(row.get("cg1_user_id") or row.get("cg1_suggested_user_id") or row.get("badge_number")
               or row.get("owneriq_user_id") or " ".join((row.get("rep_name") or "?").split())).lower()


_person = person_key


def breakdown_wins(rows: list[dict]) -> list[dict]:
    """The breakdowns are the KPIs (the Owner, 11 Nov 2026: OwnerIQ is gone).
    When a person has a breakdown for a day, any old synced row for that same
    day is dropped, so the day is counted once, from the breakdown. Old synced
    rows stay only for days with no breakdown (history from before the switch)."""
    rows = list(rows)
    have_bd = {(person_key(r), str(r.get("date") or "")[:10]) for r in rows if r.get("source") == "breakdown"}
    if not have_bd:
        return rows
    return [r for r in rows if r.get("source") == "breakdown"
            or (person_key(r), str(r.get("date") or "")[:10]) not in have_bd]


def counted_rows(rows: list[dict]) -> list[dict]:
    """Raw KPI rows (owneriq_kpis fields) for the days that count. A person can
    have more than one row for a day, so the day is judged on its totals."""
    rows = breakdown_wins(rows)
    days: dict[tuple, list] = {}
    for r in rows:
        k = (_person(r), str(r.get("date") or "")[:10])
        days.setdefault(k, [0, 0, 0, 0])
        for i, f in enumerate(RAW):
            days[k][i] += int(r.get(f) or 0)
    ok = {k for k, v in days.items() if day_counts(*v)}
    return [r for r in rows if (_person(r), str(r.get("date") or "")[:10]) in ok]
