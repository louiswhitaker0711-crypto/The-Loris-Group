"""What someone's AI can see: their own numbers, trends and plans, the office's
trend to compare against, and their team's numbers if they have a team.

The Owner, 2 Nov 2026: "Someone's AI can see everything that they can." So
this reads through the same permission helpers the screens use:
`sees_whole_office` (Admin, Coach+) reads every person; anyone else reads
themselves plus the people under them (`get_subtree_ids`). Office totals are
for everyone, so a BA can compare themselves with the office.

Used by the in-app AI (routes/ai_assistant.py) and by personal Claude
connector links (routes/claude_connector.py). Nothing here writes, and contact
details never leave (`strip_private`).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from bson import ObjectId

from auth import get_subtree_ids, sees_whole_office
from core.app_time import APP_TZ
from database import db

# The whole context is capped so one AI call stays a few pence.
MAX_CONTEXT_CHARS = 24_000
WEEKS_OF_TREND = 6
DAYS_OF_SECTORS = 7


def today_uk() -> date:
    return datetime.now(APP_TZ).date()


def week_ending_of(d: date) -> str:
    return (d + timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def next_field_day(d: date | None = None) -> date:
    """Tomorrow, skipping Sunday (the team works Monday to Saturday)."""
    n = (d or today_uk()) + timedelta(days=1)
    return n + timedelta(days=1) if n.weekday() == 6 else n


async def visible_ids(user: dict) -> tuple[set[str], bool]:
    """(the people this user can see, whole_office). Always includes them."""
    me = str(user["id"])
    if sees_whole_office(user):
        ids = {str(u["_id"]) async for u in db.users.find(
            {"office_id": user.get("office_id"), "deleted": {"$ne": True}, "is_demo": {"$ne": True},
             "role": {"$in": ["trainee", "leader", "admin"]}}, {"_id": 1})}
        return ids | {me}, True
    return {str(x) for x in await get_subtree_ids(me)} | {me}, False


async def weekly_rows(office_id: str, user_ids: set[str] | None, weeks: list[str]) -> tuple[dict, dict]:
    """({user_id: {name, weeks: {week: numbers}}}, {week: office totals}).
    `user_ids` None = nobody's personal rows (office totals only)."""
    from routes.bells import compute_totals
    rows: dict[str, dict] = {}
    office = {w: {"sign_ups": 0, "gold": 0, "the_round": 0, "days_worked": 0, "people_in": 0} for w in weeks}
    async for b in db.bells_entries.find({"office_id": office_id, "week_ending": {"$in": weeks}},
                                         {"_id": 0, "user_id": 1, "user_name": 1, "week_ending": 1, "days": 1,
                                          "weekly_goal": 1}):
        t = compute_totals(b, None)
        o = office[b["week_ending"]]
        o["sign_ups"] += t["total_sales"]
        o["gold"] += t["total_over30"]
        o["the_round"] += t["total_memberships"]
        o["days_worked"] += t["days_worked"]
        o["people_in"] += 1 if t["days_worked"] else 0
        uid = str(b.get("user_id") or "")
        if user_ids is None or uid not in user_ids:
            continue
        r = rows.setdefault(uid, {"name": b.get("user_name"), "weeks": {}})
        r["weeks"][b["week_ending"]] = {
            "goal": b.get("weekly_goal"), "sign_ups": t["total_sales"], "gold": t["total_over30"],
            "the_round": t["total_memberships"], "days_worked": t["days_worked"],
            "piece_average": t["piece_average"], "reliability_pct": t["reliability_pct"]}
    for o in office.values():
        o["piece_average"] = round(o["sign_ups"] / o["days_worked"], 2) if o["days_worked"] else None
        o["gold_pct"] = round(100 * o["gold"] / o["sign_ups"]) if o["sign_ups"] else None
        o["round_pct"] = round(100 * o["the_round"] / o["sign_ups"]) if o["sign_ups"] else None
        o["sign_ups_per_person"] = round(o["sign_ups"] / o["people_in"], 1) if o["people_in"] else None
    return rows, office


