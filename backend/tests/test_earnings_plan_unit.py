"""Plan your earnings (core/earnings_plan.py): monthly rows become weekly,
one sign-up counts at Gold up front + The Round on 75%, breakeven rounds up."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.earnings_plan import clean_rows, compute, per_sign_up, weekly  # noqa: E402


def test_per_sign_up_is_gold_plus_three_quarters_of_the_round():
    assert per_sign_up(None) == 26.0            # £20 + 75% × £8
    assert per_sign_up({"fee_target": 24, "fee_membership": 8}) == 30.0


def test_monthly_becomes_weekly():
    assert round(weekly("520", "month"), 2) == 120.0
    assert weekly("50", "week") == 50.0
    assert weekly("abc", "week") == 0.0 and weekly("-5", "week") == 0.0


def test_breakeven_and_target_round_up():
    plan = {"needs": [{"amount": "600", "per": "month"}, {"amount": "10", "per": "week"}],
            "wants": [{"amount": "52", "per": "week"}]}
    out = compute(plan, None)
    assert out["breakeven"] == 6                # £148.46 a week ÷ £26
    assert out["target"] == 8                   # £200.46 ÷ £26
    assert compute({}, None)["breakeven"] is None


def test_rows_are_tidied():
    rows = clean_rows([{"label": " Rent ", "amount": "600", "per": "month"}, {"amount": "5", "per": "daily"}, "x"])
    assert rows[0]["label"] == "Rent" and rows[0]["per"] == "month"
    assert rows[1]["per"] == "week" and len(rows) == 2
