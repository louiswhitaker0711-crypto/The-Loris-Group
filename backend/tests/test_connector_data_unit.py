"""The full Claude connector (core/connector_data.py): Admins read any part of
the app kept to their office, never personal details; changes only happen
after a confirm code, and can be undone."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from bson import ObjectId

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import connector_data as cd  # noqa: E402
from routes import claude_connector as cc  # noqa: E402


def run(c):
    return asyncio.run(c)


def _setup(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cd, "db", db)
    monkeypatch.setattr(cc, "db", db)
    owner, ba, other = ObjectId(), ObjectId(), ObjectId()
    run(db.users.insert_many([
        {"_id": owner, "role": "admin", "is_super_admin": True, "name": "Owner Example", "office_id": "o1",
         "email": "you@example.org", "password_hash": "x"},
        {"_id": ba, "role": "trainee", "name": "Alpha Example", "office_id": "o1", "phone": "07000 000000"},
        {"_id": other, "role": "trainee", "name": "Other Office", "office_id": "o2"},
    ]))
    run(db.monthly_planners.insert_many([
        {"user_id": str(ba), "month": "2026-11", "goals": [{"text": "Hit 20", "how": "More pitches"}]},
        {"user_id": str(other), "month": "2026-11", "goals": [{"text": "Not yours"}]},
    ]))
    run(db.ai_conversations.insert_one({"id": "c1", "user_id": str(ba), "messages": [
        {"role": "user", "content": "How do I close better?"}]}))
    run(db.email_otps.insert_one({"office_id": "o1", "code": "123456"}))
    viewer = {"id": str(owner), "role": "admin", "is_super_admin": True, "name": "Owner Example", "office_id": "o1"}
    return db, viewer, str(ba)


def test_list_areas_hides_secrets(monkeypatch):
    db, viewer, _ = _setup(monkeypatch)
    areas = {a["area"]: a for a in run(cd.list_areas(viewer))["areas"]}
    assert "monthly_planners" in areas and "ai_conversations" in areas
    assert "email_otps" not in areas
    assert areas["monthly_planners"]["records"] == 1          # only this office
    assert "email" not in areas["users"]["fields"] and "password_hash" not in areas["users"]["fields"]


def test_read_goal_planner_and_chats_in_office_only(monkeypatch):
    db, viewer, ba = _setup(monkeypatch)
    out = run(cd.read_data(viewer, {"area": "monthly_planners"}))
    assert out["total"] == 1
    rec = out["records"][0]
    assert rec["goals"][0]["text"] == "Hit 20" and rec["user_id__name"] == "Alpha Example"
    chats = run(cd.read_data(viewer, {"area": "ai_conversations", "match": {"user_id": ba}}))
    assert chats["records"][0]["messages"][0]["content"].startswith("How do I")
    people = run(cd.read_data(viewer, {"area": "users", "limit": 50}))
    blob = str(people)
    assert "you@example.org" not in blob and "07000" not in blob and "password" not in blob
    assert "Other Office" not in blob


def test_blocked_and_unsafe(monkeypatch):
    db, viewer, _ = _setup(monkeypatch)
    with pytest.raises(ValueError):
        run(cd.read_data(viewer, {"area": "email_otps"}))
    with pytest.raises(ValueError):
        run(cd.read_data(viewer, {"area": "users", "match": {"$where": "1"}}))
    with pytest.raises(ValueError):
        run(cd.read_data(viewer, {"area": "users", "match": {"email": "you@example.org"}}))
    ba_viewer = {**viewer, "role": "trainee", "is_super_admin": False}
    with pytest.raises(ValueError):
        run(cd.read_data(ba_viewer, {"area": "users"}))


def test_change_needs_confirm_then_undo(monkeypatch):
    db, viewer, ba = _setup(monkeypatch)
    rec = run(cd.read_data(viewer, {"area": "monthly_planners"}))["records"][0]
    prep = run(cd.change_data(viewer, {"area": "monthly_planners", "action": "update",
                                       "match": {"_doc_id": rec["_doc_id"]},
                                       "set": {"goals.0.text": "Hit 25"}, "why": "Owner asked"}))
    assert prep["nothing_changed_yet"] and prep["will_change"][0]["changes"]["goals.0.text"]["will_be"] == "Hit 25"
    doc = run(db.monthly_planners.find_one({"user_id": ba}))
    assert doc["goals"][0]["text"] == "Hit 20"                       # nothing yet
    done = run(cd.confirm_change(viewer, {"confirm_code": prep["confirm_code"]}))
    assert done["changed"] == 1
    assert run(db.monthly_planners.find_one({"user_id": ba}))["goals"][0]["text"] == "Hit 25"
    with pytest.raises(ValueError):                                   # one use only
        run(cd.confirm_change(viewer, {"confirm_code": prep["confirm_code"]}))
    run(cd.undo_change(viewer, {"change_id": done["change_id"]}))
    assert run(db.monthly_planners.find_one({"user_id": ba}))["goals"][0]["text"] == "Hit 20"


def test_locked_fields_and_other_office(monkeypatch):
    db, viewer, ba = _setup(monkeypatch)
    for bad in ({"email": "x@example.org"}, {"office_id": "o2"}, {"password_hash": "y"}, {"is_super_admin": True}):
        with pytest.raises(ValueError):
            run(cd.change_data(viewer, {"area": "users", "match": {"_doc_id": ba}, "set": bad}))
    other = run(db.users.find_one({"office_id": "o2"}))
    with pytest.raises(ValueError):                                   # can't reach another office
        run(cd.change_data(viewer, {"area": "users", "match": {"_doc_id": str(other["_id"])},
                                    "set": {"name": "Changed"}}))


def test_add_and_delete(monkeypatch):
    db, viewer, ba = _setup(monkeypatch)
    prep = run(cd.change_data(viewer, {"area": "folder_notes", "action": "add",
                                       "record": {"user_id": ba, "title": "Closing tips"}}))
    done = run(cd.confirm_change(viewer, {"confirm_code": prep["confirm_code"]}))
    assert done["added"] == 1
    prep = run(cd.change_data(viewer, {"area": "folder_notes", "action": "delete",
                                       "match": {"title": "Closing tips"}}))
    run(cd.confirm_change(viewer, {"confirm_code": prep["confirm_code"]}))
    assert run(db.folder_notes.count_documents({})) == 0
    log = run(cd.recent_changes(viewer, {}))["changes"]
    assert [c["action"] for c in log] == ["delete", "add"]


def test_admin_tools_only_listed_for_admins():
    admin = {t["name"] for t in cc.tools_list({"role": "admin"})}
    ba = {t["name"] for t in cc.tools_list({"role": "trainee"})}
    assert {"read_data", "change_data", "confirm_change"} <= admin
    assert not ({"read_data", "change_data", "confirm_change"} & ba)
