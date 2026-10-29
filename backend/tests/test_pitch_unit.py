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


def test_pitch_words_keep_line_ids_and_drop_blanks():
    out = pitch.clean_words({"words": {"L1-0": "  Hiya,   you alright? ", "L2-1q": "Perfect.", "L3-2": "",
                                        "bad": "x", "L1-1": 5, "L9-99": "ok"}})
    assert out == {"L1-0": "Hiya, you alright?", "L2-1q": "Perfect.", "L9-99": "ok"}


def test_pitch_words_must_be_an_object():
    with pytest.raises(HTTPException):
        pitch.clean_words({"words": ["x"]})
    with pytest.raises(HTTPException):
        pitch.clean_words({"words": {f"L1-{i}": "x" for i in range(pitch.MAX_WORDS + 1)}})


def test_only_the_owner_edits_the_pitch():
    assert pitch._can_edit({"role": "admin"})
    assert not pitch._can_edit({"role": "admin", "is_viewer": True})
    assert not pitch._can_edit({"role": "coach"})


def test_only_a_real_first_week_counts_as_a_new_start():
    from datetime import date as _d
    today = _d(2026, 10, 28)
    assert pitch.is_new_start({"current_day": 1, "start_date": "2026-10-26"}, today)
    assert not pitch.is_new_start({"current_day": 1, "start_date": ""}, today)          # no start date
    assert not pitch.is_new_start({"current_day": 1, "start_date": "2026-05-01"}, today)  # stale record
    assert not pitch.is_new_start({"current_day": 5, "start_date": "2026-10-26"}, today)
    assert not pitch.is_new_start(None, today)


def test_practice_tabs_are_for_new_starts_and_the_owner():
    loop = asyncio.new_event_loop()
    assert loop.run_until_complete(pitch._practice({"role": "admin"}))
    assert not loop.run_until_complete(pitch._practice({"role": "leader"}))
