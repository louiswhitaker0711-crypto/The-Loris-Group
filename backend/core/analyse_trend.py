"""The trend for Analyse me, worked out by the app so the AI's figures are exact
(the Owner, 12 Nov 2026: "should show the trend / include yesterday's", the
week so far, their breakdowns, and what went better or needs to change).

* last_day: their most recent field day with a breakdown, beside their usual
  (the field days before it in the window) and what good looks like;
* recent_days: each of the last field days, oldest first;
* follow_through: what each breakdown said would change and how they'd know,
  and whether the next field day hit that number;
* this_week: sign-ups so far, their weekly goal, breakeven, days left and
  sign-ups a day still needed;
* weeks: their last weeks' sign-ups, piece average and Gold %.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

STEPS = ("doors", "spoken", "pitched", "closed", "hit")
LABELS = {"doors": "Doors", "spoken": "Spoken to", "pitched": "Pitched", "closed": "Closed", "hit": "Sign-ups"}
GOOD = {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "hit": 4}
# "How I'll know" metrics (routes/sector.KPI_METRICS) → breakdown field.
KNOW_FIELD = {"doors": "doors", "spoken": "spoken", "pitched": "pitched", "closes": "closed", "closed": "closed",
              "sign_ups": "hit", "signups": "hit"}
RECENT_DAYS = 6
WINDOW_DAYS = 28


def _num(v) -> Optional[float]:
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def field_days(sector_days: list[dict]) -> list[dict]:
    """Days with a breakdown that has numbers on it, oldest first."""
    out = []
    for d in sorted(sector_days, key=lambda x: x.get("date") or ""):
        b = d.get("breakdown") or {}
        nums = {k: _num(b.get(k)) for k in STEPS}
        if not any(nums[k] for k in ("doors", "spoken", "pitched", "closed")):
            continue
        out.append({"date": d.get("date"), **{k: int(v) if v is not None else None for k, v in nums.items()},
                    "goal": (d.get("setup") or {}).get("goal", b.get("goal")), "breakdown": b})
    return out


def _avg(days: list[dict], k: str) -> Optional[float]:
    vals = [d[k] for d in days if d.get(k) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _pct(a: Optional[float], b: Optional[float]) -> Optional[int]:
    return round(100 * a / b) if a is not None and b else None


def _rates(d: dict) -> dict:
    return {"spoken_of_doors_pct": _pct(d.get("spoken"), d.get("doors")),
            "pitched_of_spoken_pct": _pct(d.get("pitched"), d.get("spoken")),
            "closed_of_pitched_pct": _pct(d.get("closed"), d.get("pitched")),
            "signed_of_closed_pct": _pct(d.get("hit"), d.get("closed"))}


def trend(sector_days: list[dict], my_weeks: dict, weeks: list[str], today: date,
          breakeven: Optional[int] = None) -> dict:
    days = field_days(sector_days)
    out: dict = {}
    if days:
        last, before = days[-1], days[:-1]
        usual = {k: _avg(before, k) for k in STEPS} if before else {}
        out["last_day"] = {
            "date": last["date"], "is_yesterday_or_today": last["date"] >= (today - timedelta(days=1)).isoformat(),
            "goal": last.get("goal"),
            "numbers": [{"label": LABELS[k], "that_day": last.get(k), "usual": usual.get(k), "good": GOOD[k]}
                        for k in STEPS],
            "ratios_that_day": _rates(last),
            "ratios_usual": _rates({k: usual.get(k) for k in STEPS}) if usual else None,
            "usual_is_over_days": len(before),
        }
        out["recent_days"] = [{"date": d["date"], **{k: d.get(k) for k in STEPS}, "goal": d.get("goal")}
                              for d in days[-RECENT_DAYS:]]
        follow = []
        for d, nxt in zip(days, days[1:]):
            b = d["breakdown"]
            if not (b.get("change") or b.get("know_metric")):
                continue
            item = {"date": d["date"], "said_would_change": b.get("change") or None,
                    "biggest_gap": b.get("gap") or None, "why": b.get("why") or None}
            field = KNOW_FIELD.get(str(b.get("know_metric") or "").lower())
            if field and b.get("know_target") is not None:
                got = nxt.get(field)
                item.update({"how_theyd_know": f"{b.get('know_target')} {LABELS[field].lower()}",
                             "next_day": nxt["date"], "next_day_got": got,
                             "hit_it": None if got is None else got >= int(b["know_target"])})
            follow.append(item)
        if follow:
            out["follow_through"] = follow[-4:]
        proud = [p for d in days[-3:] for p in (d["breakdown"].get(x) for x in ("proud", "proud2", "proud3")) if p]
        if proud:
            out["recent_proud_of"] = proud[-5:]
    this = (my_weeks or {}).get(weeks[-1]) if weeks else None
    if this is not None or breakeven:
        this = this or {}
        signed = int(this.get("sign_ups") or 0)
        left = max(0, 6 - today.weekday())  # field days left, today included (Mon 6 … Sat 1, Sun 0)
        aim = this.get("goal") or breakeven
        out["this_week"] = {
            "sign_ups": signed, "days_worked": this.get("days_worked"), "weekly_goal": this.get("goal"),
            "breakeven": breakeven, "field_days_left_including_today": left,
            "to_go_for_goal": max(0, int(this["goal"]) - signed) if this.get("goal") else None,
            "to_go_for_breakeven": max(0, int(breakeven) - signed) if breakeven else None,
            "a_day_needed": round(max(0, int(aim) - signed) / left, 1) if aim and left else None,
            "note": "Bells is filled in at the end of each day, so today isn't in these sign-ups yet.",
        }
    past = [{"week_ending": w, "sign_ups": (my_weeks.get(w) or {}).get("sign_ups"),
             "piece_average": (my_weeks.get(w) or {}).get("piece_average"),
             "gold_pct": _pct((my_weeks.get(w) or {}).get("gold"), (my_weeks.get(w) or {}).get("sign_ups"))}
            for w in weeks[:-1] if (my_weeks or {}).get(w)]
    if past:
        out["weeks"] = past[-4:]
    return out


async def trend_for(user: dict) -> dict:
    from core.ai_context import WEEKS_OF_TREND, today_uk, week_ending_of, weekly_rows
    from database import db
    uid = str(user["id"])
    today = today_uk()
    since = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    sector_days = [d async for d in db.sector_days.find({"user_id": uid, "date": {"$gte": since}},
                                                         {"_id": 0, "date": 1, "setup": 1, "breakdown": 1})]
    last = date.fromisoformat(week_ending_of(today))
    weeks = [(last - timedelta(days=7 * i)).isoformat() for i in range(WEEKS_OF_TREND)][::-1]
    rows, _office = await weekly_rows(user.get("office_id"), {uid}, weeks)
    my_weeks = rows.get(uid, {}).get("weeks", {})
    breakeven = None
    try:
        from bson import ObjectId
        from core.breakeven_alerts import breakeven_for
        person = await db.users.find_one({"_id": ObjectId(uid)}, {"earnings_plan": 1, "office_id": 1})
        entry = await db.bells_entries.find_one({"user_id": uid, "week_ending": weeks[-1]}, {"_id": 0, "break_even": 1}) or {}
        fees = (await db.commission_fees.find_one({"office_id": user.get("office_id")}, {"_id": 0})
                or await db.commission_fees.find_one({}, {"_id": 0}))
        rate = None
        if (person or {}).get("earnings_plan"):
            from core.sign_up_value import rate_for
            rate = (await rate_for(db, person, fees))["per_sign_up"]
        breakeven = breakeven_for(entry, (person or {}).get("earnings_plan"), fees, rate)
    except Exception:
        breakeven = None
    return trend(sector_days, my_weeks, weeks, today, breakeven)
