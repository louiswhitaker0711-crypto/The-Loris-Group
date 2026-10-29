"""Coaching today drops a new start's day once it was graded before today's
field started (the Owner, 29 Oct 2026: a signed-off Day 8 kept showing)."""
from datetime import datetime

from core.app_time import APP_TZ
from routes.coaching_today import graded_before_today


def test_graded_yesterday_is_over():
    now = datetime(2026, 10, 29, 15, 0, tzinfo=APP_TZ)          # Thursday, in the field
    assert graded_before_today("2026-10-28T21:10:00+00:00", now)


def test_graded_after_todays_field_start_still_shows():
    now = datetime(2026, 10, 29, 21, 0, tzinfo=APP_TZ)
    assert not graded_before_today("2026-10-29T20:30:00+00:00", now)


def test_missing_or_bad_date_keeps_it():
    now = datetime(2026, 10, 29, 15, 0, tzinfo=APP_TZ)
    assert not graded_before_today(None, now)
    assert not graded_before_today("not a date", now)
