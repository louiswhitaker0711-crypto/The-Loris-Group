"""Who has their own team (the Owner, 2 Nov 2026): anyone with someone
reporting to them, BA or Coach, kept for 4 weeks after the last one leaves.
Teams roll up through the reports_to chain, and an unnamed team shows as
"<first name>'s team"."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.team_sections import display_team_name, has_team, within_grace  # noqa: E402


def test_display_team_name():
    assert display_team_name({"name": "Example Person", "team_name": "Example Promotions"}) == "Example Promotions"
    assert display_team_name({"name": "Example Person", "team_name": "  "}) == "Example's team"
    assert display_team_name({}) == "Team"


def test_four_week_grace():
    assert within_grace("2026-11-01", "2026-11-02")
    assert within_grace("2026-10-06", "2026-11-02")          # 27 days ago
    assert not within_grace("2026-10-05", "2026-11-02")      # 28 days ago: back in the team above
    assert not within_grace(None, "2026-11-02")
    assert not within_grace("not a date", "2026-11-02")


def test_has_team():
    assert has_team({"role": "trainee"}, 1)                   # a BA with someone on their team
    assert not has_team({"role": "leader"}, 0)                # nobody, no recent team
    assert has_team({"team_last_member_on": "2026-10-20"}, 0, "2026-11-02")
    assert not has_team(None, 3)


def test_a_ba_with_someone_on_their_team_gets_a_section_that_rolls_up(monkeypatch):
    from bson import ObjectId
    from mongomock_motor import AsyncMongoMockClient
    from routes import bells

    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(bells, "db", db)
    owner, coach, ba, newbie = ObjectId(), ObjectId(), ObjectId(), ObjectId()
    asyncio.run(db.users.insert_many([
        {"_id": owner, "name": "Owner Example", "role": "admin", "team_name": "Top Team", "office_id": "o1"},
        {"_id": coach, "name": "Coach Example", "role": "leader", "team_name": "Middle Team", "reports_to": str(owner), "office_id": "o1"},
        {"_id": ba, "name": "Ba Example", "role": "trainee", "reports_to": str(coach), "office_id": "o1"},
        {"_id": newbie, "name": "New Example", "role": "trainee", "reports_to": str(ba), "office_id": "o1"},
    ]))
    entries = [{"user_id": str(x), "office_id": "o1"} for x in (newbie, ba, coach)]
    asyncio.run(bells._enrich_entries_with_teams(entries))
    # The BA leads their own section (unnamed → "<first>'s team")...
    assert entries[0]["primary_team"]["leader_id"] == str(ba)
    assert entries[0]["primary_team"]["team_name"] == "Ba's team"
    # ...which still counts inside the Coach's team and the Owner's above it.
    assert [t["leader_id"] for t in entries[0]["teams"]] == [str(ba), str(coach), str(owner)]
    assert entries[1]["primary_team"]["leader_id"] == str(ba)
    assert entries[2]["primary_team"]["leader_id"] == str(coach)
    # Today is stamped as a day the BA had someone on their team.
    stamped = asyncio.run(db.users.find_one({"_id": ba}))
    assert stamped.get("team_last_member_on")
