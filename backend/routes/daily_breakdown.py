"""Daily Breakdown — generates a WhatsApp-ready summary of today's bells
results with the LLM. Pulls today's per-rep sales, the week-to-date
office totals, and last week's totals so the LLM can call out high
rollers, day-over-day improvements, and progress toward the office's
weekly goal.
"""
import logging
import asyncio
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from dotenv import load_dotenv

from auth import get_current_user, get_subtree_ids
from database import db
from core.rate_limit import take_ai_quota
from core.app_time import APP_TZ
from core.llm_keys import anthropic_api_key
from core.breakdown_picks import (BELL, advice_angle, office_averages, office_wins, opener_style,
                                  person_facts, pick_callouts)
from prompts.daily_breakdown_prompt import (
    SYSTEM_MESSAGE as DAILY_BREAKDOWN_SYSTEM_MESSAGE,
    build_daily_breakdown_prompt,
)

load_dotenv()

logger = logging.getLogger(__name__)
router = APIRouter()




def _week_ending_for(d: datetime) -> str:
    """Sunday of the calendar week containing date d (YYYY-MM-DD)."""
    # Mon=0 ... Sun=6.  We want the upcoming Sunday (or d itself if it's Sun)
    days_until_sun = (6 - d.weekday()) % 7
    return (d + timedelta(days=days_until_sun)).strftime("%Y-%m-%d")


def _day_index_for(d: datetime) -> int:
    """Return the day-index (0=Mon..6=Sun) within its bells week."""
    return d.weekday()


def display_names(full_names: list) -> dict:
    """Full name -> what the breakdown calls them: the first name, or the
    first name and surname initial when two people share a first name
    (the Owner, 11 Nov 2026)."""
    people = {n.strip() for n in full_names if (n or "").strip()}
    by_first: dict = {}
    for n in people:
        by_first.setdefault(n.split()[0].lower(), set()).add(n)
    out = {}
    for n in people:
        parts = n.split()
        if len(by_first[parts[0].lower()]) > 1 and len(parts) > 1:
            out[n] = f"{parts[0]} {parts[-1][0].upper()}"
        else:
            out[n] = parts[0]
    return out


async def _hidden_ids(office_id: str) -> set:
    """Visitors and demo accounts: never in the office's figures ("they don't
    make me money", the Owner). Their old Bells rows and their breakdowns are
    left out of the daily breakdown."""
    return {str(u["_id"]) async for u in db.users.find(
        {"office_id": office_id, "$or": [{"is_visitor": True}, {"is_demo": True}]}, {"_id": 1})}


async def _recent_texts(office_id: str, before_iso: str, n: int = 3) -> list:
    """The last few days' messages, so today's doesn't read the same."""
    out = []
    async for d in db.daily_breakdown_history.find(
            {"office_id": office_id, "date": {"$lt": before_iso}}, {"_id": 0, "text": 1, "date": 1}
    ).sort("date", -1).limit(n * 3):
        if d.get("text") and d.get("date") not in {o["date"] for o in out}:
            out.append({"date": d["date"], "text": d["text"][:1500]})
        if len(out) >= n:
            break
    return out


def _day_sales(d: dict) -> int:
    return int((d or {}).get("over30") or 0) + int((d or {}).get("under30") or 0)


