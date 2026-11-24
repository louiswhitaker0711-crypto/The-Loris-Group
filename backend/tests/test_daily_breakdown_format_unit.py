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
    assert "goal_today" in prompt and "ROUND OF RESULTS" in prompt
    assert "Tomorrow*" not in prompt
    assert "–" not in TONE_EXAMPLES and "—" not in TONE_EXAMPLES


def test_office_numbers_add_up_the_breakdowns():
    from routes.daily_breakdown import office_day_numbers
    got = office_day_numbers([{"doors": 120, "spoken": 70, "pitched": 25, "closed": 15},
                              {"doors": 100, "spoken": 60}, {}, None])
    assert got == {"breakdowns_in": 2, "doors": 220, "spoken": 130, "pitched": 25, "closed": 15}


def test_prompt_asks_for_office_bits():
    prompt = build_daily_breakdown_prompt({}, "")
    assert "OFFICE KPIs" in prompt and "office_today" in prompt


def test_missing_callouts_finds_people_left_out():
    from routes.daily_breakdown import missing_callouts
    text = "Wednesday done\n\n🔔 *Louis: 3* 🔥\nGood day.\n\n🎓 *Zainab: 1* 🌱\nOn the board."
    assert missing_callouts(text, ["Louis", "Liam", "Val", "Zainab"]) == ["Liam", "Val"]
    assert missing_callouts(text, ["Louis", "Zainab"]) == []


# ── Who gets a callout (the Owner, 24 Nov 2026): every positive, not every person.

from core.breakdown_picks import office_averages, person_facts, pick_callouts, reasons  # noqa: E402


def _f(sales, **nums):
    return person_facts(sales=sales, numbers=nums or None, prev_best_day=6, prev_best_week=25,
                        prev_weeks=5, week_before_today=2, days_done=3)


def test_the_bell_is_four_and_lower_sales_need_bigger_numbers():
    assert reasons(_f(4))                                                     # 4+ always in
    assert reasons(_f(1, doors=130, spoken=85, pitched=12, closed=6))         # 1 with 85 spoken
    assert not reasons(_f(3, doors=100, spoken=50, pitched=12, closed=8))     # 3 with 8 closes
    assert reasons(_f(3, doors=100, spoken=55, pitched=15, closed=10))        # 3, 15 pitched, 10 closed
    assert not reasons(_f(1, doors=110, spoken=72, pitched=14, closed=9))     # 72 isn't enough on 1
    assert not reasons(_f(0, doors=140, spoken=95, pitched=30, closed=20))    # never a zero


def test_pbs_first_sign_ups_and_weekly_goals_count():
    pb = person_facts(sales=2, prev_best_day=1, week_before_today=0)
    assert pb["pb_day"] == {"now": 2, "was": 1} and reasons(pb)
    first = person_facts(sales=1, ever_signed_up=False, prev_best_day=None)
    assert first["first_ever_sign_up"] and reasons(first)
    goal = person_facts(sales=2, week_before_today=13, weekly_goal=15, prev_best_day=5, days_done=4)
    assert goal["weekly_goal_hit_today"] and goal["week_light"] == "Green" and goal["moved_up_to"] == "Green"
    track = person_facts(sales=3, week_before_today=6, weekly_goal=15, days_done=3, prev_best_day=5)
    assert track["on_track_for_weekly_goal"] and track["week_light"] == "Amber"


def test_averages_up_because_of_today():
    recent = [{"doors": 100, "spoken": 55, "pitched": 15, "closed": 8}] * 5
    f = person_facts(sales=3, numbers={"doors": 120, "spoken": 80, "pitched": 22, "closed": 12},
                     recent_days=recent, prev_best_day=5, prev_best_spoken=60)
    assert "spoken" in f["averages_up"] and f["pb_spoken"]["now"] == 80
    assert any("averages up" in r for r in reasons(f))


def test_pick_callouts_leaves_people_out_and_orders_best_first():
    people = [{**_f(1), "name": "A"}, {**_f(5), "name": "B"},
              {**_f(1, doors=100, spoken=88, pitched=10, closed=5), "name": "C"}]
    got = pick_callouts(people)
    assert [p["name"] for p in got] == ["B", "C"]


def test_office_averages_name_a_positive_and_a_focus():
    got = office_averages({"breakdowns_in": 2, "doors": 240, "spoken": 120, "pitched": 40, "closed": 30}, 7, 2)
    assert got["per_person"]["closed"] == 15.0 and got["strongest"] in ("doors", "closed")
    assert got["focus"] == "pitched"


def test_prompt_has_the_vision_the_rule_and_variety():
    prompt = build_daily_breakdown_prompt({}, "")
    assert "200LW" in prompt and "🐒" in prompt
    assert "every positive" in prompt and "recent_messages_do_not_repeat" in prompt
    assert "average_kpis_per_person" in prompt and "Tomorrow is a new day" in prompt
