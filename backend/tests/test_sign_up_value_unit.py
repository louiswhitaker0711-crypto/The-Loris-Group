"""What each sign-up is worth (core/sign_up_value.py)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.sign_up_value import is_owner_pay, value  # noqa: E402


def test_ba_at_team_standards():
    # 0.9 × (20 + 0.75 × 8) + 0.1 × (12 + 0.75 × 5) + 0.75 × 8
    assert value(None, 90, 75, 75) == 30.98


def test_weaker_numbers_are_worth_less():
    assert value(None, 70, 50, 60) < value(None, 90, 75, 75)


def test_owner_gets_ba_plus_mc():
    # Gold 40 up + (8 + 9) at week 4; Silver 28 up + 5 at week 4; Round 8
    assert value(None, 100, 0, 100, owner=True) == 57
    assert value(None, 0, 0, 0, owner=True) == 28


def test_driver_bonus_on_every_sign_up():
    assert round(value(None, 90, 75, 75, driver=True) - value(None, 90, 75, 75), 2) == 6


def test_owner_default_is_a_non_viewer_admin():
    assert is_owner_pay({"role": "admin"})
    assert not is_owner_pay({"role": "admin", "is_viewer": True})
    assert not is_owner_pay({"role": "admin", "pay_type": "ba"})
    assert is_owner_pay({"role": "trainee", "pay_type": "owner"})
