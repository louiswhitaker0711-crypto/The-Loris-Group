"""The end-of-day breakdown's format (the Owner, 11 Nov 2026): first names
(an initial when two share one), no dashes, goals and positives, no schedule."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from prompts.daily_breakdown_prompt import TONE_EXAMPLES, build_daily_breakdown_prompt  # noqa: E402
from routes.daily_breakdown import display_names, no_dashes  # noqa: E402


def test_first_names_with_an_initial_only_when_shared():
    shown = display_names(["Example Person", "Example Other", "Sam Sample", " Sam Sample "])
    assert shown["Example Person"] == "Example P"
    assert shown["Example Other"] == "Example O"
    assert shown["Sam Sample"] == "Sam"


def test_dashes_come_out_but_ranges_stay():
    assert no_dashes("🔔 Sam – 4 🔥 — Up 3") == "🔔 Sam, 4 🔥, Up 3"
    assert no_dashes("8–14 is amber") == "8–14 is amber"
    assert no_dashes("sign-ups") == "sign-ups"


def test_prompt_asks_for_goals_positives_and_no_schedule():
    prompt = build_daily_breakdown_prompt({}, "📅 *Tomorrow*\n⏰ 11:00–11:45")
    assert "NO DASHES" in prompt
    assert "goal_today" in prompt and "POSITIVES" in prompt
    assert "Tomorrow*" not in prompt
    assert "–" not in TONE_EXAMPLES and "—" not in TONE_EXAMPLES


def test_office_numbers_add_up_the_breakdowns():
    from routes.daily_breakdown import office_day_numbers
    got = office_day_numbers([{"doors": 120, "spoken": 70, "pitched": 25, "closed": 15},
                              {"doors": 100, "spoken": 60}, {}, None])
    assert got == {"breakdowns_in": 2, "doors": 220, "spoken": 130, "pitched": 25, "closed": 15}


def test_prompt_asks_for_office_bits():
    prompt = build_daily_breakdown_prompt({}, "")
    assert "OFFICE BITS" in prompt and "office_today" in prompt
