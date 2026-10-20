"""OwnerIQ switched off (the Owner, 20 Oct 2026): nothing reaches OwnerIQ,
the relay's posts are refused, and the status says off."""
import asyncio
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import core.owneriq_session as sess  # noqa: E402

run = asyncio.run


def test_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv("OWNERIQ_ENABLED", raising=False)
    assert sess.disabled()
    monkeypatch.setenv("OWNERIQ_ENABLED", "true")
    assert not sess.disabled()


def test_nothing_reaches_owneriq_when_off(monkeypatch):
    monkeypatch.delenv("OWNERIQ_ENABLED", raising=False)
    monkeypatch.setenv("OWNERIQ_PASSWORD", "pw")
    monkeypatch.setattr(sess, "db", AsyncMongoMockClient()["t"])
    assert run(sess.available()) is False
    with pytest.raises(sess.OwnerIQNeedsReconnect):
        run(sess.get_token(None))
    st = run(sess.status())
    assert st["state"] == sess.OFF and st["disabled"]


def test_relay_posts_are_refused_when_off(monkeypatch):
    from fastapi import HTTPException
    from routes import owneriq
    monkeypatch.delenv("OWNERIQ_ENABLED", raising=False)
    with pytest.raises(HTTPException) as e:
        run(owneriq._relay_body(None))
    assert e.value.status_code == 410
