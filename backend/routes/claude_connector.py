"""Claude connector: the office in Claude, read and (with a yes) write.

Added in claude.ai as a custom connector, then any chat with Claude can read
the numbers (Bells, breakdowns, field numbers, sectors, quality, COD) to help
plan the week, and fill in plans in the app (the Owner, 2 Nov 2026).

  POST /mcp/{token}     the connector (MCP over HTTP, JSON replies)

Two kinds of link, each just a long secret in the address:
  * CLAUDE_CONNECTOR_TOKEN (Railway, 32+ characters): the Owner's original
    link. Reads as the Owner (the super-admin) sees the app; writes as them.
  * Personal links (`connector_links`, made in the app: Profile → Connect
    Claude). Stored only as a hash. Reads what that person can see in the app
    (`core.ai_context.visible_ids`) and writes only what they could write
    (`core.ai_actions`). Admins make their own; anyone else once an Admin has
    allowed them (`users.connector_allowed`).
Wrong secrets are rate-limited per caller IP; with neither kind set up, 404.

Writes (weekly goal, sector set-ups, planner boxes and notes, bunny hops) are
marked as changing the app, so Claude asks the person before each one. Never
sent: emails, phone numbers, photos, badge numbers, passwords.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
from datetime import date, datetime, timedelta
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from core.app_time import APP_TZ
from core.brand import APP_NAME
from core.rate_limit import Limiter, client_ip
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

MIN_TOKEN_LENGTH = 32
_TOKEN_FAILURES = Limiter(10, 15 * 60)
SERVER_VERSION = "1.0"
PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

# Never sent to Claude, wherever they turn up.
PRIVATE_KEYS = {
    "email", "phone", "password_hash", "profile_image", "photo_base64", "photo_key",
    "badge_numbers", "badge_number", "amplifi_codes", "on_starter_password",
    "mc_fees", "fee_mc_standard", "fee_mc_target", "badges", "can_badge", "can_open_cod",
    "next_assessment_id", "hire_id",
}

DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
DAY_STATUS = {
    "in": "Scheduled in", "off": "Not filled in", "ab": "Scheduled off", "ns": "No show", "rt": "Retrain",
    "nc": "Not counted", "pc": "In office", "sd": "Shadow day",
}


# ── The gate ──────────────────────────────────────────────────────────────────

def _token() -> str:
    t = (os.getenv("CLAUDE_CONNECTOR_TOKEN") or "").strip()
    if t and len(t) < MIN_TOKEN_LENGTH:
        logger.warning("CLAUDE_CONNECTOR_TOKEN is shorter than %d characters; the Claude connector stays off",
                       MIN_TOKEN_LENGTH)
        return ""
    return t


def hash_link(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _check_token(token: str, request: Request) -> dict:
    """The viewer this link reads and writes as, or 404."""
    key = client_ip(request)
    _TOKEN_FAILURES.check(key)
    expected = _token()
    if token and expected and secrets.compare_digest(token.encode(), expected.encode()):
        return await owner_view()
    if token and len(token) >= MIN_TOKEN_LENGTH:
        link = await db.connector_links.find_one({"token_hash": hash_link(token), "revoked": {"$ne": True}})
        if link and ObjectId.is_valid(str(link.get("user_id"))):
            u = await db.users.find_one({"_id": ObjectId(str(link["user_id"])), "deleted": {"$ne": True},
                                         "is_active": {"$ne": False}}, {"password_hash": 0})
            if u and not u.get("is_viewer"):
                u["id"] = str(u.pop("_id"))
                await db.connector_links.update_one({"_id": link["_id"]},
                                                    {"$set": {"last_used_at": datetime.utcnow().isoformat()}})
                return u
    _TOKEN_FAILURES.hit(key)
    raise HTTPException(status_code=404, detail="Not found")


# ── Helpers ───────────────────────────────────────────────────────────────────

def strip_private(value: Any) -> Any:
    """Drop personal details at any depth; make ids and dates JSON-friendly."""
    if isinstance(value, dict):
        return {k: strip_private(v) for k, v in value.items() if k not in PRIVATE_KEYS and k != "_id"}
    if isinstance(value, list):
        return [strip_private(v) for v in value]
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


async def owner_view() -> dict:
    """The Owner as a viewer: the super-admin account (the earliest, if more
    than one). Everything is read as they'd see it in the app."""
    office = (os.getenv("CLAUDE_CONNECTOR_OFFICE_ID") or "").strip()
    q: dict = {"is_super_admin": True, "deleted": {"$ne": True}, "is_active": {"$ne": False}}
    u = await db.users.find_one(q, {"password_hash": 0}, sort=[("created_at", 1)])
    if not u:
        raise ValueError("No Owner account found in the app.")
    u["id"] = str(u.pop("_id"))
    if office:
        u["office_id"] = office
    if not u.get("office_id"):
        first = await db.offices.find_one({}, {"_id": 0, "id": 1}, sort=[("created_at", 1)])
        u["office_id"] = (first or {}).get("id")
    return u


async def scoped(viewer: dict) -> dict:
    """The viewer with `_visible` set: None for whole-office readers (Admins,
    Coach+, the Owner's link), else the ids they can see in the app."""
    from auth import sees_whole_office
    if viewer.get("is_super_admin") or sees_whole_office(viewer):
        return {**viewer, "_visible": None}
    from core.ai_context import visible_ids
    ids, _whole = await visible_ids(viewer)
    return {**viewer, "_visible": ids}


def today_uk() -> date:
    return datetime.now(APP_TZ).date()


def sunday_of(d: date) -> date:
    return d + timedelta(days=(6 - d.weekday()) % 7)


def last_full_week() -> str:
    """The most recent Monday–Saturday week that's over (its Sunday)."""
    t = today_uk()
    this = sunday_of(t)
    return (this if t.weekday() == 6 else this - timedelta(days=7)).isoformat()


def _date_arg(raw: Any, default: date) -> date:
    try:
        return date.fromisoformat(str(raw)[:10]) if raw else default
    except ValueError:
        raise ValueError(f"'{raw}' isn't a date. Use YYYY-MM-DD.")


def _week_arg(raw: Any) -> str:
    if not raw:
        return last_full_week()
    return sunday_of(_date_arg(raw, today_uk())).isoformat()


