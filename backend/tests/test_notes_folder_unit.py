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
    assert by["Leaders Meeting"]["head"] == "cod:m1" and by["Leaders Meeting"]["date"] == "2026-10-27"
    assert not by["Leaders Meeting"].get("meeting")
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


def test_leaders_meeting_box_is_an_ordinary_note():
    out = nf.planner_entries("u1", "2026-11-15", {"2": {"leaders_meeting": "Pace at the doors"}}, "", {})
    assert out[0]["head"] == "pitch:other" and not out[0].get("meeting")


def test_leaders_meetings_come_from_the_weekly_plans_cod3_row():
    db = AsyncMongoMockClient()["notes_agenda_test"]
    nf.db = db
    agenda = {"id": "a1", "office_id": "o1", "week_ending": "2026-11-29", "updated_at": "t1", "rows": [
        {"id": "r1", "label": "COD 3", "cells": [{"day": 1, "topic": "What is a leader?", "presenter": "Louis",
                                                   "run": "# What is a leader?\n## Opener · 5 min"},
                                                  {"day": 2, "topic": "", "run": ""}]},
        {"id": "r2", "label": "Primetime", "cells": [{"day": 1, "topic": "Closes"}]}]}
    _run(db.weekly_agendas.insert_one(dict(agenda)))
    owner = {"id": "o", "office_id": "o1", "role": "admin", "name": "Louis"}
    _run(nf.sync_agenda_meetings(owner))
    notes = _run(db.folder_notes.find({}, {"_id": 0}).to_list(10))
    assert len(notes) == 1
    n = notes[0]
    assert n["head"] == "pitch:leaders" and n["title"] == "What is a leader?" and n["meeting"] and n["agenda"]
    assert n["date"] == "2026-11-24" and n["source_label"] == "COD 3 \u00b7 Louis"
    _run(db.weekly_agendas.update_one({"id": "a1"}, {"$set": {"updated_at": "t2", "rows": []}}))
    _run(nf.sync_agenda_meetings(owner))
    assert _run(db.folder_notes.count_documents({})) == 0


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
