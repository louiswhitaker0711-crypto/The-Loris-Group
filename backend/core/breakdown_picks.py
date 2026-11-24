"""Who the end-of-day breakdown shouts out, and why (the Owner, 24 Nov 2026).

The rule: don't mention every person, but mention every positive. The bell is
4 sign-ups: 4+ is always in. Under 4 needs something worth promoting, and the
fewer the sign-ups the more impressive it has to be (1 sign-up with 85 spoken
to is in; 3 with 8 closes isn't; 3 with 15 pitched and 10 closed is). A new
PB, a first ever sign-up, hitting the weekly goal or moving up a traffic
light colour counts at any number of sign-ups above zero. A zero is never
called out.

Everything here is worked out from the numbers, so the AI only writes the
words: it's told exactly who's in and the facts behind each one.
"""
from __future__ import annotations

from core.kpi_rules import day_counts
from core.loa_targets import DAILY
from core.week_bands import WEEK_BANDS, week_band

BELL = DAILY["sign_ups"]  # 4
KPI_KEYS = ("doors", "spoken", "pitched", "closed")
LOA_NAMES = {"doors": "doors", "spoken": "spoken to", "pitched": "pitched", "closed": "closed"}
# How much an average has to move in one day to be worth saying.
AVG_RISE = {"spoken": 2.0, "pitched": 1.0, "closed": 1.0}
AVG_DAYS = 10


def band_label(n) -> str:
    key = week_band(n)
    return next(label for _f, k, label in WEEK_BANDS if k == key)


def _nums(bd: dict | None) -> dict:
    bd = bd or {}
    return {k: int(bd.get(k) or 0) for k in KPI_KEYS}


def _counts(n: dict) -> bool:
    return day_counts(n["doors"], n["spoken"], n["pitched"], n["closed"])


def averages(days: list[dict]) -> dict:
    """Average spoken / pitched / closed over counted days."""
    days = [d for d in days if _counts(d)]
    if not days:
        return {}
    return {k: round(sum(d[k] for d in days) / len(days), 1) for k in ("spoken", "pitched", "closed")}


def person_facts(*, sales: int, gold: int = 0, the_round: int = 0, numbers: dict | None = None,
                 goal_today=None, week_before_today: int = 0, weekly_goal=None,
                 days_done: int = 1, prev_best_day: int | None = None, prev_best_week: int | None = None,
                 prev_weeks: int = 0, ever_signed_up: bool = True, prev_best_spoken: int | None = None,
                 recent_days: list[dict] | None = None, is_new_start: bool = False,
                 breakeven: int | None = None, ever_gold: bool = True, ever_round: bool = True,
                 week_days_in: list[int] | None = None, prev_days_at: dict | None = None) -> dict:
    """Everything worth knowing about one person's day.

    week_before_today: sign-ups this week before today. days_done: field days
    of the week including today (Mon = 1). recent_days: their last breakdowns
    before today, newest first (dicts of doors/spoken/pitched/closed)."""
    n = _nums(numbers)
    has_numbers = any(n.values())
    week = week_before_today + sales
    f: dict = {"sales": sales, "gold": gold, "took_the_round": the_round, "week_so_far": week,
               "week_light": band_label(week), "is_new_start": is_new_start}
    if has_numbers:
        f["numbers"] = n
        f["law_of_averages_hit"] = [LOA_NAMES[k] for k in KPI_KEYS if n[k] >= DAILY[k]]
    if goal_today is not None:
        try:
            g = int(goal_today)
            f["goal_today"] = g
            f["beat_goal_today"] = sales > g
            f["hit_goal_today"] = sales >= g
        except (TypeError, ValueError):
            pass
    # Personal PBs.
    if sales > 0 and not ever_signed_up:
        f["first_ever_sign_up"] = True
    elif sales > 0 and prev_best_day is not None and sales > prev_best_day:
        f["pb_day"] = {"now": sales, "was": prev_best_day}
    if sales > 0 and prev_weeks >= 2 and prev_best_week is not None and week > prev_best_week:
        f["pb_week"] = {"now": week, "was": prev_best_week}
    if has_numbers and prev_best_spoken is not None and n["spoken"] > prev_best_spoken \
            and len(recent_days or []) >= 3:
        f["pb_spoken"] = {"now": n["spoken"], "was": prev_best_spoken}
    if gold > 0 and not ever_gold:
        f["first_ever_gold"] = True
    if the_round > 0 and not ever_round:
        f["first_ever_round"] = True
    # A number they've never done in a day before (e.g. a first 3).
    if sales > 0 and prev_best_day is not None and sales > prev_best_day:
        f["first_time_on"] = sales
    # Breakeven: their week's sign-ups covering their weekly needs.
    if breakeven:
        f["breakeven"] = int(breakeven)
        if week >= breakeven and week_before_today < breakeven and sales > 0:
            f["breakeven_hit_today"] = True
            f["breakeven_in_days"] = days_done
        elif week < breakeven:
            f["to_go_for_breakeven"] = int(breakeven) - week
    # Consistency this week: every day in on the board.
    wd = list(week_days_in or [])
    if sales > 0 and len(wd) >= 1:
        run = [*wd, sales]
        if len(run) >= 2 and all(x > 0 for x in run):
            f["on_the_board_every_day_this_week"] = len(run)
        if len(run) >= 2 and all(x >= 3 for x in run):
            f["three_plus_every_day_this_week"] = len(run)
    # The personal traffic light: did today move them up a colour?
    before = band_label(week_before_today)
    if sales > 0 and before != f["week_light"]:
        f["moved_up_to"] = f["week_light"]
    # The weekly goal.
    try:
        wg = int(weekly_goal) if weekly_goal is not None else None
    except (TypeError, ValueError):
        wg = None
    if wg and wg > 0:
        f["weekly_goal"] = wg
        if week >= wg:
            f["weekly_goal_hit"] = True
            if week_before_today < wg:
                f["weekly_goal_hit_today"] = True
        else:
            days_left = max(0, 6 - days_done)
            pace = week / max(1, days_done) * 6
            f["to_go_for_weekly_goal"] = wg - week
            if days_left and pace >= wg:
                f["on_track_for_weekly_goal"] = True
    # Averages that rose because of today.
    recent = [d for d in (recent_days or []) if _counts(_nums(d))][:AVG_DAYS]
    if has_numbers and _counts(n) and len(recent) >= 3:
        old = averages([_nums(d) for d in recent])
        new = averages([n] + [_nums(d) for d in recent][:AVG_DAYS - 1])
        rose = {k: {"was": old[k], "now": new[k]} for k in AVG_RISE
                if new.get(k, 0) - old.get(k, 0) >= AVG_RISE[k]}
        if rose:
            f["averages_up"] = rose
    return f


