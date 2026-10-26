"""The weekly bulletin names each person's team, the way Bells groups them,
not the office (the Owner, 26 Oct 2026); no named team reads "Mini <team>".
Fees never read £0 just because no Rates have been saved."""
import asyncio
import sys
from pathlib import Path

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.brand import ORG_NAME  # noqa: E402
from routes import bells, bulletin  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_bulletin_shows_team_names(monkeypatch):
    db = AsyncMongoMockClient()["bulletin_label_test"]
    monkeypatch.setattr(bulletin, "db", db)
    monkeypatch.setattr(bells, "db", db)

    async def viewer(_request):
        return {"id": "x", "role": "admin", "office_id": "o1"}
    monkeypatch.setattr(bulletin, "require_admin_or_leader", viewer)

    lead, sub, ba, loner = (ObjectId() for _ in range(4))
    _run(db.offices.insert_one({"id": "o1", "name": "Office Example"}))
    _run(db.users.insert_many([
        {"_id": lead, "name": "Lead Example", "role": "leader", "team_name": "Team Example", "office_id": "o1"},
        {"_id": sub, "name": "Sub Example", "role": "leader", "reports_to": str(lead), "office_id": "o1"},
        {"_id": ba, "name": "Ba Example", "role": "trainee", "reports_to": str(sub), "office_id": "o1"},
        {"_id": loner, "name": "Loner Example", "role": "trainee", "office_id": "o1"},
    ]))
    days = [{"status": "in", "over30": 6, "under30": 5, "memberships": 0}]
    _run(db.bells_entries.insert_many([
        {"week_ending": "2026-10-25", "user_id": str(ba), "user_name": "Ba Example", "office_id": "o1",
         "office": "Office Example", "days": days},
        {"week_ending": "2026-10-25", "user_id": str(loner), "user_name": "Loner Example", "office_id": "o1",
         "office": "Office Example", "days": days},
    ]))
    out = _run(bulletin.bulletin_weekly(None, week_ending="2026-10-25"))
    by = {r["name"]: r for r in out["top_sales"]}
    assert by["Ba Example"]["office"] == "Team Example"
    assert by["Loner Example"]["office"] == f"Mini {ORG_NAME}"
    assert by["Ba Example"]["earnings"] > 0
