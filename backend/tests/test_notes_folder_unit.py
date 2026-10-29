"""Notes folder (routes/notes_folder.py): what a planner week files, and the
folder's settings per note box."""
import asyncio
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import notes_folder as nf  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_clean_folder_keeps_note_boxes_only():
    out = nf.clean_folder({"2:morning_topic": {"head": "pitch:close", "title": "  Ask,  then stop ", "share": True},
                           "2:primetime": {"head": "pitch:close"}, "x:notes": {"head": "cod:abc-1"},
                           "9:morning_topic": {}, "1:leaders_meeting": {"head": "bad head!"}})
    assert out["2:morning_topic"] == {"head": "pitch:close", "title": "Ask, then stop", "share": True}
    assert "2:primetime" not in out and "9:morning_topic" not in out
    assert out["x:notes"]["head"] == "cod:abc-1"
    assert out["1:leaders_meeting"]["head"] == ""


def test_planner_entries_default_to_the_meeting_cod_pick_or_other():
    days = {"1": {"leaders_meeting": "Coach one fix per door", "leaders_meeting_cod": "m1", "morning_news": "",
                  "morning_cs": "Smile on the doorstep"}}
    out = nf.planner_entries("u1", "2026-11-01", days, "Extra bits", {})
    by = {e["source_label"]: e for e in out}
    assert by["Coaches Meeting"]["head"] == "cod:m1" and by["Coaches Meeting"]["date"] == "2026-10-27"
    assert by["Morning Meeting · Customer Service"]["head"] == "pitch:other"
    assert by["Extra notes"]["date"] == "2026-10-26"
    assert len(out) == 3


def test_sync_files_edits_and_removes_and_only_the_owner_shares():
    db = AsyncMongoMockClient()["notes_folder_test"]
    nf.db = db
    _run(db.training_modules.insert_one({"id": "m1", "office_id": "o1", "stage": 3, "topic": "Coaching the Pitch",
                                         "category": "Coaching"}))
    ba = {"id": "u1", "office_id": "o1", "role": "trainee", "name": "Sam B"}
    days = {"1": {"leaders_meeting": "Coach one fix", "leaders_meeting_cod": "m1"}}
    folder = {"1:leaders_meeting": {"head": "", "title": "One fix", "share": True}}
    _run(nf.sync_planner(ba, "2026-11-01", days, "", folder))
    n = _run(db.folder_notes.find_one({}))
    assert n["head"] == "cod:m1" and n["head_label"] == "Coaching the Pitch" and n["stage"] == 3
    assert n["title"] == "One fix" and n["shared"] is False          # a BA can't post to everyone
    _run(nf.sync_planner(ba, "2026-11-01", {"1": {"leaders_meeting": ""}}, "", {}))
    assert _run(db.folder_notes.count_documents({})) == 0             # emptied box: note gone
    owner = {"id": "o", "office_id": "o1", "role": "admin", "name": "Owner"}
    _run(nf.sync_planner(owner, "2026-11-01", {"2": {"morning_topic": "Ask then stop"}}, "",
                         {"2:morning_topic": {"head": "pitch:close", "title": "Ask, then stop", "share": True}}))
    shared = _run(db.folder_notes.find_one({"user_id": "o"}))
    assert shared["shared"] is True and shared["head_label"] == "Close"
