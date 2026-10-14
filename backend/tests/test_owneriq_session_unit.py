"""OwnerIQ session store (core/owneriq_session.py): one token source, a 401
clears it, MFA stops the loop, and the owner's paste reconnects. No real
OwnerIQ is ever touched — a fake transport answers every call."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import core.owneriq_session as sess  # noqa: E402

run = asyncio.run


def _db(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(sess, "db", db)
    return db


def _transport(handler):
    return httpx.MockTransport(handler)


def _client(handler):
    return httpx.AsyncClient(transport=_transport(handler))


def test_parse_and_blank():
    assert sess.parse_pasted("Bearer abc12345") == "abc12345"
    assert sess.parse_pasted('{"state":{"token":"ZZZZ"}}') == "ZZZZ"
    assert "secretlongtoken" not in sess._blank_token_like('{"auth_token":"secretlongtoken"}')


def test_sign_in_once_then_reuse(monkeypatch):
    _db(monkeypatch)
    monkeypatch.setenv("OWNERIQ_EMAIL", "you@example.org")
    monkeypatch.setenv("OWNERIQ_PASSWORD", "pw")
    monkeypatch.delenv("OWNERIQ_API_BASE", raising=False)
    calls = {"signin": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/v3/owner/sessions") and req.method == "POST":
            calls["signin"] += 1
            return httpx.Response(200, json={"data": {"attributes": {"auth_token": "TOK1"}}})
        return httpx.Response(200, json={})

    async def go():
        async with _client(handler) as c:
            t1 = await sess.get_token(c)
            t2 = await sess.get_token(c)
            return t1, t2
    t1, t2 = run(go())
    assert t1 == t2 == "TOK1" and calls["signin"] == 1
    assert run(sess.available()) is True


def test_mfa_stops_and_needs_reconnect(monkeypatch):
    _db(monkeypatch)
    monkeypatch.setenv("OWNERIQ_EMAIL", "you@example.org")
    monkeypatch.setenv("OWNERIQ_PASSWORD", "pw")
    calls = {"signin": 0}

    def handler(req):
        if req.url.path.endswith("/v3/owner/sessions") and req.method == "POST":
            calls["signin"] += 1
            return httpx.Response(200, json={"otp_required": True, "mfa_token": "longmfatoken"})
        return httpx.Response(200, json={})

    async def go():
        async with _client(handler) as c:
            errs = 0
            for _ in range(4):
                try:
                    await sess.get_token(c)
                except sess.OwnerIQNeedsReconnect:
                    errs += 1
            return errs
    errs = run(go())
    assert errs == 4 and calls["signin"] == 1          # one attempt, then no more
    assert run(sess.available()) is False
    doc = run(sess._read())
    assert doc["state"] == sess.NEEDS_RECONNECT
    assert "longmfatoken" not in (doc.get("last_body") or "")   # token blanked


def test_401_on_old_token_clears_and_resigns(monkeypatch):
    db = _db(monkeypatch)
    monkeypatch.setenv("OWNERIQ_EMAIL", "you@example.org")
    monkeypatch.setenv("OWNERIQ_PASSWORD", "pw")
    run(db.owneriq_session.update_one({"_id": "session"},
        {"$set": {"token": "OLD", "state": sess.CONNECTED, "source": "password",
                  "minted_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()}}, upsert=True))
    run(sess.on_unauthorized("OLD"))
    doc = run(sess._read())
    assert doc["state"] == sess.SIGNED_OUT and not doc.get("token")


def test_password_token_refused_fast_needs_reconnect(monkeypatch):
    db = _db(monkeypatch)
    run(db.owneriq_session.update_one({"_id": "session"},
        {"$set": {"token": "NEW", "state": sess.CONNECTED, "source": "password",
                  "minted_at": datetime.now(timezone.utc).isoformat()}}, upsert=True))
    run(sess.on_unauthorized("NEW"))
    assert run(sess._read())["state"] == sess.NEEDS_RECONNECT


def test_reconnect_with_pasted_token(monkeypatch):
    _db(monkeypatch)
    monkeypatch.setenv("OWNERIQ_EMAIL", "you@example.org")
    monkeypatch.delenv("OWNERIQ_API_BASE", raising=False)

    def handler(req):
        if "activation_info" in req.url.path:
            return httpx.Response(200, json={"api_url": "https://uk.owner-iq.ai"})
        if req.url.path.endswith("/light_index"):
            ok = req.headers.get("authorization") == "Bearer GOODTOKEN"
            return httpx.Response(200 if ok else 401, json={})
        return httpx.Response(200, json={})

    async def go(tok):
        async with _client(handler) as c:
            return await sess.reconnect(c, tok)
    st = run(go("  GOODTOKEN  "))
    assert st["state"] == sess.CONNECTED and st["source"] == "browser"
    assert "token" not in st
    assert run(sess._read())["token"] == "GOODTOKEN"
    # A token OwnerIQ refuses is rejected.
    try:
        run(go("WRONGTOKEN"))
        assert False
    except ValueError:
        pass


def test_status_never_returns_token(monkeypatch):
    db = _db(monkeypatch)
    run(db.owneriq_session.update_one({"_id": "session"},
        {"$set": {"token": "SECRET", "state": sess.CONNECTED}}, upsert=True))
    st = run(sess.status())
    assert "SECRET" not in str(st) and st["has_token"] is True
