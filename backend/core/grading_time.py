"""When a new start's day is ready to grade (the Owner's call, 24 Oct 2026).

A day is graded after it's been done. A new start's CURRENT day is the one
they're doing today, so it only counts as waiting once today's field is over
(from 19:30 Monday to Friday, when the breakdown starts; from 17:00 on a
Saturday; any time on a Sunday). Earlier days still ungraded always count.

Grading a day moves the new start on to their next day, which they haven't
done yet. So if a day was graded after the latest field day started (13:30
Monday to Friday, 10:00 on a Saturday), today's work is already graded and
their current day isn't waiting: grade Saturday's day on Saturday night and
nothing nags on Sunday morning (the Owner, 25 Oct 2026).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable, Optional

from core.app_time import APP_TZ

READY_FROM = {5: (17, 0), 6: (0, 0)}   # Saturday, Sunday; every other day 19:30
WEEKDAY_READY = (19, 30)
FIELD_START = {5: (10, 0)}             # Saturday; Monday to Friday 13:30
WEEKDAY_FIELD_START = (13, 30)


def todays_day_ready(now: Optional[datetime] = None) -> bool:
    now = (now or datetime.now(APP_TZ)).astimezone(APP_TZ)
    h, m = READY_FROM.get(now.weekday(), WEEKDAY_READY)
    return (now.hour, now.minute) >= (h, m)


def latest_field_start(now: Optional[datetime] = None) -> datetime:
    """When the most recent field day (Monday to Saturday) started, at or before now."""
    now = (now or datetime.now(APP_TZ)).astimezone(APP_TZ)
    for back in range(8):
        day = (now - timedelta(days=back)).date()
        if day.weekday() == 6:
            continue
        h, m = FIELD_START.get(day.weekday(), WEEKDAY_FIELD_START)
        start = datetime(day.year, day.month, day.day, h, m, tzinfo=APP_TZ)
        if start <= now:
            return start
    return now


def last_graded_at(rows: Iterable[dict]) -> Optional[str]:
    """The latest assessment_date among a new start's graded days."""
    dates = [str(a.get("assessment_date")) for a in rows if a.get("completed") and a.get("assessment_date")]
    return max(dates) if dates else None


def _parse(when) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(when))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=APP_TZ)


def ready_to_grade(day_number, current_day, now: Optional[datetime] = None,
                   last_graded: Optional[str] = None) -> bool:
    """True when this day should show as waiting to be graded. `last_graded`
    is when their latest day was graded (last_graded_at)."""
    d, cur = int(day_number or 99), int(current_day or 1)
    if d < cur:
        return True
    if d != cur or not todays_day_ready(now):
        return False
    graded = _parse(last_graded) if last_graded else None
    return not (graded and graded >= latest_field_start(now))
