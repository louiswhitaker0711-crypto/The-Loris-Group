"""Sector set-up and breakdown (the Owner's WhatsApp format, Oct 2026).

Set-up (morning / sector):        Breakdown (end of day):
    *Riz*                             *Riz*
    Goal: 4                           82/57/20/17 (phone died)
    KPI: 20 closes                    Goal: 3 hit: 1
                                      Proud of: shorten my pitch
    Focus: KISS                       Change: SEE

The breakdown's doors / spoken / pitched / closed come from OwnerIQ for that
day and "hit" from Bells (or OwnerIQ), so a Coach only adds the words. The
next day's set-up is prompted from the breakdown: the focus suggestion is
yesterday's "Change" (a suggestion, never filled in), and the KPI suggestion is the step furthest behind the
Law of Averages. Each person can be sent their own set-up as a push.

Collection `sector_days`, one per (user_id, date):
    {office_id, user_id, user_name, date,
     setup: {goal, kpi_metric, kpi_target, focus, by_id, at},
     breakdown: {doors, spoken, pitched, closed, note, goal, hit, proud, change, by_id, at}}
Coaches edit their team (and themselves), Admins the office; a BA can fill in
their own.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date as Date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, get_subtree_ids
from core.app_time import APP_TZ
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

# The Owner's Law of Averages for a day.
LOA = {"doors": 120, "spoken": 70, "pitched": 25, "closes": 15}
KPI_METRICS = {"doors": "doors", "spoken": "spoken", "pitched": "pitched", "closes": "closes", "callbacks": "call backs"}
PROUD_OPTIONS = [
    "Good intro", "S.E.E.", "Tone of voice", "Body language", "Being confident", "Shorter pitch",
    "Hooklines", "Handling objections", "Closing effectively", "Rehash", "Creating the order",
    "Work ethic", "Speaking to more people", "Taking control",
]
CHANGE_OPTIONS = [
    "Speak to more people", "S.E.E.", "Tone of voice", "Body language", "K.I.S.S.", "Building trust",
    "Hooklines", "Handling objections", "Closing", "Timing the close", "Rehash", "Not wasting time",
    "Qualifying early", "Call backs", "Intro",
]
MAX_TEXT = 160


def today_iso() -> str:
    return datetime.now(APP_TZ).date().isoformat()


def _clean_date(v: Optional[str]) -> str:
    try:
        return Date.fromisoformat(str(v or today_iso())[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")


def _int(v, lo=0, hi=999) -> Optional[int]:
    if v in (None, ""):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Numbers only, please")
    if not lo <= n <= hi:
        raise HTTPException(status_code=400, detail=f"Keep numbers between {lo} and {hi}")
    return n


def _text(v) -> str:
    return " ".join(str(v or "").split())[:MAX_TEXT]


def clean_setup(body: dict) -> dict:
    metric = str(body.get("kpi_metric") or "").strip().lower()
    if metric and metric not in KPI_METRICS:
        raise HTTPException(status_code=400, detail="Pick the KPI: doors, spoken, pitched, closes or call backs")
    return {"goal": _int(body.get("goal"), 0, 30), "kpi_metric": metric or None,
            "kpi_target": _int(body.get("kpi_target"), 0, 300), "focus": _text(body.get("focus")),
            "positive": _text(body.get("positive"))}


def clean_breakdown(body: dict) -> dict:
    return {"doors": _int(body.get("doors")), "spoken": _int(body.get("spoken")),
            "pitched": _int(body.get("pitched")), "closed": _int(body.get("closed")),
            "note": _text(body.get("note")), "goal": _int(body.get("goal"), 0, 30),
            "hit": _int(body.get("hit"), 0, 30), "proud": _text(body.get("proud")),
            "change": _text(body.get("change"))}


def kpi_text(setup: dict) -> str:
    m, t = setup.get("kpi_metric"), setup.get("kpi_target")
    if not m:
        return ""
    return f"{t} {KPI_METRICS[m]}" if t is not None else KPI_METRICS[m]


def suggest_kpi(bd: Optional[dict]) -> Optional[dict]:
    """The step furthest behind the Law of Averages in a breakdown."""
    if not bd:
        return None
    vals = {"doors": bd.get("doors"), "spoken": bd.get("spoken"), "pitched": bd.get("pitched"), "closes": bd.get("closed")}
    scored = [(v / LOA[k], k) for k, v in vals.items() if isinstance(v, int)]
    if not scored:
        return None
    ratio, metric = min(scored)
    if ratio >= 1:
        return None
    return {"kpi_metric": metric, "kpi_target": LOA[metric]}


def _first(name: str) -> str:
    return (name or "").strip().split(" ")[0] or "Someone"


def _label(iso: str) -> str:
    """'Tue 13 Oct': written out, so it can't be read as goal/hit ('12/10')."""
    d = Date.fromisoformat(iso)
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"


