"""Analyse me's trend (the Owner, 12 Nov 2026): yesterday against their usual,
recent days, whether breakdowns were followed through, and the week so far."""
import sys
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.analyse_trend import trend  # noqa: E402


def _day(iso, doors, spoken, pitched, closed, hit, **bd):
    return {"date": iso, "setup": {"goal": 4},
            "breakdown": {"doors": doors, "spoken": spoken, "pitched": pitched, "closed": closed, "hit": hit, **bd}}


def test_last_day_against_usual_and_follow_through():
    days = [
        _day("2026-11-09", 100, 60, 20, 10, 2, change="Pitch more", know_metric="pitched", know_target=25),
        _day("2026-11-10", 120, 70, 26, 14, 3, proud="Good intro"),
        _day("2026-11-11", 130, 80, 30, 16, 4),
        {"date": "2026-11-08", "breakdown": {"note": "no numbers"}},
    ]
    t = trend(days, {"2026-11-15": {"sign_ups": 9, "goal": 20, "days_worked": 3}}, ["2026-11-08", "2026-11-15"],
              date(2026, 11, 12), breakeven=12)
    last = t["last_day"]
    assert last["date"] == "2026-11-11" and last["is_yesterday_or_today"]
    doors = next(n for n in last["numbers"] if n["label"] == "Doors")
    assert doors == {"label": "Doors", "that_day": 130, "usual": 110.0, "good": 120}
    assert len(t["recent_days"]) == 3
    f = t["follow_through"][0]
    assert f["next_day_got"] == 26 and f["hit_it"] is True
    w = t["this_week"]
    assert w["to_go_for_goal"] == 11 and w["to_go_for_breakeven"] == 3
    assert w["field_days_left_including_today"] == 3 and w["a_day_needed"] == 3.7
    assert t["recent_proud_of"] == ["Good intro"]


def test_nothing_to_go_on():
    assert trend([], {}, ["2026-11-15"], date(2026, 11, 12)) == {}
