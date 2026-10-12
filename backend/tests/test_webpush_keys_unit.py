"""Web push works with nothing set on Railway: the server makes its own VAPID
key pair once, stores it, and reuses it. Keys set on Railway still win."""
import asyncio
import base64
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import webpush  # noqa: E402


def _raw(b64: str) -> bytes:
    return base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4))


def _fresh(monkeypatch):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.setattr(webpush, "_KEYS", {})
    mdb = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(webpush, "db", mdb)
    return mdb


def test_generated_keys_have_the_raw_shapes_push_needs():
    public, private = webpush.generate_vapid_keys()
    assert len(_raw(public)) == 65 and _raw(public)[0] == 4
    assert len(_raw(private)) == 32
    from py_vapid import Vapid01
    Vapid01.from_raw(private.encode())  # the sender can load it


def test_keys_are_made_once_and_reused(monkeypatch):
    mdb = _fresh(monkeypatch)
    assert asyncio.run(webpush.ensure_vapid_keys()) is True
    first = webpush.vapid_public_key()
    assert first
    monkeypatch.setattr(webpush, "_KEYS", {})  # a restart
    assert asyncio.run(webpush.ensure_vapid_keys()) is True
    assert webpush.vapid_public_key() == first
    assert asyncio.run(mdb.server_keys.count_documents({})) == 1


def test_railway_keys_win(monkeypatch):
    _fresh(monkeypatch)
    public, private = webpush.generate_vapid_keys()
    monkeypatch.setenv("VAPID_PUBLIC_KEY", public)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", private)
    assert asyncio.run(webpush.ensure_vapid_keys()) is True
    assert webpush.vapid_public_key() == public


def test_subject_falls_back_to_the_railway_domain(monkeypatch):
    for k in ("VAPID_SUBJECT", "APP_BASE_URL", "SENDGRID_FROM_EMAIL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("RAILWAY_PUBLIC_DOMAIN", "example.up.railway.app")
    assert webpush._vapid_subject() == "https://example.up.railway.app"