def clean_postcode(v) -> str:
    """A postcode or district as typed ('ls6 1ab' → 'LS6 1AB'), letters,
    digits and spaces only."""
    return " ".join("".join(ch for ch in str(v or "").upper() if ch.isalnum() or ch == " ").split())[:10]


def sector_stats(rows: list, sector_goal: Optional[int] = None) -> dict:
    """From the people with a breakdown: sign-ups, goal, PA (sign-ups per
    person in) and scoring (% of people in with at least one sign-up)."""
    inn = [r.get("breakdown") or {} for r in rows
           if any((r.get("breakdown") or {}).get(k) is not None for k in ("doors", "spoken", "pitched", "closed", "hit"))]
    hits = [int(b.get("hit") or 0) for b in inn]
    goals = [b.get("goal") for b in inn if b.get("goal") is not None]
    hit = sum(hits)
    goal = sector_goal if sector_goal is not None else (sum(goals) if goals else None)
    n = len(inn)
    return {"in": n, "hit": hit, "goal": goal,
            "pa": round(hit / n, 1) if n else None,
            "scoring": round(100 * sum(1 for h in hits if h > 0) / n) if n else None}


def setup_text(rows: list, iso: str, sector_goal: Optional[int] = None, postcode: str = "") -> str:
    out = [f"*SetUp* {_label(iso)}"]
    if postcode:
        out.append(f"Postcode: {postcode}")
    if sector_goal is not None:
        out.append(f"Sector goal: {sector_goal}")
    for r in rows:
        s = r.get("setup") or {}
        if not any([s.get("goal") is not None, s.get("kpi_metric"), s.get("focus")]):
            continue
        out += ["", f"*{_first(r.get('user_name'))}*"]
        if s.get("goal") is not None:
            out.append(f"Goal: {s['goal']}")
        if s.get("kpi_metric"):
            out.append(f"KPI: {kpi_text(s)}")
        if s.get("focus"):
            out += ["", f"Focus: {s['focus']}"]
    return "\n".join(out)


def breakdown_text(rows: list, iso: str, sector_goal: Optional[int] = None, postcode: str = "") -> str:
    out = [f"*Breakdown* {_label(iso)}"]
    if postcode:
        out.append(f"Postcode: {postcode}")
    st = sector_stats(rows, sector_goal)
    if st["in"]:
        g, h = st["goal"], st["hit"]
        out.append(f"Sector goal: {g} hit: {h}{'🔥' if h >= g and h > 0 else ''}" if g is not None else f"Sector sign-ups: {h}")
        out.append(f"PA: {st['pa']} · Scoring: {st['scoring']}%")
    for r in rows:
        b = r.get("breakdown") or {}
        nums = [b.get(k) for k in ("doors", "spoken", "pitched", "closed")]
        if not any(v is not None for v in nums) and b.get("hit") is None and not b.get("proud") and not b.get("change"):
            continue
        out += ["", f"*{_first(r.get('user_name'))}*"]
        if any(v is not None for v in nums):
            line = "/".join("-" if v is None else str(v) for v in nums)
            if b.get("note"):
                line += f" ({b['note']})"
            out.append(line)
        goal, hit = b.get("goal"), b.get("hit")
        if goal is not None or hit is not None:
            fire = "🔥" if goal is not None and hit is not None and hit >= goal and hit > 0 else ""
            out.append(f"Goal: {'-' if goal is None else goal} hit: {'-' if hit is None else hit}{fire}")
        if b.get("proud"):
            out.append(f"Proud of: {b['proud']}")
        if b.get("change"):
            out.append(f"Change: {b['change']}")
    return "\n".join(out)


