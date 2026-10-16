"""One-off cleanup of the past-week Bells rows made by the 16 Oct Hub-history
sync: only sync-made rows from that window, for the 10 weeks before last,
untouched since and with no sign-ups, are removed; it runs once.

Pure in-memory: mongomock_motor. Placeholder people.
"""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from core import relay_history_cleanup as c  # noqa: E402

run = asyncio.run
T = "2026-10-16T09:40:55.123456+00:00"


def _day(n=None, status="off"):
    return {"over30": None, "under30": n, "memberships": None, "status": status}


def _row(id_, **kw):
    base = {"id": id_, "office_id": "o1", "user_id": f"u{id_}", "user_name": "Example Person",
            "week_ending": "2026-09-27", "created_by_id": "owneriq-sync",
            "created_at": T, "updated_at": T,
            "days": [_day(status="no_show")] + [_day() for _ in range(6)]}
    base.update(kw)
    return base


def test_removes_only_the_mistaken_rows():
    db = AsyncMongoMockClient()["t"]
    rows = [
        _row("gone"),                                                            # removed
        _row("signups", days=[_day(2)] + [_day() for _ in range(6)]),            # has sign-ups
        _row("before", created_at="2026-10-10T12:00:00+00:00",
             updated_at=T),                                                      # existed before
        _row("edited", updated_at="2026-10-16T11:00:00+00:00"),                  # touched since
        _row("lastweek", week_ending="2026-10-11"),                              # last week: normal
        _row("thisweek", week_ending="2026-10-18"),
        _row("person", created_by_id="admin-1"),                                 # made by a person
        _row("old", week_ending="2026-08-02"),                                   # oldest history week: removed
    ]
    run(db.bells_entries.insert_many([dict(r) for r in rows]))
    out = run(c.run(db))
    assert out == {"removed": 2}
    left = sorted(e["id"] for e in run(db.bells_entries.find({}).to_list(100)))
    assert left == ["before", "edited", "lastweek", "person", "signups", "thisweek"]


def test_runs_once():
    db = AsyncMongoMockClient()["t"]
    run(db.bells_entries.insert_one(_row("gone")))
    assert run(c.run(db))["removed"] == 1
    run(db.bells_entries.insert_one(_row("again")))
    assert run(c.run(db)) == {"skipped": "already ran"}
    assert run(db.bells_entries.count_documents({})) == 1
