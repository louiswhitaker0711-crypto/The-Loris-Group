"""After a deploy the hourly OwnerIQ pull carries on from the last one."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.app_time import next_hourly_run  # noqa: E402

NOW = datetime(2026, 10, 14, 15, 40, tzinfo=timezone.utc)


def test_an_hour_after_the_last_pull():
    assert next_hourly_run("2026-10-14T15:10:00+00:00", NOW) == datetime(2026, 10, 14, 16, 10, tzinfo=timezone.utc)


def test_overdue_runs_in_a_minute():
    assert next_hourly_run("2026-10-14T13:00:00+00:00", NOW) == NOW + timedelta(seconds=60)


def test_no_last_pull():
    assert next_hourly_run(None, NOW) is None and next_hourly_run("nonsense", NOW) is None
