"""The Hub's AI (routes/ai_assistant.py, core/ai_actions.py): daily caps, one
analysis a day, "Use this" writing as the person, and personal Claude links."""
import asyncio
import json
import os
import sys
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import ai_actions  # noqa: E402
from routes import ai_assistant as ai  # noqa: E402
from routes import claude_connector as cc  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class _Req:
    def __init__(self, body=None):
        self._body = body if body is not None else {}
        self.headers = {"content-length": "1"}
        self.client = type("C", (), {"host": "203.0.113.9"})()

    async def json(self):
        return self._body


@pytest.fixture
def db(monkeypatch):
    d = AsyncMongoMockClient()["ai_test"]
    for mod in (ai, ai_actions, cc):
        monkeypatch.setattr(mod, "db", d)
    import routes.notes_folder as nf
    monkeypatch.setattr(nf, "db", d)
    return d


def _login(monkeypatch, user):
    async def me(_req):
        return user
    monkeypatch.setattr(ai, "get_current_user", me)


def _ba():
    return {"id": str(ObjectId()), "name": "Alpha Example", "role": "trainee", "office_id": "o1"}


def test_chat_is_capped_at_twenty_a_day(db):
    uid = "u1"
    for _ in range(ai.DAILY_LIMITS["chat"]):
        _run(ai._take(uid, "chat"))
    with pytest.raises(HTTPException) as e:
        _run(ai._take(uid, "chat"))
    assert e.value.status_code == 429 and "Tomorrow is a new day" in e.value.detail
    _run(ai._give_back(uid, "chat"))     # a failed call gives one back
    _run(ai._take(uid, "chat"))


def test_analyse_once_a_day_and_never_calls_the_model_twice(db, monkeypatch):
    user = _ba()
    _login(monkeypatch, user)
    monkeypatch.setattr(ai, "llm_configured", lambda: True)
    calls = []

    async def fake_ask(_u, _s, prompt):
        calls.append(prompt)
        return json.dumps({"headline": "Good week", "tomorrow": {"focus": "Speak to more people", "goal": 4},
                           "this_week": {"weekly_goal": 16}})

    async def fake_ctx(_u):
        return "{}"
    monkeypatch.setattr(ai, "_ask", fake_ask)
    monkeypatch.setattr(ai, "context_text", fake_ctx)
    monkeypatch.setattr(ai, "coaching_material", fake_ctx)
    first = _run(ai.analyse(_Req()))["analysis"]
    assert first["result"]["headline"] == "Good week"
    again = _run(ai.analyse(_Req()))["analysis"]
    assert again["id"] == first["id"] and len(calls) == 1
    # An analysis in the old shape is done again once, at no extra cost.
    _run(db.ai_analyses.update_one({"id": first["id"]}, {"$unset": {"v": ""}}))
    assert _run(ai.get_analysis(_Req()))["analysis"] is None
    redo = _run(ai.analyse(_Req()))["analysis"]
    assert redo["id"] != first["id"] and redo["v"] == ai.ANALYSE_VERSION and len(calls) == 2


def test_ai_is_off_without_the_key_and_for_viewers(db, monkeypatch):
    monkeypatch.setattr(ai, "llm_configured", lambda: False)
    with pytest.raises(HTTPException) as e:
        ai._require_ai(_ba())
    assert e.value.status_code == 503
    monkeypatch.setattr(ai, "llm_configured", lambda: True)
    with pytest.raises(HTTPException):
        ai._require_ai({**_ba(), "is_viewer": True})


def test_use_this_sets_my_weekly_goal_as_me(db, monkeypatch):
    user = _ba()
    _login(monkeypatch, user)
    out = _run(ai.apply(_Req({"kind": "weekly_goal", "data": {"goal": 16}})))
    row = _run(db.bells_entries.find_one({"user_id": user["id"]}))
    assert out["weekly_goal"] == 16 and row["weekly_goal"] == 16 and row["weekly_goal_source"] == "app"
    with pytest.raises(HTTPException):
        _run(ai.apply(_Req({"kind": "weekly_goal", "data": {"goal": "lots"}})))


def test_use_this_writes_my_planner_box_and_note(db, monkeypatch):
    user = _ba()
    _login(monkeypatch, user)
    out = _run(ai.apply(_Req({"kind": "planner", "data": {"date": "2026-11-03", "box": "sector",
                                                          "text": "Doors first, 120 by 17:00"}})))
    assert out["box"] == "Sector" and out["day"] == "Tuesday"
    p = _run(db.weekly_planners.find_one({"user_id": user["id"], "week_ending": "2026-11-08"}))
    assert p["days"]["1"]["sector"] == "Doors first, 120 by 17:00"
    _run(ai.apply(_Req({"kind": "planner", "data": {"date": "2026-11-03", "box": "Sector", "text": "Bunny hop with B"}})))
    p = _run(db.weekly_planners.find_one({"user_id": user["id"]}))
    assert p["days"]["1"]["sector"].splitlines() == ["Doors first, 120 by 17:00", "Bunny hop with B"]
    with pytest.raises(HTTPException):
        _run(ai.apply(_Req({"kind": "planner", "data": {"date": "2026-11-03", "box": "made up", "text": "x"}})))
    _run(ai.apply(_Req({"kind": "note", "data": {"date": "2026-11-03", "title": "Close", "body": "Ask, then stop"}})))
    p = _run(db.weekly_planners.find_one({"user_id": user["id"]}))
    assert p["slot_notes"]["1:day"][0]["title"] == "Close"