async def _people_facts(office_id: str, week_ending: str, day_idx: int, target_iso: str,
                        user_id_filter: Optional[list]) -> list:
    """One fact sheet per person on this week's Bells (visitors and demo
    accounts left out): today, the week, their weekly goal, their PBs from
    every past Bells week and breakdown, and their recent breakdowns."""
    q: dict = {"office_id": office_id, "week_ending": week_ending}
    if user_id_filter is not None:
        q["user_id"] = {"$in": [str(u) for u in user_id_filter]}
    hidden = await _hidden_ids(office_id)
    entries = [e async for e in db.bells_entries.find(
        q, {"_id": 0, "user_id": 1, "user_name": 1, "days": 1, "role": 1, "weekly_goal": 1, "break_even": 1})
        if e.get("user_id") and str(e["user_id"]) not in hidden]
    ids = [str(e["user_id"]) for e in entries]
    if not ids:
        return []
    # Past Bells: best day and best week before today.
    best_day: dict = {}
    best_week: dict = {}
    weeks_n: dict = {}
    ever_gold: set = set()
    ever_round: set = set()
    async for e in db.bells_entries.find({"user_id": {"$in": ids}, "week_ending": {"$lt": week_ending}},
                                         {"_id": 0, "user_id": 1, "days": 1}):
        uid = str(e["user_id"])
        sales = [_day_sales(d) for d in (e.get("days") or [])]
        if any(int((d or {}).get("over30") or 0) for d in (e.get("days") or [])):
            ever_gold.add(uid)
        if any(int((d or {}).get("memberships") or 0) for d in (e.get("days") or [])):
            ever_round.add(uid)
        if sales:
            best_day[uid] = max(best_day.get(uid, 0), max(sales))
            best_week[uid] = max(best_week.get(uid, 0), sum(sales))
            weeks_n[uid] = weeks_n.get(uid, 0) + 1
    # Past breakdowns, newest first.
    recent: dict = {}
    best_spoken: dict = {}
    today_bd: dict = {}
    today_goal: dict = {}
    async for sd in db.sector_days.find({"user_id": {"$in": ids}, "date": {"$lte": target_iso}},
                                        {"_id": 0, "user_id": 1, "date": 1, "breakdown": 1, "setup": 1}
                                        ).sort("date", -1):
        uid, bd = str(sd.get("user_id")), sd.get("breakdown") or {}
        if sd.get("date") == target_iso:
            today_bd[uid] = bd
            g = (sd.get("setup") or {}).get("goal")
            today_goal[uid] = g if g is not None else bd.get("goal")
            continue
        if not any(bd.get(k) for k in ("doors", "spoken", "pitched", "closed")):
            continue
        recent.setdefault(uid, [])
        if len(recent[uid]) < 10:
            recent[uid].append(bd)
        best_spoken[uid] = max(best_spoken.get(uid, 0), int(bd.get("spoken") or 0))
    # Breakeven, worked out the same way as Bells and the breakeven push.
    from bson import ObjectId
    from core.breakeven_alerts import breakeven_for
    fees = (await db.commission_fees.find_one({"office_id": office_id}, {"_id": 0})
            or await db.commission_fees.find_one({}, {"_id": 0}))
    plans: dict = {}
    oids = []
    for i in ids:
        try:
            oids.append(ObjectId(i))
        except Exception:
            pass
    async for u in db.users.find({"_id": {"$in": oids}}):
        plans[str(u["_id"])] = u
    out = []
    for e in entries:
        uid = str(e["user_id"])
        days = e.get("days") or []
        person = plans.get(uid) or {}
        be = None
        try:
            rate = None
            if person.get("earnings_plan"):
                from core.sign_up_value import rate_for
                rate = (await rate_for(db, person, fees))["per_sign_up"]
            be = breakeven_for(e, person.get("earnings_plan"), fees, rate)
        except Exception:
            logger.exception("breakeven for the breakdown")
        earlier = days[:day_idx]
        if any(int((d or {}).get("over30") or 0) for d in earlier):
            ever_gold.add(uid)
        if any(int((d or {}).get("memberships") or 0) for d in earlier):
            ever_round.add(uid)
        td = days[day_idx] if day_idx < len(days) else {}
        td = td or {}
        sales = _day_sales(td) if (td.get("status") or "off") == "in" else 0
        before = [_day_sales(d) for d in days[:day_idx]]
        before_week = sum(before)
        if sales <= 0 and not today_bd.get(uid):
            continue
        f = person_facts(
            sales=sales, gold=int(td.get("over30") or 0), the_round=int(td.get("memberships") or 0),
            numbers=today_bd.get(uid), goal_today=today_goal.get(uid), week_before_today=before_week,
            weekly_goal=e.get("weekly_goal"), days_done=day_idx + 1,
            prev_best_day=max([best_day.get(uid, 0)] + before) if (uid in best_day or before) else None,
            prev_best_week=best_week.get(uid), prev_weeks=weeks_n.get(uid, 0),
            ever_signed_up=bool(best_day.get(uid) or before_week),
            prev_best_spoken=best_spoken.get(uid), recent_days=recent.get(uid, []),
            is_new_start=(e.get("role") == "trainee" and weeks_n.get(uid, 0) < 2),
            breakeven=be, ever_gold=uid in ever_gold, ever_round=uid in ever_round,
            week_days_in=[_day_sales(d) for d in earlier if (d or {}).get("status") == "in"],
        )
        f.update({"user_id": uid, "full_name": e.get("user_name") or "", "role": e.get("role") or "trainee"})
        out.append(f)
    return out