def reasons(f: dict) -> list[str]:
    """What makes this day worth promoting. Empty = leave them out."""
    s = f.get("sales") or 0
    if s <= 0:
        return []
    out: list[str] = []
    n = f.get("numbers") or {}
    if s >= BELL:
        out.append(f"rang the bell: {s} sign-ups")
    if f.get("first_ever_sign_up"):
        out.append("first ever sign-up")
    if f.get("pb_day"):
        out.append(f"new PB day, first time ever on {f['pb_day']['now']} (best was {f['pb_day']['was']})")
    if f.get("breakeven_hit_today"):
        out.append(f"hit their breakeven of {f['breakeven']} for the week in {f['breakeven_in_days']} days")
    if f.get("first_ever_gold"):
        out.append("first ever Gold sign-up")
    if f.get("first_ever_round"):
        out.append("first ever sign-up taking The Round")
    if f.get("three_plus_every_day_this_week") and s >= 3:
        out.append(f"3+ every day this week ({f['three_plus_every_day_this_week']} days)")
    elif f.get("on_the_board_every_day_this_week", 0) >= 3 and s >= 2:
        out.append(f"on the board every day this week ({f['on_the_board_every_day_this_week']} days)")
    if f.get("pb_week"):
        out.append(f"best week ever already: {f['pb_week']['now']} (best was {f['pb_week']['was']})")
    if f.get("pb_spoken"):
        out.append(f"most people ever spoken to: {f['pb_spoken']['now']} (best was {f['pb_spoken']['was']})")
    if f.get("weekly_goal_hit_today"):
        out.append(f"hit their weekly goal of {f['weekly_goal']} today")
    if f.get("moved_up_to") in ("Green", "Super Green"):
        out.append(f"into {f['moved_up_to']} for the week on {f['week_so_far']}")
    if f.get("on_track_for_weekly_goal") and s >= 2:
        out.append(f"on track for their weekly goal: {f['week_so_far']} of {f['weekly_goal']}")
    # The numbers on the doors: the fewer the sign-ups, the bigger they need to be.
    sp, pi, cl, do = n.get("spoken", 0), n.get("pitched", 0), n.get("closed", 0), n.get("doors", 0)
    if s >= 3:
        strong = sp >= 70 or (pi >= 15 and cl >= 10) or do >= 120 or pi >= 25 or cl >= 15
    elif s == 2:
        strong = sp >= 75 or (pi >= 20 and cl >= 12) or pi >= 25 or cl >= 15
    else:
        strong = sp >= 80 or pi >= 25 or cl >= 15
    if strong:
        bits = [f"{do} doors" if do >= 120 else "", f"{sp} spoken to" if sp >= 70 else "",
                f"{pi} pitched" if pi >= 15 else "", f"{cl} closed" if cl >= 10 else ""]
        out.append("big numbers on the doors: " + ", ".join(b for b in bits if b))
    if f.get("averages_up") and s >= 3:
        out.append("averages up because of today: " + ", ".join(
            f"{k} {v['was']} to {v['now']}" for k, v in f["averages_up"].items()))
    if s < BELL and len(out) == 0:
        return []
    return out


