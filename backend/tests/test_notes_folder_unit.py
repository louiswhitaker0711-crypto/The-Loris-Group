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


def test_meetings_file_into_their_catalogues_not_cod_or_other():
    days = {"1": {"leaders_meeting": "Coach one fix per door", "leaders_meeting_cod": "m1", "morning_news": "",
                  "morning_cs": "Smile on the doorstep"}}
    out = nf.planner_entries("u1", "2026-11-01", days, "Extra bits", {})
    by = {e["source_label"]: e for e in out}
    assert by["Leaders meeting"]["head"] == "pitch:leaders" and by["Leaders meeting"]["date"] == "2026-10-27"
    assert by["Morning meeting"]["head"] == "pitch:morning"
    assert by["Morning meeting"]["body"] == "Customer Service\nSmile on the doorstep"
    assert by["Extra notes"]["date"] == "2026-10-26"
    assert len(out) == 3


def test_sync_files_edits_and_removes_and_only_the_owner_shares():
    db = AsyncMongoMockClient()["notes_folder_test"]
    nf.db = db
    ba = {"id": "u1", "office_id": "o1", "role": "trainee", "name": "Sam B"}
    slot = {"1:day": [{"id": "aaaaaa1", "title": "One fix", "head": "pitch:close", "body": "Coach one fix", "share": True}]}
    _run(nf.sync_planner(ba, "2026-11-01", {}, "", {}, slot))
    n = _run(db.folder_notes.find_one({}))
    assert n["head"] == "pitch:close" and n["title"] == "One fix"
    assert n["shared"] is False                                       # a BA can't post to everyone
    _run(nf.sync_planner(ba, "2026-11-01", {}, "", {}, {}))
    assert _run(db.folder_notes.count_documents({})) == 0             # removed note: gone
    owner = {"id": "o", "office_id": "o1", "role": "admin", "name": "Owner"}
    _run(nf.sync_planner(owner, "2026-11-01", {}, "", {}, slot))
    shared = _run(db.folder_notes.find_one({"user_id": "o"}))
    assert shared["shared"] is True and shared["head_label"] == "Close"
    _run(nf.sync_planner(owner, "2026-11-01", {"2": {"leaders_meeting": "# Pace\n## Opener"}}, "", {}, slot))
    m = _run(db.folder_notes.find_one({"user_id": "o", "head": "pitch:leaders"}))
    assert m["meeting"] is True and m["title"] == "Pace" and m["shared"] is False


def test_leaders_meeting_box_files_under_leaders_meeting():
    out = nf.planner_entries("u1", "2026-11-15", {"2": {"leaders_meeting": "Pace at the doors"}}, "", {})
    assert out[0]["head"] == "pitch:leaders"


def test_ownership_is_the_owners_alone_and_never_shared():
    db = AsyncMongoMockClient()["notes_owner_test"]
    nf.db = db
    ba = {"id": "u1", "office_id": "o1", "role": "trainee", "name": "Sam B"}
    owner = {"id": "o", "office_id": "o1", "role": "admin", "name": "Owner"}
    _run(nf.sync_planner(ba, "2026-11-15", {}, "Mine", {"x:notes": {"head": "pitch:ownership", "title": "x", "share": False}}))
    assert _run(db.folder_notes.find_one({"user_id": "u1"}))["head"] == "pitch:other"
    _run(nf.sync_planner(owner, "2026-11-15", {}, "Profit plan", {"x:notes": {"head": "pitch:ownership", "title": "P&L", "share": True}}))
    n = _run(db.folder_notes.find_one({"user_id": "o"}))
    assert n["head"] == "pitch:ownership" and n["shared"] is False
    assert nf.allowed_head(ba, "pitch:ownership") == "pitch:other"
    assert nf.allowed_head(owner, "pitch:ownership") == "pitch:ownership"