async def _office_pa(office_id: str, week_ending: str, upto_idx: int, user_id_filter: Optional[list]) -> dict:
    """Sign-ups and person-days in (Bells days marked in) up to a day of a week."""
    q: dict = {"office_id": office_id, "week_ending": week_ending}
    if user_id_filter is not None:
        q["user_id"] = {"$in": [str(u) for u in user_id_filter]}
    hidden = await _hidden_ids(office_id)
    sales = person_days = 0
    async for e in db.bells_entries.find(q, {"_id": 0, "user_id": 1, "days": 1}):
        if str(e.get("user_id") or "") in hidden:
            continue
        for d in (e.get("days") or [])[:upto_idx + 1]:
            if (d or {}).get("status") == "in":
                person_days += 1
                sales += _day_sales(d)
    return {"sales": sales, "person_days": person_days}


def missing_callouts(text: str, names: list) -> list:
    """Callout names the AI left out of the message."""
    return [n for n in names if f"*{n}:" not in text and f"{n}:" not in text]


def office_day_numbers(breakdowns: list) -> dict:
    """Today's office numbers on the doors, added up from everyone's
    breakdown (KPIs come from the breakdowns, the Owner, 11 Nov 2026)."""
    out = {"breakdowns_in": 0, "doors": 0, "spoken": 0, "pitched": 0, "closed": 0}
    for bd in breakdowns:
        if not bd or not any(bd.get(k) for k in ("doors", "spoken", "pitched", "closed")):
            continue
        out["breakdowns_in"] += 1
        for k in ("doors", "spoken", "pitched", "closed"):
            out[k] += int(bd.get(k) or 0)
    return out


def no_dashes(text: str) -> str:
    """Take out the spaced dashes the model likes ("Liam – 4 — up 3"); the
    Owner finds them hard to read (11 Nov 2026). Ranges like 12–14 stay."""
    text = re.sub(r"[ \t]+[–—][ \t]+", ", ", text)
    return re.sub(r"[–—]", ", ", re.sub(r"(?<=\d)[–—](?=\d)", "\x00", text)).replace("\x00", "–")


def _clock(hhmm: str) -> str:
    """'9:5' -> '09:05', '14:30' -> '14:30' — UK 24-hour clock (best-effort,
    returns input on parse fail)."""
    try:
        h, m = [int(x) for x in (hhmm or "00:00").split(":")[:2]]
        return f"{h:02d}:{m:02d}"
    except Exception:
        return hhmm or ""


def _day_month(d: datetime) -> str:
    """UK-style short date, e.g. '30 Sep'."""
    return f"{d.day} {d.strftime('%b')}"


async def _tomorrow_schedule(office_id: str, target_dt: datetime) -> dict:
    """Pull tomorrow's recurring schedule blocks for the office.
    Returns { date, weekday, blocks: [{start, end, title, audience, presenter, topic}, ...] }
    sorted by start time. Excludes core_leaders-only and very narrow audiences so
    the daily breakdown reflects what the broader WhatsApp group should know about.
    """
    tomorrow = target_dt + timedelta(days=1)
    dow = tomorrow.weekday()  # 0=Mon..6=Sun (matches schedule_blocks.day_of_week)
    blocks: list = []
    async for b in db.schedule_blocks.find(
        {"office_id": office_id, "day_of_week": dow, "audience": {"$ne": "personal"},
         "date": {"$in": [None, "", tomorrow.date().isoformat()]}},
        {"_id": 0, "start_time": 1, "end_time": 1, "title": 1, "audience": 1, "presenter": 1, "topic": 1},
    ):
        aud = (b.get("audience") or "all").lower()
        # Skip narrowly-scoped per-person blocks; keep all/leaders/trainees
        if aud == "core_leaders":
            continue
        blocks.append(b)

    def _mins(s):
        try:
            h, m = [int(x) for x in (s or "00:00").split(":")[:2]]
            return h * 60 + m
        except Exception:
            return 0

    blocks.sort(key=lambda b: _mins(b.get("start_time")))
    return {
        "date": tomorrow.strftime("%Y-%m-%d"),
        "weekday": tomorrow.strftime("%A"),
        "pretty": _day_month(tomorrow),
        "blocks": [
            {
                "start": _clock(b.get("start_time") or ""),
                "end": _clock(b.get("end_time") or ""),
                "title": b.get("title") or "",
                "audience": (b.get("audience") or "all"),
                "presenter": b.get("presenter") or "",
                "topic": b.get("topic") or "",
            }
            for b in blocks
        ],
    }


