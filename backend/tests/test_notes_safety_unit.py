"""Planner notes safety net (the Owner, 3 Nov 2026): a stale save never wipes
a note it didn't know about, removed text is kept, and it can be put back."""
import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import core.notes_safety as ns  # noqa: E402

UID, WEEK = "user-1", "2026-11-08"


def _note(nid, body="Body", title="T"):
    return {"id": nid, "title": title, "head": "", "body": body, "photos": []}


def test_stale_save_keeps_notes_added_elsewhere():
    server = {"1:day": [_note("aaaaaa1"), _note("bbbbbb2", "added from Notes")]}
    client = {"1:day": [_note("aaaaaa1", "edited")]}
    out = ns.merge_slot_notes(server, client, [])
    bodies = [n["body"] for n in out["1:day"]]
    assert bodies == ["edited", "added from Notes"]


def test_a_note_the_phone_removed_does_go():
    server = {"1:day": [_note("aaaaaa1"), _note("bbbbbb2")]}
    out = ns.merge_slot_notes(server, {"1:day": [_note("aaaaaa1")]}, ["bbbbbb2"])
    assert [n["id"] for n in out["1:day"]] == ["aaaaaa1"]


def test_losing_text_is_spotted():
    before = {"days": {"1": {"primetime": "Long notes here"}}, "notes": "", "slot_notes": {}}
    assert ns.loses_anything(before, {"days": {"1": {"primetime": "Long"}}})
    assert ns.loses_anything(before, {"days": {"1": {}}})
    assert not ns.loses_anything(before, {"days": {"1": {"primetime": "Long notes here and more"}}})


def test_removed_note_is_listed_and_put_back(monkeypatch):
    db = AsyncMongoMockClient()["notes_safety_test"]
    monkeypatch.setattr(ns, "db", db)

    async def run():
        before = {"user_id": UID, "office_id": "o", "week_ending": WEEK, "days": {"2": {"primetime": "Pitch tips"}},
                  "notes": "", "slot_notes": {"2:day": [_note("cccccc3", "Close slower", "Sam's coaching")]}}
        after = {**before, "days": {"2": {"primetime": ""}}, "slot_notes": {}}
        await db.weekly_planners.insert_one(dict(after))
        await ns.snapshot(before, after)
        items = await ns.removed_notes(UID, weeks_back=520)
        keys = {i["key"] for i in items}
        assert keys == {"box:2:primetime", "note:2:day:cccccc3"}
        note = next(i for i in items if i["key"].startswith("note:"))
        assert note["title"] == "Sam's coaching"
        p = await ns.restore(UID, note["history_id"], note["key"])
        assert p["slot_notes"]["2:day"][0]["body"] == "Close slower"
        box = next(i for i in items if i["key"].startswith("box:"))
        p = await ns.restore(UID, box["history_id"], box["key"])
        assert p["days"]["2"]["primetime"] == "Pitch tips"
        left = {i["key"] for i in await ns.removed_notes(UID, weeks_back=520)}
        assert left == set()

    asyncio.run(run())
