"""Exit a BA: their week reads red from the exit day (frontend), and from the
week after they're off the Bells sheet. Their records stay."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.bells import exit_day, exited_before_week  # noqa: E402


def test_exit_day():
    assert exit_day({"left_on": "2026-10-21"}) == "2026-10-21"
    assert exit_day({"deleted_at": "2026-10-20T23:30:00+00:00"}) == "2026-10-21"   # UK date (BST)
    assert exit_day({}) is None


def test_off_the_sheet_from_the_week_after():
    # Exited Wed 21 Oct 2026: that week (ending Sun 25 Oct) still shows them.
    assert not exited_before_week("2026-10-21", "2026-10-25")
    assert exited_before_week("2026-10-21", "2026-11-01")
    assert not exited_before_week("2026-10-21", "2026-10-18")      # earlier weeks keep them
    assert not exited_before_week(None, "2026-11-01")