async def recent_sector_days(user_id: str, days: int = DAYS_OF_SECTORS) -> list[dict]:
    from routes.claude_connector import strip_private
    since = (today_uk() - timedelta(days=days)).isoformat()
    out = []
    async for d in db.sector_days.find({"user_id": user_id, "date": {"$gte": since}},
                                       {"_id": 0, "date": 1, "setup": 1, "breakdown": 1}).sort("date", 1):
        for part in ("setup", "breakdown"):
            if isinstance(d.get(part), dict):
                d[part] = {k: v for k, v in d[part].items() if k not in ("by_id", "at") and v not in (None, "", [])}
        out.append(strip_private(d))
    return out


async def this_week_plan(user_id: str) -> dict:
    """The person's planner for this week: the filled-in boxes and notes titles."""
    from routes.weekly_planners import DAY_FIELD_LABELS, DAY_NAMES
    week = week_ending_of(today_uk())
    p = await db.weekly_planners.find_one({"user_id": user_id, "week_ending": week}, {"_id": 0})
    if not p:
        return {"week_ending": week, "days": {}}
    days = {}
    for d, box in (p.get("days") or {}).items():
        filled = {DAY_FIELD_LABELS.get(k, k): v for k, v in (box or {}).items()
                  if k in DAY_FIELD_LABELS and isinstance(v, str) and v.strip()}
        if filled and d.isdigit() and int(d) < len(DAY_NAMES):
            days[DAY_NAMES[int(d)]] = filled
    notes = []
    for key, items in (p.get("slot_notes") or {}).items():
        for n in items or []:
            notes.append({"slot": key, "title": n.get("title"), "text": (n.get("body") or "")[:400]})
    goals = ((p.get("review") or {}).get("next_goals") or {})
    return {"week_ending": week, "goals": {k: v for k, v in goals.items() if v}, "days": days, "notes": notes[:30]}


async def latest_quality(office_id: str, user_ids: set[str]) -> dict | None:
    from core.quality import TARGETS
    doc = await db.quality_weeks.find_one({"office_id": office_id}, {"_id": 0}, sort=[("week_ending", -1)])
    if not doc:
        return None
    mine = [{"user_id": str(b.get("user_id")), "metrics": b.get("metrics")}
            for b in doc.get("bas") or [] if str(b.get("user_id") or "") in user_ids]
    return {"week_ending": doc["week_ending"], "targets": {k: v["text"] for k, v in TARGETS.items()},
            "office_total": doc.get("total"), "people": mine}


