"""What each person needs today: coaching suggestions from their numbers.

Rules, not guesses, so a Coach can see why each one is there. For one person,
from their Bells days (sign-ups by tier, The Round) and their OwnerIQ field
days (doors → spoken → pitched → closed → sign-ups):

  retrain      their last 3 days in averaged under 1.8 sign-ups (PA under 1.8)
  order value  under 90% Gold over the last 2 weeks (5+ sign-ups)
  The Round    under 75% taking The Round over the last 2 weeks (5+ sign-ups)
  funnel       the step furthest below the Owner's Law of Averages over their
               last 5 field days: getting spoken to (intros), getting to the
               pitch, closing, or turning closes into sign-ups (rehash)
  work rate    under 100 doors a day over those days
  quality      from the latest weekly quality report (routes/quality.py), with
               3+ sales that week: fails 10%+, order value under £13, drop
               days under 2.5, under 75% reaching their 4th week

Each person gets their two most important suggestions, most important first.
No database here, so it's tested on its own.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Optional

# The Owner's Law of Averages (core/loa_targets.py): a day is 120 doors, 70
# spoken to, 25 pitched, 15 closed, 4+ sign-ups.
LOA = {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "sales": 4}
GOLD_TARGET = 90          # % of sign-ups that are Gold (£10+ repeat order): the Owner's 90%+
ROUND_TARGET = 75         # % taking The Round (the Owner's quality target)
RETRAIN_PA = 1.8          # the Owner (26 Oct 2026): under 1.8 a day over the last 3 days in → retrain
MIN_SIGNUPS_FOR_MIX = 5
FUNNEL_DAYS = 5
LOW_DOORS = 100

# Each funnel step: (numerator, denominator, topic, what it means).
FUNNEL = [
    ("spoken", "doors", "Intros", "getting spoken to at the door"),
    ("pitched", "spoken", "Getting to the pitch", "turning conversations into pitches"),
    ("closed", "pitched", "Closing", "asking for the sign-up"),
    ("sales", "closed", "Rehash and objections", "turning closes into sign-ups"),
]


def _first(name: str) -> str:
    return (name or "").strip().split(" ")[0] or "Someone"


def bells_days(entries: Iterable[dict]) -> list[dict]:
    """Bells rows → [{date, status, gold, silver, round}] by date."""
    out = []
    for e in entries:
        try:
            we = date.fromisoformat(str(e.get("week_ending"))[:10])
        except ValueError:
            continue
        for i, d in enumerate((e.get("days") or [])[:7]):
            d = d or {}
            out.append({"date": we - timedelta(days=6 - i), "status": d.get("status"),
                        "gold": int(d.get("over30") or 0), "silver": int(d.get("under30") or 0),
                        "round": int(d.get("memberships") or 0)})
    out.sort(key=lambda x: x["date"])
    return out


QUALITY_MIN_SALES = 3


def quality_suggestions(first: str, q: dict | None, week_label: str = "") -> list[dict]:
    """From one person's latest weekly quality numbers {sales, aov, drops,
    fourth_week, fail_rate}."""
    if not q or (q.get("sales") or 0) < QUALITY_MIN_SALES:
        return []
    wk = f" in {week_label}" if week_label else ""
    out = []
    fr = q.get("fail_rate")
    if fr is not None and fr >= 10:
        out.append({"kind": "fails", "priority": 2, "topic": "Fails and who not to sign up",
                    "title": f"Go over fails with {first}",
                    "why": f"{fr:g}% fails{wk} (target under 10%)"})
    aov = q.get("aov")
    if aov is not None and aov < 13:
        out.append({"kind": "order_value", "priority": 3, "topic": "Order value",
                    "title": f"Teach {first} order value",
                    "why": f"£{aov:.2f} average order{wk} (target £13+)"})
    drops = q.get("drops")
    if drops is not None and drops < 2.5:
        out.append({"kind": "drops", "priority": 5, "topic": "Drop days",
                    "title": f"Talk drop days with {first}",
                    "why": f"{drops:g} drop days{wk} (target 2.5+)"})
    fw = q.get("fourth_week")
    if fw is not None and fw < 75:
        out.append({"kind": "fourth_week", "priority": 5, "topic": "Keeping customers to week 4",
                    "title": f"Talk 4th week with {first}",
                    "why": f"{fw:g}% reaching their 4th week{wk} (target 75%+)"})
    return out


def suggest(name: str, days: list[dict], field: list[dict], through: date,
            quality: dict | None = None, quality_week: str = "") -> list[dict]:
    """Suggestions for one person. `days` from bells_days; `field` is their
    OwnerIQ days [{date, doors, spoken, pitched, closed, sales}]; `through`
    is the last day whose numbers are final; `quality` their latest weekly
    quality numbers, if there are any."""
    first = _first(name)
    out: list[dict] = []

    ins = [d for d in days if d["date"] <= through and d["status"] == "in"]
    last3 = ins[-3:]
    if len(last3) == 3:
        n = sum(d["gold"] + d["silver"] for d in last3)
        pa = n / 3
        if pa < RETRAIN_PA:
            out.append({"kind": "retrain", "priority": 1, "topic": "Retrain",
                        "title": f"Retrain {first}",
                        "why": f"{n} sign-up{'' if n == 1 else 's'} in their last 3 days in (PA {pa:.1f})"})

    two_weeks = [d for d in days if through - timedelta(days=13) <= d["date"] <= through]
    gold = sum(d["gold"] for d in two_weeks)
    total = gold + sum(d["silver"] for d in two_weeks)
    rounds = sum(d["round"] for d in two_weeks)
    if total >= MIN_SIGNUPS_FOR_MIX:
        g = round(100 * gold / total)
        if g < GOLD_TARGET:
            out.append({"kind": "order_value", "priority": 3, "topic": "Order value",
                        "title": f"Teach {first} order value",
                        "why": f"{g}% Gold over 2 weeks (target {GOLD_TARGET}%)"})
        r = round(100 * min(rounds, total) / total)
        if r < ROUND_TARGET:
            out.append({"kind": "the_round", "priority": 4, "topic": "The Round",
                        "title": f"Teach {first} The Round",
                        "why": f"{r}% taking The Round over 2 weeks (target {ROUND_TARGET}%)"})

    recent = sorted([f for f in field if f["date"] <= through and (f.get("doors") or 0) > 0], key=lambda f: f["date"])[-FUNNEL_DAYS:]
    if len(recent) >= 2:
        tot = {k: sum(int(f.get(k) or 0) for f in recent) for k in LOA}
        worst = None
        for num, den, topic, means in FUNNEL:
            if not tot[den]:
                continue
            ratio = (tot[num] / tot[den]) / (LOA[num] / LOA[den])
            if ratio < 0.8 and (worst is None or ratio < worst[0]):
                worst = (ratio, num, den, topic, means)
        if worst:
            _, num, den, topic, means = worst
            per = len(recent)
            out.append({"kind": "funnel", "priority": 6, "topic": topic,
                        "title": f"Work on {topic.lower()} with {first}",
                        "why": f"{round(tot[num] / per)} {num} from {round(tot[den] / per)} {den} a day "
                               f"(Law of Averages {LOA[num]} from {LOA[den]}): {means}"})
        if tot["doors"] / len(recent) < LOW_DOORS:
            out.append({"kind": "work_rate", "priority": 7, "topic": "Work rate",
                        "title": f"Lift {first}'s work rate",
                        "why": f"{round(tot['doors'] / len(recent))} doors a day (Law of Averages {LOA['doors']})"})

    # Quality: order value from the report sits alongside the Gold mix as one
    # suggestion (both reasons), never two.
    for qs in quality_suggestions(first, quality, quality_week):
        same = next((s for s in out if s["kind"] == qs["kind"]), None)
        if same:
            same["why"] = f"{same['why']}; {qs['why']}"
        else:
            out.append(qs)

    out.sort(key=lambda s: s["priority"])
    return out[:2]