def test_viewers_cannot_use_this(db, monkeypatch):
    _login(monkeypatch, {**_ba(), "is_viewer": True})
    with pytest.raises(HTTPException) as e:
        _run(ai.apply(_Req({"kind": "weekly_goal", "data": {"goal": 10}})))
    assert e.value.status_code == 403


def test_personal_links_admins_only_until_allowed(db, monkeypatch):
    ba = _ba()
    _login(monkeypatch, ba)
    with pytest.raises(HTTPException) as e:
        _run(ai.make_connector_link(_Req()))
    assert e.value.status_code == 403
    _login(monkeypatch, {**ba, "connector_allowed": True})
    path = _run(ai.make_connector_link(_Req()))["path"]
    token = path.rsplit("/", 1)[1]
    assert len(token) >= cc.MIN_TOKEN_LENGTH
    stored = _run(db.connector_links.find_one({"user_id": ba["id"]}))
    assert stored["token_hash"] == cc.hash_link(token) and token not in json.dumps(stored, default=str)
    # A new link replaces the old one.
    _run(ai.make_connector_link(_Req()))
    assert _run(db.connector_links.count_documents({"user_id": ba["id"], "revoked": {"$ne": True}})) == 1


# ── Private coaching notes (routes/coaching_notes.py) ────────────────────────

def _notes_db(monkeypatch, d):
    import auth
    import core.ai_context as ctx
    from routes import coaching_notes as cn
    for mod in (cn, auth, ctx):
        monkeypatch.setattr(mod, "db", d)
    return cn


def _people(d):
    owner, coach, ba, other = ObjectId(), ObjectId(), ObjectId(), ObjectId()
    _run(d.users.insert_many([
        {"_id": owner, "name": "Owner Example", "role": "admin", "office_id": "o1"},
        {"_id": coach, "name": "Coach Example", "role": "leader", "office_id": "o1", "reports_to": str(owner)},
        {"_id": ba, "name": "Alpha Example", "role": "trainee", "office_id": "o1", "reports_to": str(coach)},
        {"_id": other, "name": "Beta Example", "role": "trainee", "office_id": "o1"},
    ]))
    as_user = lambda oid, role: {"id": str(oid), "role": role, "office_id": "o1"}  # noqa: E731
    return as_user(owner, "admin"), as_user(coach, "leader"), as_user(ba, "trainee"), as_user(other, "trainee")


def test_coaching_notes_are_for_the_owner_and_their_coach_only(db, monkeypatch):
    cn = _notes_db(monkeypatch, db)
    owner, coach, ba, other = _people(db)
    _run(cn.may_note(owner, ba["id"]))
    _run(cn.may_note(coach, ba["id"]))
    for who, about in ((ba, ba["id"]), (other, ba["id"]), (coach, other["id"]), ({**owner, "is_viewer": True}, ba["id"])):
        with pytest.raises(HTTPException):
            _run(cn.may_note(who, about))       # themselves, a peer, not their team, read-only


def test_notes_live_until_sorted_and_reach_the_coach_ai_not_the_person(db, monkeypatch):
    cn = _notes_db(monkeypatch, db)
    import core.ai_context as ctx
    owner, coach, ba, _other = _people(db)

    async def me(_req):
        return coach
    monkeypatch.setattr(cn, "get_current_user", me)
    note = _run(cn.add_note(ba["id"], _Req({"text": "Rushes the close when nervous"})))
    assert _run(cn.live_notes([ba["id"]])) == {ba["id"]: ["Rushes the close when nervous"]}
    # The Coach's AI sees it, by name; the BA's own context never does.
    assert _run(cn.noteable_ids(coach, {ba["id"], coach["id"]})) == {ba["id"]}
    assert _run(cn.noteable_ids(ba, {ba["id"]})) == set()

    async def no_page(*_a, **_k):
        raise HTTPException(status_code=403)
    monkeypatch.setattr("routes.people.person_breakdown_for", no_page)
    mine = _run(ctx.build_context({**ba, "name": "Alpha Example"}))
    assert "Rushes" not in json.dumps(mine, default=str)
    theirs = _run(ctx.build_context({**coach, "name": "Coach Example"}))
    assert theirs["coaching_notes_on_my_people"] == [{"name": "Alpha Example", "notes": ["Rushes the close when nervous"]}]
    _run(cn.sort_note(ba["id"], note["id"], _Req()))
    assert _run(cn.live_notes([ba["id"]])) == {}


def test_own_ai_gets_notes_only_as_private_guidance(db, monkeypatch):
    _notes_db(monkeypatch, db)
    _run(db.coaching_notes.insert_one({"subject_id": "u9", "text": "Goes quiet after a no", "sorted_at": None,
                                       "created_at": "2026-11-05T10:00:00+00:00"}))
    g = _run(ai.private_guidance({"id": "u9"}))
    assert "Goes quiet after a no" in g and "never" in g.lower()
    assert _run(ai.private_guidance({"id": "u8"})) == ""