async def today_in_field(user: dict) -> dict:
    """Right now: the time, how long's left in the field, and the sector this
    person is in today (goal, hops, each person's set-up), so the AI can coach
    live ("we're behind with 2 hours left"). Never today's Bells: it's only
    filled in at the end of the day (the Owner, 5 Nov 2026), so the AI asks."""
    from datetime import datetime as _dt
    from routes.sector import _my_sector
    now = _dt.now(APP_TZ)
    d = now.date()
    end_h, end_m = (17, 0) if d.weekday() == 5 else (20, 0)
    start_h, start_m = (10, 0) if d.weekday() == 5 else (13, 30)
    mins = now.hour * 60 + now.minute
    out: dict = {"now": now.strftime("%H:%M"), "day": now.strftime("%A"),
                 "field": f"{start_h:02d}:{start_m:02d}–{end_h:02d}:{end_m:02d}" if d.weekday() < 6 else "no field on Sundays",
                 "minutes_left_in_field": max(0, end_h * 60 + end_m - mins) if d.weekday() < 6 and mins >= start_h * 60 + start_m else None,
                 "sector": None}
    sec = await _my_sector(str(user["id"]), d.isoformat())
    if not sec:
        return out
    ids = [str(x) for x in [sec.get("leader_id")] + list(sec.get("member_ids") or []) if x]
    ids = list(dict.fromkeys(ids))
    names = {str(u["_id"]): u.get("name") async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in ids if ObjectId.is_valid(i)]}}, {"name": 1})}
    setups = {sd["user_id"]: sd async for sd in db.sector_days.find(
        {"user_id": {"$in": ids}, "date": d.isoformat()}, {"_id": 0, "user_id": 1, "setup": 1, "breakdown": 1})}
    shadows = {str(m) for h in sec.get("hops") or [] for m in (h.get("shadow_ids") or [])}
    people = []
    for i in ids:
        su = (setups.get(i) or {}).get("setup") or {}
        people.append({"name": names.get(i) or "?", "leader": i == str(sec.get("leader_id")), "shadow": i in shadows,
                       "goal": su.get("goal"), "focus": su.get("focus"), "kpi": (f"{su.get('kpi_target')} {su.get('kpi_metric')}"
                                                                                  if su.get("kpi_metric") else None)})
    hops = [[names.get(str(m)) or "?" for m in h.get("member_ids") or []] for h in sec.get("hops") or []]
    out["sector"] = {"postcode": sec.get("postcode"), "leader": names.get(str(sec.get("leader_id"))),
                     "i_lead_it": str(sec.get("leader_id")) == str(user["id"]), "goal": sec.get("goal"),
                     "hops": hops, "people": people,
                     "note": "Today's sign-ups aren't known: Bells is only filled in at the end of the day. Ask them."}
    return out


