"""Daily COD 2 (the Owner, 23 Nov 2026): the day's items in the set-up and
breakdown, Know ticked at the breakdown, and Coaching today by team in the
morning and by bunny hop in the field."""
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

import pytest
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
from core import cod_calendar as cal  # noqa: E402
from core.app_time import APP_TZ  # noqa: E402
from tests.test_cod_ticks_calendar_unit import MODS  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture
def mdb(monkeypatch):
    db = AsyncMongoMockClient()["cod2_daily_test"]
    monkeypatch.setattr(database, "db", db)
    return db


def _cal():
    return {"user_id": "u1", "days": cal.build_days(date(2026, 11, 24), MODS)}


def test_day_view_has_todays_items_and_whats_behind():
    c = _cal()
    first = c["days"][0]["items"]
    v = cal.day_view(c, {}, c["days"][1]["date"])
    assert v["day"] == 2 and v["total"] == 11
    assert [i["module_id"] for i in v["today"]] == [i["module_id"] for i in c["days"][1]["items"]]
    assert {b["module_id"] for b in v["behind"]} == {i["module_id"] for i in first}
    # Day 1 at Know: nothing behind any more.
    v = cal.day_view(c, {i["module_id"]: 1 for i in first}, c["days"][1]["date"])
    assert v["behind"] == []


def test_day_view_none_before_it_starts_and_when_all_known():
    c = _cal()
    assert cal.day_view(c, {}, "2026-11-23") is None
    every = {it["module_id"]: 1 for d in c["days"] for it in d["items"]}
    assert cal.day_view(c, every, "2026-12-20") is None


def test_day_views_only_people_with_a_calendar(mdb):
    _run(mdb.cod_calendars.insert_one(_cal()))
    out = _run(cal.day_views(["u1", "u2"], "2026-11-24"))
    assert list(out) == ["u1"] and out["u1"]["day"] == 1


def test_coaching_today_team_in_the_morning_hop_in_the_field(mdb, monkeypatch):
    import routes.coaching_today as ct
    import auth
    from bson import ObjectId
    monkeypatch.setattr(ct, "db", mdb)
    names = {}
    for n in ("u1", "u2"):
        oid = ObjectId()
        names[n] = str(oid)
    for n, oid in names.items():
        _run(mdb.cod_calendars.insert_one({**_cal(), "user_id": oid}))
        _run(mdb.users.insert_one({"_id": ObjectId(oid), "name": f"Example {n}"}))

    async def subtree2(_):
        return ["coach"] + list(names.values())
    monkeypatch.setattr(auth, "get_subtree_ids", subtree2)

    async def sector2(user, iso):
        return {"hops": [{"member_ids": ["coach", names["u2"]]}]}
    monkeypatch.setattr(ct, "_my_sector", sector2)

    coach = {"id": "coach", "role": "leader", "office_id": "o1"}
    morning = datetime(2026, 11, 24, 10, 30, tzinfo=APP_TZ)
    field = datetime(2026, 11, 24, 15, 0, tzinfo=APP_TZ)
    am = _run(ct.cod2_today(coach, "2026-11-24", morning))
    assert am["mode"] == "team" and len(am["people"]) == 2
    pm = _run(ct.cod2_today(coach, "2026-11-24", field))
    assert pm["mode"] == "hop" and [p["name"] for p in pm["people"]] == ["Example u2"]
    # A BA only sees it in the field, for their own hop.
    ba = {"id": "coach", "role": "trainee", "office_id": "o1"}
    assert _run(ct.cod2_today(ba, "2026-11-24", morning))["people"] == []