# ── Who can see / edit whom ──────────────────────────────────────────────────
async def _sector_of_leader(leader_id: str, iso: str) -> Optional[dict]:
    return await db.sectors.find_one({"leader_id": str(leader_id), "date": iso}, {"_id": 0})


async def _users_by_ids(ids: list[str]) -> list[dict]:
    oids = [ObjectId(i) for i in ids if ObjectId.is_valid(str(i))]
    rows = []
    async for u in db.users.find({"_id": {"$in": oids}, "deleted": {"$ne": True}}, {"_id": 1, "name": 1, "role": 1}):
        rows.append({"user_id": str(u["_id"]), "user_name": u.get("name") or "", "role": u.get("role")})
    order = {str(i): n for n, i in enumerate(ids)}
    rows.sort(key=lambda r: order.get(r["user_id"], 999))
    return rows


async def _people(user: dict, iso: Optional[str] = None) -> list[dict]:
    """Who the caller works with on a day: a sector leader's sector when they
    have one, otherwise their team (Coach), the office (Admin) or themselves."""
    role = (user.get("role") or "").lower()
    if iso and role in ("leader", "admin"):
        sec = await _sector_of_leader(str(user["id"]), iso)
        if sec and sec.get("member_ids"):
            return await _users_by_ids(sec["member_ids"])
    q: dict = {"office_id": user.get("office_id"), "deleted": {"$ne": True}, "is_active": {"$ne": False},
               "is_demo": {"$ne": True}, "role": {"$in": ["trainee", "leader", "admin"]}}
    if role == "leader":
        ids = [ObjectId(i) for i in await get_subtree_ids(str(user["id"])) if ObjectId.is_valid(str(i))]
        q["_id"] = {"$in": ids}
    elif role != "admin":
        q["_id"] = ObjectId(str(user["id"]))
    rows = []
    async for u in db.users.find(q, {"_id": 1, "name": 1, "role": 1}):
        rows.append({"user_id": str(u["_id"]), "user_name": u.get("name") or "", "role": u.get("role")})
    rows.sort(key=lambda r: r["user_name"].lower())
    return rows


async def _can_edit(user: dict, target_id: str, iso: Optional[str] = None) -> bool:
    if str(user.get("id")) == str(target_id):
        return True
    if iso:
        sec = await _sector_of_leader(str(user["id"]), iso)
        if sec and str(target_id) in (sec.get("member_ids") or []):
            return True
    return any(p["user_id"] == str(target_id) for p in await _people(user))


async def _prefill(user_ids: list[str], iso: str) -> dict:
    """OwnerIQ doors/spoken/pitched/closed and sign-ups for the day; Bells
    sign-ups win for "hit" when the day has them."""
    out: dict = {}
    async for r in db.owneriq_kpis.find({"date": iso, "cg1_user_id": {"$in": user_ids},
                                        "test_mode": {"$ne": True}, "cg1_matched_by": {"$ne": "name"}}):
        cur = out.setdefault(str(r["cg1_user_id"]), {"doors": 0, "spoken": 0, "pitched": 0, "closed": 0, "hit": 0})
        cur["doors"] += int(r.get("doors_knocked") or 0)
        cur["spoken"] += int(r.get("spoken_to") or 0)
        cur["pitched"] += int(r.get("pitches_commenced") or 0)
        cur["closed"] += int(r.get("pitches_closed") or 0)
        cur["hit"] += int(r.get("sales") or 0)
    d = Date.fromisoformat(iso)
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    async for e in db.bells_entries.find({"week_ending": week_ending, "user_id": {"$in": user_ids}},
                                         {"user_id": 1, "days": 1}):
        days = e.get("days") or []
        day = days[d.weekday()] if d.weekday() < len(days) else None
        if day and ((day.get("over30") or 0) + (day.get("under30") or 0)) > 0:
            out.setdefault(str(e["user_id"]), {})["hit"] = (day.get("over30") or 0) + (day.get("under30") or 0)
    return out


