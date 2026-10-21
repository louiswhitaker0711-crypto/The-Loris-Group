"""Matching the quality report's rows to people: the report writes
'Haider M - MMC9974' (a dash before the badge), and people who've exited
still match so their history stays with them."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from bson import ObjectId  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from routes import quality as q  # noqa: E402


def test_first_l_ignores_the_dash_before_the_badge():
    assert q._first_l("Haider M - MMC9974", "MMC9974") == "haider m"
    assert q._first_l("Jon Paul M - MMC9842", "MMC9842") == "jon m"
    assert q._first_l("Example P MMC1234", "MMC1234") == "example p"
    assert q._first_l("Example P – MMC1234", "MMC1234") == "example p"
    assert q._first_l("MMC1234", "MMC1234") == ""


def test_exited_people_still_match(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(q, "db", db)
    here, gone = ObjectId(), ObjectId()
    asyncio.run(db.users.insert_many([
        {"_id": here, "name": "Haider Example", "office_id": "o1"},
        {"_id": gone, "name": "Nimrah Example", "office_id": "o1", "deleted": True},
    ]))
    users = asyncio.run(q._office_people("o1"))
    _, by_name = asyncio.run(q._badge_index("o1", users))
    assert by_name[q._first_l("Haider E - MMC9974", "MMC9974")] == str(here)
    assert by_name[q._first_l("Nimrah E - MMC9844", "MMC9844")] == str(gone)