def office_wins(*, today_sales: int, people_in_today: int, people_on_board: int,
                week_sales: int, week_person_days: int, last_week_sales: int, last_week_person_days: int,
                last_week_to_day_sales: int, last_week_to_day_person_days: int,
                today_gold: int, today_round: int, best_day_this_week: bool, averages: dict | None,
                week_goal: int = 0) -> list[str]:
    """Every office positive worth saying today, worked out from the numbers.
    P/A = sign-ups per person per day in."""
    wins: list[str] = []
    pa_today = round(today_sales / people_in_today, 2) if people_in_today else None
    pa_week = round(week_sales / week_person_days, 2) if week_person_days else None
    pa_last = round(last_week_sales / last_week_person_days, 2) if last_week_person_days else None
    pa_last_to_day = (round(last_week_to_day_sales / last_week_to_day_person_days, 2)
                      if last_week_to_day_person_days else None)
    if pa_week is not None and pa_last is not None and pa_week > pa_last:
        wins.append(f"office P/A this week {pa_week} is better than last week's {pa_last}")
    elif pa_week is not None and pa_last_to_day is not None and pa_week > pa_last_to_day:
        wins.append(f"office P/A this week {pa_week} is ahead of last week at this point ({pa_last_to_day})")
    if pa_today is not None and pa_last is not None and pa_today > pa_last and pa_today >= 2:
        wins.append(f"today's P/A {pa_today} beat last week's {pa_last}")
    if pa_today is not None and pa_today >= BELL:
        wins.append(f"today's P/A {pa_today}: the whole office rang the bell on average")
    if people_in_today and people_on_board == people_in_today and people_in_today >= 2:
        wins.append(f"everyone in today got on the board ({people_on_board} of {people_in_today})")
    if best_day_this_week and today_sales:
        wins.append(f"best day of the week so far: {today_sales}")
    if today_sales >= 5 and today_gold / today_sales >= 0.9:
        wins.append(f"{today_gold} of {today_sales} Gold today, at the 90% standard")
    if today_sales >= 5 and today_round / today_sales >= 0.75:
        wins.append(f"{today_round} of {today_sales} took The Round today, at the 75% standard")
    if week_goal and week_sales >= week_goal:
        wins.append(f"weekly goal of {week_goal} hit: {week_sales}")
    for k in (averages or {}).get("at_or_above_target") or []:
        if k != "sign_ups":
            wins.append(f"office average {k} {averages['per_person'][k]} at or above the {DAILY[k]}")
    return wins


ADVICE_ANGLES = (
    "the mindset behind tomorrow's focus number",
    "one technique on the doors for the focus number (words, tone or body language)",
    "the Rehash: the second lap and the people it finds",
    "pace and energy in the first hour",
    "the Close: asking for the sign-up on every pitch",
    "quality: Gold orders and The Round on every sign-up",
    "consistency: the Law of Averages day after day",
    "what the best people did today that everyone can copy tomorrow",
)


def advice_angle(date_iso: str) -> str:
    """A different side of the advice each day."""
    from datetime import date as _d
    return ADVICE_ANGLES[_d.fromisoformat(date_iso).toordinal() % len(ADVICE_ANGLES)]


def pick_callouts(people: list[dict]) -> list[dict]:
    """The people to shout out, best first: each with their facts and reasons."""
    picked = []
    for p in people:
        why = reasons(p)
        if why:
            picked.append({**p, "why_they_are_in": why})
    picked.sort(key=lambda p: (p.get("sales") or 0, len(p["why_they_are_in"])), reverse=True)
    return picked


def office_averages(on_the_doors: dict, sales_today: int, people_in: int) -> dict:
    """Today's average per person on the doors against the Law of Averages,
    with the strongest number and the one to focus on."""
    k = on_the_doors.get("breakdowns_in") or 0
    if not k:
        return {}
    avg = {key: round(on_the_doors.get(key, 0) / k, 1) for key in KPI_KEYS}
    if people_in:
        avg["sign_ups"] = round(sales_today / people_in, 1)
    vs = {key: avg[key] / DAILY[key] for key in avg if DAILY.get(key)}
    best = max(vs, key=vs.get)
    worst = min(vs, key=vs.get)
    return {"per_person": avg, "law_of_averages": dict(DAILY), "breakdowns_in": k,
            "strongest": best, "strongest_vs_target": f"{avg[best]} against {DAILY[best]}",
            "focus": worst, "focus_vs_target": f"{avg[worst]} against {DAILY[worst]}",
            "at_or_above_target": [key for key in vs if vs[key] >= 1]}


OPENER_STYLES = (
    "lead with the office's total and what it means for the week",
    "lead with the standout moment of the day (a PB, a big number), then the total",
    "lead with where the week stands against the goal, then today",
    "lead with how many rang the bell today, then the total",
    "lead with a short, punchy one-word or two-word verdict on the day, then the total",
)


def opener_style(date_iso: str) -> str:
    """A different way in each day, so no two days read the same."""
    from datetime import date as _d
    return OPENER_STYLES[_d.fromisoformat(date_iso).toordinal() % len(OPENER_STYLES)]
