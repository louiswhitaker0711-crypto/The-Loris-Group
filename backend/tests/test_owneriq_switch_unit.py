"""The OwnerIQ tap: the sign-in stays on the host but nothing is used until
OWNERIQ_ENABLED is on; with it off, check-ins read without live numbers."""
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import owneriq_sync  # noqa: E402
from routes.sector import plain_nudge_text  # noqa: E402


def test_off_unless_enabled(monkeypatch):
    monkeypatch.setenv("OWNERIQ_EMAIL", "you@example.org")
    monkeypatch.setenv("OWNERIQ_PASSWORD", "placeholder")
    monkeypatch.delenv("OWNERIQ_ENABLED", raising=False)
    assert owneriq_sync.owneriq_on() is False
    with pytest.raises(owneriq_sync.OwnerIQError):
        owneriq_sync._creds()
    monkeypatch.setenv("OWNERIQ_ENABLED", "true")
    assert owneriq_sync.owneriq_on() is True
    assert owneriq_sync._creds()[0] == "you@example.org"
    monkeypatch.delenv("OWNERIQ_PASSWORD")
    assert owneriq_sync.owneriq_on() is False


def test_check_in_without_numbers():
    title, body = plain_nudge_text({"goal": 4, "focus": "Rehash every no"}, "mid")
    assert title == "📊 Halfway check"
    assert body == "Goal 4 · Focus: Rehash every no" and " on " not in body