async def _aggregate_office_totals(
    office_id: str,
    week_ending: str,
    day_idx: Optional[int] = None,
    user_id_filter: Optional[list] = None,
) -> dict:
    """Sum sales across every rep in the given office's weekly bells entries.
    If day_idx is given, only that one day is summed; otherwise the whole week.
    If user_id_filter is given (list of user IDs), only bells_entries whose
    user_id matches are summed — this is how leaders get team-only scoping
    without admins losing their office-wide view.
    Returns {sales, over30, under30, memberships, days_worked, top_reps:[...]}.
    """
    pipeline_match: dict = {"office_id": office_id, "week_ending": week_ending}
    if user_id_filter is not None:
        # Empty list → zero results (correct — leader with no team sees nothing)
        pipeline_match["user_id"] = {"$in": [str(u) for u in user_id_filter]}
    hidden = await _hidden_ids(office_id)
    rows: list = []
    async for e in db.bells_entries.find(pipeline_match, {"_id": 0, "user_id": 1, "user_name": 1, "days": 1, "role": 1}):
        if str(e.get("user_id") or "") in hidden:
            continue
        rows.append(e)

    sales = 0
    over30 = 0
    under30 = 0
    memberships = 0
    days_worked = 0
    by_rep: dict = {}
    for r in rows:
        days = r.get("days") or []
        rep_sales = 0
        rep_over30 = 0
        rep_mem = 0
        rep_days = 0
        if day_idx is not None:
            rng = [day_idx] if day_idx < len(days) else []
        else:
            rng = list(range(min(7, len(days))))
        for i in rng:
            d = days[i] or {}
            if (d.get("status") or "off") != "in":
                continue
            o = int(d.get("over30") or 0)
            u = int(d.get("under30") or 0)
            m = int(d.get("memberships") or 0)
            ds = o + u
            if ds == 0 and not d.get("status") == "in":
                continue
            sales += ds
            over30 += o
            under30 += u
            memberships += m
            if ds > 0:
                days_worked += 1
                rep_days += 1
            rep_sales += ds
            rep_over30 += o
            rep_mem += m
        if rep_sales > 0:
            by_rep[r.get("user_id") or r.get("user_name")] = {
                "user_id": r.get("user_id"),
                "name": r.get("user_name"),
                "role": r.get("role"),
                "sales": rep_sales,
                "over30": rep_over30,
                "memberships": rep_mem,
                "days": rep_days,
            }

    top_reps = sorted(by_rep.values(), key=lambda x: x["sales"], reverse=True)
    return {
        "sales": sales,
        "over30": over30,
        "under30": under30,
        "memberships": memberships,
        "days_worked": days_worked,
        "top_reps": top_reps,
    }