@router.get("/sector/day")
async def sector_day(request: Request, date: Optional[str] = None):
    user = await get_current_user(request)
    iso = _clean_date(date)
    prev = (Date.fromisoformat(iso) - timedelta(days=1 if Date.fromisoformat(iso).weekday() != 0 else 2)).isoformat()
    people = await _people(user, iso)
    sector = await _sector_of_leader(str(user["id"]), iso)
    ids = [p["user_id"] for p in people]
    docs = {d["user_id"]: d async for d in db.sector_days.find({"date": iso, "user_id": {"$in": ids}}, {"_id": 0})}
    prev_docs = {d["user_id"]: d async for d in db.sector_days.find({"date": prev, "user_id": {"$in": ids}}, {"_id": 0})}
    pre = await _prefill(ids, iso)
    rows = []
    for p in people:
        doc = docs.get(p["user_id"]) or {}
        y = prev_docs.get(p["user_id"]) or {}
        yb = y.get("breakdown") or {}
        rows.append({
            **p,
            "setup": doc.get("setup"),
            "breakdown": doc.get("breakdown"),
            "prefill": pre.get(p["user_id"]) or {},
            "yesterday": {"change": yb.get("change") or "", "proud": yb.get("proud") or "",
                          "goal": (y.get("setup") or {}).get("goal") or yb.get("goal"),
                          "kpi": suggest_kpi(yb)},
        })
    return {
        "date": iso, "previous_date": prev,
        "can_manage": (user.get("role") or "").lower() in ("leader", "admin"),
        "sector": sector,
        "options": {"proud": PROUD_OPTIONS, "change": CHANGE_OPTIONS,
                    "kpi_metrics": [{"key": k, "label": v, "loa": LOA.get(k)} for k, v in KPI_METRICS.items()]},
        "people": rows,
        "whatsapp": {"setup": setup_text(rows, iso, (sector or {}).get("goal"), (sector or {}).get("postcode") or ""),
                     "breakdown": breakdown_text(rows, iso, (sector or {}).get("goal"), (sector or {}).get("postcode") or "")},
    }


