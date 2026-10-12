"""The 6pm reset: answers are checked, and the WhatsApp text reads right for
one person and for a team. Placeholder names only."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import field_reset as fr  # noqa: E402


def test_answers_are_checked():
    assert fr.clean_reset({"more_signups": "2", "kpi": "Pitched", "focus": "  hooklines   before the close "}) == {
        "more_signups": 2, "kpi": "Pitched", "focus": "hooklines before the close"}
    for bad in ({"more_signups": "x", "kpi": "Pitched"}, {"more_signups": 30, "kpi": "Pitched"},
                {"more_signups": 1, "kpi": "Vibes"}):
        with pytest.raises(HTTPException):
            fr.clean_reset(bad)


def test_my_message():
    text = fr.my_whatsapp_text({"more_signups": 2, "kpi": "Pitched", "focus": "hooklines"}, "Mon 12 Oct")
    assert text.startswith("🔄 6pm reset · Mon 12 Oct")
    assert "Going for 2 more sign-ups" in text and "Number I'm focusing on: Pitched" in text and "Focus: hooklines" in text


def test_team_message_adds_up_and_uses_first_names():
    rows = [
        {"user_name": "Example Person", "more_signups": 2, "kpi": "Closed", "focus": ""},
        {"user_name": "Another Example", "more_signups": 1, "kpi": "Doors", "focus": "last lap"},
    ]
    text = fr.team_whatsapp_text(rows, "Mon 12 Oct")
    assert "Going for 3 more as a team" in text
    assert "• Another: going for 1 more · focus on Doors · last lap" in text
    assert "• Example: going for 2 more · focus on Closed" in text
