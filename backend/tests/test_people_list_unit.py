"""The BAs tab (GET /people): Admins see the office, a Coach their team,
grouped under the nearest Coach with a team name."""
import asyncio
import os
import sys
from pathlib import Path

from bson import ObjectId

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import people  # noqa: E402


def test_people_list_scope_and_teams(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    import auth
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(people, "db", db)
    monkeypatch.setattr(auth, "db", db)
    owner, coach, ba1, ba2, other = (ObjectId() for _ in range(5))
    asyncio.run(db.users.insert_many([
        {"_id": owner, "role": "admin", "name": "Owner Example", "office_id": "o1"},
        {"_id": coach, "role": "leader", "name": "Coach Example", "office_id": "o1", "team_name": "Team Example", "reports_to": str(owner)},
        {"_id": ba1, "role": "trainee", "name": "Alpha Example", "office_id": "o1", "reports_to": str(coach)},
        {"_id": ba2, "role": "trainee", "name": "Bravo Example", "office_id": "o1", "reports_to": str(owner)},
        {"_id": other, "role": "trainee", "name": "Other Example", "office_id": "o2"},
    ]))
    who = {}

    async def _caller(_r):
        return who["u"]

    monkeypatch.setattr(people, "require_admin_or_leader", _caller)
    who["u"] = {"id": str(owner), "role": "admin", "office_id": "o1"}
    rows = asyncio.run(people.list_people(None))["people"]
    by = {r["name"]: r for r in rows}
    assert set(by) == {"Owner Example", "Coach Example", "Alpha Example", "Bravo Example"}
    assert by["Alpha Example"]["team"] == "Team Example" and by["Alpha Example"]["coach"] == "Coach Example"
    assert by["Bravo Example"]["team"] == ""
    who["u"] = {"id": str(coach), "role": "leader", "office_id": "o1"}
    rows = asyncio.run(people.list_people(None))["people"]
    assert {r["name"] for r in rows} == {"Coach Example", "Alpha Example"}