async def _office_people(owner: dict, include_left: bool = False) -> dict[str, dict]:
    q: dict = {"office_id": owner.get("office_id"), "is_demo": {"$ne": True},
               "role": {"$in": ["trainee", "leader", "admin"]}}
    if not include_left:
        q.update({"deleted": {"$ne": True}, "is_active": {"$ne": False}})
    people = {str(u["_id"]): u async for u in db.users.find(q, {"name": 1, "role": 1, "reports_to": 1})}
    vis = owner.get("_visible")
    return people if vis is None else {i: u for i, u in people.items() if i in vis}


def _sees(owner: dict, user_id: Any) -> bool:
    """Personal links only see their own people; the Owner's link sees all."""
    vis = owner.get("_visible")
    return vis is None or str(user_id or "") in vis


def _band(n: int) -> str:
    from core.week_bands import week_band
    return {"super_green": "Super Green", "green": "Green", "amber": "Amber", "red": "Red"}.get(week_band(n), "Red")


# ── Tools ─────────────────────────────────────────────────────────────────────

async def tool_get_team(owner: dict, args: dict) -> dict:
    from routes.people import people_for
    from core.person_breakdown import stage_label
    people = await people_for(owner)
    ids = [ObjectId(p["user_id"]) for p in people if ObjectId.is_valid(p["user_id"])]
    extra = {str(u["_id"]): u async for u in db.users.find(
        {"_id": {"$in": ids}}, {"owneriq_stage": 1, "legacy_vertex_hub": 1, "coach_plus": 1, "created_at": 1})}
    starts = {h.get("trainee_user_id"): h async for h in db.new_hires.find(
        {"office_id": owner.get("office_id")}, {"_id": 0, "trainee_user_id": 1, "start_date": 1, "current_day": 1, "active": 1})}
    out = []
    for p in people:
        e = extra.get(p["user_id"]) or {}
        legacy = e.get("legacy_vertex_hub") or {}
        h = starts.get(p["user_id"]) or {}
        out.append({
            "user_id": p["user_id"], "name": p["name"], "role": p["role_label"], "team": p["team"] or None, "coach": p["coach"] or None,
            "coach_plus": bool(e.get("coach_plus")) if p["role"] == "leader" else None,
            "stage": stage_label(e.get("owneriq_stage")) or stage_label(legacy.get("stage")),
            "start_date": h.get("start_date") or legacy.get("start_date"),
            "new_start_day": h.get("current_day") if h.get("active") is not False and h else None,
        })
    return {"office_people": len(out), "people": out}


def _compact_entry(e: dict) -> dict:
    days = e.get("days") or []
    return {
        "name": e.get("user_name"), "team": e.get("team_name") or e.get("team"), "coach": e.get("coach_name"),
        "stage": e.get("stage_label") or e.get("stage"),
        "left_on": e.get("left_on"),
        "goal": e.get("weekly_goal"), "last_week": e.get("last_week_total"),
        "sign_ups": e.get("total_sales"), "gold": e.get("total_over30"), "silver": e.get("total_under30"),
        "the_round": e.get("total_memberships"),
        "gold_pct": round(100 * (e.get("total_over30") or 0) / e["total_sales"]) if e.get("total_sales") else None,
        "round_pct": round(100 * (e.get("total_memberships") or 0) / e["total_sales"]) if e.get("total_sales") else None,
        "days_worked": e.get("days_worked"), "piece_average": e.get("piece_average"),
        "scoring_pct": e.get("scoring_pct"), "reliability_pct": e.get("reliability_pct"),
        "traffic_light": _band(int(e.get("total_sales") or 0)),
        "weeks_on_bells_before": e.get("prior_weeks"),
        "recruit": e.get("recruit_badge"),
        "days": {
            DAY_NAMES[i]: {
                "status": DAY_STATUS.get(d.get("status") or "off", d.get("status")),
                "gold": d.get("over30"), "silver": d.get("under30"), "round": d.get("memberships"),
            } for i, d in enumerate(days[:7])
        },
    }


async def tool_get_bells_week(owner: dict, args: dict) -> dict:
    from routes.bells import bells_week_for
    week = _week_arg(args.get("week_ending"))
    sheet = await bells_week_for(owner, week, None, adopt_plan_goal=False)
    totals = strip_private(sheet.get("office_totals") or {})
    totals.pop("earnings", None)
    totals.pop("average_earnings_per_day", None)
    totals["daily_totals"] = dict(zip(DAY_NAMES, totals.get("daily_totals") or []))
    totals["gold_pct"] = totals.pop("pct_over30", None)
    totals["silver_pct"] = totals.pop("pct_under30", None)
    totals["round_pct"] = totals.pop("pct_memberships", None)
    return {
        "week_ending": sheet["week_ending"], "office": sheet.get("office_name"),
        "office_totals": totals,
        "people": [_compact_entry(e) for e in sheet.get("entries") or []
                   if (e.get("user_active", True) or (e.get("total_sales") or 0) > 0 or e.get("left_on"))
                   and _sees(owner, e.get("user_id"))],
    }


async def tool_get_recent_weeks(owner: dict, args: dict) -> dict:
    """Each person's weekly sign-ups for the last N weeks, for trends."""
    from routes.bells import compute_totals
    n = max(1, min(int(args.get("weeks") or 6), 26))
    end = date.fromisoformat(_week_arg(args.get("up_to_week_ending")))
    weeks = [(end - timedelta(days=7 * i)).isoformat() for i in range(n)][::-1]
    people = await _office_people(owner, include_left=True)
    rows: dict[str, dict] = {}
    office = {w: {"sign_ups": 0, "gold": 0, "silver": 0, "the_round": 0, "days_worked": 0, "people_in": 0} for w in weeks}
    async for b in db.bells_entries.find({"office_id": owner.get("office_id"), "week_ending": {"$in": weeks}},
                                         {"_id": 0, "user_id": 1, "user_name": 1, "week_ending": 1, "days": 1}):
        t = compute_totals(b, None)
        o = office[b["week_ending"]]
        o["sign_ups"] += t["total_sales"]
        o["gold"] += t["total_over30"]
        o["silver"] += t["total_under30"]
        o["the_round"] += t["total_memberships"]
        o["days_worked"] += t["days_worked"]
        o["people_in"] += 1 if t["days_worked"] else 0
        if not _sees(owner, b.get("user_id")):
            continue
        key = b.get("user_id") or (b.get("user_name") or "").strip().lower()
        u = people.get(str(b.get("user_id") or "")) or {}
        r = rows.setdefault(key, {"name": u.get("name") or b.get("user_name"),
                                  "still_active": bool(u) and not u.get("deleted") and u.get("is_active") is not False,
                                  "weeks": {}})
        r["weeks"][b["week_ending"]] = {"sign_ups": t["total_sales"], "gold": t["total_over30"],
                                        "the_round": t["total_memberships"], "days_worked": t["days_worked"],
                                        "piece_average": t["piece_average"], "reliability_pct": t["reliability_pct"]}
    for o in office.values():
        o["piece_average"] = round(o["sign_ups"] / o["days_worked"], 2) if o["days_worked"] else None
        o["gold_pct"] = round(100 * o["gold"] / o["sign_ups"]) if o["sign_ups"] else None
        o["round_pct"] = round(100 * o["the_round"] / o["sign_ups"]) if o["sign_ups"] else None
    people_rows = [r for r in rows.values() if any(w.get("days_worked") or w.get("sign_ups") for w in r["weeks"].values())]
    people_rows.sort(key=lambda r: (not r["still_active"], (r["name"] or "").lower()))
    return {"weeks": weeks, "office": office, "people": people_rows}


