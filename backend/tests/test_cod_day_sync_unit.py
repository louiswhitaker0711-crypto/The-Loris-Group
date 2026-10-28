"""Field days feed the COD: lowest rung of linked rows (core/cod_day_sync.py)."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.cod_day_sync import rungs_for_day  # noqa: E402


def test_lowest_of_the_five_steps():
    rows = [{"topic": t, "grade": "Do"} for t in ("Introduction", "Presentation", "Short Story", "Rehash")]
    rows.append({"topic": "Close", "grade": "Know"})
    out = rungs_for_day(rows)
    assert out["5-Step Sign-Up Process"] == 1
    assert out["Clear Close"] == 1


def test_ungraded_and_off_ladder_rows_dont_count():
    rows = [{"topic": "Field IQ", "grade": "Deliver"}, {"topic": "Field IQ Accuracy", "grade": None},
            {"topic": "Daily KPI Standard", "grade": "Met"}, {"topic": "Unlinked", "grade": "Do"}]
    assert rungs_for_day(rows) == {"Field IQ": 3}


def test_not_learnt_is_zero():
    assert rungs_for_day([{"topic": "Impulse Factors", "grade": "Not Learnt"}]) == {"Impulses": 0}
