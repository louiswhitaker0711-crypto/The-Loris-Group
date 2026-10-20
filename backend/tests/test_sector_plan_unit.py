"""Morning sector planning (routes/sector_plan.py): who's told what, and the
send/remind/field-start times."""
import sys
from datetime import date, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.sector_plan import FIELD_START, REMIND_AT, SEND_AT, _past, _slot, plan_messages  # noqa: E402


def test_messages_for_leaders_members_and_the_unplaced():
    names = {"l1": "Leader Example", "a": "Alpha Example", "b": "Bravo Example", "x": "Extra Example"}
    sectors = [{"leader_id": "l1", "postcode": "LS6 2", "goal": 12, "member_ids": ["l1", "a", "b"]}]
    out = plan_messages(sectors, names, ["l1", "a", "b", "x"])
    assert out["l1"][0] == "🗺️ Your sector's ready · LS6 2"
    assert "with Alpha, Bravo" in out["l1"][1] and "sector goal 12" in out["l1"][1]
    assert out["a"][0] == "📍 You're in Leader's sector today · LS6 2"
    assert out["a"][1].startswith("With Bravo.")
    assert out["x"][0] == "You're not in a sector yet today"


def test_a_leader_on_their_own_and_no_postcode():
    out = plan_messages([{"leader_id": "l1", "member_ids": ["l1"]}], {"l1": "Leader Example"}, ["l1"])
    assert out["l1"][0] == "🗺️ Your sector's ready · no postcode yet"
    assert " with " not in out["l1"][1] and "goal" not in out["l1"][1]


def test_times_weekday_and_saturday():
    wed, sat = date(2026, 10, 14), date(2026, 10, 17)
    assert _slot(SEND_AT, wed) == (10, 30) and _slot(SEND_AT, sat) == (9, 30)
    assert _slot(REMIND_AT, wed) == (10, 45) and _slot(REMIND_AT, sat) == (9, 45)
    assert _slot(FIELD_START, wed) == (13, 30) and _slot(FIELD_START, sat) == (10, 0)
    assert _past(datetime(2026, 10, 14, 10, 30), (10, 30)) and not _past(datetime(2026, 10, 14, 10, 29), (10, 30))


def test_recap_is_the_last_field_day():
    from routes.sector_plan import previous_field_day
    assert previous_field_day(date(2026, 10, 15)) == "2026-10-14"   # Thursday → Wednesday
    assert previous_field_day(date(2026, 10, 19)) == "2026-10-17"   # Monday → Saturday


def test_a_no_show_leaves_todays_sectors(monkeypatch):
    """However the No Show came in (OwnerIQ's plan, Bells), that person drops
    out of today's sectors; other days and other people are untouched."""
    import asyncio
    from mongomock_motor import AsyncMongoMockClient
    import routes.sector_plan as sp
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(sp, "db", db)
    monkeypatch.setattr(sp, "_now_uk", lambda: datetime(2026, 10, 16, 12, 50))   # a Friday
    run = asyncio.run
    days = [{"status": "off"} for _ in range(7)]
    days[4] = {"status": "ns", "under30": None, "over30": None, "memberships": None}
    run(db.bells_entries.insert_many([
        {"id": "e1", "office_id": "o1", "week_ending": "2026-10-18", "user_id": "gone", "days": days},
        {"id": "e2", "office_id": "o1", "week_ending": "2026-10-18", "user_id": "here",
         "days": [{"status": "in"}] * 7},
    ]))
    run(db.sectors.insert_many([
        {"id": "s1", "office_id": "o1", "date": "2026-10-16", "leader_id": "lead", "member_ids": ["lead", "here", "gone"]},
        {"id": "s0", "office_id": "o1", "date": "2026-10-15", "leader_id": "lead", "member_ids": ["lead", "gone"]},
    ]))
    assert run(sp.drop_no_shows("o1", "2026-10-16")) == 1
    assert run(db.sectors.find_one({"id": "s1"}))["member_ids"] == ["lead", "here"]
    assert run(sp.drop_no_shows("o1", "2026-10-15")) == 0                         # yesterday: left as it was
    assert run(db.sectors.find_one({"id": "s0"}))["member_ids"] == ["lead", "gone"]


def test_not_scheduled_on_bells_leaves_todays_sectors(monkeypatch):
    """NS (Not scheduled, 'ab') on Bells takes someone out of today's sector, like X."""
    import asyncio
    from mongomock_motor import AsyncMongoMockClient
    import routes.sector_plan as sp
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(sp, "db", db)
    monkeypatch.setattr(sp, "_now_uk", lambda: datetime(2026, 10, 16, 12, 50))   # a Friday
    run = asyncio.run
    days = [{"status": "in"} for _ in range(7)]
    days[4] = {"status": "ab"}
    run(db.bells_entries.insert_one({"id": "e1", "office_id": "o1", "week_ending": "2026-10-18", "user_id": "off", "days": days}))
    run(db.sectors.insert_one({"id": "s1", "office_id": "o1", "date": "2026-10-16", "leader_id": "lead",
                               "member_ids": ["lead", "off"]}))
    assert run(sp.drop_no_shows("o1", "2026-10-16")) == 1
    assert run(db.sectors.find_one({"id": "s1"}))["member_ids"] == ["lead"]
