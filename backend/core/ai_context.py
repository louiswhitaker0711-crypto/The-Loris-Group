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
MAX_CONTEXT_CHARS = 60_000
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


def _fit(ctx: dict) -> str:
    """JSON, trimmed to the cap: the team block shrinks first, then sectors."""
    text = json.dumps(ctx, ensure_ascii=False, default=str)
    for key in ("team", "my_recent_sector_days", "my_page"):
        if len(text) <= MAX_CONTEXT_CHARS:
            break
        if isinstance(ctx.get(key), list):
            while ctx[key] and len(text) > MAX_CONTEXT_CHARS:
                ctx[key] = ctx[key][: max(0, len(ctx[key]) // 2)] if len(ctx[key]) > 1 else []
                text = json.dumps(ctx, ensure_ascii=False, default=str)
        elif key in ctx and len(text) > MAX_CONTEXT_CHARS:
            ctx[key] = "(left out: too long)"
            text = json.dumps(ctx, ensure_ascii=False, default=str)
    return text[:MAX_CONTEXT_CHARS]


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
        page = strip_private(await person_breakdown_for(user, me))
    except Exception:
        page = None
    team_ids = ids - {me}
    names = {str(u["_id"]): u.get("name") async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in team_ids if ObjectId.is_valid(i)]},
         "deleted": {"$ne": True}, "is_active": {"$ne": False}}, {"name": 1})}
    team = [{"name": names[i], "weeks": rows.get(i, {}).get("weeks", {})} for i in names]
    team.sort(key=lambda r: -sum((w.get("sign_ups") or 0) for w in r["weeks"].values()))
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
        "next_field_day": next_field_day(today).isoformat(),
        "me": {"name": user.get("name"), "role": role_label(user.get("role")),
               "sees": "the whole office" if whole else ("my team" if team_ids else "only myself")},
        "my_weeks": rows.get(me, {}).get("weeks", {}),
        "office_weeks": office,
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