def _fit(ctx: dict) -> str:
    """JSON, trimmed to the cap: the team block shrinks first, then sectors."""
    dump = lambda x: json.dumps(x, ensure_ascii=False, default=str, separators=(",", ":"))  # noqa: E731
    text = dump(ctx)
    for key in ("team", "my_recent_sector_days", "my_page"):
        if len(text) <= MAX_CONTEXT_CHARS:
            break
        if isinstance(ctx.get(key), list):
            while ctx[key] and len(text) > MAX_CONTEXT_CHARS:
                ctx[key] = ctx[key][: max(0, len(ctx[key]) // 2)] if len(ctx[key]) > 1 else []
                text = dump(ctx)
        elif key in ctx and len(text) > MAX_CONTEXT_CHARS:
            ctx[key] = "(left out: too long)"
            text = dump(ctx)
    return text[:MAX_CONTEXT_CHARS]


SKILLS = (("skill_intro", "intro"), ("skill_presentation", "presentation"), ("skill_short_story", "short story"),
          ("skill_close", "close"), ("skill_signup", "sign-up"), ("skill_rehash", "Rehash"))


def _grade(score) -> str | None:
    """Day grades are out of 10 (Excellent 10, Average 7, Needs Work 4)."""
    if score is None:
        return None
    try:
        v = float(score)
    except (TypeError, ValueError):
        return None
    return "Excellent" if v >= 8.5 else "Average" if v >= 5.5 else "Needs Work"


async def development_of(uid: str) -> dict:
    """Where someone is in their development, so the AI coaches them for their
    stage (the Owner, 5 Nov 2026): new-start day, days in the field, how each
    graded day went (skills, own sign-ups vs leader-assisted, biggest weakness,
    focus), whether they're signing up on their own yet, and their COD stage."""
    out: dict = {}
    person = await db.users.find_one({"_id": ObjectId(uid)}, {"new_hire_id": 1, "role": 1, "owneriq_stage": 1,
                                                              "created_at": 1}) if ObjectId.is_valid(uid) else None
    if not person:
        return out
    hire = None
    if person.get("new_hire_id"):
        hire = await db.new_hires.find_one({"id": person["new_hire_id"]}, {"_id": 0})
    if not hire:
        hire = await db.new_hires.find_one({"trainee_user_id": uid}, {"_id": 0})
    field_days = await db.sector_days.count_documents({"user_id": uid, "breakdown": {"$ne": None}})
    out["days_in_field_with_a_breakdown"] = field_days
    own_total = assisted_total = 0
    # Marked "Not a new start" by an Admin (the Owner, 10 Nov 2026): treated
    # as established; their graded days stay on record but aren't coached to.
    if hire and hire.get("closed_out_reason") == "not_new_start":
        hire = None
    if hire:
        rows = await db.daily_assessments.find({"new_hire_id": hire["id"], "completed": True}, {"_id": 0}).to_list(20)
        rows.sort(key=lambda a: int(a.get("day_number") or 0))
        graded = []
        for a in rows[-3:]:
            sales = a.get("kpi_sales")
            assisted = a.get("leader_assisted_sales")
            own = max(0, int(sales or 0) - int(assisted or 0)) if sales is not None else None
            graded.append({k: v for k, v in {
                "day": a.get("day_number"),
                "skills": {label: _grade(a.get(k)) for k, label in SKILLS if a.get(k) is not None} or None,
                "own_sign_ups": own, "leader_assisted": assisted,
                "biggest_weakness": a.get("biggest_weakness") or None, "focus_next": a.get("focus_tomorrow") or None,
            }.items() if v not in (None, "", {})})
        for a in rows:
            if a.get("kpi_sales") is not None:
                own_total += max(0, int(a.get("kpi_sales") or 0) - int(a.get("leader_assisted_sales") or 0))
                assisted_total += int(a.get("leader_assisted_sales") or 0)
        day = int(hire.get("current_day") or 1)
        out["new_start"] = {"start_date": hire.get("start_date"), "on_day": day,
                            "days_graded": len(rows), "recent_graded_days": graded}
        independent = own_total > 0
        if day <= 2 and not rows:
            stage = "BA Academy (Days 1–2, in the office): not in the field yet"
        elif day == 3 and own_total == 0:
            stage = "shadow day: watching a bunny hop, no sales goal"
        elif not independent:
            stage = "first field days: still being shown, sign-ups so far leader-assisted"
        elif day <= 8:
            stage = "signing up on their own within their first 8 days: sharpen, don't demonstrate"
        else:
            stage = "past their new-start days and signing up on their own"
    else:
        stage = "established: past the new-start days"
    out["stage_of_development"] = stage
    try:
        from routes.people import _cod
        cod = await _cod({**person, "_id": person["_id"]}, uid)
        cur = next((st for st in cod.get("stages") or [] if st.get("current")), None)
        if cur:
            out["cod"] = {"stage": cur.get("name"), "done": cur.get("done"), "of": cur.get("total")}
    except Exception:
        pass
    return out


def slim_page(page: dict | None) -> dict | None:
    """The parts of someone's person page the AI uses: who they are, their Law
    of Averages (this week and the last 28 days) and where they are on the COD.
    The weekly rows are already in my_weeks, so they aren't sent twice."""
    if not page:
        return None
    person = page.get("person") or {}
    loa = {}
    for k in ("week", "recent"):
        x = (page.get("loa") or {}).get(k) or {}
        if x.get("active_days"):
            loa[k] = {"days": x.get("active_days"), "avg_per_day": x.get("avg_per_day"),
                      "steps": {f'{st.get("from")}→{st.get("to")}': st.get("pct") for st in x.get("steps") or []}}
    cod = page.get("cod") or {}
    current = next((st for st in cod.get("stages") or [] if st.get("current")), None)
    return {"stage": person.get("stage"), "coach": (person.get("coach") or {}).get("name") if isinstance(person.get("coach"), dict) else person.get("coach"),
            "team_size": (person.get("team") or {}).get("total"), "start_date": person.get("start_date"),
            "law_of_averages": loa,
            "cod_now": {k: current.get(k) for k in ("stage", "name", "done", "total") if k in current} if current else None}


async def build_context(user: dict) -> dict:
    """Everything this person's AI can see, as one dict."""
    from routes.claude_connector import strip_private
    from routes.people import person_breakdown_for
    me = str(user["id"])
    office_id = user.get("office_id")
    ids, whole = await visible_ids(user)
    today = today_uk()
    last = date.fromisoformat(week_ending_of(today))
    weeks = [(last - timedelta(days=7 * i)).isoformat() for i in range(WEEKS_OF_TREND)][::-1]
    rows, office = await weekly_rows(office_id, ids, weeks)

    try:
        page = slim_page(strip_private(await person_breakdown_for(user, me)))
    except Exception:
        page = None
    team_ids = ids - {me}
    names = {str(u["_id"]): u.get("name") async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in team_ids if ObjectId.is_valid(i)]},
         "deleted": {"$ne": True}, "is_active": {"$ne": False}}, {"name": 1})}
    def _team_row(i: str) -> dict:
        w = rows.get(i, {}).get("weeks", {})
        this = w.get(weeks[-1]) or {}
        signed = sum((w.get(x) or {}).get("sign_ups") or 0 for x in weeks)
        gold = sum((w.get(x) or {}).get("gold") or 0 for x in weeks)
        return {"name": names[i], "sign_ups_by_week": [(w.get(x) or {}).get("sign_ups") or 0 for x in weeks],
                "this_week": {"days": this.get("days_worked"), "piece_avg": this.get("piece_average"),
                              "goal": this.get("goal")},
                "gold_pct": round(100 * gold / signed) if signed else None}
    try:
        live = await today_in_field(user)
    except Exception:
        live = None
    try:
        my_dev = await development_of(me)
    except Exception:
        my_dev = None
    team = [_team_row(i) for i in names]
    for row, i in zip(team, list(names)):
        try:
            row["development"] = await development_of(i)
        except Exception:
            pass
    # If the picture has to be trimmed, the end goes first: so people in my
    # sector today and new starts come first, then by sign-ups.
    in_sector = {p.get("name") for p in (((live or {}).get("sector") or {}).get("people") or [])}
    team.sort(key=lambda r: (r["name"] not in in_sector, "new_start" not in (r.get("development") or {}),
                             -sum(r["sign_ups_by_week"])))
    quality = await latest_quality(office_id, ids)
    if quality:
        for q in quality["people"]:
            q["name"] = "me" if q["user_id"] == me else names.get(q.pop("user_id"))
            q.pop("user_id", None)
        quality["people"] = [q for q in quality["people"] if q.get("name")]

    # Coaching notes on the people this viewer coaches (never about themselves):
    # what they're struggling with, from the Owner or their Coach.
    from routes.coaching_notes import live_notes, noteable_ids
    allowed = await noteable_ids(user, set(names))
    notes = await live_notes(allowed)
    coaching_notes = [{"name": names[i], "notes": n} for i, n in notes.items() if i in names]


    from core.brand import role_label
    return {
        "today": today.isoformat(), "weekday": today.strftime("%A"),
        "right_now": live,
        "next_field_day": next_field_day(today).isoformat(),
        "me": {"name": user.get("name"), "role": role_label(user.get("role")), "development": my_dev,
               "sees": "the whole office" if whole else ("my team" if team_ids else "only myself")},
        "my_weeks": rows.get(me, {}).get("weeks", {}),
        "weeks_oldest_first": weeks,
        "bells_note": "Bells is filled in at the end of each day, so today is never on it: this week's numbers run "
                      "to yesterday. Ignore today's Bells; ask how today's going if you need it.",
        "my_page": page,
        "my_recent_sector_days": await recent_sector_days(me),
        "my_plan_this_week": await this_week_plan(me),
        "team": team,
        "coaching_notes_on_my_people": coaching_notes,
        "quality_latest": quality,
    }


async def context_text(user: dict) -> str:
    return _fit(await build_context(user))


def compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)
