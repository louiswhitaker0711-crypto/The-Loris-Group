"""PR / OR on Bells: who recruited someone (users.recruited_by)."""
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

from routes import bells  # noqa: E402


def test_badges(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(bells, "db", db)
    owner, pr, orr, unset = (ObjectId() for _ in range(4))
    asyncio.run(db.users.insert_many([
        {"_id": owner, "name": "Owner Example"},
        {"_id": pr, "name": "Pr Example", "recruited_by": str(owner)},
        {"_id": orr, "name": "Or Example", "recruited_by": "office"},
        {"_id": unset, "name": "Unset Example"},
    ]))
    rows = [{"user_id": str(x)} for x in (pr, orr, unset)] + [{"user_id": None}]
    asyncio.run(bells.attach_recruit_badges(rows, with_names=True))
    assert [r["recruit_badge"] for r in rows] == ["PR", "OR", None, None]
    assert rows[0]["recruited_by_name"] == "Owner Example" and rows[1]["recruited_by"] == "office"

    public = [{"user_id": str(pr)}]
    asyncio.run(bells.attach_recruit_badges(public))
    assert public == [{"user_id": str(pr), "recruit_badge": "PR"}]        # no names on the public link