async def _find_person(owner: dict, name: str) -> str:
    name = (name or "").strip().lower()
    if not name:
        raise ValueError("Say whose page you want (a name).")
    people = await _office_people(owner, include_left=True)
    exact = [i for i, u in people.items() if (u.get("name") or "").strip().lower() == name]
    if len(exact) == 1:
        return exact[0]
    part = [i for i, u in people.items() if name in (u.get("name") or "").lower()]
    if len(part) == 1:
        return part[0]
    if not part:
        raise ValueError(f"Nobody in the office matches '{name}'.")
    raise ValueError("More than one person matches: " + ", ".join(sorted(people[i].get("name") or "" for i in part)))


async def tool_get_person(owner: dict, args: dict) -> dict:
    from routes.people import person_breakdown_for
    uid = await _find_person(owner, args.get("name"))
    page = await person_breakdown_for(owner, uid)
    focus = await db.cod_focus.find({"user_id": uid}, {"_id": 0}).sort("week_ending", -1).to_list(4)
    page["cod_focus_recent"] = focus
    return strip_private(page)


def _loa_summary(rows: list) -> dict:
    from core.person_breakdown import law_of_averages
    loa = law_of_averages(rows)
    return {"days_in_field": loa["active_days"], "totals": loa["totals"], "avg_per_day": loa["avg_per_day"],
            "conversion": {f'{s["from"]}→{s["to"]}': s["pct"] for s in loa["steps"]},
            "to_one_sign_up": loa["to_one_sale"]}


async def tool_get_field_numbers(owner: dict, args: dict) -> dict:
    """Doors / spoken to / pitched / closed / sign-ups from the breakdowns,
    per BA and for the office, against the Law of Averages."""
    from owneriq_sync import ID_LINKED
    if not args.get("from_date") and not args.get("to_date"):
        end = date.fromisoformat(last_full_week())
        start = end - timedelta(days=6)
    else:
        end = _date_arg(args.get("to_date"), today_uk())
        start = _date_arg(args.get("from_date"), end - timedelta(days=end.weekday()))
    if start > end:
        start, end = end, start
    if (end - start).days > 186:
        start = end - timedelta(days=186)
    everyone = await _office_people({**owner, "_visible": None}, include_left=True)
    people = {i: u for i, u in everyone.items() if _sees(owner, i)}
    rows = await db.owneriq_kpis.find(
        {"cg1_user_id": {"$in": list(everyone)}, "date": {"$gte": start.isoformat(), "$lte": end.isoformat()},
         "test_mode": {"$ne": True}, **ID_LINKED}, {"_id": 0}).to_list(50000)
    from core.bells_signups import bells_wins   # sign-ups from Bells (the Owner, 12 Nov 2026)
    rows = await bells_wins(rows, db)
    by_person: dict[str, list] = {}
    for r in rows:
        if str(r["cg1_user_id"]) not in people:
            continue
        by_person.setdefault(str(r["cg1_user_id"]), []).append(r)
    per = []
    for uid, rs in by_person.items():
        s = _loa_summary(rs)
        if s["days_in_field"]:
            per.append({"name": (people.get(uid) or {}).get("name"), **s})
    per.sort(key=lambda p: -(p["avg_per_day"].get("sales") or 0))
    return {
        "from": start.isoformat(), "to": end.isoformat(),
        "law_of_averages_target_per_day": {"doors": 120, "spoken_to": 70, "pitched": 25, "closed": 15, "sign_ups": "4+"},
        "note": "pitches_commenced = pitched, pitches_closed = closed, sales = sign-ups. Days under 10 doors, "
                "or with doors/spoken/pitched/closed all equal, are left out (the app's KPI rule).",
        "office": _loa_summary(rows),
        "people": per,
    }


