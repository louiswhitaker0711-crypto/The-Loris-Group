"""Breakeven pushes: the week's sign-ups against breakeven (core/breakeven_alerts.py)."""
from datetime import date

from core.breakeven_alerts import breakeven_for, hit, week_ending, week_total

FEES = {"fee_ba_target": 20, "fee_round": 8}


def test_week_ending_is_sunday():
    assert week_ending(date(2026, 10, 29)) == "2026-11-01"   # Thursday → Sunday
    assert week_ending(date(2026, 11, 1)) == "2026-11-01"    # Sunday itself


def test_week_total_counts_silver_and_gold():
    e = {"days": [{"over30": 2, "under30": 1}, {"over30": 1}, {}, None]}
    assert week_total(e) == 4


def test_plan_wins_over_a_stored_breakeven():
    # A stored BE was usually the plan's old figure saved back by a day edit
    # (the Owner, 3 Nov 2026), so the plan always wins when there is one.
    plan = {"needs": [{"label": "Rent", "amount": 260, "per": "week"}]}
    assert breakeven_for({"break_even": 5}, plan, FEES, 26) == 10


def test_typed_breakeven_when_no_plan():
    assert breakeven_for({"break_even": 5}, None, FEES) == 5


def test_monthly_bills_become_weekly():
    # £1,300 a month = £300 a week; at £30 a sign-up that's 10 a week, not 44.
    plan = {"needs": [{"label": "Rent", "amount": 1300, "per": "month"}]}
    assert breakeven_for({}, plan, FEES, 30) == 10


def test_plan_breakeven_when_nothing_typed():
    plan = {"needs": [{"label": "Rent", "amount": 260, "per": "week"}]}
    be = breakeven_for({}, plan, FEES)
    assert isinstance(be, int) and be > 0


def test_no_plan_no_breakeven():
    assert breakeven_for({}, None, FEES) is None


def test_hit():
    assert hit(6, 6) and hit(7, 6)
    assert not hit(5, 6)
    assert not hit(9, None)
