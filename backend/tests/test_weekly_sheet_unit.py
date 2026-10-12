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
