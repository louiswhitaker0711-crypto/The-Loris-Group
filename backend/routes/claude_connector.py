"""Claude connector: a read-only window on the office for the Owner's Claude.

The Owner adds this once in claude.ai as a custom connector, and then any chat
with Claude can read the team's numbers (Bells, breakdowns, field numbers,
sectors, quality, COD) to help plan the week. Agreed with the Owner, 25 Oct
2026: read-only, everything sales-related, no contact details.

  POST /mcp/{token}     the connector (MCP over HTTP, JSON replies)

The secret in the address is the only gate, the same model as the other
secret links (routes/roster_share.py). Off until CLAUDE_CONNECTOR_TOKEN is set
to a long random string (32+ characters); unset, it 404s. Wrong secrets are
rate-limited per caller IP.

Read only: nothing here writes to the database, sends anything or asks
OwnerIQ. Every tool reads as the office's Owner (the super-admin) would see
the app, then drops personal details: emails, phone numbers, photos, badge
numbers and passwords never leave.
"""
from __future__ import annotations

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
    "in": "In", "off": "Off", "ab": "Not scheduled", "ns": "No show", "rt": "Retrain",
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


def _check_token(token: str, request: Request) -> None:
    expected = _token()
    if not expected:
        raise HTTPException(status_code=404, detail="Not found")
    key = client_ip(request)
    _TOKEN_FAILURES.check(key)
    if not token or not secrets.compare_digest(token.encode(), expected.encode()):
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
    return {str(u["_id"]): u async for u in db.users.find(q, {"name": 1, "role": 1, "reports_to": 1})}


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
            "name": p["name"], "role": p["role_label"], "team": p["team"] or None, "coach": p["coach"] or None,
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
                   if e.get("user_active", True) or (e.get("total_sales") or 0) > 0 or e.get("left_on")],
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
        key = b.get("user_id") or (b.get("user_name") or "").strip().lower()
        u = people.get(str(b.get("user_id") or "")) or {}
        r = rows.setdefault(key, {"name": u.get("name") or b.get("user_name"),
                                  "still_active": bool(u) and not u.get("deleted") and u.get("is_active") is not False,
                                  "weeks": {}})
        r["weeks"][b["week_ending"]] = {"sign_ups": t["total_sales"], "gold": t["total_over30"],
                                        "the_round": t["total_memberships"], "days_worked": t["days_worked"],
                                        "piece_average": t["piece_average"], "reliability_pct": t["reliability_pct"]}
        o = office[b["week_ending"]]
        o["sign_ups"] += t["total_sales"]
        o["gold"] += t["total_over30"]
        o["silver"] += t["total_under30"]
        o["the_round"] += t["total_memberships"]
        o["days_worked"] += t["days_worked"]
        o["people_in"] += 1 if t["days_worked"] else 0
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
    people = await _office_people(owner, include_left=True)
    rows = await db.owneriq_kpis.find(
        {"cg1_user_id": {"$in": list(people)}, "date": {"$gte": start.isoformat(), "$lte": end.isoformat()},
         "test_mode": {"$ne": True}, **ID_LINKED}, {"_id": 0}).to_list(50000)
    by_person: dict[str, list] = {}
    for r in rows:
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
    people = await _office_people(owner, include_left=True)
    name = lambda i: (people.get(str(i)) or {}).get("name") or "?"  # noqa: E731
    days = {}
    async for sd in db.sector_days.find({"office_id": office_id, "date": {"$in": dates}}, {"_id": 0}):
        days[(sd.get("user_id"), sd.get("date"))] = sd
    out = []
    async for s in db.sectors.find({"office_id": office_id, "date": {"$in": dates}}, {"_id": 0}).sort([("date", 1), ("leader_name", 1)]):
        hops = []
        for h in s.get("hops") or []:
            shadows = set(h.get("shadow_ids") or [])
            hops.append({"people": [name(m) for m in h.get("member_ids") or [] if m not in shadows],
                         "shadows": [name(m) for m in shadows]})
        members = []
        for m in s.get("member_ids") or []:
            d = days.get((m, s["date"])) or {}
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
            "metrics": b.get("metrics")} for b in doc.get("bas") or []]
    return {"week_ending": doc["week_ending"], "measures": LABELS,
            "targets": {k: v["text"] for k, v in TARGETS.items()},
            "office_total": doc.get("total"), "bas": bas, "weeks_available": weeks}


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
}

INSTRUCTIONS = (
    f"Read-only view of {APP_NAME}, the Owner's field app for a UK Modern Milkman door-to-door sales office. "
    "Self-employed Brand Ambassadors (BAs) sign up customers; Coaches develop them. Gold = a sign-up with a £10+ "
    "repeat weekly order, Silver = £5–£9.99, The Round = Modern Milkman's membership add-on. Standards: weekly "
    "traffic light Red under 8, Amber 8–14, Green 15–19, Super Green 20+; Gold 90%+; The Round 75%+; under 2 "
    "sign-ups a day on average needs retraining. Law of Averages per day: 120 doors, 70 spoken to, 25 pitched, "
    "15 closed, 4+ sign-ups. Weeks run Monday–Saturday and are named by their Sunday. Use self-employed language "
    "(no 'staff', 'employees', 'manager', 'hire'), British English. Nothing here can change the app."
)


def _schema(props: dict) -> dict:
    return {"type": "object", "properties": props, "additionalProperties": False}


def tools_list() -> list[dict]:
    return [{"name": n, "description": d, "inputSchema": _schema(p),
             "annotations": {"readOnlyHint": True, "openWorldHint": False}}
            for n, (_f, d, p) in TOOLS.items()]


async def handle(msg: dict) -> Optional[dict]:
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
                   "serverInfo": {"name": f"{APP_NAME} (read-only)", "version": SERVER_VERSION},
                   "instructions": INSTRUCTIONS})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": tools_list()})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return err(-32602, f"Unknown tool: {name}")
        try:
            owner = await owner_view()
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
    _check_token(token, request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
                            status_code=400)
    if isinstance(body, list):
        replies = [r for r in [await handle(m) for m in body if isinstance(m, dict)] if r]
        return JSONResponse(replies) if replies else Response(status_code=202)
    if not isinstance(body, dict):
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}},
                            status_code=400)
    reply = await handle(body)
    return JSONResponse(reply) if reply else Response(status_code=202)


@router.get("/mcp/{token}")
async def mcp_get(token: str, request: Request):
    """No server-sent stream here: every reply comes back on the POST."""
    _check_token(token, request)
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp/{token}")
async def mcp_delete(token: str, request: Request):
    _check_token(token, request)
    return Response(status_code=405, headers={"Allow": "POST"})
