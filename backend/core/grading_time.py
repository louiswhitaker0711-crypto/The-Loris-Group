"""When a new start's day is ready to grade (the Owner's call, 24 Oct 2026).

A day is graded after it's been done. A new start's CURRENT day is the one
they're doing today, so it only counts as waiting once today's field is over
(from 19:30 Monday to Friday, when the breakdown starts; from 17:00 on a
Saturday; any time on a Sunday). Earlier days still ungraded always count.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from core.app_time import APP_TZ

READY_FROM = {5: (17, 0), 6: (0, 0)}   # Saturday, Sunday; every other day 19:30
WEEKDAY_READY = (19, 30)


def todays_day_ready(now: Optional[datetime] = None) -> bool:
    now = (now or datetime.now(APP_TZ)).astimezone(APP_TZ)
    h, m = READY_FROM.get(now.weekday(), WEEKDAY_READY)
    return (now.hour, now.minute) >= (h, m)


def ready_to_grade(day_number, current_day, now: Optional[datetime] = None) -> bool:
    """True when this day should show as waiting to be graded."""
    d, cur = int(day_number or 99), int(current_day or 1)
    if d < cur:
        return True
    return d == cur and todays_day_ready(now)
