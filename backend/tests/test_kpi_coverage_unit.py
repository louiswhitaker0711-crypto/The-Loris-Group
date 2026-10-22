"""Bells sign-ups vs KPI numbers (core/kpi_coverage.py).

Bells is the true count; the KPIs cover only who posted a day that counts.
The gap is listed by name for Coaches and Admins, as a count for a BA.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.kpi_coverage import compare, _week_endings  # noqa: E402

WK = "2026-10-25"          # Sunday; Monday 19 Oct is days[0]
WED = "2026-10-21"         # days[2]


def _day(silver=0, gold=0):
    return {"under30": silver, "over30": gold, "memberships": 0, "status": "in"}


def _entry(uid, name, wed):
    days = [{} for _ in range(7)]
    days[2] = wed
    return {"user_id": uid, "user_name": name, "week_ending": WK, "days": days}


def _kpi(uid, sales, doors=120, spoken=70, pitched=25, closed=15):
    return {"cg1_user_id": uid, "date": WED, "doors_knocked": doors, "spoken_to": spoken,
            "pitches_commenced": pitched, "pitches_closed": closed, "sales": sales}


def test_someone_who_did_not_post_is_missing_by_name():
    entries = [_entry("a", "Example One", _day(4, 6)), _entry("b", "Example Two", _day(5, 0)),
               _entry("c", "Example Three", _day(0, 1))]
    rows = [_kpi("a", 10), _kpi("b", 5)]
    out = compare(entries, rows, WED, WED, show_names=True)
    assert out["bells_sales"] == 16
    assert out["kpi_sales"] == 15
    assert out["missing_count"] == 1
    assert out["missing"][0] == {"user_id": "c", "name": "Example Three", "sales": 1, "reason": "not posted"}
    assert out["differs"] is True


def test_a_ba_sees_only_the_count():
    entries = [_entry("c", "Example Three", _day(1, 0))]
    out = compare(entries, [], WED, WED, show_names=False)
    assert out["missing"] == [{"sales": 1, "reason": "not posted"}]
    assert out["names_shown"] is False


def test_a_day_left_out_by_the_kpi_rules_reads_didnt_count():
    entries = [_entry("a", "Example One", _day(2, 0))]
    rows = [_kpi("a", 2, doors=2, spoken=2, pitched=2, closed=2)]
    out = compare(entries, rows, WED, WED, show_names=True)
    assert out["kpi_sales"] == 0
    assert out["missing"][0]["reason"] == "didn't count"


def test_matching_numbers_show_no_caveat():
    entries = [_entry("a", "Example One", _day(3, 1))]
    out = compare(entries, [_kpi("a", 4)], WED, WED, show_names=True)
    assert out["differs"] is False and out["missing_count"] == 0


def test_days_outside_the_range_are_ignored():
    days = [_day(5, 0)] + [{} for _ in range(6)]   # Monday only
    entries = [{"user_id": "a", "user_name": "Example One", "week_ending": WK, "days": days}]
    out = compare(entries, [], WED, WED, show_names=True)
    assert out["bells_sales"] == 0 and out["missing_count"] == 0


def test_week_endings_cover_the_range():
    assert _week_endings("2026-10-19", "2026-10-25") == ["2026-10-25"]
    assert _week_endings("2026-10-24", "2026-10-27") == ["2026-10-25", "2026-11-01"]
