"""Learn your pitch (routes/pitch.py): Read only on a new start's first
night; everything opens at 18:00 the next day; the 18:00 notification goes
to today's new starts once each."""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.app_time import APP_TZ  # noqa: E402
from routes import pitch  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_opens_at_six_the_day_after_their_first_day():
    assert pitch.is_unlocked("2026-10-26", datetime(2026, 10, 26, 19, 0, tzinfo=APP_TZ)) is False
    assert pitch.is_unlocked("2026-10-26", datetime(2026, 10, 27, 17, 59, tzinfo=APP_TZ)) is False
    assert pitch.is_unlocked("2026-10-26", datetime(2026, 10, 27, 18, 0, tzinfo=APP_TZ)) is True
    assert pitch.is_unlocked(None) is True


def test_progress_is_tidied():
    out = pitch.clean_state({"counts": {"read": 12, "mirror": 3, "x": 5}, "ladder": {"l1": True, "l2": "y"},
                             "quiz": {"0": 1, "a": 2}, "shown": {"L1-0": True}})
    assert out["counts"] == {"read": 10, "mirror": 3, "record": 0}
    assert out["ladder"] == {"l1": True} and out["quiz"] == {"0": 1} and out["shown"] == {"L1-0": True}
    with pytest.raises(HTTPException):
        pitch.clean_state([])


def test_six_pm_push_goes_to_todays_new_starts_once(monkeypatch):
    db = AsyncMongoMockClient()["pitch_test"]
    monkeypatch.setattr(pitch, "db", db)
    sent = []

    async def fake_push(uid, title, body, data=None):
        sent.append(uid)
    import core.push
    monkeypatch.setattr(core.push, "send_push_to_user", fake_push)
    today, old = ObjectId(), ObjectId()
    _run(db.users.insert_many([{"_id": today, "name": "New"}, {"_id": old, "name": "Old"}]))
    _run(db.new_hires.insert_many([
        {"active": True, "start_date": "2026-10-26", "trainee_user_id": str(today)},
        {"active": True, "start_date": "2026-10-20", "trainee_user_id": str(old)},
    ]))
    at_seven = datetime(2026, 10, 26, 19, 0, tzinfo=APP_TZ)
    assert _run(pitch.pitch_push_tick(datetime(2026, 10, 26, 17, 0, tzinfo=APP_TZ))) == 0
    assert _run(pitch.pitch_push_tick(at_seven)) == 1 and sent == [str(today)]
    assert _run(pitch.pitch_push_tick(at_seven)) == 0
