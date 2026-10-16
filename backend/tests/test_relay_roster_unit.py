"""The relayed OwnerIQ people list (core/owneriq_relay_roster.py): stored
trimmed and per office, served only while the browser relay is live, and used
by "Add the team from OwnerIQ" in place of a server fetch.

Pure in-memory: mongomock_motor, nothing real is called. Placeholder people.
"""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import core.owneriq_relay_roster as rr  # noqa: E402
import core.owneriq_session as sess  # noqa: E402

run = asyncio.run


def _user(oid, name, active=True, **extra):
    return {"id": oid, "type": "users", "attributes": {
        "full_name": name, "email": f"{oid}@example.org", "badge_number_list": f"B{oid}",
        "stage": "stage_1", "parent_id": None, "active": active,
        "phone": "00000 000000", "address": "1 Example Street", **extra}}


def _setup(monkeypatch, live=True):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(rr, "db", db)

    async def active(doc=None):
        return live
    monkeypatch.setattr(sess, "relay_active", active)
    return db


def test_store_trims_and_tags_offices(monkeypatch):
    db = _setup(monkeypatch)
    n = run(rr.store([{"data": [_user("1", "Example Person"), _user("2", "Example Two", active=False)]}], ["62"]))
    assert n == 2
    doc = run(db.owneriq_relay_roster.find_one({"_id": "latest"}))
    office = doc["offices"][0]
    assert office["pin"] == "62"
    attrs = office["users"][0]["attributes"]
    # Only what the screens use is kept.
    assert "phone" not in attrs and "address" not in attrs
    assert attrs["full_name"] == "Example Person" and attrs["active"] is True


def test_served_only_while_relay_is_live(monkeypatch):
    _setup(monkeypatch, live=False)
    run(rr.store([{"data": [_user("1", "Example Person")]}], ["62"]))
    assert run(rr.offices()) is None
    assert run(rr.payload_for("62")) is None


def test_payload_for_matches_pin_or_single_office(monkeypatch):
    _setup(monkeypatch)
    run(rr.store([{"data": [_user("1", "Example Person")]}], ["62"]))
    assert [u["id"] for u in run(rr.payload_for("62"))["data"]] == ["1"]
    # One office: used whatever pin the app has mapped (or none).
    assert [u["id"] for u in run(rr.payload_for(None))["data"]] == ["1"]
    # An older script that sent no pins still works for a single office.
    run(rr.store([{"data": [_user("3", "Example Three")]}]))
    assert [u["id"] for u in run(rr.payload_for("62"))["data"]] == ["3"]


def test_two_offices_keep_apart(monkeypatch):
    _setup(monkeypatch)
    run(rr.store([{"data": [_user("1", "Example A")]}, {"data": [_user("2", "Example B")]}], ["62", "63"]))
    assert [u["id"] for u in run(rr.payload_for("63"))["data"]] == ["2"]
    assert run(rr.payload_for("99"))["data"] == []


def test_import_reads_the_relayed_list(monkeypatch):
    """Admin → "Add the team from OwnerIQ" uses the relayed list (active only)
    and never logs in to OwnerIQ while the relay is live."""
    _setup(monkeypatch)
    run(rr.store([{"data": [_user("1", "Example Person"), _user("2", "Example Gone", active=False)]}], ["62"]))
    from routes import owneriq

    class NoClient:
        def __init__(self, *a, **k):
            raise AssertionError("the server must not call OwnerIQ while the relay is live")
    monkeypatch.setattr(owneriq, "_client", NoClient)
    people = run(owneriq._owneriq_roster_for("62"))
    assert [p["owneriq_user_id"] for p in people] == ["1"]
    assert people[0]["name"] == "Example Person"


def _request(body: dict):
    import json
    from starlette.requests import Request
    raw = json.dumps(body).encode()

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}
    return Request({"type": "http", "method": "POST", "headers": []}, receive)


def _hub_fakes(monkeypatch):
    import owneriq_hub
    import owneriq_performance
    stored, applied = [], []

    async def fake_store(kind, ref, week_start, payload):
        stored.append((kind, str(ref), week_start))

    async def fake_apply(week_start, payloads):
        applied.append(week_start)
        return {"stats": len(payloads)}

    async def fake_mark(meta=None):
        return None
    monkeypatch.setattr(owneriq_hub, "store", fake_store)
    monkeypatch.setattr(owneriq_performance, "apply_relayed_week", fake_apply)
    monkeypatch.setattr(sess, "mark_relay_ingest", fake_mark)
    monkeypatch.setenv("OWNERIQ_RELAY_SECRET", "example-relay-secret-0123456789")
    return stored, applied


def test_hub_history_is_for_viewing_only(monkeypatch):
    """The daily walk back through earlier weeks (cache_only) is shown on the
    Hub but never rewrites that week's Bells."""
    from routes import owneriq
    stored, applied = _hub_fakes(monkeypatch)
    body = {"secret": "example-relay-secret-0123456789", "week_start": "2026-09-07", "cache_only": True,
            "views": [{"kind": "mc", "ref": "9", "payload": {"users": []}},
                      {"kind": "team", "ref": "4", "payload": {"users": []}}]}
    out = run(owneriq.owneriq_relay_hub(_request(body)))
    assert out["views_stored"] == 2
    assert stored == [("mc", "9", "2026-09-07"), ("team", "4", "2026-09-07")]
    assert applied == []


def test_hub_this_week_still_fills_bells(monkeypatch):
    from routes import owneriq
    stored, applied = _hub_fakes(monkeypatch)
    body = {"secret": "example-relay-secret-0123456789", "week_start": "2026-10-12",
            "views": [{"kind": "mc", "ref": "9", "payload": {"users": []}}]}
    run(owneriq.owneriq_relay_hub(_request(body)))
    assert stored == [("mc", "9", "2026-10-12")]
    assert applied == ["2026-10-12"]
