"""Browser relay → field check-ins. Each relay KPI post sends the check-in
that's due right then, on the numbers just posted (fresh by construction), so
the 15:00 / 16:30 / 19:00 check-ins go out on time instead of waiting for the
hourly job. A push failure must never fail the relay post.

Pure in-memory: nothing real is called.
"""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import owneriq  # noqa: E402
import routes.sector as sector  # noqa: E402


def test_relay_post_sends_the_due_checkin_on_fresh_numbers(monkeypatch):
    calls = []

    async def fake(now=None, require_fresh=False):
        calls.append(require_fresh)
        return 3

    monkeypatch.setattr(sector, "field_nudge_after_sync", fake)
    assert asyncio.run(owneriq._relay_field_checkin()) == 3
    # Still gated on a fresh pull: the relay's own ingest just stamped it.
    assert calls == [True]


def test_relay_post_survives_a_checkin_failure(monkeypatch):
    async def boom(now=None, require_fresh=False):
        raise RuntimeError("push service down")

    monkeypatch.setattr(sector, "field_nudge_after_sync", boom)
    assert asyncio.run(owneriq._relay_field_checkin()) == 0


def test_due_slot_matches_the_relay_quarter_hours():
    """The relay syncs at :00/:15/:30/:45 (+5 s). Every check-in time falls on
    one of those, so the sync just after it finds that slot due."""
    from datetime import datetime
    from core.app_time import APP_TZ
    fri = datetime(2026, 10, 16, tzinfo=APP_TZ)   # a Friday
    sat = datetime(2026, 10, 17, tzinfo=APP_TZ)
    for day, slots in ((fri, sector.WEEKDAY_SLOTS), (sat, sector.SATURDAY_SLOTS)):
        for h, m, name in slots:
            assert m % 15 == 0
            assert sector.due_slot(day.replace(hour=h, minute=m, second=5)) == name
            # A minute before, the slot isn't due yet.
            before = day.replace(hour=h, minute=m) .timestamp() - 60
            assert sector.due_slot(datetime.fromtimestamp(before, APP_TZ)) != name
