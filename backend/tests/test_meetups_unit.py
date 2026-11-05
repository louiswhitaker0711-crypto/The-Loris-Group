"""Meet-ups (routes/meetups.py): planner cleaning, when the Home card shows,
progress, and notes filing into Notes → Meet-ups."""
import asyncio
import sys
from datetime import date
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import meetups as mu  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_clean_plan_drops_empties_and_caps_takeaways():
    p = mu.clean_plan({"goals": [{"text": "  Three pitch ideas "}, {"text": ""}, "junk"],
                       "contacts": [{"name": "Example Person", "phone": "07000 000000", "followed_up": "yes"}],
                       "questions": [{"text": "How do you keep Round % up?"}],
                       "notes": [{"title": "", "body": "  "}, {"title": "Panel", "body": "Ask more"}],
                       "debrief": {"takeaways": ["a", "b", "c", "d"], "primetime": "Objections", "done": True},
                       "sessions": [{"title": "Workshop", "day": "2026-11-07", "time": "14:00"},
                                    {"title": "Panel", "day": "2026-11-07", "time": "10:00"}]})
    assert [g["text"] for g in p["goals"]] == ["Three pitch ideas"]
    assert p["contacts"][0]["followed_up"] is False
    assert len(p["notes"]) == 1 and p["debrief"]["takeaways"] == ["a", "b", "c"]
    assert [s["title"] for s in p["sessions"]] == ["Panel", "Workshop"]
    assert mu.progress(p)["done"] == 3


def test_on_home_from_a_week_before_until_debrief():
    m = {"sent_at": "x", "start_date": "2026-11-06", "end_date": "2026-11-08"}
    assert not mu.on_home(m, None, date(2026, 10, 29))
    assert mu.on_home(m, None, date(2026, 10, 30))
    assert mu.on_home(m, None, date(2026, 11, 10))
    assert not mu.on_home(m, {"debrief": {"done": True}}, date(2026, 11, 10))
    assert not mu.on_home(m, None, date(2026, 11, 23))
    assert not mu.on_home({**m, "sent_at": None}, None, date(2026, 11, 5))


def test_notes_file_under_the_meetup_and_follow_edits():
    db = AsyncMongoMockClient()["meetups_test"]
    mu.db = db
    user = {"id": "u1", "office_id": "o1", "name": "Example Person"}
    m = {"id": "meet-abc-123", "name": "Example Meet-up", "start_date": "2026-11-06", "end_date": "2026-11-08",
         "attendee_ids": ["u1"], "office_id": "o1", "sent_at": "x"}
    _run(db.meetups.insert_one(dict(m)))
    plan = mu.clean_plan({"notes": [{"id": "note-000001", "title": "Panel", "body": "Ask more"}],
                          "debrief": {"takeaways": ["Smile first"], "primetime": "Doorstep openers"}})
    _run(db.meetup_plans.insert_one({"meetup_id": m["id"], "user_id": "u1", **plan}))
    _run(mu.file_notes(user, m, plan))
    notes = _run(db.folder_notes.find({}).to_list(10))
    assert {n["head"] for n in notes} == {"meetup:meet-abc-123"}
    assert {n["source_label"] for n in notes} == {"Meet-up notes", "Debrief"}
    panel = next(n for n in notes if n["title"] == "Panel")
    assert _run(mu.edit_from_notes(user, panel, "Panel", "Ask much more"))
    saved = _run(db.meetup_plans.find_one({"user_id": "u1"}))
    assert saved["notes"][0]["body"] == "Ask much more"
    # Notes taken out of the planner leave the folder.
    _run(mu.file_notes(user, m, mu.clean_plan({})))
    assert _run(db.folder_notes.count_documents({})) == 0
