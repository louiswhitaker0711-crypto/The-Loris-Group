"""Sunday reads Not scheduled (NS, 'ab') for everyone unless changed."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.bells import _normalize_days, _sunday_ns  # noqa: E402


def test_a_new_week_has_sunday_not_scheduled():
    days = _normalize_days([])
    assert [d["status"] for d in days] == ["off"] * 6 + ["ab"]


def test_a_changed_sunday_is_kept():
    worked = _normalize_days([{}] * 6 + [{"under30": 2}])
    assert worked[6]["status"] == "in" and worked[6]["under30"] == 2
    for st in ("in", "ns", "rt", "pc", "nc"):
        assert _normalize_days([{}] * 6 + [{"status": st}])[6]["status"] == st


def test_an_old_untouched_sunday_reads_ns():
    old = [{"status": "off", "over30": None, "under30": None, "memberships": None} for _ in range(7)]
    assert _sunday_ns(old)[6]["status"] == "ab" and old[6]["status"] == "off"   # the original isn't changed
    assert _sunday_ns(None) is None and _sunday_ns([]) == []
