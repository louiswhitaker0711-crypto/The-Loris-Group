"""With OwnerIQ off (needs reconnect / no session), the field check-ins read
without live numbers."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.sector import plain_nudge_text  # noqa: E402


def test_check_in_without_numbers():
    title, body = plain_nudge_text({"goal": 4, "focus": "Rehash every no"}, "mid")
    assert title == "📊 Halfway check"
    assert body == "Goal 4 · Focus: Rehash every no" and " on " not in body
