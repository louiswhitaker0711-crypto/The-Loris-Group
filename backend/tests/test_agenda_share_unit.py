"""Share a Weekly Plan topic into someone's planner (the Owner, 26 Nov 2026)."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.agenda import merge_shared, share_box_key  # noqa: E402
from routes.weekly_planners import normalize_sheet_layout  # noqa: E402

RUN = "# Know your numbers\n> Run it like a business · 20 min\n## Opener · 6 min\n- Cards"


def test_box_follows_the_row_and_their_own_names():
    default = normalize_sheet_layout(None)
    assert share_box_key("Morning Meeting", default) == "morning_topic"
    assert share_box_key("COD 3", default) == "leaders_meeting"
    renamed = normalize_sheet_layout([{"key": "leaders_meeting", "label": "One on Ones"},
                                      {"key": "stage2", "label": "Leaders Meeting"}])
    assert share_box_key("COD 3", renamed) == "stage2"
    assert share_box_key("Something else", default) == "crew_plan"


def test_resharing_replaces_and_keeps_their_notes():
    assert merge_shared("", RUN) == RUN
    mine = "My own notes"
    once = merge_shared(mine, RUN)
    assert once.startswith(mine) and RUN in once
    newer = RUN.replace("Cards", "New cards")
    twice = merge_shared(once, newer)
    assert twice.count("# Know your numbers") == 1 and "New cards" in twice and twice.startswith(mine)
