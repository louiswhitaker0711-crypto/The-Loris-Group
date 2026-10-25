"""A new start's current day only waits to be graded after the field (core/grading_time.py)."""
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.app_time import APP_TZ  # noqa: E402
from core.grading_time import ready_to_grade  # noqa: E402

SAT_MORNING = datetime(2026, 10, 24, 9, 52, tzinfo=APP_TZ)
SAT_TEA = datetime(2026, 10, 24, 17, 5, tzinfo=APP_TZ)
FRI_AFTERNOON = datetime(2026, 10, 23, 15, 0, tzinfo=APP_TZ)
FRI_BREAKDOWN = datetime(2026, 10, 23, 19, 30, tzinfo=APP_TZ)
SUNDAY = datetime(2026, 10, 25, 10, 0, tzinfo=APP_TZ)


def test_todays_day_isnt_waiting_in_the_morning():
    assert not ready_to_grade(4, 4, SAT_MORNING)
    assert not ready_to_grade(4, 4, FRI_AFTERNOON)


def test_todays_day_is_waiting_after_the_field():
    assert ready_to_grade(4, 4, FRI_BREAKDOWN)
    assert ready_to_grade(4, 4, SAT_TEA)
    assert ready_to_grade(4, 4, SUNDAY)


def test_an_earlier_day_still_ungraded_always_waits():
    assert ready_to_grade(3, 4, SAT_MORNING)


def test_a_later_day_never_waits():
    assert not ready_to_grade(5, 4, SAT_TEA)


SAT_NIGHT_GRADED = "2026-10-24T18:40:00+00:00"   # graded Saturday's day after the field
SAT_MORNING_GRADED = "2026-10-24T08:15:00+00:00"  # graded Friday's day before Saturday's field
SUNDAY_MORNING = datetime(2026, 10, 25, 8, 50, tzinfo=APP_TZ)


def test_no_sunday_nag_when_saturdays_day_was_graded_on_saturday():
    # Grading moved them on to a day they haven't done yet.
    assert not ready_to_grade(7, 7, SUNDAY_MORNING, last_graded=SAT_NIGHT_GRADED)


def test_sunday_still_nags_when_saturdays_day_isnt_graded():
    assert ready_to_grade(7, 7, SUNDAY_MORNING, last_graded="2026-10-23T20:00:00+01:00")
    assert ready_to_grade(7, 7, SUNDAY_MORNING, last_graded=None)


def test_grading_fridays_day_on_saturday_morning_still_leaves_saturday_waiting():
    assert ready_to_grade(7, 7, SAT_TEA, last_graded=SAT_MORNING_GRADED)


def test_graded_tonight_means_tomorrows_day_isnt_waiting():
    assert not ready_to_grade(5, 5, datetime(2026, 10, 23, 21, 0, tzinfo=APP_TZ),
                              last_graded="2026-10-23T20:10:00+01:00")
