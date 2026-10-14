"""Pay rules on the server: the fee knobs, Bells' sign-up fees, and
GET /bells/my-summary (the Earnings Calculator's own-numbers feed).

Bells day fields keep their original names: `under30` = Silver sign-ups
(£5.00 to £9.99 order), `over30` = Gold sign-ups (£10+ order), `memberships`
= sign-ups that took The Round. A membership adds a fee to a sign-up; it is
never a sign-up of its own.

Pure in-memory: mongomock_motor, no network, no real Mongo.
"""
import asyncio
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.app_time import APP_TZ  # noqa: E402
from core.vertex_pay import DEFAULT_FEES, clean_fee_update, normalize_fees, retention_fees, sign_up_fees  # noqa: E402
from routes import bells  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _day(over30=None, under30=None, memberships=None, status="in"):
    return {"over30": over30, "under30": under30, "memberships": memberships, "status": status}


def _week(*days):
    days = list(days) + [_day(status="off")] * 7
    return days[:7]


# ── core/vertex_pay ────────────────────────────────────────────────────────

def test_worked_examples_from_the_owner():
    # Silver with no membership: £12 up front, £5 at week 4 = £17.
    assert sign_up_fees(1, 0, None)["sign_up_fees"] == 12
    assert retention_fees(1, 0, None)["retention_fees"] == 5
    # Gold with The Round: £20 + £8 up front, £8 at week 4 = £36.
    assert sign_up_fees(0, 1, None, 1)["sign_up_fees"] == 28
    assert retention_fees(0, 1, None)["retention_fees"] == 8


def test_each_tier_uses_its_own_knob():
    out = sign_up_fees(2, 3, {"fee_standard": 13, "fee_target": 22, "fee_membership": 9}, 4)
    assert out["standard_earnings"] == 26
    assert out["target_earnings"] == 66
    assert out["membership_earnings"] == 36
    assert out["sign_up_fees"] == 128
    assert out["standard_count"] == 2 and out["target_count"] == 3 and out["membership_count"] == 4


def test_no_more_memberships_are_paid_than_sign_ups():
    # A membership is an add-on to a sign-up, so 1 sign-up can carry 1 at most.
    out = sign_up_fees(1, 0, None, 5)
    assert out["membership_count"] == 1
    assert out["sign_up_fees"] == 12 + 8


def test_retention_pays_each_tier_at_its_own_rate():
    out = retention_fees(3, 2, {"retention_standard": 6, "retention_target": 10})
    assert out["standard_earnings"] == 18 and out["target_earnings"] == 20
    assert out["retention_fees"] == 38
    assert retention_fees(None, -4, None)["retention_fees"] == 0


def test_normalize_fills_defaults_and_ignores_other_shapes():
    assert normalize_fees(None) == DEFAULT_FEES
    legacy = {"base": {"first": 35}, "volume_threshold": 12, "fee_standard": True}
    assert normalize_fees(legacy) == DEFAULT_FEES
    # Knobs from the earlier pay model are simply not knobs any more.
    assert "quality_lag_months" not in normalize_fees({"quality_lag_months": 4, "third_dd_bonus": 15})
    assert normalize_fees({"fee_standard": "12.5"})["fee_standard"] == 12.5
    assert normalize_fees({"retention_target": 99999})["retention_target"] == 8   # out of range → default


def test_clean_fee_update_drops_unknown_and_rejects_bad():
    assert clean_fee_update({"fee_target": 21, "office_name": "X", "quality_gate_pct": 70}) == {"fee_target": 21}
    with pytest.raises(ValueError):
        clean_fee_update({"fee_membership": -1})
    with pytest.raises(ValueError):
        clean_fee_update(["fee_target", 21])


# ── compute_totals ─────────────────────────────────────────────────────────

def test_compute_totals_prices_the_tiers_and_adds_the_membership_fee():
    entry = {"days": _week(_day(over30=1, under30=2, memberships=2), _day(under30=1))}
    t = bells.compute_totals(entry, None)
    assert t["total_sales"] == 4          # 1 Gold + 3 Silver — a membership is not a sign-up
    assert t["total_under30"] == 3 and t["total_over30"] == 1 and t["total_memberships"] == 2
    assert t["earnings"] == 3 * 12 + 20 + 2 * 8   # defaults when nothing is stored
    bd = t["earnings_breakdown"]
    assert bd["standard_earnings"] == 36 and bd["target_earnings"] == 20 and bd["membership_earnings"] == 16
    assert bd["sign_up_fees"] == t["earnings"]


def test_compute_totals_uses_the_office_knobs():
    entry = {"days": _week(_day(over30=2, under30=1, memberships=1))}
    t = bells.compute_totals(entry, {"office_id": "o", "fee_standard": 10, "fee_target": 25, "fee_membership": 5})
    assert t["earnings"] == 10 + 2 * 25 + 5


def test_compute_totals_tolerates_an_old_fee_document():
    entry = {"days": _week(_day(over30=1, under30=1))}
    old = {"base": {"first": 35, "second": 20, "fourth": 10}, "targets": {}, "base_commission": 25}
    assert bells.compute_totals(entry, old)["earnings"] == 12 + 20


# ── GET /bells/my-summary ──────────────────────────────────────────────────

class _Req:
    headers: dict = {}


