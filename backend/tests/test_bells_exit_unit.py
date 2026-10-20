"""Exit a BA: their week reads red from the exit day (frontend), and from the
week after they're off the Bells sheet. Their records stay."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.bells import exit_day, exited_before_week  # noqa: E402


def test_exit_day():
    assert exit_day({"left_on": "2026-10-21"}) == "2026-10-21"
    assert exit_day({"deleted_at": "2026-10-20T23:30:00+00:00"}) == "2026-10-21"   # UK date (BST)
    assert exit_day({}) is None


def test_off_the_sheet_from_the_week_after():
    # Exited Wed 21 Oct 2026: that week (ending Sun 25 Oct) still shows them.
    assert not exited_before_week("2026-10-21", "2026-10-25")
    assert exited_before_week("2026-10-21", "2026-11-01")
    assert not exited_before_week("2026-10-21", "2026-10-18")      # earlier weeks keep them
    assert not exited_before_week(None, "2026-11-01")


def test_an_exited_ba_stays_in_their_team(monkeypatch):
    import asyncio
    from bson import ObjectId
    from mongomock_motor import AsyncMongoMockClient
    from routes import bells

    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(bells, "db", db)
    lead, coach, ba = ObjectId(), ObjectId(), ObjectId()
    asyncio.run(db.users.insert_many([
        {"_id": lead, "name": "Lead Example", "role": "leader", "team_name": "Example Team", "office_id": "o1"},
        {"_id": coach, "name": "Coach Example", "role": "leader", "reports_to": str(lead), "office_id": "o1"},
        {"_id": ba, "name": "Ba Example", "role": "trainee", "reports_to": str(coach), "office_id": "o1",
         "deleted": True, "left_on": "2026-10-20"},
    ]))
    entries = [{"user_id": str(ba), "office_id": "o1"}, {"user_id": str(coach), "office_id": "o1"}]
    asyncio.run(bells._enrich_entries_with_teams(entries))
    assert entries[0]["primary_team"]["leader_id"] == str(lead)        # still in their team
    assert entries[1]["primary_team"]["leader_id"] == str(lead)