@router.put("/sector/day/{user_id}")
async def save_sector_day(user_id: str, request: Request, date: Optional[str] = None):
    user = await get_current_user(request)
    iso = _clean_date(date)
    if not await _can_edit(user, user_id, iso):
        raise HTTPException(status_code=403, detail="That person is not on your team or in your sector")
    body = await request.json()
    now = datetime.now(timezone.utc).isoformat()
    upd: dict = {}
    if "setup" in body:
        upd["setup"] = {**clean_setup(body.get("setup") or {}), "by_id": str(user["id"]), "at": now}
    if "breakdown" in body:
        upd["breakdown"] = {**clean_breakdown(body.get("breakdown") or {}), "by_id": str(user["id"]), "at": now}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to save")
    target = await db.users.find_one({"_id": ObjectId(user_id)}, {"name": 1, "office_id": 1}) if ObjectId.is_valid(user_id) else None
    if not target:
        raise HTTPException(status_code=404, detail="Person not found")
    await db.sector_days.update_one(
        {"user_id": user_id, "date": iso},
        {"$set": {**upd, "office_id": target.get("office_id"), "user_name": target.get("name") or "", "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True)
    return await db.sector_days.find_one({"user_id": user_id, "date": iso}, {"_id": 0})


@router.post("/sector/setup/notify")
async def notify_setups(request: Request, date: Optional[str] = None):
    """Send each person on the caller's team their own set-up for the day."""
    user = await get_current_user(request)
    if (user.get("role") or "").lower() not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coach or admin access required")
    iso = _clean_date(date)
    ids = [p["user_id"] for p in await _people(user, iso)]
    from core.push import send_push_to_user
    sent = 0
    async for d in db.sector_days.find({"date": iso, "user_id": {"$in": ids}}, {"_id": 0}):
        s = d.get("setup") or {}
        parts = []
        if s.get("goal") is not None:
            parts.append(f"Goal {s['goal']}")
        if s.get("kpi_metric"):
            parts.append(f"KPI {kpi_text(s)}")
        if s.get("focus"):
            parts.append(f"Focus: {s['focus']}")
        if s.get("positive"):
            parts.append(f"💪 {s['positive']}")
        if not parts:
            continue
        try:
            await send_push_to_user(d["user_id"], "🎯 Your set-up for today", " · ".join(parts),
                                    {"type": "sector_setup", "url": "/sector"})
            sent += 1
        except Exception as ex:
            logger.warning("set-up push failed for %s: %s", d["user_id"], ex)
    return {"sent": sent}


async def my_setup(user_id: str, iso: Optional[str] = None) -> Optional[dict]:
    d = await db.sector_days.find_one({"user_id": str(user_id), "date": iso or today_iso()}, {"_id": 0, "setup": 1})
    s = (d or {}).get("setup")
    return {**s, "kpi": kpi_text(s)} if s else None


# ── Through the field day: reminders built from each person's set-up ────────
# Weekdays (field 13:30–20:00): 15:00, 16:30 and 19:00 (the 6pm reset sits
# between). Saturday (field 10:00–17:00): 12:00, 14:00 and 16:00. Only people
# with a set-up for today get them; numbers come from OwnerIQ / Bells, so they
# are as fresh as the last sync.
WEEKDAY_SLOTS = ((15, 0, "early"), (16, 30, "mid"), (19, 0, "late"))
SATURDAY_SLOTS = ((12, 0, "early"), (14, 0, "mid"), (16, 0, "late"))
_KPI_FIELD = {"doors": "doors", "spoken": "spoken", "pitched": "pitched", "closes": "closed"}


def nudge_text(setup: dict, now: dict, slot: str) -> tuple[str, str]:
    """(title, body) for one person at one point in the day."""
    goal = setup.get("goal")
    hit = int(now.get("hit") or 0)
    parts = []
    if goal is not None:
        parts.append(f"{hit}/{goal} sign-ups")
    m, t = setup.get("kpi_metric"), setup.get("kpi_target")
    if m and t is not None and _KPI_FIELD.get(m):
        parts.append(f"{int(now.get(_KPI_FIELD[m]) or 0)}/{t} {KPI_METRICS[m]}")
    elif m:
        parts.append(f"KPI: {kpi_text(setup)}")
    if setup.get("focus"):
        parts.append(f"Focus: {setup['focus']}")
    if setup.get("positive"):
        parts.append(f"💪 {setup['positive']}")
    if goal is not None and hit >= goal and goal > 0:
        return "🔥 Goal hit", f"{hit}/{goal} — go for one more. " + " · ".join(parts[1:])
    title = {"early": "🎯 Check in", "mid": "📊 Halfway check", "late": "⏱️ Last stretch"}[slot]
    if slot == "late" and goal is not None:
        title = f"⏱️ {max(0, goal - hit)} more to hit your goal"
    return title, " · ".join(parts)


def sector_nudge_text(goal: Optional[int], rows: list, slot: str) -> tuple[str, str]:
    """(title, body) for a sector leader: the sector against its goal, and
    who is furthest behind their own goal. rows: {user_name, goal, hit}."""
    hit = sum(int(r.get("hit") or 0) for r in rows)
    if goal is None:
        goal = sum(int(r.get("goal") or 0) for r in rows) or None
    behind = sorted([r for r in rows if r.get("goal") is not None and int(r.get("hit") or 0) < int(r["goal"])],
                    key=lambda r: int(r.get("hit") or 0) - int(r["goal"]))
    tail = ", ".join(f"{_first(r.get('user_name'))} {int(r.get('hit') or 0)}/{r['goal']}" for r in behind[:4])
    if goal is None:
        return "📊 Your sector", f"{hit} sign-ups so far" + (f" · Behind: {tail}" if tail else "")
    if goal > 0 and hit >= goal:
        return "🔥 Sector goal hit", f"{hit}/{goal} — push for one more each." + (f" Still chasing: {tail}" if tail else "")
    left = goal - hit
    title = {"early": "🎯 Sector check in", "mid": "📊 Sector halfway",
             "late": f"⏱️ Sector: {left} more to hit {goal}"}[slot]
    body = f"{hit}/{goal} sign-ups · {left} to go"
    return title, body + (f" · Behind: {tail}" if tail else "")


async def sector_leader_nudges(slot: str, iso: str) -> int:
    from core.push import send_push_to_user
    sectors = [x async for x in db.sectors.find({"date": iso, "member_ids.0": {"$exists": True}}, {"_id": 0})]
    if not sectors:
        return 0
    ids = list({m for sec in sectors for m in sec.get("member_ids") or []})
    live = await _prefill(ids, iso)
    setups = {d["user_id"]: d.get("setup") or {} async for d in db.sector_days.find({"date": iso, "user_id": {"$in": ids}}, {"_id": 0})}
    names = {p["user_id"]: p["user_name"] for p in await _users_by_ids(ids)}
    sent = 0
    for sec in sectors:
        rows = [{"user_name": names.get(m, ""), "goal": (setups.get(m) or {}).get("goal"),
                 "hit": (live.get(m) or {}).get("hit") or 0} for m in sec.get("member_ids") or [] if m in names]
        title, body = sector_nudge_text(sec.get("goal"), rows, slot)
        try:
            await send_push_to_user(sec["leader_id"], title, body, {"type": "field_nudge", "url": "/sectors"})
            sent += 1
        except Exception as ex:
            logger.warning("sector nudge failed for %s: %s", sec.get("leader_id"), ex)
    return sent


async def field_nudge_tick(slot: str) -> int:
    from core.push import send_push_to_user
    iso = today_iso()
    docs = [d async for d in db.sector_days.find({"date": iso, "setup": {"$ne": None}}, {"_id": 0})]
    live = await _prefill([d["user_id"] for d in docs], iso) if docs else {}
    sent = 0
    for d in docs:
        s = d.get("setup") or {}
        if s.get("goal") is None and not s.get("kpi_metric") and not s.get("focus") and not s.get("positive"):
            continue
        title, body = nudge_text(s, live.get(d["user_id"]) or {}, slot)
        try:
            await send_push_to_user(d["user_id"], title, body, {"type": "field_nudge", "url": "/field-reset"})
            sent += 1
        except Exception as ex:
            logger.warning("field nudge failed for %s: %s", d["user_id"], ex)
    try:
        sent += await sector_leader_nudges(slot, iso)
    except Exception as ex:
        logger.warning("sector leader nudges failed: %s", ex)
    return sent


async def breakdown_prompt_tick() -> int:
    """After the field (20:15 weekdays, 17:15 Saturday): ask everyone who had
    a set-up or was out today to fill in what they're proud of and what
    they'll change."""
    from core.push import send_push_to_user
    iso = today_iso()
    ids = {d["user_id"] async for d in db.sector_days.find({"date": iso}, {"user_id": 1})}
    async for r in db.owneriq_kpis.find({"date": iso, "cg1_user_id": {"$ne": None}, "test_mode": {"$ne": True},
                                        "cg1_matched_by": {"$ne": "name"}}, {"cg1_user_id": 1, "doors_knocked": 1}):
        if int(r.get("doors_knocked") or 0) > 0:
            ids.add(str(r["cg1_user_id"]))
    done = {d["user_id"] async for d in db.sector_days.find(
        {"date": iso, "breakdown.proud": {"$nin": ["", None]}, "breakdown.change": {"$nin": ["", None]}}, {"user_id": 1})}
    sent = 0
    for uid in ids - done:
        try:
            await send_push_to_user(uid, "📝 Breakdown", "What are you proud of today, and what will you change tomorrow?",
                                    {"type": "field_nudge", "url": "/sector?mode=breakdown"})
            sent += 1
        except Exception as ex:
            logger.warning("breakdown prompt failed for %s: %s", uid, ex)
    return sent



# ── Sectors: who's with which sector leader, and the board ────────────────────
# Collection `sectors`, one per (leader_id, date): {id, office_id, date,
# leader_id, leader_name, member_ids, updated_at}. A person is in one sector a
# day: adding them to a sector takes them out of any other that day.

@router.get("/sector/roster")
async def sector_roster(request: Request, date: Optional[str] = None):
    """The office's people, for picking who's in your sector; shows who is
    already in someone else's sector that day."""
    user = await get_current_user(request)
    if (user.get("role") or "").lower() not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coach or admin access required")
    iso = _clean_date(date)
    taken: dict[str, str] = {}
    async for sec in db.sectors.find({"office_id": user.get("office_id"), "date": iso}, {"_id": 0}):
        if sec.get("leader_id") == str(user["id"]):
            continue
        for m in sec.get("member_ids") or []:
            taken[m] = sec.get("leader_name") or ""
    rows = []
    async for u in db.users.find({"office_id": user.get("office_id"), "deleted": {"$ne": True}, "is_active": {"$ne": False},
                                  "is_demo": {"$ne": True}, "role": {"$in": ["trainee", "leader", "admin"]}},
                                 {"_id": 1, "name": 1, "role": 1}):
        uid = str(u["_id"])
        rows.append({"user_id": uid, "user_name": u.get("name") or "", "role": u.get("role"),
                     "in_sector_of": taken.get(uid)})
    rows.sort(key=lambda r: r["user_name"].lower())
    return {"date": iso, "people": rows}


@router.put("/sector/sectors")
async def save_my_sector(request: Request, date: Optional[str] = None):
    user = await get_current_user(request)
    if (user.get("role") or "").lower() not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coach or admin access required")
    iso = _clean_date(date)
    body = await request.json()
    wanted = [str(i) for i in (body.get("member_ids") or []) if ObjectId.is_valid(str(i))][:40]
    if not wanted:
        raise HTTPException(status_code=400, detail="Pick at least one person")
    valid = {str(u["_id"]) async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in wanted]}, "office_id": user.get("office_id"), "deleted": {"$ne": True}}, {"_id": 1})}
    members = [i for i in dict.fromkeys(wanted) if i in valid]
    if not members:
        raise HTTPException(status_code=400, detail="Nobody from your office in that list")
    await db.sectors.update_many({"office_id": user.get("office_id"), "date": iso, "leader_id": {"$ne": str(user["id"])}},
                                 {"$pull": {"member_ids": {"$in": members}}})
    now = datetime.now(timezone.utc).isoformat()
    await db.sectors.update_one({"leader_id": str(user["id"]), "date": iso}, {
        "$set": {"office_id": user.get("office_id"), "leader_name": user.get("name") or "", "member_ids": members, "updated_at": now},
        "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}}, upsert=True)
    return await _sector_of_leader(str(user["id"]), iso)


@router.put("/sector/goal")
async def save_sector_goal(request: Request, date: Optional[str] = None):
    """The sector leader's goal for the whole sector that day (blank clears it,
    and the board falls back to adding up each person's goal)."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    sec = await _sector_of_leader(str(user["id"]), iso)
    if not sec:
        raise HTTPException(status_code=400, detail="Pick who's in your sector first")
    body = await request.json()
    raw = body.get("goal")
    goal = None if raw in (None, "") else _int(raw, 0, 200)
    await db.sectors.update_one({"leader_id": str(user["id"]), "date": iso},
                                {"$set": {"goal": goal, "postcode": clean_postcode(body.get("postcode"))}})
    return await _sector_of_leader(str(user["id"]), iso)


@router.get("/sector/board")
async def sector_board(request: Request, date: Optional[str] = None):
    """Every sector in the office on a day, with each person's set-up and
    breakdown: the one place to see the whole field."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    sectors = [x async for x in db.sectors.find({"office_id": user.get("office_id"), "date": iso, "member_ids.0": {"$exists": True}},
                                                {"_id": 0}).sort("leader_name", 1)]
    all_ids = [m for sec in sectors for m in sec.get("member_ids") or []]
    docs = {d["user_id"]: d async for d in db.sector_days.find({"date": iso, "user_id": {"$in": all_ids}}, {"_id": 0})}
    live = await _prefill(all_ids, iso)
    people = {p["user_id"]: p for p in await _users_by_ids(all_ids)}
    out = []
    for sec in sectors:
        rows = []
        for m in sec.get("member_ids") or []:
            if m not in people:
                continue
            d = docs.get(m) or {}
            su = d.get("setup")
            rows.append({**people[m], "setup": {**su, "kpi": kpi_text(su)} if su else None, "breakdown": d.get("breakdown"), "live": live.get(m) or {}})
        people_goal = sum(int((r.get("setup") or {}).get("goal") or 0) for r in rows)
        sg = sec.get("goal")
        hit = sum(int((r.get("live") or {}).get("hit") or 0) for r in rows)
        out.append({"leader_id": sec["leader_id"], "leader_name": sec.get("leader_name"), "people": rows,
                    "goal": sg if sg is not None else people_goal, "sector_goal": sg, "people_goal": people_goal, "hit": hit,
                    "postcode": sec.get("postcode") or "", "stats": sector_stats(rows, sg),
                    "whatsapp": {"setup": setup_text(rows, iso, sg, sec.get("postcode") or ""),
                                 "breakdown": breakdown_text(rows, iso, sg, sec.get("postcode") or "")}})
    return {"date": iso, "sectors": out}


