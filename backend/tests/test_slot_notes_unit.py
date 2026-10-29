"""Planner slot notes: several notes per time slot, each filed with a title,
a heading and photos (routes/notes_folder.py, the Owner 29 Oct 2026)."""
from routes.notes_folder import clean_slot_notes, planner_entries


def test_keeps_good_notes_and_drops_bad_keys():
    raw = {
        "3:primetime": [{"id": "abc123def", "title": "Sam's coaching", "head": "pitch:close", "body": "Slow the close down",
                         "photos": ["https://evil.example/x.jpg"]}],
        "9:primetime": [{"id": "abc123def", "body": "bad day index"}],
        "2:bad key!": [{"body": "x"}],
    }
    out = clean_slot_notes(raw)
    assert list(out) == ["3:primetime"]
    n = out["3:primetime"][0]
    assert n["title"] == "Sam's coaching" and n["head"] == "pitch:close"
    assert n["photos"] == []          # outside URLs are never kept


def test_empty_notes_dropped_and_bad_heading_cleared():
    out = clean_slot_notes({"1:day": [{"id": "zzzzzz1", "body": "  "}, {"id": "zzzzzz2", "body": "Keep", "head": "nope"}]})
    assert len(out["1:day"]) == 1 and out["1:day"][0]["head"] == ""


def test_caps_notes_per_slot():
    out = clean_slot_notes({"0:day": [{"body": f"n{i}"} for i in range(30)]})
    assert len(out["0:day"]) == 10


def test_each_slot_note_files_once():
    slot = clean_slot_notes({"3:primetime": [{"id": "note00001", "title": "A", "body": "one"},
                                             {"id": "note00002", "body": "two", "label": "Primetime"}]})
    entries = planner_entries("u1", "2026-11-01", {}, "", {}, slot)
    refs = [e["ref"] for e in entries]
    assert refs == ["planner:u1:2026-11-01:3:n:note00001", "planner:u1:2026-11-01:3:n:note00002"]
    assert entries[0]["date"] == "2026-10-29"
    assert entries[1]["title"] == "Primetime" and entries[1]["head"] == "pitch:other"
