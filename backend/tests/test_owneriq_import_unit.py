"""Add from OwnerIQ: plan who can be added from the OwnerIQ tree, then create
their app accounts with a starter password.

Pure in-memory: mongomock, no OwnerIQ. Placeholder people only.
"""
import asyncio
import sys
from pathlib import Path

import pytest
from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from owneriq_import import apply_import, owner_node, parse_roster, plan_import  # noqa: E402

OFFICE = "office-a"
ADMIN = {"id": "admin-1", "role": "admin", "office_id": OFFICE}


def _run(coro):
    return asyncio.run(coro)


def _u(oid, name, email, parent=None, stage="stage_1", badge="", active=True):
    return {"id": oid, "attributes": {
        "full_name": name, "email": email, "parent_id": parent, "stage": stage,
        "badge_number": badge, "badge_number_list": badge, "active": active}}


ROSTER = {"data": [
    _u("1", "Example Owner", "owner@example.org", stage="stage_5", badge="EX0001"),
    _u("2", "Example Coach", "coach@example.org", parent="1", stage="stage_3", badge="EX0002"),
    _u("3", "Example Ba", "ba@example.org", parent="2", badge="EX0003"),
    _u("4", "Example Noemail", "", parent="2", badge="EX0004"),
    _u("5", "Example Linked", "linked@example.org", parent="2", badge="EX0005"),
    _u("6", "Example Applicant", "applicant@example.org"),
    _u("7", "Example Leaver", "leaver@example.org", parent="2", active=False),
]}


def _people():
    return parse_roster(ROSTER)


def test_owner_is_the_root_with_most_reports():
    assert owner_node(_people()) == "1"
    assert owner_node(_people(), skip_roots=["1"]) == "6"


def test_plan_statuses_roles_and_coaches():
    app_users = [{"_id": ObjectId(), "name": "Someone", "email": "x@example.org",
                  "amplifi_codes": ["EX0005"], "owneriq_user_id": None}]
    rows = {r["owneriq_user_id"]: r for r in plan_import(_people(), app_users, "1")}
    assert "1" not in rows and "7" not in rows  # owner and leavers left out
    assert rows["2"]["status"] == "new" and rows["2"]["role"] == "leader"
    assert rows["3"]["status"] == "new" and rows["3"]["role"] == "trainee"
    assert rows["3"]["coach_name"] == "Example Coach"
    assert rows["4"]["status"] == "no_email"
    assert rows["5"]["status"] == "in_app"  # matched by badge
    assert rows["6"]["in_tree"] is False


def test_plan_never_matches_by_name():
    app_users = [{"_id": ObjectId(), "name": "Example Ba", "email": "other@example.org",
                  "amplifi_codes": [], "owneriq_user_id": None}]
    rows = {r["owneriq_user_id"]: r for r in plan_import(_people(), app_users, "1")}
    assert rows["3"]["status"] == "new"


def test_apply_creates_accounts_and_links_coach():
    db = AsyncMongoMockClient()["t"]
    rows = plan_import(_people(), [], "1")
    res = _run(apply_import(db, office_id=OFFICE, admin=ADMIN, rows=rows,
                            picks=[{"owneriq_user_id": "2"}, {"owneriq_user_id": "3"},
                                   {"owneriq_user_id": "4"}],
                            starter_password="starter-pass-1"))
    assert {c["owneriq_user_id"] for c in res["created"]} == {"2", "3"}
    assert [s["owneriq_user_id"] for s in res["skipped"]] == ["4"]
    coach = _run(db.users.find_one({"owneriq_user_id": "2"}))
    ba = _run(db.users.find_one({"owneriq_user_id": "3"}))
    assert coach["role"] == "leader" and ba["role"] == "trainee"
    assert ba["must_change_password"] is True and ba["amplifi_codes"] == ["EX0003"]
    assert ba["office_id"] == OFFICE
    assert ba["reports_to"] == str(coach["_id"])
    assert ba["password_hash"] != "starter-pass-1"


def test_apply_skips_taken_email_and_badge():
    db = AsyncMongoMockClient()["t"]
    _run(db.users.insert_one({"email": "ba@example.org", "name": "Existing"}))
    _run(db.users.insert_one({"email": "z@example.org", "amplifi_codes": ["EX0002"]}))
    rows = plan_import(_people(), [], "1")
    res = _run(apply_import(db, office_id=OFFICE, admin=ADMIN, rows=rows,
                            picks=[{"owneriq_user_id": "2"}, {"owneriq_user_id": "3"}],
                            starter_password="starter-pass-1"))
    assert [c["owneriq_user_id"] for c in res["created"]] == ["2"]
    assert res["created"][0]["badges"] == []  # badge already held


def test_apply_rejects_short_password():
    db = AsyncMongoMockClient()["t"]
    rows = plan_import(_people(), [], "1")
    with pytest.raises(ValueError):
        _run(apply_import(db, office_id=OFFICE, admin=ADMIN, rows=rows,
                          picks=[{"owneriq_user_id": "3"}], starter_password="short"))