@router.get("/sector/status")
async def sector_status(request: Request):
    """For the Home card: is it set-up or breakdown time, and what's done."""
    user = await get_current_user(request)
    now = datetime.now(APP_TZ)
    iso = now.date().isoformat()
    mins = now.hour * 60 + now.minute
    sat = now.weekday() == 5
    sun = now.weekday() == 6
    start_win = (9 * 60 + 30, 12 * 60) if sat else (13 * 60, 16 * 60)
    end_win = (16 * 60 + 30, 19 * 60) if sat else (19 * 60 + 30, 22 * 60)
    phase = None if sun else "setup" if start_win[0] <= mins < start_win[1] else "breakdown" if end_win[0] <= mins < end_win[1] else None
    is_leader = (user.get("role") or "").lower() in ("leader", "admin")
    sec = await _sector_of_leader(str(user["id"]), iso) if is_leader else None
    members = (sec or {}).get("member_ids") or []
    setups = breakdowns = 0
    if members:
        async for d in db.sector_days.find({"date": iso, "user_id": {"$in": members}}, {"setup": 1, "breakdown": 1}):
            setups += 1 if d.get("setup") else 0
            breakdowns += 1 if d.get("breakdown") else 0
    return {"date": iso, "phase": phase, "is_leader": is_leader, "has_sector": bool(members),
            "members": len(members), "setups": setups, "breakdowns": breakdowns,
            "my_setup": await my_setup(str(user["id"]), iso)}