async def tool_get_sectors(owner: dict, args: dict) -> dict:
    """Sectors for a day (or every day of a week): leader, goal, bunny hops,
    and each person's set-up and breakdown."""
    if args.get("week_ending"):
        sun = date.fromisoformat(_week_arg(args["week_ending"]))
        dates = [(sun - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    else:
        dates = [_date_arg(args.get("date"), today_uk()).isoformat()]
    office_id = owner.get("office_id")
    # Names for everyone in a sector they can see (teammates outside their team
    # show by name, without their set-up or breakdown).
    people = await _office_people({**owner, "_visible": None}, include_left=True)
    name = lambda i: (people.get(str(i)) or {}).get("name") or "?"  # noqa: E731
    days = {}
    async for sd in db.sector_days.find({"office_id": office_id, "date": {"$in": dates}}, {"_id": 0}):
        days[(sd.get("user_id"), sd.get("date"))] = sd
    out = []
    async for s in db.sectors.find({"office_id": office_id, "date": {"$in": dates}}, {"_id": 0}).sort([("date", 1), ("leader_name", 1)]):
        if not any(_sees(owner, i) for i in [s.get("leader_id")] + list(s.get("member_ids") or [])):
            continue
        hops = []
        for h in s.get("hops") or []:
            shadows = set(h.get("shadow_ids") or [])
            hops.append({"people": [name(m) for m in h.get("member_ids") or [] if m not in shadows],
                         "shadows": [name(m) for m in shadows]})
        members = []
        for m in s.get("member_ids") or []:
            d = (days.get((m, s["date"])) or {}) if _sees(owner, m) else {}
            members.append({"name": name(m),
                            "set_up": strip_private(d.get("setup")) if d.get("setup") else None,
                            "breakdown": strip_private(d.get("breakdown")) if d.get("breakdown") else None,
                            "cod_observed": strip_private(d.get("cod_observed")) if d.get("cod_observed") else None})
        out.append({"date": s["date"], "leader": s.get("leader_name") or name(s.get("leader_id")),
                    "postcode": s.get("postcode"), "goal": s.get("goal"), "hops": hops, "people": members})
    return {"dates": dates, "sectors": out}


async def tool_get_quality(owner: dict, args: dict) -> dict:
    """Acwyre's weekly quality report (Power BI), per BA, as uploaded."""
    from core.quality import TARGETS, LABELS
    q: dict = {"office_id": owner.get("office_id")}
    if args.get("week_ending"):
        q["week_ending"] = _week_arg(args["week_ending"])
    doc = await db.quality_weeks.find_one(q, {"_id": 0}, sort=[("week_ending", -1)])
    weeks = [d["week_ending"] async for d in db.quality_weeks.find(
        {"office_id": owner.get("office_id")}, {"_id": 0, "week_ending": 1}).sort("week_ending", -1).limit(12)]
    if not doc:
        return {"message": "No quality report uploaded for that week.", "weeks_available": weeks}
    people = await _office_people(owner, include_left=True)
    bas = [{"name": (people.get(str(b.get("user_id"))) or {}).get("name") or b.get("label"),
            "metrics": b.get("metrics")} for b in doc.get("bas") or []
           if b.get("user_id") and _sees(owner, b.get("user_id"))]   # unmatched batch numbers are left out
    return {"week_ending": doc["week_ending"], "measures": LABELS,
            "targets": {k: v["text"] for k, v in TARGETS.items()},
            "office_total": doc.get("total"), "bas": bas, "weeks_available": weeks}


async def tool_get_me(owner: dict, args: dict) -> dict:
    """Everything this link's person can see, in one go (as the in-app AI sees it)."""
    from core.ai_context import build_context
    from core.ai_actions import my_planner_boxes
    out = await build_context(owner)
    try:
        out["planner_boxes"] = [{"name": b["name"], "time": b["time"]} for b in await my_planner_boxes(owner)]
    except Exception:
        pass
    return out


# ── Writes (Claude asks the person before each one) ──────────────────────────

async def _person_id(owner: dict, name: Any) -> str:
    """A name → someone this link can see; blank = the link's own person."""
    if not str(name or "").strip():
        return str(owner["id"])
    return await _find_person(owner, str(name))


async def tool_set_weekly_goal(owner: dict, args: dict) -> dict:
    from core.ai_actions import set_weekly_goal
    return await set_weekly_goal(owner, args.get("goal"))


async def tool_save_setup(owner: dict, args: dict) -> dict:
    from core.ai_actions import save_setup
    who = await _person_id(owner, args.get("person"))
    return await save_setup(owner, who, args.get("date"), args)


async def tool_write_planner(owner: dict, args: dict) -> dict:
    from core.ai_actions import set_planner_box
    return await set_planner_box(owner, args.get("date"), args.get("box"), args.get("text"),
                                 append=args.get("replace") is not True)


async def tool_add_planner_note(owner: dict, args: dict) -> dict:
    from core.ai_actions import add_planner_note
    return await add_planner_note(owner, args.get("date"), args.get("title"), args.get("body"))


async def tool_set_bunny_hops(owner: dict, args: dict) -> dict:
    from core.ai_actions import set_hops
    leader = await _person_id(owner, args.get("sector_leader")) if args.get("sector_leader") else None
    return await set_hops(owner, args.get("date"), args.get("hops") or [], leader)


async def tool_get_coaching(owner: dict, args: dict) -> dict:
    """The office's own coaching material on a topic (the Coaching library)."""
    from routes.coaching_assistant import _retrieve_impacts
    topic = str(args.get("topic") or "").strip()
    if not topic:
        raise ValueError("Say what the coaching is about, e.g. 'closing' or 'getting more pitches'.")
    found = await _retrieve_impacts(owner, topic, k=6)
    if not found:
        return {"topic": topic, "message": "Nothing in the office's coaching library matches that yet.", "items": []}
    return {"topic": topic, "items": [{
        "title": d.get("title"), "stage": d.get("stage"),
        "summary": " ".join(str(d.get("summary") or "").split())[:800],
        "body": " ".join(str(d.get("body") or "").split())[:2500],
        "key_points": (d.get("key_takeaways") or [])[:8]} for d in found]}


# ── The office's Weekly Plan (Schedule → Plan: the agenda) ───────────────────
# The Owner, 15 Nov 2026: Claude can read and fill the Weekly Plan (themes,
# weekly stats and every row's topic / presenter / time, e.g. COD 3 = the
# Leaders Meeting). Admins only, as in the app. Publishing stays in the app.
_AGENDA_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat")


def _agenda_week(raw: Any) -> str:
    from routes.agenda import _coerce_to_sunday
    if str(raw or "").strip():
        wk = _coerce_to_sunday(str(raw).strip()[:10])
        if not wk:
            raise ValueError("week_ending must be a date (YYYY-MM-DD).")
        return wk
    today = datetime.now(APP_TZ).date()
    return (today + timedelta(days=(6 - today.weekday()) % 7)).isoformat()


def _agenda_admin(owner: dict) -> str:
    if owner.get("role") != "admin" or not owner.get("office_id"):
        raise ValueError("Only an Admin can see or change the office's Weekly Plan.")
    return owner["office_id"]


async def _last_week_frame(office_id: str, week: str) -> Optional[list]:
    """Last week's plan rows as a frame for a new week: same rows, order,
    presenters, times and merges, topics cleared (the Owner, 15 Nov 2026: a
    new week looks like the usual week, not just the timetable)."""
    from routes.agenda import _normalize_row
    prev_week = (date.fromisoformat(week) - timedelta(days=7)).isoformat()
    prev = await db.weekly_agendas.find_one({"office_id": office_id, "week_ending": prev_week}, {"_id": 0, "rows": 1})
    if not prev or not prev.get("rows"):
        return None
    import uuid
    rows = []
    for r in prev["rows"]:
        nr = _normalize_row(r)
        nr["id"] = str(uuid.uuid4())
        for c in nr["cells"]:
            c["topic"], c["cod"] = "", ""
        rows.append(nr)
    return rows


async def _agenda_load(office_id: str, week: str, rebuild: bool = False) -> tuple[Optional[dict], list]:
    from routes.agenda import (_build_seed_rows, follow_schedule, _normalize_row,
                               _normalize_themes, _normalize_stats)
    seed = await _build_seed_rows(office_id)
    doc = await db.weekly_agendas.find_one({"office_id": office_id, "week_ending": week}, {"_id": 0})
    if doc:
        doc["themes"] = _normalize_themes(doc.get("themes"))
        doc["stats"] = _normalize_stats(doc.get("stats"))
    frame = await _last_week_frame(office_id, week) if (rebuild or not doc) else None
    if frame is not None:
        # Carry anything already written this week into the frame.
        mine = {(r.get("label") or "").strip().lower(): r for r in (doc or {}).get("rows") or []}
        for r in frame:
            have = mine.pop((r.get("label") or "").strip().lower(), None)
            for c in (have or {}).get("cells") or []:
                if (c.get("topic") or "").strip():
                    tgt = next((x for x in r["cells"] if x["day"] == c.get("day")), None)
                    if tgt is not None:
                        tgt["topic"] = c["topic"]
                        tgt["presenter"] = c.get("presenter") or tgt.get("presenter") or ""
        rows = frame + [r for r in mine.values()
                        if any((c.get("topic") or "").strip() for c in r.get("cells") or [])]
    else:
        rows = list((doc or {}).get("rows") or [])
    rows = follow_schedule(rows, seed)
    return doc, [_normalize_row(r) for r in rows if isinstance(r, dict)]


def _agenda_day(raw: Any) -> int:
    t = str(raw if raw is not None else "").strip().lower()
    if t.isdigit() and int(t) in range(6):
        return int(t)
    for i, d in enumerate(_AGENDA_DAYS):
        if t.startswith(d.lower()):
            return i
    try:
        return date.fromisoformat(t[:10]).weekday()
    except ValueError:
        raise ValueError(f"'{raw}' isn't a day: use Mon–Sat or a date.")


def _agenda_row(rows: list, name: Any) -> dict:
    want = " ".join(str(name or "").lower().split())
    if not want:
        raise ValueError("Say which row, e.g. 'COD 3' or 'Primetime'.")
    exact = [r for r in rows if (r.get("label") or "").strip().lower() == want]
    found = exact or [r for r in rows if want in (r.get("label") or "").lower()]
    if len(found) != 1:
        names = ", ".join(r.get("label") or "" for r in rows)
        raise ValueError(f"No single row called '{name}'. Rows this week: {names}.")
    return found[0]


async def tool_get_weekly_plan(owner: dict, args: dict) -> dict:
    office_id = _agenda_admin(owner)
    week = _agenda_week(args.get("week_ending"))
    doc, rows = await _agenda_load(office_id, week)
    from routes.agenda import _normalize_themes, _normalize_stats
    return {
        "week_ending": week,
        "status": (doc or {}).get("status") or "not started",
        "stats": (doc or {}).get("stats") or _normalize_stats(None),
        "themes": (doc or {}).get("themes") or _normalize_themes(None),
        "rows": [{"row": r.get("label"), "time": r.get("time_label") or "",
                  "days": [{"day": _AGENDA_DAYS[c["day"]], "topic": c.get("topic") or "",
                            "presenter": c.get("presenter") or "", "time": c.get("time") or "",
                            **({"run": c["run"]} if c.get("run") else {})}
                           for c in r.get("cells") or []
                           if c.get("topic") or c.get("presenter") or c.get("time")]}
                 for r in rows],
    }


async def tool_update_weekly_plan(owner: dict, args: dict) -> dict:
    from routes.agenda import save_agenda_doc, _normalize_themes, _normalize_stats, DEFAULT_THEMES, DEFAULT_STATS
    office_id = _agenda_admin(owner)
    if owner.get("is_demo"):
        raise ValueError("This account can only look, not change things.")
    week = _agenda_week(args.get("week_ending"))
    doc, rows = await _agenda_load(office_id, week, rebuild=args.get("rebuild_from_last_week") is True)
    themes = dict((doc or {}).get("themes") or _normalize_themes(None))
    stats = dict((doc or {}).get("stats") or _normalize_stats(None))
    for k, v in (args.get("themes") or {}).items():
        if k not in DEFAULT_THEMES:
            raise ValueError(f"Unknown theme '{k}'. Themes: {', '.join(DEFAULT_THEMES)}.")
        themes[k] = str(v or "")
    for k, v in (args.get("stats") or {}).items():
        if k not in DEFAULT_STATS:
            raise ValueError(f"Unknown stat '{k}'. Stats: {', '.join(DEFAULT_STATS)}.")
        stats[k] = str(v if v is not None else "")
    changed = []
    frame: Optional[list] = None
    for c in args.get("cells") or []:
        try:
            row = _agenda_row(rows, c.get("row"))
        except ValueError:
            # A row from last week's layout that this week doesn't have yet
            # comes back with last week's presenters and times (topics clear).
            if frame is None:
                frame = await _last_week_frame(office_id, week) or []
            row = _agenda_row(frame, c.get("row"))
            order = [(r.get("label") or "").lower() for r in frame]
            pos = order.index((row.get("label") or "").lower())
            later = {lbl for lbl in order[pos + 1:]}
            at = next((i for i, r in enumerate(rows) if (r.get("label") or "").lower() in later), len(rows))
            rows.insert(at, row)
        day = _agenda_day(c.get("day"))
        cell = next(x for x in row["cells"] if x["day"] == day)
        for key in ("topic", "presenter", "time", "run"):
            if key in c and c[key] is not None:
                cell[key] = str(c[key]).strip()
        changed.append(f"{row.get('label')} {_AGENDA_DAYS[day]}")
    saved = await save_agenda_doc(owner, office_id, week, rows, _normalize_themes(themes), _normalize_stats(stats))
    return {"week_ending": week, "saved": True, "status": saved.get("status"), "cells_changed": changed,
            "note": "Saved as a draft. Publish it from Schedule → Plan when it's ready."}


def _box_names() -> str:
    from core.ai_actions import planner_boxes
    return ", ".join(planner_boxes().values())


# ── Every part of the app (Admins; the Owner, 16 Nov 2026) ─────────────────

async def tool_list_areas(owner: dict, args: dict) -> dict:
    from core.connector_data import list_areas
    return await list_areas(owner)


async def tool_read_data(owner: dict, args: dict) -> dict:
    from core.connector_data import read_data
    return await read_data(owner, args)


async def tool_change_data(owner: dict, args: dict) -> dict:
    from core.connector_data import change_data
    return await change_data(owner, args)


async def tool_confirm_change(owner: dict, args: dict) -> dict:
    from core.connector_data import confirm_change
    return await confirm_change(owner, args)


async def tool_undo_change(owner: dict, args: dict) -> dict:
    from core.connector_data import undo_change
    return await undo_change(owner, args)


async def tool_recent_changes(owner: dict, args: dict) -> dict:
    from core.connector_data import recent_changes
    return await recent_changes(owner, args)


WRITE_TOOLS = {"set_weekly_goal", "save_setup", "write_planner", "add_planner_note", "set_bunny_hops",
               "update_weekly_plan", "confirm_change", "undo_change"}
ADMIN_TOOLS = {"list_areas", "read_data", "change_data", "confirm_change", "undo_change", "recent_changes"}


TOOLS: dict[str, tuple] = {
    "get_team": (tool_get_team,
                 "Everyone currently in the office: name, role (BA / Coach / Admin), team, coach, stage, "
                 "start date and new-start day. Start here to learn who's who.",
                 {}),
    "get_bells_week": (tool_get_bells_week,
                       "The Bells sheet for one week (Monday–Saturday, named by its Sunday): each person's daily "
                       "status and Gold/Silver/The Round sign-ups, weekly goal, last week, traffic light, piece "
                       "average, scoring and reliability, plus office totals. Defaults to the last finished week.",
                       {"week_ending": {"type": "string", "description": "Any date in the week (YYYY-MM-DD). Optional."}}),
    "get_recent_weeks": (tool_get_recent_weeks,
                         "Each person's and the office's weekly sign-ups, Gold, The Round, days worked, piece "
                         "average and reliability over the last N weeks, for spotting trends.",
                         {"weeks": {"type": "integer", "description": "How many weeks (1–26). Default 6."},
                          "up_to_week_ending": {"type": "string", "description": "Last week to include (YYYY-MM-DD). "
                                                "Default: the last finished week."}}),
    "get_person": (tool_get_person,
                   "One person's full page: coach, stage, team size, recent weeks, their law of averages "
                   "(this week and the last 28 days, beside the office average), COD position and Days 1–8 "
                   "assessments, and recent weekly COD focus.",
                   {"name": {"type": "string", "description": "The person's name (or part of it)."}}),
    "get_field_numbers": (tool_get_field_numbers,
                          "Doors, spoken to, pitched, closed and sign-ups from the daily breakdowns, per BA and "
                          "for the office, with conversion at each step and the Law of Averages targets. "
                          "Defaults to the last finished week.",
                          {"from_date": {"type": "string", "description": "YYYY-MM-DD. Optional."},
                           "to_date": {"type": "string", "description": "YYYY-MM-DD. Optional."}}),
    "get_sectors": (tool_get_sectors,
                    "Sectors for a day or a whole week: sector leader, postcode, goal, bunny hops and shadows, "
                    "and each person's set-up (goal, focus) and breakdown (numbers, proud of, will change).",
                    {"date": {"type": "string", "description": "One day (YYYY-MM-DD). Default today."},
                     "week_ending": {"type": "string", "description": "Any date in a week, for every day of it."}}),
    "get_quality": (tool_get_quality,
                    "Acwyre's weekly quality report per BA (order value, drop days, The Round %, 4th week %, "
                    "fails) against the Owner's targets. Defaults to the latest uploaded week.",
                    {"week_ending": {"type": "string", "description": "YYYY-MM-DD. Optional."}}),
    "get_coaching": (tool_get_coaching,
                     "The office's own coaching material on a topic, from the Hub's Coaching library (e.g. "
                     "'closing', 'hooklines', 'getting more pitches', 'objections'). Use it before giving sales "
                     "advice so the advice carries the office's own coaching and terms.",
                     {"topic": {"type": "string", "description": "What the coaching is about."}}),
    "get_me": (tool_get_me,
               "Everything about the person this connector belongs to, in one go: their weeks, the office's "
               "weeks to compare with, their page, recent set-ups and breakdowns, this week's planner, their "
               "team's weeks and the latest quality. Start here when they ask about themselves or their plan.",
               {}),
    "set_weekly_goal": (tool_set_weekly_goal,
                        "CHANGES THE APP. Sets the person's own weekly goal (sign-ups) on Bells for this week.",
                        {"goal": {"type": "integer", "description": "Sign-ups for the week."}}),
    "save_setup": (tool_save_setup,
                   "CHANGES THE APP. Fills in a sector set-up for a day: sign-ups goal, focus, KPI (doors, spoken, "
                   "pitched or closes) and its target, and a positive to keep doing. Their own, or "
                   "someone else's if they lead that sector or coach them. Keeps their COD pick.",
                   {"date": {"type": "string", "description": "YYYY-MM-DD. Default today."},
                    "person": {"type": "string", "description": "Whose set-up (a name). Blank = their own."},
                    "goal": {"type": "integer"}, "focus": {"type": "string"},
                    "kpi_metric": {"type": "string", "enum": ["doors", "spoken", "pitched", "closes"]},
                    "kpi_target": {"type": "integer"}, "positive": {"type": "string"}}),
    "write_planner": (tool_write_planner,
                      "CHANGES THE APP. Writes into one box of a day (Monday–Saturday) in the person's own weekly "
                      "planner. Adds to what's there unless replace is true (replace with empty text clears the box).",
                      {"date": {"type": "string", "description": "YYYY-MM-DD."},
                       "box": {"type": "string", "description": "One of the planner's boxes (see instructions)."},
                       "text": {"type": "string"},
                       "replace": {"type": "boolean", "description": "Replace the box instead of adding. Default false."}}),
    "get_weekly_plan": (tool_get_weekly_plan,
                        "The office's Weekly Plan (Schedule → Plan, Admins only) for a week: status, weekly stats "
                        "(weekly_goal, promotions, personal_recruits), themes, and each row (e.g. COD 3 = the Leaders "
                        "Meeting, Primetime, Morning Meeting) with each day's topic, presenter and time. Default: "
                        "this week (on a Sunday, the week ending that day).",
                        {"week_ending": {"type": "string", "description": "Any date in the week (YYYY-MM-DD). Optional."}}),
    "update_weekly_plan": (tool_update_weekly_plan,
                           "CHANGES THE APP. Fills in the office's Weekly Plan for a week (Admins only): any theme "
                           "or stat, and any row's topic / presenter / time for a day. Only what you send changes; "
                           "it saves as a draft and the Admin publishes it in the app. Rows by their name "
                           "(get_weekly_plan lists them), days as Mon–Sat. A topic is the short name shown on "
                           "the plan (a few words, e.g. 'A leader owns the numbers'), never the full run-through: "
                           "put the detail in the person's planner (write_planner). A new week starts from last "
                           "week's rows and presenters with the topics cleared.",
                           {"week_ending": {"type": "string", "description": "Any date in the week (YYYY-MM-DD)."},
                            "themes": {"type": "object", "description": "Theme name → text, e.g. "
                                       "{\"leaders\": \"What is a leader\"}. Names: expectations_1, expectations_2, "
                                       "leaders, topic_theme, customer_service_theme, competition, concentration, news, social."},
                            "stats": {"type": "object", "description": "weekly_goal, promotions, personal_recruits."},
                            "rebuild_from_last_week": {"type": "boolean", "description": "Lay the week out like "
                                                       "last week again (rows, presenters, times), keeping the "
                                                       "topics already written. Default false."},
                            "cells": {"type": "array", "description": "Row/day cells to set.",
                                      "items": {"type": "object", "properties": {
                                          "row": {"type": "string"}, "day": {"type": "string"},
                                          "topic": {"type": "string"}, "presenter": {"type": "string"},
                                          "time": {"type": "string"},
                                          "run": {"type": "string", "description": "The topic's run-through, opened with "
                                                  "Run it (see RUN_SHEET_FORMAT in the instructions)."}},
                                                "required": ["row", "day"]}}}),
    "add_planner_note": (tool_add_planner_note,
                         "CHANGES THE APP. Adds a note to a day's Notes box in the person's own planner.",
                         {"date": {"type": "string", "description": "YYYY-MM-DD. Default today."},
                          "title": {"type": "string"}, "body": {"type": "string"}}),
    "set_bunny_hops": (tool_set_bunny_hops,
                       "CHANGES THE APP. Sets the bunny hops for a sector the person leads (an Admin: any sector, "
                       "by its leader's name). Only people already in that sector; shadows are kept.",
                       {"date": {"type": "string", "description": "YYYY-MM-DD. Default today."},
                        "hops": {"type": "array", "items": {"type": "array", "items": {"type": "string"}},
                                 "description": "Each hop is a list of names, e.g. [[\"A\", \"B\"], [\"C\"]]."},
                        "sector_leader": {"type": "string", "description": "Admins only: whose sector. Blank = their own."}}),
}

_ANY_PROPS = {"type": "object", "description": "Field → value, as read_data shows them.",
              "additionalProperties": True}

TOOLS.update({
    "list_areas": (tool_list_areas,
                   "ADMINS. Every part of the app Claude can open (each collection): what it is, how many records "
                   "your office has, and its fields. E.g. monthly_planners = the monthly goal planner, "
                   "ai_conversations = people's AI chats, academy_workbooks, folder_notes, meetup_plans. Use it "
                   "when no other tool covers what's asked.",
                   {}),
    "read_data": (tool_read_data,
                  "ADMINS. Reads records from any area (from list_areas), kept to the office. match is a filter "
                  "on fields, e.g. {\"user_id\": \"<id from get_team>\", \"month\": \"2026-11\"} or "
                  "{\"week_ending\": {\"$gte\": \"2026-10-01\"}}; _doc_id picks one record. People's ids come "
                  "back with names beside them (field__name). Never includes emails, phone numbers or passwords.",
                  {"area": {"type": "string"},
                   "match": {"type": "object", "additionalProperties": True},
                   "fields": {"type": "array", "items": {"type": "string"},
                              "description": "Only these fields. Optional."},
                   "sort": {"type": "string", "description": "A field; '-' first for newest/highest first. "
                            "Default -_id (newest added)."},
                   "limit": {"type": "integer", "description": "1–200. Default 20."},
                   "skip": {"type": "integer"}}),
    "change_data": (tool_change_data,
                    "ADMINS. Prepares a change to any area: update (set / unset fields on the records match picks), "
                    "add (new records) or delete. NOTHING CHANGES HERE: it returns exactly what would change and a "
                    "confirm_code. Show the person that, get a clear yes, then call confirm_change. Up to 50 "
                    "records; read them with read_data first. Dotted fields reach inside, e.g. "
                    "\"days.2.status\". Who someone is and how they sign in (email, phone, password, office) "
                    "can't be changed.",
                    {"area": {"type": "string"},
                     "action": {"type": "string", "enum": ["update", "add", "delete"]},
                     "match": {"type": "object", "additionalProperties": True},
                     "set": _ANY_PROPS,
                     "unset": {"type": "array", "items": {"type": "string"}},
                     "record": _ANY_PROPS,
                     "records": {"type": "array", "items": _ANY_PROPS},
                     "why": {"type": "string", "description": "One line on what this is for (kept in the log)."}}),
    "confirm_change": (tool_confirm_change,
                       "CHANGES THE APP. Makes a change prepared by change_data, only after the person has said "
                       "yes to exactly what it showed. Returns a change_id for undo_change.",
                       {"confirm_code": {"type": "string"}}),
    "undo_change": (tool_undo_change,
                    "CHANGES THE APP. Puts a confirmed change back exactly as it was (ask first).",
                    {"change_id": {"type": "string"}}),
    "recent_changes": (tool_recent_changes,
                       "ADMINS. The last 20 changes made through Claude: when, by whom, what, and whether undone.",
                       {}),
})

INSTRUCTIONS = (
    f"{APP_NAME}, the field app for a UK Modern Milkman door-to-door sales office. "
    "Self-employed Brand Ambassadors (BAs) sign up customers; Coaches develop them. Gold = a sign-up with a £10+ "
    "repeat weekly order, Silver = £5–£9.99, The Round = Modern Milkman's membership add-on. Standards: weekly "
    "traffic light Red under 8, Amber 8–14, Green 15–19, Super Green 20+; Gold 90%+; The Round 75%+; under 1.8 "
    "sign-ups a day on average over the last 3 days in needs retraining. Law of Averages per day: 120 doors, 70 "
    "spoken to, 25 pitched, 15 closed, 4+ sign-ups. Weeks run Monday–Saturday and are named by their Sunday. Use "
    "self-employed language (no 'staff', 'employees', 'manager', 'hire'), British English. "
    "This connector belongs to one person and sees what they can see in the app (get_me first). Tools marked "
    "CHANGES THE APP write to it as that person: before each one, show them exactly what you'll write and get a "
    "clear yes. On an Admin's link Claude can open every part of the app: list_areas, then read_data; to "
    "change anything there, change_data (shows the change, changes nothing), the person's yes, then "
    "confirm_change. Never call confirm_change without that yes. Prefer the named tools when one fits. "
    "Planner boxes: "
)


RUN_SHEET_FORMAT = (
    "RUN_SHEET_FORMAT (a meeting's run-through, opened full screen with Run it, card by card). Write it as "
    "plain lines: '# Title', '> subtitle (theme · minutes)', then one card per part with '## Part · N min' "
    "(e.g. Opener, Teach, Activity, Close; for a leaders' meeting Opener, Standard, Why it helps, What's in it "
    "for them, CoD, Activity). Inside a card: plain lines, '- bullets', 'Say: words to read out', 'Ask: a "
    "question for the room', 'Steer to: the answer to land on', 'VIDEO: title | url' (no url = a YouTube "
    "search; never invent a link), 'TIMER: seconds', and diagrams: 'DIAGRAM: flow: A > B > C', "
    "'DIAGRAM: funnel: Doors 120 > Spoken 70 > ...', 'DIAGRAM: pyramid: top > ... > base', 'DIAGRAM: cycle: A > B > C', "
    "'DIAGRAM: compare: Head 1 | Head 2 ; row a | row b', 'DIAGRAM: quadrant: x low | x high ; tl | tr | bl | br'. "
    "Timings add up to the slot (a 30-minute morning meeting's topic is about 20). Put the run-through in the "
    "planner box (write_planner, the person's own box name) and in the Weekly Plan cell's run; the plan cell's "
    "topic stays a short name.\n\n"
)


def instructions() -> str:
    from core.sales_coaching import BIG_COACH, PLAYBOOK, RESPONSE_STYLE
    return (INSTRUCTIONS + _box_names() + ". A person may have renamed their boxes: write_planner takes their own "
            "names (get_me lists them as planner_boxes), and an unknown name lists them.\n\n" + RUN_SHEET_FORMAT +
            "When they ask for sales or coaching advice, coach to make them better, not just to inform: read their "
            "numbers (get_me or get_person) and breakdowns, pull the office's coaching with get_coaching, and "
            "answer in this shape. Measure against what good looks like, not the office average.\n\n"
            + BIG_COACH + "\n" + RESPONSE_STYLE + "\n" + PLAYBOOK)


def _schema(props: dict) -> dict:
    return {"type": "object", "properties": props, "additionalProperties": False}


def _is_admin(viewer: Optional[dict]) -> bool:
    return viewer is None or bool(viewer.get("is_super_admin")) or (viewer.get("role") or "").lower() == "admin"


def tools_list(viewer: Optional[dict] = None) -> list[dict]:
    """Every tool; the every-part-of-the-app ones only on an Admin's link."""
    admin = _is_admin(viewer)
    return [{"name": n, "description": d, "inputSchema": _schema(p),
             "annotations": ({"readOnlyHint": False, "destructiveHint": n in ("confirm_change", "undo_change"),
                              "idempotentHint": False, "openWorldHint": False} if n in WRITE_TOOLS
                             else {"readOnlyHint": True, "openWorldHint": False})}
            for n, (_f, d, p) in TOOLS.items() if admin or n not in ADMIN_TOOLS]


async def handle(msg: dict, viewer: Optional[dict] = None) -> Optional[dict]:
    """One JSON-RPC message → its reply (None for a notification)."""
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if mid is None:
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, text):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}

    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok({"protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                   "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": {"name": APP_NAME, "version": SERVER_VERSION},
                   "instructions": instructions()})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": tools_list(viewer)})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return err(-32602, f"Unknown tool: {name}")
        try:
            owner = await scoped(viewer or await owner_view())
            result = await TOOLS[name][0](owner, params.get("arguments") or {})
            text = json.dumps(strip_private(result), ensure_ascii=False, default=str)
            return ok({"content": [{"type": "text", "text": text}], "isError": False})
        except (ValueError, HTTPException) as ex:
            detail = getattr(ex, "detail", None) or str(ex)
            return ok({"content": [{"type": "text", "text": str(detail)}], "isError": True})
        except Exception:
            logger.exception("claude connector: %s failed", name)
            return ok({"content": [{"type": "text", "text": "That didn't work on the app's side. Try again shortly."}],
                       "isError": True})
    if method in ("resources/list", "prompts/list"):
        return ok({method.split("/")[0]: []})
    return err(-32601, f"Method not found: {method}")


@router.post("/mcp/{token}")
async def mcp_post(token: str, request: Request):
    viewer = await _check_token(token, request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
                            status_code=400)
    if isinstance(body, list):
        replies = [r for r in [await handle(m, viewer) for m in body if isinstance(m, dict)] if r]
        return JSONResponse(replies) if replies else Response(status_code=202)
    if not isinstance(body, dict):
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}},
                            status_code=400)
    reply = await handle(body, viewer)
    return JSONResponse(reply) if reply else Response(status_code=202)


@router.get("/mcp/{token}")
async def mcp_get(token: str, request: Request):
    """No server-sent stream here: every reply comes back on the POST."""
    await _check_token(token, request)
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp/{token}")
async def mcp_delete(token: str, request: Request):
    await _check_token(token, request)
    return Response(status_code=405, headers={"Allow": "POST"})
