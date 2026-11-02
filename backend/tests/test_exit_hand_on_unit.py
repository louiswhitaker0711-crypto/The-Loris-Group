"""Exiting a leader hands their people up a level (the Owner, 2 Nov 2026)."""
import asyncio

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from core.team_sections import hand_on_team


def _setup():
    db = AsyncMongoMockClient()["t"]
    owner, lead, sub, ba, sub_ba = (ObjectId() for _ in range(5))
    asyncio.run(db.users.insert_many([
        {"_id": owner, "name": "Owner Example", "role": "admin", "office_id": "o1"},
        {"_id": lead, "name": "Lead Example", "role": "trainee", "reports_to": str(owner),
         "team_name": "Example Team", "team_last_member_on": "2026-11-02", "office_id": "o1"},
        {"_id": sub, "name": "Sub Example", "role": "trainee", "reports_to": str(lead), "office_id": "o1"},
        {"_id": ba, "name": "Ba Example", "role": "trainee", "reports_to": str(lead), "office_id": "o1"},
        {"_id": sub_ba, "name": "Subba Example", "role": "trainee", "reports_to": str(sub), "office_id": "o1"},
    ]))
    asyncio.run(db.new_hires.insert_many([
        {"id": "h1", "leader_user_id": str(lead), "leader": "Lead Example", "office_id": "o1"},
        {"id": "h2", "leader": "Lead Example", "office_id": "o1"},
    ]))
    return db, owner, lead, sub, ba, sub_ba


def test_people_go_to_the_leader_above_and_sub_teams_move_whole():
    db, owner, lead, sub, ba, sub_ba = _setup()
    exited = asyncio.run(db.users.find_one({"_id": lead}))
    out = asyncio.run(hand_on_team(db, exited, str(owner)))
    assert out == {"to": str(owner), "moved": 2}
    get = lambda i: asyncio.run(db.users.find_one({"_id": i}))
    assert get(sub)["reports_to"] == str(owner)
    assert get(ba)["reports_to"] == str(owner)
    assert get(sub_ba)["reports_to"] == str(sub)               # Sub keeps their own team
    assert "team_last_member_on" not in get(lead)               # section goes straight away
    for hid in ("h1", "h2"):
        h = asyncio.run(db.new_hires.find_one({"id": hid}))
        assert h["leader_user_id"] == str(owner) and h["leader"] == "Owner Example"


def test_nobody_above_falls_back_to_the_admin_doing_the_exit():
    db, owner, lead, sub, ba, _ = _setup()
    asyncio.run(db.users.update_one({"_id": lead}, {"$unset": {"reports_to": ""}}))
    exited = asyncio.run(db.users.find_one({"_id": lead}))
    out = asyncio.run(hand_on_team(db, exited, str(owner)))
    assert out["to"] == str(owner)
    assert asyncio.run(db.users.find_one({"_id": ba}))["reports_to"] == str(owner)