async def _leaders_out_today() -> list[str]:
    now = datetime.now(APP_TZ)
    d = now.date()
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    away: set[str] = set()
    async for e in db.bells_entries.find({"week_ending": week_ending}, {"user_id": 1, "days": 1}):
        days = e.get("days") or []
        if d.weekday() < len(days) and (days[d.weekday()] or {}).get("status") in ("ab", "ns", "rt", "pc"):
            away.add(str(e.get("user_id")))
    return [str(u["_id"]) async for u in db.users.find(
        {"role": "leader", "deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_demo": {"$ne": True}}, {"_id": 1})
        if str(u["_id"]) not in away]


async def sector_start_tick() -> int:
    """Field start: every Coach out today is asked to start their sector set-up."""
    from core.push import send_push_to_user
    sent = 0
    for uid in await _leaders_out_today():
        if await _sector_of_leader(uid, today_iso()):
            continue
        try:
            await send_push_to_user(uid, "🚀 Start your sector set-up",
                                    "Who's in your sector, the postcode, and everyone's goal, KPI and focus.",
                                    {"type": "sector_setup", "url": "/sector?start=1"})
            sent += 1
        except Exception as ex:
            logger.warning("sector start push failed for %s: %s", uid, ex)
    return sent


async def sector_breakdown_tick() -> int:
    """End of the field: every sector leader is asked for their breakdown."""
    from core.push import send_push_to_user
    sent = 0
    async for sec in db.sectors.find({"date": today_iso(), "member_ids.0": {"$exists": True}}, {"leader_id": 1}):
        try:
            await send_push_to_user(sec["leader_id"], "📝 Sector breakdown",
                                    "Do your sector's breakdown: numbers, proud of, and what changes tomorrow.",
                                    {"type": "sector_setup", "url": "/sector?mode=breakdown"})
            sent += 1
        except Exception as ex:
            logger.warning("sector breakdown push failed for %s: %s", sec.get("leader_id"), ex)
    return sent
