"""The read-only Claude connector (routes/claude_connector.py): the secret
gate, the MCP handshake, read-only tools, and no personal details leaving."""
import asyncio
import json
import os
import sys
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import claude_connector as cc  # noqa: E402

GOOD = "x" * 40


class _Req:
    headers: dict = {}
    client = type("C", (), {"host": "203.0.113.9"})()


def test_gate_off_when_unset_or_short(monkeypatch):
    monkeypatch.delenv("CLAUDE_CONNECTOR_TOKEN", raising=False)
    with pytest.raises(HTTPException) as e:
        cc._check_token(GOOD, _Req())
    assert e.value.status_code == 404
    monkeypatch.setenv("CLAUDE_CONNECTOR_TOKEN", "short")
    with pytest.raises(HTTPException):
        cc._check_token("short", _Req())


def test_gate_wrong_and_right(monkeypatch):
    monkeypatch.setenv("CLAUDE_CONNECTOR_TOKEN", GOOD)
    with pytest.raises(HTTPException) as e:
        cc._check_token("y" * 40, _Req())
    assert e.value.status_code == 404
    cc._check_token(GOOD, _Req())   # no error


def test_handshake_and_tools_are_read_only():
    init = asyncio.run(cc.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                  "params": {"protocolVersion": "2025-06-18"}}))
    assert init["result"]["protocolVersion"] == "2025-06-18"
    assert "tools" in init["result"]["capabilities"]
    assert asyncio.run(cc.handle({"jsonrpc": "2.0", "method": "notifications/initialized"})) is None
    tools = asyncio.run(cc.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"get_team", "get_bells_week", "get_recent_weeks", "get_person",
            "get_field_numbers", "get_sectors", "get_quality"} <= names
    assert all(t["annotations"]["readOnlyHint"] for t in tools)
    bad = asyncio.run(cc.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "nope"}}))
    assert "error" in bad


def test_private_details_never_leave():
    out = cc.strip_private({"name": "Example Person", "email": "you@example.org", "phone": "0",
                            "person": {"badge_numbers": ["A1"], "profile_image": "x", "stage": "2"},
                            "rows": [{"badge_number": "A1", "sales": 3}], "_id": ObjectId()})
    text = json.dumps(out)
    for word in ("email", "phone", "badge", "profile_image", "_id"):
        assert word not in text
    assert out["person"]["stage"] == "2" and out["rows"][0]["sales"] == 3


def _db(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cc, "db", db)
    return db


def test_recent_weeks_trend(monkeypatch):
    db = _db(monkeypatch)
    owner, ba = ObjectId(), ObjectId()
    asyncio.run(db.users.insert_many([
        {"_id": owner, "role": "admin", "is_super_admin": True, "name": "Owner Example", "office_id": "o1",
         "email": "you@example.org"},
        {"_id": ba, "role": "trainee", "name": "Alpha Example", "office_id": "o1", "phone": "0"},
    ]))
    day = lambda g, s, r, st="in": {"over30": g, "under30": s, "memberships": r, "status": st}  # noqa: E731
    asyncio.run(db.bells_entries.insert_many([
        {"office_id": "o1", "user_id": str(ba), "user_name": "Alpha Example", "week_ending": "2026-10-18",
         "days": [day(2, 1, 2), day(3, 0, 3), day(0, 0, 0, "ns"), day(1, 0, 1), day(2, 0, 2), day(4, 0, 3), day(0, 0, 0, "ab")]},
        {"office_id": "o1", "user_id": str(ba), "user_name": "Alpha Example", "week_ending": "2026-10-25",
         "days": [day(4, 0, 4)] + [day(0, 0, 0, "ab")] * 6},
    ]))
    owner_doc = asyncio.run(cc.owner_view())
    assert owner_doc["office_id"] == "o1"
    res = asyncio.run(cc.tool_get_recent_weeks(owner_doc, {"weeks": 2, "up_to_week_ending": "2026-10-25"}))
    assert res["weeks"] == ["2026-10-18", "2026-10-25"]
    alpha = res["people"][0]
    assert alpha["name"] == "Alpha Example"
    assert alpha["weeks"]["2026-10-18"]["sign_ups"] == 13
    assert alpha["weeks"]["2026-10-18"]["reliability_pct"] == 83   # 5 of 6 planned days in (one no show)
    assert res["office"]["2026-10-25"]["sign_ups"] == 4
    assert "phone" not in json.dumps(res) and "email" not in json.dumps(res)


def test_tool_call_reports_errors_gently(monkeypatch):
    _db(monkeypatch)
    r = asyncio.run(cc.handle({"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                               "params": {"name": "get_team", "arguments": {}}}))
    assert r["result"]["isError"] is True     # no Owner account in an empty database


def test_mounted_outside_api():
    paths = {getattr(r, "path", "") for r in cc.router.routes}
    assert "/mcp/{token}" in paths
    methods = {m for r in cc.router.routes for m in (getattr(r, "methods", None) or set())}
    assert methods <= {"POST", "GET", "DELETE"}
