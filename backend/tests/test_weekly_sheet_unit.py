"""The owner's weekly sheet saves into the weekly planner: its header rows
live in review.office_plan (plus concentration and social), and its extra
day rows are ordinary day boxes."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import weekly_planners as wp  # noqa: E402


def test_header_rows_are_kept_and_trimmed():
    out = wp._normalize_review({"office_plan": {"expectations_1": "  On time, 9:30  ", "competition": "Bells race",
                                                 "made_up": "dropped"}, "concentration": "Rehash"})
    assert out["office_plan"]["expectations_1"] == "On time, 9:30"
    assert out["office_plan"]["competition"] == "Bells race"
    assert "made_up" not in out["office_plan"]
    assert set(out["office_plan"]) == set(wp.OFFICE_PLAN_FIELDS)
    assert out["concentration"] == "Rehash"


def test_sheet_day_rows_are_day_boxes():
    for k in ("stage1", "stage2", "sales_impact", "product_coaching", "appointments"):
        assert k in wp.DAY_FIELDS and k in wp.DAY_FIELD_LABELS
    days = wp._normalize_days({"0": {"sales_impact": "Close variations", "appointments": "2 interviews"}})
    assert days["0"]["sales_impact"] == "Close variations"
    assert days["0"]["appointments"] == "2 interviews"


def test_sheet_layout_keeps_order_times_and_labels():
    rows = wp.normalize_sheet_layout([
        {"key": "sector", "label": "Field", "time": "13:30"},
        {"key": "stage1", "time": "25:00"},
        {"key": "sector", "label": "duplicate"},
        {"key": "not_a_box", "label": "x"},
        {"key": "appointments", "on_sheet": False},
    ])
    assert [r["key"] for r in rows[:3]] == ["sector", "stage1", "appointments"]
    assert rows[0] == {"key": "sector", "label": "Field", "time": "13:30", "on_sheet": True}
    assert rows[1]["time"] == "" and rows[1]["label"] == "Stage 1"
    assert rows[2]["on_sheet"] is False
    # every day box is there exactly once
    assert sorted(r["key"] for r in rows) == sorted(wp.DAY_FIELDS)


def test_sheet_layout_default_is_in_time_order_and_matches_the_paper_sheet():
    rows = wp.normalize_sheet_layout(None)
    times = [r["time"] for r in rows if r["time"]]
    assert times == sorted(times)
    assert sum(r["on_sheet"] for r in rows) == 10
