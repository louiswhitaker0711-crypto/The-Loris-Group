"""Past weeks keep the teams as they stood (the Owner, 2 Nov 2026)."""
import asyncio

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from core import team_history as th
from core.team_history import as_at_for_week, parents_at


def test_parent_as_at_a_day():
    current = {"a": "owner"}
    moves = [{"user_id": "a", "from": "lead", "to": "owner", "on": "2026-11-02", "logged_at": "x"}]
    assert parents_at(current, moves, "2026-11-01")["a"] == "lead"     # last week: old team
    assert parents_at(current, moves, "2026-11-02")["a"] == "owner"    # from the move day


def test_current_week_reads_live():
    assert as_at_for_week("2026-11-08", today="2026-11-02") is None
    assert as_at_for_week("2026-11-01", today="2026-11-02") == "2026-11-01"


def test_bells_last_week_keeps_the_exited_leaders_team(monkeypatch):
    from routes import bells
    from core.team_sections import hand_on_team
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(bells, "db", db)
    monkeypatch.setattr(th, "today_iso", lambda: "2026-11-02")
    owner, lead, sub, sub_ba = (ObjectId() for _ in range(4))
    asyncio.run(db.users.insert_many([
        {"_id": owner, "name": "Owner Example", "role": "admin", "office_id": "o1", "team_name": "Top Team"},
        {"_id": lead, "name": "Lead Example", "role": "leader", "reports_to": str(owner), "office_id": "o1", "team_name": "Old Team"},
        {"_id": sub, "name": "Sub Example", "role": "leader", "reports_to": str(lead), "office_id": "o1", "team_name": "Sub Team"},
        {"_id": sub_ba, "name": "Subba Example", "role": "trainee", "reports_to": str(sub), "office_id": "o1"},
    ]))
    exited = asyncio.run(db.users.find_one({"_id": lead}))
    asyncio.run(hand_on_team(db, exited, str(owner), on="2026-11-02"))
    asyncio.run(db.users.update_one({"_id": lead}, {"$set": {"deleted": True, "left_on": "2026-11-02"}}))

    def teams(week):
        rows = [{"user_id": str(x), "office_id": "o1"} for x in (lead, sub, sub_ba)]
        asyncio.run(bells._enrich_entries_with_teams(rows, week))
        return [[t["team_name"] for t in r["teams"]] for r in rows]

    last = teams("2026-11-01")
    assert last[1] == ["Sub Team", "Old Team", "Top Team"]      # Sub was in Old Team last week
    assert last[2] == ["Sub Team", "Old Team", "Top Team"]
    this = teams("2026-11-08")
    assert this[1] == ["Sub Team", "Top Team"]                  # now first gen to the Owner
    assert this[2] == ["Sub Team", "Top Team"]                  # their team's second gen