@pytest.fixture
def summary_db(monkeypatch):
    db = AsyncMongoMockClient()["vertex_summary_test"]

    async def _user(_request):
        return {"id": "me", "role": "trainee", "office_id": "off-ldn"}

    monkeypatch.setattr(bells, "db", db)
    monkeypatch.setattr(bells, "get_current_user", _user)
    return db


def _this_sunday() -> date:
    today = datetime.now(APP_TZ).date()
    return today + timedelta(days=(6 - today.weekday()) % 7)


def test_my_summary_reads_only_my_row_for_this_week(summary_db):
    we = _this_sunday().isoformat()
    _run(summary_db.bells_entries.insert_many([
        {"id": "a", "office_id": "off-ldn", "user_id": "me", "week_ending": we,
         "days": _week(_day(over30=1, under30=2, memberships=1), _day(under30=1, memberships=1))},
        {"id": "b", "office_id": "off-ldn", "user_id": "someone-else", "week_ending": we,
         "days": _week(_day(over30=9, under30=9))},
    ]))
    _run(summary_db.commission_fees.insert_one({"office_id": "off-ldn", "fee_standard": 14}))
    out = _run(bells.my_bells_summary(_Req()))
    assert out["week_ending"] == we
    assert out["has_entry"] is True
    assert out["this_week"]["standard"] == 3
    assert out["this_week"]["target"] == 1
    assert out["this_week"]["sign_ups"] == 4
    assert out["this_week"]["memberships"] == 2
    assert out["this_week"]["earnings"] == 3 * 14 + 20 + 2 * 8
    assert out["fees"]["fee_standard"] == 14 and out["fees"]["fee_target"] == 20


def test_my_summary_with_no_row_is_zero(summary_db):
    out = _run(bells.my_bells_summary(_Req()))
    assert out["has_entry"] is False
    days = out["this_week"].pop("days")
    assert out["this_week"] == {"standard": 0, "target": 0, "memberships": 0, "sign_ups": 0, "days_worked": 0, "earnings": 0, "weekly_goal": None}
    assert len(days) == 6 and all(d == {"status": "off", "silver": 0, "gold": 0, "round": 0} for d in days)
    assert len(out["months"]) == 6
    assert out["fees"] == DEFAULT_FEES


def test_my_summary_splits_a_week_across_two_months(summary_db, monkeypatch):
    """Week ending Sun 4 Oct 2026 runs Mon 28 Sep → Sun 4 Oct: sign-ups on the
    Mon–Wed count for September, Thu onwards for October."""
    class _FixedNow(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 20, 12, 0, tzinfo=tz)

    monkeypatch.setattr(bells, "datetime", _FixedNow)
    days = _week(
        _day(under30=1), _day(over30=1), _day(under30=2),   # Mon 28, Tue 29, Wed 30 Sep
        _day(under30=1), _day(over30=2),                     # Thu 1, Fri 2 Oct
    )
    _run(summary_db.bells_entries.insert_many([
        {"id": "a", "office_id": "off-ldn", "user_id": "me", "week_ending": "2026-10-04", "days": days},
        {"id": "b", "office_id": "off-ldn", "user_id": "me", "week_ending": "2026-09-13",
         "days": _week(_day(under30=5))},
        # Too old for a 3-month window — ignored.
        {"id": "c", "office_id": "off-ldn", "user_id": "me", "week_ending": "2026-06-07",
         "days": _week(_day(under30=7))},
    ]))
    out = _run(bells.my_bells_summary(_Req(), months=3))
    by_month = {m["month"]: m for m in out["months"]}
    assert list(by_month) == ["2026-08", "2026-09", "2026-10"]
    assert by_month["2026-09"]["sign_ups"] == 5 + 4
    assert by_month["2026-09"]["standard"] == 5 + 3 and by_month["2026-09"]["target"] == 1
    assert by_month["2026-10"]["sign_ups"] == 3
    assert by_month["2026-10"]["target"] == 2
    assert by_month["2026-08"]["sign_ups"] == 0
    assert by_month["2026-09"]["weeks"] == 2 and by_month["2026-10"]["weeks"] == 1


def test_mc_fees_are_admin_only_knobs_priced_by_tier():
    from core.vertex_pay import ADMIN_ONLY_FEE_KEYS, mc_fees
    # The office is paid £16 for a Silver and £20 for a Gold.
    assert DEFAULT_FEES["fee_mc_standard"] == 16 and DEFAULT_FEES["fee_mc_target"] == 20
    assert set(ADMIN_ONLY_FEE_KEYS) == {"fee_mc_standard", "fee_mc_target"}
    assert mc_fees(3, 2, None) == 3 * 16 + 2 * 20
    assert mc_fees(5, 0, {"fee_mc_standard": 30}) == 150
    assert mc_fees(0, 13, {"fee_mc_target": 32.5}) == 422.5
    assert mc_fees(None, None, None) == 0 and mc_fees(-3, -1, {"fee_mc_standard": 30}) == 0
    assert normalize_fees({"fee_mc_target": "40"})["fee_mc_target"] == 40
    assert normalize_fees({"fee_mc_standard": 99999})["fee_mc_standard"] == 16   # out of range → the default
    # A document from before the fee was split by tier is ignored, not misread.
    assert normalize_fees({"fee_mc": 30})["fee_mc_standard"] == 16
    assert clean_fee_update({"fee_mc_standard": 18, "fee_mc_target": 28}) == {"fee_mc_standard": 18, "fee_mc_target": 28}