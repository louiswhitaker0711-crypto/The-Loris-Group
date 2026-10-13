"""Suggested for today: a low PA asks for a retrain, a Silver-heavy mix for
order value, a weak funnel step for that step, and each person gets their two
most important. Placeholder names only."""
import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.coach_suggestions import bells_days, suggest  # noqa: E402

THROUGH = date(2026, 10, 13)   # a Tuesday


def _week(we, days):
    out = []
    for d in days:
        status, gold, silver, rnd = d
        out.append({"status": status, "over30": gold, "under30": silver, "memberships": rnd})
    return {"week_ending": we, "days": out + [{}] * (7 - len(out))}


def test_three_low_days_in_ask_for_a_retrain():
    rows = [_week("2026-10-11", [("in", 1, 0, 1), ("in", 0, 0, 0), ("ab", 0, 0, 0), ("in", 0, 1, 0), ("in", 0, 0, 0), ("off", 0, 0, 0)]),
            _week("2026-10-18", [("in", 0, 0, 0)])]
    s = suggest("Ayo Example", bells_days(rows), [], THROUGH)
    assert s[0]["kind"] == "retrain" and s[0]["title"] == "Retrain Ayo"
    assert s[0]["why"] == "1 sign-up in their last 3 days in (PA 0.3)"


def test_a_silver_heavy_mix_asks_for_order_value_and_the_round():
    rows = [_week("2026-10-11", [("in", 1, 3, 1), ("in", 1, 2, 2), ("in", 0, 2, 0), ("in", 1, 1, 1), ("in", 0, 2, 1), ("in", 1, 1, 1)])]
    s = suggest("Sam Example", bells_days(rows), [], THROUGH)
    assert [x["kind"] for x in s] == ["order_value", "the_round"]
    assert s[0]["why"] == "27% Gold over 2 weeks (target 55%)"


def test_the_weakest_step_against_the_law_of_averages():
    field = [{"date": THROUGH - timedelta(days=i), "doors": 120, "spoken": 70, "pitched": 25, "closed": 6, "sales": 2} for i in range(1, 4)]
    s = suggest("Jo Example", [], field, THROUGH)
    assert s[0]["kind"] == "funnel" and s[0]["topic"] == "Closing"
    assert s[0]["why"].startswith("6 closed from 25 pitched a day (Law of Averages 15 from 25)")


def test_nothing_to_say_when_things_are_good():
    rows = [_week("2026-10-11", [("in", 3, 1, 4), ("in", 2, 2, 4), ("in", 3, 1, 3)])]
    field = [{"date": THROUGH - timedelta(days=i), "doors": 125, "spoken": 72, "pitched": 26, "closed": 16, "sales": 4} for i in range(1, 4)]
    assert suggest("Kit Example", bells_days(rows), field, THROUGH) == []
