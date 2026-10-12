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
yesterday's "Change", and the KPI suggestion is the step furthest behind the
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
            "kpi_target": _int(body.get("kpi_target"), 0, 300), "focus": _text(body.get("focus"))}


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
    d = Date.fromisoformat(iso)
    return f"{d.day}/{d.month}"


def setup_text(rows: list, iso: str) -> str:
    out = [f"*SetUp* {_label(iso)}"]
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


def breakdown_text(rows: list, iso: str) -> str:
    out = [f"*Breakdown* {_label(iso)}"]
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
async def _people(user: dict) -> list[dict]:
    role = (user.get("role") or "").lower()
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


async def _can_edit(user: dict, target_id: str) -> bool:
    if str(user.get("id")) == str(target_id):
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
    people = await _people(user)
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
        "options": {"proud": PROUD_OPTIONS, "change": CHANGE_OPTIONS,
                    "kpi_metrics": [{"key": k, "label": v, "loa": LOA.get(k)} for k, v in KPI_METRICS.items()]},
        "people": rows,
        "whatsapp": {"setup": setup_text(rows, iso), "breakdown": breakdown_text(rows, iso)},
    }


@router.put("/sector/day/{user_id}")
async def save_sector_day(user_id: str, request: Request, date: Optional[str] = None):
    user = await get_current_user(request)
    if not await _can_edit(user, user_id):
        raise HTTPException(status_code=403, detail="That person is not on your team")
    iso = _clean_date(date)
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
    ids = [p["user_id"] for p in await _people(user)]
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
