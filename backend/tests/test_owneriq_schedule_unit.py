"""Field IQ day plans → Bells: planned out = Not scheduled (ab, grey), planned
in but didn't go out = No show (ns, black). A day changed in the app keeps
the change."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from owneriq_performance import schedule_status_updates  # noqa: E402


def _days(**st):
    out = [{"over30": None, "under30": None, "memberships": None, "status": "off"} for _ in range(7)]
    for k, v in st.items():
        out[int(k[1:])]["status"] = v
    return out


# Week of Mon 12 Oct 2026
def _oiq(**st):
    dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]
    return [{"date": dates[int(k[1:])], "status": v} for k, v in st.items()]


def test_planned_out_and_no_show_fill_untouched_days():
    up = schedule_status_updates(_days(), _oiq(d0="present", d1="not_present", d2="absent", d5="planned_out", d6="not_present"), {})
    assert up == {1: "ab", 2: "ns", 5: "ab"}   # Sunday is never touched


def test_a_day_changed_in_the_app_is_left_alone():
    days = _days(d1="in", d2="rt")
    days[1]["under30"] = 2
    assert schedule_status_updates(days, _oiq(d1="not_present", d2="absent"), {}) == {}


def test_our_own_earlier_value_follows_field_iq_and_clears():
    days = _days(d1="ab", d3="ab")
    up = schedule_status_updates(days, _oiq(d1="planned_in", d3="absent"), {"1": "ab", "3": "ab"})
    assert up == {1: "off", 3: "ns"}


def test_someone_elses_not_scheduled_is_kept():
    # Set in the app (not by the sync): Field IQ saying "planned in" doesn't undo it.
    assert schedule_status_updates(_days(d4="ab"), _oiq(d4="planned_in"), {}) == {}
