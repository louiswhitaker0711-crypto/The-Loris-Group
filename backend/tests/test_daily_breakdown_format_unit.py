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


def test_firsts_breakeven_and_every_day_on_the_board():
    from core.breakdown_picks import person_facts, reasons
    # A first 3: Monday 2, today 3, no weeks before.
    f = person_facts(sales=3, week_before_today=2, prev_best_day=2, days_done=2, week_days_in=[2])
    assert f["pb_day"]["now"] == 3 and any("first time ever on 3" in r for r in reasons(f))
    # Breakeven of 5 hit in 2 days (3 + 3).
    be = person_facts(sales=3, week_before_today=3, prev_best_day=3, days_done=2, breakeven=5, week_days_in=[3])
    assert be["breakeven_hit_today"] and be["breakeven_in_days"] == 2
    assert any("breakeven of 5" in r and "2 days" in r for r in reasons(be))
    assert be["three_plus_every_day_this_week"] == 2
    gold = person_facts(sales=1, gold=1, ever_gold=False, prev_best_day=2)
    assert gold["first_ever_gold"] and reasons(gold)


def test_office_wins_pa_against_last_week():
    from core.breakdown_picks import office_wins
    wins = office_wins(today_sales=9, people_in_today=4, people_on_board=4, week_sales=17, week_person_days=8,
                       last_week_sales=40, last_week_person_days=20, last_week_to_day_sales=10,
                       last_week_to_day_person_days=8, today_gold=8, today_round=5, best_day_this_week=True,
                       averages={"per_person": {"closed": 16}, "at_or_above_target": ["closed"]})
    text = " | ".join(wins)
    assert "P/A this week 2.12 is better than last week's 2.0" in text
    assert "everyone in today got on the board" in text and "best day" in text
    assert "today's P/A 2.25 beat" in text and "closed 16" in text


def test_advice_changes_every_day():
    from core.breakdown_picks import advice_angle, opener_style
    days = [f"2026-11-{d:02d}" for d in range(23, 29)]
    assert len({advice_angle(d) for d in days}) == 6
    assert opener_style("2026-11-24") != opener_style("2026-11-25")
    assert "ADVICE" in build_daily_breakdown_prompt({}, "") and "office_wins" in build_daily_breakdown_prompt({}, "")


def test_people_facts_from_bells_and_breakdowns(monkeypatch):
    import asyncio
    from bson import ObjectId
    from mongomock_motor import AsyncMongoMockClient
    import routes.daily_breakdown as dbk
    mdb = AsyncMongoMockClient()["breakdown_picks_test"]
    monkeypatch.setattr(dbk, "db", mdb)
    a, b = ObjectId(), ObjectId()

    def day(o, u, m, st="in"):
        return {"over30": o, "under30": u, "memberships": m, "status": st}

    off = day(None, None, None, "off")

    async def go():
        await mdb.users.insert_many([
            {"_id": a, "name": "Example Person", "office_id": "o1", "role": "trainee"},
            {"_id": b, "name": "Sam Sample", "office_id": "o1", "role": "leader",
             "earnings_plan": {"needs": [{"amount": "125", "per": "week"}]}}])
        await mdb.bells_entries.insert_many([
            {"office_id": "o1", "week_ending": "2026-11-29", "user_id": str(a), "user_name": "Example Person",
             "role": "trainee", "days": [day(0, 2, 1), day(3, 0, 2)] + [off] * 5},
            {"office_id": "o1", "week_ending": "2026-11-29", "user_id": str(b), "user_name": "Sam Sample",
             "role": "leader", "days": [day(2, 1, 1), day(2, 1, 1)] + [off] * 5},
            {"office_id": "o1", "week_ending": "2026-11-22", "user_id": str(b), "user_name": "Sam Sample",
             "days": [day(4, 0, 2), day(1, 1, 1)] + [off] * 5}])
        people = await dbk._people_facts("o1", "2026-11-29", 1, "2026-11-24", None)
        return {p["full_name"]: p for p in people}

    got = asyncio.run(go())
    first = got["Example Person"]
    assert first["pb_day"] == {"now": 3, "was": 2} and first["first_ever_gold"]
    assert dbk.pick_callouts([first])  # a first 3 is in
    sam = got["Sam Sample"]
    assert sam["breakeven"] and sam["breakeven_hit_today"] and sam["breakeven_in_days"] == 2
    assert dbk.pick_callouts([sam])