@router.post("/bells/daily-breakdown")
async def daily_breakdown(request: Request):
    """Body: { date?: YYYY-MM-DD (defaults to today, app time),
              office_id?: <admin override>,
              regenerate?: bool }
    Returns: { text: '...whatsapp-ready summary...', meta: {...} }
    """
    me = await get_current_user(request)
    if me.get("role") not in ("admin", "leader"):
        raise HTTPException(status_code=403, detail="Admin or coach access required")

    body = await request.json() if (await request.body()) else {}
    raw_date = (body.get("date") or "").strip()
    if raw_date:
        try:
            target_dt = datetime.strptime(raw_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    else:
        target_dt = datetime.now(APP_TZ).replace(tzinfo=None)
    target_iso = target_dt.strftime("%Y-%m-%d")
    day_idx = _day_index_for(target_dt)
    week_ending = _week_ending_for(target_dt)
    last_week_ending = (target_dt + timedelta(days=(6 - target_dt.weekday()) - 7)).strftime("%Y-%m-%d")
    if me.get("is_super_admin") and body.get("office_id"):
        office_id = body["office_id"]
    else:
        office_id = me.get("office_id")
    if not office_id:
        raise HTTPException(status_code=400, detail="No office assigned to your account.")

    # Pull office name for the LLM
    office_doc = await db.offices.find_one({"id": office_id}, {"_id": 0, "name": 1, "weekly_goal": 1})
    office_name = (office_doc or {}).get("name") or "the office"
    weekly_goal = int((office_doc or {}).get("weekly_goal") or 0)

    # ── Role-based scoping ─────────────────────────────────────────────────
    # Leaders must NEVER see office-wide data in their daily breakdown — the
    # AI would otherwise call out reps from other teams, leaking info that
    # belongs to another leader. Scope to their subtree (self + direct reports
    # + any sub-teams). Admins and super-admins keep the full office view.
    user_id_filter: Optional[list] = None
    if me.get("role") == "leader" and not me.get("is_super_admin"):
        try:
            sub = await get_subtree_ids(me["id"])
            team_ids = {str(x) for x in sub}
            team_ids.add(str(me["id"]))  # belt + suspenders — include self
            user_id_filter = list(team_ids)
        except Exception:
            # Defensive fallback: if subtree lookup fails, still only expose
            # the leader's own entries rather than the entire office.
            user_id_filter = [str(me["id"])]
        # Adjust the "office" label the LLM uses in the output so the pep-talk
        # is phrased as a team update, not an office-wide broadcast. Also
        # shrink the weekly goal target to scale — a 50-bell office goal isn't
        # a fair yardstick for a 6-rep team. Rough proxy: scale goal by team
        # share of total office active reps.
        try:
            total_active = await db.users.count_documents({"office_id": office_id, "role": {"$in": ["trainee", "leader", "admin"]}, "is_active": {"$ne": False}, "is_demo": {"$ne": True}})
            team_active = len(user_id_filter)
            if total_active > 0 and team_active > 0:
                weekly_goal = max(1, round(weekly_goal * team_active / total_active))
        except Exception:
            pass
        office_name = f"{me.get('name') or 'Your'}'s team"

    today = await _aggregate_office_totals(office_id, week_ending, day_idx, user_id_filter)
    week_to_date = await _aggregate_office_totals(office_id, week_ending, None, user_id_filter)
    last_week = await _aggregate_office_totals(office_id, last_week_ending, None, user_id_filter)
    # Tomorrow's recurring office schedule (meetings & blocks)
    tomorrow = await _tomorrow_schedule(office_id, target_dt)

    # Everyone's day, with their PBs, weekly goal, personal traffic light and
    # averages worked out here, then only the people with a positive worth
    # promoting go to the AI (the Owner, 24 Nov 2026: "we don't want to
    # mention every person but we do want to mention every positive").
    roster: list = []
    async for u in db.users.find({"office_id": office_id, "is_active": {"$ne": False}, "is_demo": {"$ne": True}},
                                 {"_id": 0, "name": 1}):
        roster.append(u.get("name") or "")
    people = await _people_facts(office_id, week_ending, day_idx, target_iso, user_id_filter)
    shown = display_names(roster + [p["full_name"] for p in people])
    for p in people:
        p["name"] = shown.get(p["full_name"], p["full_name"])
    rep_deltas = pick_callouts([{k: v for k, v in p.items() if k not in ("full_name", "user_id")} for p in people])

    # Compose context for the LLM
    weekday_name = target_dt.strftime("%A")
    pretty_date = f"{target_dt.strftime('%a')} {_day_month(target_dt)}"
    goal_remaining = max(0, weekly_goal - week_to_date["sales"])
    # The week runs Monday to Saturday: after Wednesday there are 3 days left.
    days_left = max(0, 5 - day_idx)

    # Build a pre-formatted "Tomorrow's Schedule" block so the LLM can drop it
    # in verbatim instead of rewriting times (which models love to hallucinate).
    aud_emoji = {"all": "👥", "leaders": "👨‍✈️", "trainees": "🎓", "core_leaders": "🔱"}
    if tomorrow["blocks"]:
        sched_lines = []
        for blk in tomorrow["blocks"]:
            ae = aud_emoji.get((blk["audience"] or "all").lower(), "👥")
            line = f"⏰ {blk['start']}–{blk['end']} · {blk['title']} {ae}"
            extras = []
            if blk["presenter"]:
                extras.append(blk["presenter"])
            if blk["topic"]:
                extras.append(blk["topic"])
            if extras:
                line += f"  _({' · '.join(extras)})_"
            sched_lines.append(line)
        tomorrow_block_text = (
            f"📅 *Tomorrow — {tomorrow['weekday']} {tomorrow['pretty']}*\n"
            + "\n".join(sched_lines)
        )
    else:
        tomorrow_block_text = (
            f"📅 *Tomorrow — {tomorrow['weekday']} {tomorrow['pretty']}*\n"
            f"Rest day — recharge & reload. 🔋"
        )

    callout_reps = rep_deltas[:12]

    # Load admin-authored prompt overrides for this office (if any). Empty
    # string is the baseline — the stock prompt rules apply as-is.
    settings_doc = await db.daily_breakdown_settings.find_one(
        {"office_id": office_id}, {"_id": 0, "custom_instructions": 1}
    )
    custom_instructions = (settings_doc or {}).get("custom_instructions") or ""

    # General office bits for the WhatsApp (the Owner, 11 Nov 2026): today's
    # numbers on the doors, the week day by day, and the week so far against
    # last week to the same day.
    day_q: dict = {"date": target_iso, "office_id": office_id}
    if user_id_filter is not None:
        day_q["user_id"] = {"$in": [str(u) for u in user_id_filter]}
    hidden = await _hidden_ids(office_id)
    office_bds = [sd.get("breakdown") async for sd in db.sector_days.find(day_q, {"_id": 0, "user_id": 1, "breakdown": 1})
                  if str(sd.get("user_id") or "") not in hidden]
    by_day = []
    for i in range(day_idx + 1):
        this_i = today if i == day_idx else await _aggregate_office_totals(office_id, week_ending, i, user_id_filter)
        by_day.append({"day": ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[i], "sign_ups": this_i["sales"]})
    best = max(by_day, key=lambda d: d["sign_ups"]) if by_day else None
    office_today = {
        "people_with_a_sign_up": len([p for p in people if p["sales"] > 0]),
        "people_who_rang_the_bell_4_plus": len([p for p in people if p["sales"] >= BELL]),
        "gold_sign_ups": today["over30"],
        "took_the_round": today["memberships"],
        "on_the_doors": office_day_numbers(office_bds),
        "average_kpis_per_person": office_averages(office_day_numbers(office_bds), today["sales"],
                                                   len([p for p in people if p.get("numbers") or p["sales"]])),
        "week_by_day": by_day,
        "best_day_this_week": best["day"] if best and best["sign_ups"] else None,
        "today_is_best_day_this_week": bool(best and best["sign_ups"] and today["sales"] >= best["sign_ups"]),
    }
    this_pa = await _office_pa(office_id, week_ending, day_idx, user_id_filter)
    today_pa = this_pa
    before_pa = await _office_pa(office_id, week_ending, day_idx - 1, user_id_filter) if day_idx else {"sales": 0, "person_days": 0}
    last_pa = await _office_pa(office_id, last_week_ending, 6, user_id_filter)
    last_to_day = await _office_pa(office_id, last_week_ending, day_idx, user_id_filter)
    people_in_today = today_pa["person_days"] - before_pa["person_days"]
    office_today["office_wins"] = office_wins(
        today_sales=today["sales"], people_in_today=people_in_today,
        people_on_board=len([p for p in people if p["sales"] > 0]),
        week_sales=this_pa["sales"], week_person_days=this_pa["person_days"],
        last_week_sales=last_pa["sales"], last_week_person_days=last_pa["person_days"],
        last_week_to_day_sales=last_to_day["sales"], last_week_to_day_person_days=last_to_day["person_days"],
        today_gold=today["over30"], today_round=today["memberships"],
        best_day_this_week=office_today["today_is_best_day_this_week"] and day_idx > 0,
        averages=office_today["average_kpis_per_person"], week_goal=weekly_goal)
    office_today["pa"] = {
        "today": round(today["sales"] / people_in_today, 2) if people_in_today else None,
        "this_week": round(this_pa["sales"] / this_pa["person_days"], 2) if this_pa["person_days"] else None,
        "last_week": round(last_pa["sales"] / last_pa["person_days"], 2) if last_pa["person_days"] else None,
    }

    summary_context = {
        "office": office_name,
        "date": pretty_date,
        "weekday": weekday_name,
        "weekly_goal": weekly_goal,
        "today_totals": {
            "sales": today["sales"],
            "over30": today["over30"],
            "under30": today["under30"],
            "memberships": today["memberships"],
        },
        "week_to_date": {
            "sales": week_to_date["sales"],
            "over30": week_to_date["over30"],
            "memberships": week_to_date["memberships"],
        },
        "last_week_total": last_week["sales"],
        "vision": {"name": "200LW", "meaning": "200 sales a week", "emoji": "🐒",
                   "this_week_so_far": week_to_date["sales"], "last_week": last_week["sales"]},
        "opener_style_today": opener_style(target_iso),
        "advice_angle_today": advice_angle(target_iso),
        "recent_messages_do_not_repeat": await _recent_texts(office_id, target_iso),
        "rep_callouts": callout_reps,
        "callout_names": [r["name"] for r in callout_reps],
        "callout_count": len(callout_reps),
        "office_today": office_today,
        "goal_remaining": goal_remaining,
        "days_left_in_week": days_left,
    }

    prompt = build_daily_breakdown_prompt(summary_context, tomorrow_block_text, custom_instructions)
    take_ai_quota(me)  # per-person hourly AI cap (core/rate_limit.py)

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"LLM library missing: {ex}")

    chat = LlmChat(
        api_key=anthropic_api_key(),
        session_id=f"daily-breakdown-{uuid.uuid4().hex[:10]}",
        system_message=DAILY_BREAKDOWN_SYSTEM_MESSAGE,
    ).with_model("anthropic")

    try:
        response = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=25)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="LLM timed out. Try again.")
    except Exception:
        logger.exception("daily breakdown AI call failed")
        raise HTTPException(status_code=502, detail="The AI call failed. Try again shortly.")

    text = (response if isinstance(response, str) else str(response)).strip()
    # Every positive gets a mention (the Owner, 24 Nov 2026): ask once more
    # if anyone picked is missing.
    missing = missing_callouts(text, [r["name"] for r in callout_reps])
    if missing:
        try:
            again = await asyncio.wait_for(chat.send_message(UserMessage(text=(
                prompt + f"\n\nIMPORTANT: a first try left out {', '.join(missing)}. Write a callout "
                f"for every name in callout_names, in order, and still nobody else."))), timeout=25)
            again = (again if isinstance(again, str) else str(again)).strip()
            if not missing_callouts(again, [r["name"] for r in callout_reps]):
                text = again
        except Exception:
            logger.exception("daily breakdown retry failed")
    # Strip stray markdown fences if the model added them
    if text.startswith("```"):
        text = re.sub(r"^```(?:[a-zA-Z]+)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    text = no_dashes(text)
    try:
        await db.daily_breakdown_history.update_one(
            {"office_id": office_id, "date": target_iso, "by": me.get("id")},
            {"$set": {"text": text, "at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    except Exception:
        logger.exception("couldn't keep the breakdown for next time")

    return {
        "text": text,
        "meta": {
            "office_id": office_id,
            "office_name": office_name,
            "date": target_iso,
            "weekday": weekday_name,
            "weekly_goal": weekly_goal,
            "week_to_date_sales": week_to_date["sales"],
            "today_sales": today["sales"],
            "last_week_total_sales": last_week["sales"],
            "goal_remaining": goal_remaining,
            "days_left_in_week": days_left,
        },
    }


@router.put("/offices/{office_id}/weekly-goal")
async def set_office_weekly_goal(office_id: str, request: Request):
    """Admin: set the office's weekly sales goal (used by the daily-breakdown
    progress line). Stored on the office doc as `weekly_goal`."""
    me = await get_current_user(request)
    if me.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    try:
        goal = max(0, int(body.get("weekly_goal") or 0))
    except Exception:
        raise HTTPException(status_code=400, detail="weekly_goal must be an integer")
    res = await db.offices.update_one({"id": office_id}, {"$set": {"weekly_goal": goal, "weekly_goal_updated_at": datetime.now(timezone.utc).isoformat()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Office not found")
    # This is the running week's target — mirror it onto the current week's
    # plan Sales Goal + the admins' bells crew rows like every other goal
    # write path (core/goal_sync.py).
    from core.goal_sync import sync_office_weekly_goal, _current_local_sunday
    await sync_office_weekly_goal(
        office_id, _current_local_sunday(), goal or None, me,
        "PUT /offices/weekly-goal", skip_office=True,
    )
    return {"office_id": office_id, "weekly_goal": goal}


# ───────────────────────────────────────────────────────────────────────
# Daily-Breakdown PROMPT EDITOR — admin-only, per-office.
# Stores a free-form `custom_instructions` string that is injected into the
# prompt with highest priority (overrides the default rules if they conflict).
# ───────────────────────────────────────────────────────────────────────

def _resolve_office_id_for_settings(me: dict, body_office_id: str | None) -> str:
    """Super-admins may pass an office_id to target another office;
    everyone else is forced to their own office. Raises 400 if no office."""
    if me.get("is_super_admin") and (body_office_id or "").strip():
        return body_office_id.strip()
    office_id = me.get("office_id")
    if not office_id:
        raise HTTPException(status_code=400, detail="No office assigned to your account.")
    return office_id


@router.get("/bells/daily-breakdown/settings")
async def get_daily_breakdown_settings(request: Request, office_id: Optional[str] = None):
    """Return the admin-authored custom instructions for this office (or empty
    string if none saved yet)."""
    me = await get_current_user(request)
    if me.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    resolved = _resolve_office_id_for_settings(me, office_id)
    doc = await db.daily_breakdown_settings.find_one(
        {"office_id": resolved},
        {"_id": 0, "custom_instructions": 1, "updated_at": 1, "updated_by_name": 1, "office_id": 1},
    ) or {}
    return {
        "office_id": resolved,
        "custom_instructions": doc.get("custom_instructions") or "",
        "updated_at": doc.get("updated_at"),
        "updated_by_name": doc.get("updated_by_name"),
    }


@router.put("/bells/daily-breakdown/settings")
async def save_daily_breakdown_settings(request: Request):
    """Body: { custom_instructions: str, office_id?: str (super-admin only) }.
    Empty string clears the override and restores the baseline prompt."""
    me = await get_current_user(request)
    if me.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    body_office_id = body.get("office_id")
    resolved = _resolve_office_id_for_settings(me, body_office_id)

    raw = body.get("custom_instructions")
    if raw is None:
        raise HTTPException(status_code=400, detail="custom_instructions is required (use empty string to clear)")
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="custom_instructions must be a string")
    # Cap to a generous size so we don't OOM the prompt. 6k chars is ~1500 tokens.
    if len(raw) > 6000:
        raise HTTPException(status_code=400, detail=f"custom_instructions too long ({len(raw)} chars; max 6000)")
    cleaned = raw.strip()

    await db.daily_breakdown_settings.update_one(
        {"office_id": resolved},
        {"$set": {
            "office_id": resolved,
            "custom_instructions": cleaned,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by_id": me.get("id"),
            "updated_by_name": me.get("name") or me.get("email") or "Admin",
        }},
        upsert=True,
    )
    return {
        "office_id": resolved,
        "custom_instructions": cleaned,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by_name": me.get("name") or me.get("email") or "Admin",
    }


@router.post("/bells/daily-breakdown/settings/reset")
async def reset_daily_breakdown_settings(request: Request):
    """Remove the override doc → baseline prompt kicks back in."""
    me = await get_current_user(request)
    if me.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    body_office_id = body.get("office_id")
    resolved = _resolve_office_id_for_settings(me, body_office_id)
    await db.daily_breakdown_settings.delete_one({"office_id": resolved})
    return {"office_id": resolved, "custom_instructions": "", "reset": True}
