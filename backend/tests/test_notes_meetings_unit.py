"""Meetings go in their own catalogue, never Other (the Owner, 26 Nov 2026)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes.notes_folder import planner_entries  # noqa: E402


def test_morning_parts_make_one_meeting_and_leaders_its_own():
    days = {"2": {"morning_news": "Val hit 6", "morning_topic": "# Own the close\n> Close · 20 min\n## Opener · 5 min",
                  "morning_bells": "Office 42", "leaders_meeting": "# What is a leader?\n## Opener · 5 min",
                  "leaders_meeting_cod": "abc123"}}
    out = planner_entries("u1", "2026-11-29", days, "", {}, {})
    assert len(out) == 2
    morning = next(e for e in out if e["head"] == "pitch:morning")
    assert morning["title"] == "Own the close" and morning["meeting"]
    assert morning["body"].startswith("News\nVal hit 6") and "Bells\nOffice 42" in morning["body"]
    lead = next(e for e in out if e["head"] == "pitch:leaders")
    assert lead["title"] == "What is a leader?" and lead["meeting"]
    assert not any(e["head"] == "pitch:other" for e in out)
