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
    cod = str(body.get("cod_module_id") or "").strip()[:64] or None
    return {"goal": _int(body.get("goal"), 0, 30), "kpi_metric": metric or None,
            "kpi_target": _int(body.get("kpi_target"), 0, 300), "focus": _text(body.get("focus")),
            "positive": _text(body.get("positive")), "cod_module_id": cod}


# ── COD learning in the set-up ──────────────────────────────────────────────
# A Stage 1 or 2 picks ONE item from the COD to learn that day, from their own
# stage or below. At the breakdown the sector leader or a Coach can mark that
# they were seen doing it: a record of the day ("observed in the field by …"),
# never a tick on their COD (sign-offs stay on the COD itself).
COD_PICK_STAGES = (1, 2)


async def cod_pick_stages(target: dict) -> list[int]:
    """The COD stages this person may pick from in a set-up: their own stage
    and below, for Stage 1-2 people only (Stage 3 and up pick nothing)."""
    from core.schedule_template import stage_num
    n = stage_num(target.get("owneriq_stage"))
    if n is None:
        # No OwnerIQ stage: BAs only, Stage 2 once it's open to them.
        if (target.get("role") or "").lower() != "trainee":
            return []
        from routes.modules import _is_stage_unlocked_by_role
        return [1] + ([2] if await _is_stage_unlocked_by_role(target, 2) else [])
    if n >= 3:
        return []
    return [s for s in COD_PICK_STAGES if s <= n]


async def cod_options(office_id) -> list[dict]:
    """The office's COD items a set-up can pick from (Stages 1-2), in order."""
    return [{"id": m["id"], "stage": m.get("stage"), "topic": m.get("topic"), "category": m.get("category")}
            async for m in db.training_modules.find(
                {"office_id": office_id, "stage": {"$in": list(COD_PICK_STAGES)}, "retired": {"$ne": True}},
                {"_id": 0, "id": 1, "stage": 1, "topic": 1, "category": 1, "sequence": 1}).sort([("stage", 1), ("sequence", 1)])
            if m.get("id")]


def clean_breakdown(body: dict) -> dict:
    out = {"doors": _int(body.get("doors")), "spoken": _int(body.get("spoken")),
           "pitched": _int(body.get("pitched")), "closed": _int(body.get("closed")),
           "note": _text(body.get("note")), "goal": _int(body.get("goal"), 0, 30),
           "hit": _int(body.get("hit"), 0, 30), "proud": _text(body.get("proud")),
           "change": _text(body.get("change")),
           # Silver / Gold / took The Round, from Field IQ (sign-ups = Silver + Gold).
           "silver": _int(body.get("silver"), 0, 30), "gold": _int(body.get("gold"), 0, 30),
           "round": _int(body.get("round"), 0, 30)}
    if out["silver"] is not None or out["gold"] is not None:
        out["hit"] = (out["silver"] or 0) + (out["gold"] or 0)
        if out["round"] is not None:
            out["round"] = min(out["round"], out["hit"])
    return out


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


async def _my_sector(user_id: str, iso: str) -> Optional[dict]:
    """The sector a person is in that day — one they LEAD, or one they're a
    MEMBER of. A person is in one sector a day, so a member can do and post the
    sector's breakdown against the original leader's set-up."""
    me = str(user_id)
    sec = await db.sectors.find_one({"leader_id": me, "date": iso}, {"_id": 0})
    return sec or await db.sectors.find_one({"date": iso, "member_ids": me}, {"_id": 0})


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
    if iso:
        # The sector they're in that day (lead OR a member of): everyone works
        # with the whole sector, so anyone can fill in its breakdowns.
        sec = await _my_sector(str(user["id"]), iso)
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
        sec = await _my_sector(str(user["id"]), iso)
        if sec and str(target_id) in ((sec.get("member_ids") or []) + [sec.get("leader_id")]):
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
            cur = out.setdefault(str(e["user_id"]), {})
            cur["hit"] = (day.get("over30") or 0) + (day.get("under30") or 0)
            cur.update(silver=day.get("under30") or 0, gold=day.get("over30") or 0, round=day.get("memberships") or 0)
    return out


@router.get("/sector/day")
async def sector_day(request: Request, date: Optional[str] = None):
    user = await get_current_user(request)
    iso = _clean_date(date)
    prev = (Date.fromisoformat(iso) - timedelta(days=1 if Date.fromisoformat(iso).weekday() != 0 else 2)).isoformat()
    people = await _people(user, iso)
    sector = await _my_sector(str(user["id"]), iso)
    i_lead = bool(sector) and sector.get("leader_id") == str(user["id"])
    role = (user.get("role") or "").lower()
    ids = [p["user_id"] for p in people]
    docs = {d["user_id"]: d async for d in db.sector_days.find({"date": iso, "user_id": {"$in": ids}}, {"_id": 0})}
    prev_docs = {d["user_id"]: d async for d in db.sector_days.find({"date": prev, "user_id": {"$in": ids}}, {"_id": 0})}
    pre = await _prefill(ids, iso)
    # COD learning: who may pick, the items, and what's been seen today.
    targets = {str(u["_id"]): u async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in ids if ObjectId.is_valid(i)]}},
        {"role": 1, "owneriq_stage": 1, "office_id": 1, "new_hire_id": 1})}
    options = await cod_options(user.get("office_id"))
    by_id = {o["id"]: o for o in options}
    rows = []
    for p in people:
        doc = docs.get(p["user_id"]) or {}
        y = prev_docs.get(p["user_id"]) or {}
        yb = y.get("breakdown") or {}
        picked = by_id.get(((doc.get("setup") or {}).get("cod_module_id")) or "")
        rows.append({
            **p,
            "cod": {"stages": await cod_pick_stages(targets.get(p["user_id"]) or {}),
                    "pick": picked, "observed": doc.get("cod_observed")},
            "setup": doc.get("setup"),
            "breakdown": doc.get("breakdown"),
            "prefill": pre.get(p["user_id"]) or {},
            "yesterday": {"change": yb.get("change") or "", "proud": yb.get("proud") or "",
                          "goal": (y.get("setup") or {}).get("goal") or yb.get("goal"),
                          "kpi": suggest_kpi(yb)},
        })
    return {
        "date": iso, "previous_date": prev,
        # Managing a sector (who's in it, the goal, the postcode) is the leader's,
        # or a Coach/Admin starting a new one. A member can do the breakdown but
        # never re-pick the set-up — that stays as the leader made it.
        "can_manage": i_lead or (role in ("leader", "admin") and sector is None),
        "leads": i_lead,
        # Marking a COD item as seen in the field: the sector leader or a Coach.
        "can_mark_cod": i_lead or role in ("leader", "admin"),
        "cod_options": options,
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
    # Breakdowns: anyone in the sector can fill them for anyone in it. Set-ups of
    # OTHER people stay the leader's (or a Coach/Admin's) — a member only sets
    # their own.
    if "setup" in body and str(user_id) != str(user["id"]):
        sec = await _my_sector(str(user["id"]), iso)
        leads = bool(sec) and sec.get("leader_id") == str(user["id"])
        if not (leads or (user.get("role") or "").lower() in ("leader", "admin")):
            raise HTTPException(status_code=403, detail="Only the sector leader sets other people’s set-ups")
    now = datetime.now(timezone.utc).isoformat()
    upd: dict = {}
    if "setup" in body:
        upd["setup"] = {**clean_setup(body.get("setup") or {}), "by_id": str(user["id"]), "at": now}
        cod_id = upd["setup"].get("cod_module_id")
        if cod_id:
            who = await db.users.find_one({"_id": ObjectId(user_id)}, {"role": 1, "owneriq_stage": 1, "office_id": 1, "new_hire_id": 1}) \
                if ObjectId.is_valid(user_id) else None
            item = await db.training_modules.find_one(
                {"id": cod_id, "office_id": (who or {}).get("office_id"), "retired": {"$ne": True}}, {"stage": 1})
            if not who or not item or item.get("stage") not in await cod_pick_stages(who):
                raise HTTPException(status_code=400, detail="Pick a COD item from their own stage or below")
    if "breakdown" in body:
        upd["breakdown"] = {**clean_breakdown(body.get("breakdown") or {}), "by_id": str(user["id"]), "at": now}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to save")
    target = await db.users.find_one({"_id": ObjectId(user_id)}, {"name": 1, "office_id": 1, "role": 1, "badge_number": 1}) \
        if ObjectId.is_valid(user_id) else None
    if not target:
        raise HTTPException(status_code=404, detail="Person not found")
    if "setup" in upd:
        # A different COD item picked: what was seen for the old one no longer applies.
        before = await db.sector_days.find_one({"user_id": user_id, "date": iso}, {"cod_observed": 1})
        seen = (before or {}).get("cod_observed") or {}
        if seen and seen.get("module_id") != upd["setup"].get("cod_module_id"):
            upd["cod_observed"] = None
            await db.cod_observations.delete_many({"user_id": user_id, "date": iso})
    await db.sector_days.update_one(
        {"user_id": user_id, "date": iso},
        {"$set": {**upd, "office_id": target.get("office_id"), "user_name": target.get("name") or "", "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True)
    if "breakdown" in upd:
        # OwnerIQ switched off: the breakdown is the day's numbers and fills Bells.
        try:
            from core.breakdown_numbers import apply_breakdown
            await apply_breakdown(target, iso, upd["breakdown"])
        except Exception as ex:
            logger.warning("breakdown numbers for %s failed: %s", user_id, ex)
    return await db.sector_days.find_one({"user_id": user_id, "date": iso}, {"_id": 0})


@router.put("/sector/day/{user_id}/cod-observed")
async def mark_cod_observed(user_id: str, request: Request, date: Optional[str] = None):
    """At the breakdown: the sector leader or a Coach marks that this person was
    seen doing today's COD item (or takes it back). A record of the day, kept
    on the item as "observed in the field by … · 16 Oct" — it never ticks
    their COD."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    role = (user.get("role") or "").lower()
    target = await db.users.find_one({"_id": ObjectId(user_id)}, {"name": 1, "office_id": 1}) \
        if ObjectId.is_valid(user_id) else None
    if not target or (target.get("office_id") != user.get("office_id") and not user.get("is_super_admin")):
        raise HTTPException(status_code=404, detail="Person not found")
    sec = await _my_sector(user_id, iso)
    leads = bool(sec) and sec.get("leader_id") == str(user["id"])
    if not (leads or role in ("leader", "admin")):
        raise HTTPException(status_code=403, detail="Only the sector leader or a Coach marks this")
    doc = await db.sector_days.find_one({"user_id": user_id, "date": iso}, {"_id": 0})
    module_id = ((doc or {}).get("setup") or {}).get("cod_module_id")
    if not module_id:
        raise HTTPException(status_code=400, detail="They didn't pick a COD item in today's set-up")
    done = bool((await request.json()).get("done"))
    now = datetime.now(timezone.utc).isoformat()
    if done:
        seen = {"module_id": module_id, "date": iso, "by_id": str(user["id"]),
                "by_name": user.get("name") or "", "at": now}
        await db.sector_days.update_one({"user_id": user_id, "date": iso}, {"$set": {"cod_observed": seen, "updated_at": now}})
        await db.cod_observations.update_one(
            {"user_id": user_id, "date": iso},
            {"$set": {**seen, "user_id": user_id, "office_id": target.get("office_id")}}, upsert=True)
    else:
        await db.sector_days.update_one({"user_id": user_id, "date": iso}, {"$set": {"cod_observed": None, "updated_at": now}})
        await db.cod_observations.delete_many({"user_id": user_id, "date": iso})
    return await db.sector_days.find_one({"user_id": user_id, "date": iso}, {"_id": 0})


@router.post("/sector/setup/notify")
async def notify_setups(request: Request, date: Optional[str] = None):
    """Send each person on the caller's team their own set-up for the day."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    if (user.get("role") or "").lower() not in ("leader", "admin") and not await _sector_of_leader(str(user["id"]), iso):
        raise HTTPException(status_code=403, detail="Only the sector leader can send the set-ups")
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
    # Just the three things from the set-up: the goal, the KPI and the focus,
    # each with where you're on (written out, never "1/4", which reads as a date).
    parts = []
    if goal is not None:
        parts.append(f"Goal {goal}, on {hit}")
    m, t = setup.get("kpi_metric"), setup.get("kpi_target")
    if m and t is not None and _KPI_FIELD.get(m):
        parts.append(f"KPI {t} {KPI_METRICS[m]}, on {int(now.get(_KPI_FIELD[m]) or 0)}")
    elif m:
        parts.append(f"KPI: {kpi_text(setup)}")
    if setup.get("focus"):
        parts.append(f"Focus: {setup['focus']}")
    if goal is not None and hit >= goal and goal > 0:
        return "🔥 Goal hit", f"On {hit} of {goal}: go for one more. " + " · ".join(parts[1:])
    title = {"early": "🎯 Check in", "mid": "📊 Halfway check", "late": "⏱️ Last stretch"}[slot]
    if slot == "late" and goal is not None:
        title = f"⏱️ {max(0, goal - hit)} more to hit your goal"
    return title, " · ".join(parts)


def plain_nudge_text(setup: dict, slot: str) -> tuple[str, str]:
    """The check-in without live numbers: the goal, the KPI and the focus."""
    parts = []
    if setup.get("goal") is not None:
        parts.append(f"Goal {setup['goal']}")
    if setup.get("kpi_metric"):
        parts.append(f"KPI: {kpi_text(setup)}")
    if setup.get("focus"):
        parts.append(f"Focus: {setup['focus']}")
    title = {"early": "🎯 Check in", "mid": "📊 Halfway check", "late": "⏱️ Last stretch"}[slot]
    return title, " · ".join(parts)


async def field_nudge_on_clock(now: Optional[datetime] = None) -> int:
    """With OwnerIQ switched off, the check-ins go on the clock instead of
    after a pull."""
    from owneriq_sync import owneriq_on
    if await owneriq_on():
        return 0
    now = now or datetime.now(APP_TZ)
    slot = due_slot(now)
    if not slot or not await _claim_slot(now.date().isoformat(), slot):
        return 0
    return await field_nudge_tick(slot, numbers=False)


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


# The check-ins go out only straight after the app pulls fresh numbers from
# OwnerIQ (hourly), so they're never a stale read: after each pull
# that worked in field hours, the latest slot that's due and not yet sent
# today goes out. Each slot goes out once a day (`field_nudge_runs`).


def _slots_for(day: int):
    return () if day == 6 else SATURDAY_SLOTS if day == 5 else WEEKDAY_SLOTS


def due_slot(now: datetime) -> Optional[str]:
    """The latest check-in due at `now` (UK time), while the field's still on."""
    field_end = 17 * 60 if now.weekday() == 5 else 20 * 60
    mins = now.hour * 60 + now.minute
    if mins >= field_end:
        return None
    due = [slot for h, m, slot in _slots_for(now.weekday()) if h * 60 + m <= mins]
    return due[-1] if due else None


async def _claim_slot(iso: str, slot: str) -> bool:
    r = await db.field_nudge_runs.update_one({"_id": f"{iso}:{slot}"},
                                             {"$setOnInsert": {"at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return bool(getattr(r, "upserted_id", None))


FRESH_SECONDS = 600   # the pull (stamped when it starts) must have just run


async def field_nudge_after_sync(now: Optional[datetime] = None, require_fresh: bool = False) -> int:
    """Called right after each OwnerIQ sync. With require_fresh, nothing goes
    out unless that pull worked in the last few minutes."""
    now = now or datetime.now(APP_TZ)
    if require_fresh:
        st = await db.owneriq_sync_state.find_one({"_id": "last"}, {"ok": 1, "synced_at": 1}) or {}
        try:
            at = datetime.fromisoformat(str(st.get("synced_at")).replace("Z", "+00:00"))
        except ValueError:
            return 0
        if not st.get("ok") or (datetime.now(timezone.utc) - at).total_seconds() > FRESH_SECONDS:
            logger.info("field check-in skipped: OwnerIQ pull %s", "failed" if not st.get("ok") else "not fresh")
            return 0
    slot = due_slot(now)
    if not slot:
        return 0
    if not await _claim_slot(now.date().isoformat(), slot):
        logger.info("field check-in skipped: the %s check-in already went", slot)
        return 0
    return await field_nudge_tick(slot)


async def field_nudge_tick(slot: str, numbers: bool = True) -> int:
    """numbers=False (OwnerIQ switched off): just the goal, KPI and focus,
    without "on X", which would always read 0."""
    from core.push import send_push_to_user
    iso = today_iso()
    docs = [d async for d in db.sector_days.find({"date": iso, "setup": {"$ne": None}}, {"_id": 0})]
    live = await _prefill([d["user_id"] for d in docs], iso) if docs and numbers else {}
    # Say how fresh the numbers are, so a lag in Field IQ reads as one.
    last = await db.owneriq_kpis.find_one({"date": iso}, {"synced_at": 1}, sort=[("synced_at", -1)])
    as_of = ""
    if (last or {}).get("synced_at"):
        try:
            as_of = datetime.fromisoformat(str(last["synced_at"]).replace("Z", "+00:00")).astimezone(APP_TZ).strftime("%H:%M")
        except ValueError:
            as_of = ""
    sent = 0
    for d in docs:
        s = d.get("setup") or {}
        if s.get("goal") is None and not s.get("kpi_metric") and not s.get("focus") and not s.get("positive"):
            continue
        title, body = nudge_text(s, live.get(d["user_id"]) or {}, slot) if numbers else plain_nudge_text(s, slot)
        if as_of and numbers:
            body = f"{body} (Field IQ at {as_of})"
        try:
            await send_push_to_user(d["user_id"], title, body, {"type": "field_nudge", "url": "/field-reset"})
            sent += 1
        except Exception as ex:
            logger.warning("field nudge failed for %s: %s", d["user_id"], ex)
    if numbers:
        try:
            sent += await sector_leader_nudges(slot, iso)
        except Exception as ex:
            logger.warning("sector leader nudges failed: %s", ex)
    return sent


# ── After the field: chase the map and the breakdown until they're done ─────
# Weekdays every 15 minutes from 20:30 to 22:00; Saturday (no breakdown) map
# only, 17:30 to 19:00. The sector leader until the map's saved and the
# breakdown's posted; each person until their own breakdown's in; a BA the
# leader asked to mark their streets off until they've drawn some (or the
# leader's saved the map).
CHASE = {"weekday": ((20, 30), (22, 0)), "sat": ((17, 30), (19, 0))}


def in_chase_window(now: datetime) -> bool:
    if now.weekday() == 6:
        return False
    lo, hi = CHASE["sat" if now.weekday() == 5 else "weekday"]
    return lo <= (now.hour, now.minute) <= hi


def chase_text(todo: list[str]) -> tuple[str, str]:
    """todo: any of 'map', 'post', 'breakdown', 'mark'."""
    words = {"map": "save your sector's map", "post": "post your sector's breakdown",
             "breakdown": "your breakdown", "mark": "mark your streets off on the map"}
    items = [words[t] for t in todo if t in words]
    if not items:
        return "", ""
    title = "🗺️ Mark your map" if todo[0] in ("map", "mark") else "📝 Breakdown"
    return title, "Still to do: " + " · ".join(items) + "."


async def evening_chase_tick(now: Optional[datetime] = None) -> int:
    from core.push import send_push_to_user
    now = now or datetime.now(APP_TZ)
    if not in_chase_window(now):
        return 0
    iso = now.date().isoformat()
    sat = now.weekday() == 5
    todo: dict[str, list[str]] = {}
    async for sec in db.sectors.find({"date": iso}, {"_id": 0}):
        leader = sec["leader_id"]
        members = list(dict.fromkeys([leader, *(sec.get("member_ids") or [])]))
        saved = bool(sec.get("map_saved_at")) or bool(await db.coverage_marks.find_one(
            {"date": iso, "status": "confirmed", "sector_leader_id": leader}, {"_id": 1}))
        if not saved:
            todo.setdefault(leader, []).append("map")
        if not sat and not sec.get("breakdown_posted_at"):
            todo.setdefault(leader, []).append("post")
        if not saved:
            for uid in sec.get("mark_requests") or []:
                if uid == leader:
                    continue
                drew = await db.coverage_marks.find_one({"date": iso, "author_id": uid, "kind": "done"}, {"_id": 1})
                if not drew:
                    todo.setdefault(uid, []).append("mark")
        if not sat:
            done = {d["user_id"] async for d in db.sector_days.find(
                {"date": iso, "user_id": {"$in": members},
                 "breakdown.proud": {"$nin": ["", None]}, "breakdown.change": {"$nin": ["", None]}}, {"user_id": 1})}
            for uid in members:
                if uid not in done:
                    todo.setdefault(uid, []).append("breakdown")
    sent = 0
    for uid, items in todo.items():
        title, body = chase_text(items)
        if not title:
            continue
        url = "/sector?mode=breakdown" if items[0] in ("breakdown", "post") else f"/sector-map?date={iso}"
        try:
            await send_push_to_user(uid, title, body, {"type": "field_nudge", "url": url})
            sent += 1
        except Exception as ex:
            logger.warning("evening chase failed for %s: %s", uid, ex)
    return sent


@router.post("/sector/mark-request")
async def request_mark_off(request: Request, date: Optional[str] = None):
    """The sector leader asks someone in their sector to mark their streets
    off on the map: they're told now and chased until they have."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    uid = str((await request.json()).get("user_id") or "")
    sec = await _sector_of_leader(str(user["id"]), iso)
    if not sec and (user.get("role") or "").lower() == "admin":
        sec = await db.sectors.find_one({"date": iso, "office_id": user.get("office_id"), "member_ids": uid}, {"_id": 0})
    if not sec or uid not in (sec.get("member_ids") or []):
        raise HTTPException(status_code=403, detail="Only the sector leader can ask someone in their sector")
    await db.sectors.update_one({"leader_id": sec["leader_id"], "date": iso}, {"$addToSet": {"mark_requests": uid}})
    from core.push import send_push_to_user
    await send_push_to_user(uid, f"🗺️ {_first(user.get('name') or '')} asks you to mark your streets off",
                            "Open today's map, press Mark done and draw over the streets you worked.",
                            {"type": "field_nudge", "url": f"/sector-map?date={iso}"})
    return {"ok": True}


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
    already in someone else's sector that day. Anyone can lead a sector
    (a Coach or a BA), so anyone can pick from the office."""
    user = await get_current_user(request)
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
    """Lead a sector: anyone in the office (a Coach or a BA)."""
    user = await get_current_user(request)
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
    # You can't start/lead a sector while you're a member of someone else's that
    # day: the set-up is fixed once it's done. This stops a breakdown re-homing a
    # sector onto whoever happens to be filling it in.
    in_other = await db.sectors.find_one(
        {"office_id": user.get("office_id"), "date": iso, "member_ids": str(user["id"]),
         "leader_id": {"$ne": str(user["id"])}}, {"_id": 0, "leader_name": 1})
    if in_other:
        raise HTTPException(status_code=403,
                            detail=f"You’re in {in_other.get('leader_name') or 'another'}’s sector today — ask them to change who’s in it")
    planned = await _sector_of_leader(str(user["id"]), iso)
    # A planned sector's people are fixed for its leader — but not for the
    # Owner or today's sector planner, who made the plan and may change it
    # (e.g. take out someone who didn't come in).
    from routes.sector_plan import can_plan
    if planned and planned.get("planned_by") and not await can_plan(user, iso):
        raise HTTPException(status_code=403, detail="Your sector was planned this morning: ask the sector planner to change who's in it")
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
    # A sector planned in the morning keeps its postcode: its leader sets the goal.
    upd = {"goal": goal} if sec.get("planned_by") else {"goal": goal, "postcode": clean_postcode(body.get("postcode"))}
    await db.sectors.update_one({"leader_id": str(user["id"]), "date": iso}, {"$set": upd})
    return await _sector_of_leader(str(user["id"]), iso)


@router.get("/sector/days")
async def sector_days(request: Request, days: int = 7):
    """The Sector tab: sectors grouped by day, newest first (today, yesterday,
    …). Coaches and Admins see every sector in the office; a BA sees the ones
    they led or were in."""
    user = await get_current_user(request)
    days = max(1, min(int(days or 7), 31))
    today = Date.fromisoformat(today_iso())
    since = (today - timedelta(days=days - 1)).isoformat()
    me = str(user["id"])
    q: dict = {"office_id": user.get("office_id"), "date": {"$gte": since, "$lte": today.isoformat()}}
    if (user.get("role") or "").lower() not in ("leader", "admin"):
        q["$or"] = [{"leader_id": me}, {"member_ids": me}]
    secs = [x async for x in db.sectors.find(q, {"_id": 0}).sort([("date", -1), ("leader_name", 1)])]
    ids = list({m for x in secs for m in (x.get("member_ids") or [])} | {x["leader_id"] for x in secs})
    names = {p["user_id"]: p["user_name"] for p in await _users_by_ids(ids)}
    out: dict[str, list] = {}
    for x in secs:
        iso = x["date"]
        members = [m for m in (x.get("member_ids") or []) if m in names]
        live = await _prefill(members, iso) if members else {}
        out.setdefault(iso, []).append({
            "leader_id": x["leader_id"], "leader_name": x.get("leader_name") or names.get(x["leader_id"], ""),
            "postcode": x.get("postcode") or "", "goal": x.get("goal"),
            "hit": sum(int((live.get(m) or {}).get("hit") or 0) for m in members),
            "people": [names[m] for m in members], "mine": me == x["leader_id"] or me in members,
            "leads": me == x["leader_id"], "breakdown_posted_at": x.get("breakdown_posted_at")})
    return {"days": [{"date": iso, "label": _label(iso), "today": iso == today.isoformat(),
                      "yesterday": iso == (today - timedelta(days=1)).isoformat(), "sectors": rows}
                     for iso, rows in out.items()]}


async def _deletable(sec: dict) -> bool:
    """A sector can be deleted (a test, or started by mistake) until its day is
    finished: no breakdown posted and nothing saved on the worked map."""
    if sec.get("breakdown_posted_at"):
        return False
    done = await db.coverage_marks.count_documents({
        "office_id": sec.get("office_id"), "date": sec["date"], "status": "confirmed",
        "$or": [{"sector_leader_id": sec["leader_id"]}, {"sector_leader_id": None, "author_id": sec["leader_id"]}]})
    return done == 0


@router.delete("/sector")
async def delete_sector(request: Request, date: Optional[str] = None, leader: Optional[str] = None):
    """Delete a sector that isn't finished: the sector, its set-ups and
    breakdowns for that day, and anything drawn on its map that day."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    leader_id = str(leader or user["id"])
    is_admin = (user.get("role") or "").lower() == "admin"
    if leader_id != str(user["id"]) and not is_admin:
        raise HTTPException(status_code=403, detail="Only the sector leader or an Admin can delete a sector")
    sec = await db.sectors.find_one({"office_id": user.get("office_id"), "date": iso, "leader_id": leader_id}, {"_id": 0})
    if not sec:
        raise HTTPException(status_code=404, detail="That sector wasn't found")
    # The leader can only delete an unfinished sector; an Admin can force-delete
    # even a finished one (map saved or breakdown posted) to clean up a mess.
    if not is_admin and not await _deletable(sec):
        raise HTTPException(status_code=400, detail="This sector's day is finished (map saved or breakdown posted), so it can't be deleted")
    members = [str(m) for m in sec.get("member_ids") or []] + [leader_id]
    # A person's set-up goes too, unless they're in another sector that day.
    others = {str(m) async for x in db.sectors.find({"office_id": sec.get("office_id"), "date": iso, "leader_id": {"$ne": leader_id}},
                                                    {"leader_id": 1, "member_ids": 1})
              for m in ([x["leader_id"]] + list(x.get("member_ids") or []))}
    gone = [m for m in dict.fromkeys(members) if m not in others]
    await db.sector_days.delete_many({"date": iso, "user_id": {"$in": gone}})
    await db.coverage_marks.delete_many({"office_id": sec.get("office_id"), "date": iso,
                                         "$or": [{"sector_leader_id": leader_id}, {"sector_leader_id": None, "author_id": leader_id}]})
    await db.sectors.delete_one({"office_id": sec.get("office_id"), "date": iso, "leader_id": leader_id})
    return {"deleted": True}


@router.post("/sector/breakdown/post")
async def post_breakdown(request: Request, date: Optional[str] = None):
    """Post the sector's breakdown: anyone IN the sector can, and it always lands
    on the original sector (its leader's set-up), never a new one. It's then
    done and shows on every Coach's Home with the set-ups (Today's sectors)."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    sec = await _my_sector(str(user["id"]), iso)
    if not sec:
        raise HTTPException(status_code=403, detail="You can only post the breakdown for a sector you’re in")
    at = datetime.now(timezone.utc).isoformat()
    await db.sectors.update_one({"leader_id": sec["leader_id"], "date": iso},
                                {"$set": {"breakdown_posted_at": at, "breakdown_posted_by": user.get("name") or ""}})
    return {"ok": True, "posted_at": at}


@router.get("/sector/board")
async def sector_board(request: Request, date: Optional[str] = None):
    """Every sector in the office on a day, with each person's set-up and
    breakdown: the one place to see the whole field."""
    user = await get_current_user(request)
    iso = _clean_date(date)
    # Someone marked No Show today isn't in a sector (however the No Show came in).
    try:
        from routes.sector_plan import drop_no_shows
        await drop_no_shows(user.get("office_id"), iso)
    except Exception as ex:
        logger.warning("sector board: no-show tidy failed: %s", ex)
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
                    "breakdown_posted_at": sec.get("breakdown_posted_at"),
                    "map_saved_at": sec.get("map_saved_at"), "mark_requests": sec.get("mark_requests") or [],
                    "can_delete": (user.get("role") or "").lower() == "admin"
                                  or (sec["leader_id"] == str(user["id"]) and await _deletable(sec)),
                    "whatsapp": {"setup": setup_text(rows, iso, sg, sec.get("postcode") or ""),
                                 "breakdown": breakdown_text(rows, iso, sg, sec.get("postcode") or "")}})
    return {"date": iso, "sectors": out}


AVERAGE_DAYS = 28   # look back this far for your field days
LOA_DAY = {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "sales": 4}


def averages_from(days: list[dict]) -> dict:
    """Your field days → an average day, and what one sign-up takes. With no
    sign-ups yet, what one takes comes from the Law of Averages."""
    from core.kpi_rules import day_counts
    days = [x for x in days if day_counts(x.get("doors"), x.get("spoken"), x.get("pitched"), x.get("closed"))]
    n = len(days)
    keys = ("doors", "spoken", "pitched", "closed", "sales")
    tot = {k: sum(int(x.get(k) or 0) for x in days) for k in keys}
    per_day = {k: round(tot[k] / n, 1) for k in keys} if n else None
    if tot["sales"]:
        per_sale = {k: round(tot[k] / tot["sales"], 1) for k in keys[:4]}
        source = "yours"
    else:
        per_sale = {k: round(LOA_DAY[k] / LOA_DAY["sales"], 1) for k in keys[:4]}
        source = "law_of_averages"
    return {"days": n, "per_day": per_day, "per_sale": per_sale, "per_sale_source": source}


async def my_averages(uid: str, today: Date) -> dict:
    since = (today - timedelta(days=AVERAGE_DAYS)).isoformat()
    by_day: dict = {}
    async for r in db.owneriq_kpis.find({"cg1_user_id": uid, "date": {"$gte": since, "$lt": today.isoformat()},
                                        "test_mode": {"$ne": True}, "cg1_matched_by": {"$ne": "name"}}):
        cur = by_day.setdefault(str(r["date"])[:10], {"doors": 0, "spoken": 0, "pitched": 0, "closed": 0, "sales": 0})
        cur["doors"] += int(r.get("doors_knocked") or 0)
        cur["spoken"] += int(r.get("spoken_to") or 0)
        cur["pitched"] += int(r.get("pitches_commenced") or 0)
        cur["closed"] += int(r.get("pitches_closed") or 0)
        cur["sales"] += int(r.get("sales") or 0)
    return averages_from(list(by_day.values()))


@router.get("/sector/my-day")
async def sector_my_day(request: Request):
    """Home, straight under the map: your set-up for today and your live
    numbers so far (OwnerIQ, synced through the day; Bells sign-ups win)."""
    user = await get_current_user(request)
    now = datetime.now(APP_TZ)
    iso = now.date().isoformat()
    uid = str(user["id"])
    # OwnerIQ switched off: no live numbers (any still in the database are the
    # last pull before it was turned off — My day just shows the set-up and
    # what the goal takes).
    from owneriq_sync import owneriq_on
    oiq_on = await owneriq_on()
    live = (await _prefill([uid], iso)).get(uid) or {} if oiq_on else {}
    last = await db.owneriq_kpis.find_one({"date": iso, "cg1_user_id": uid, "source": {"$ne": "breakdown"}},
                                          {"synced_at": 1}, sort=[("synced_at", -1)]) if oiq_on else None
    # This week's focus: what they wrote last week for this week, else this
    # week's scoring focus (Weekly Planner).
    d = now.date()
    week_end = (d + timedelta(days=6 - d.weekday())).isoformat()
    last_week = (d + timedelta(days=-1 - d.weekday())).isoformat()
    focus: list[str] = []
    prev_plan = await db.weekly_planners.find_one({"user_id": uid, "week_ending": last_week}, {"focus_next_week": 1})
    focus = [str(x).strip() for x in ((prev_plan or {}).get("focus_next_week") or []) if str(x).strip()][:3]
    if not focus:
        plan = await db.weekly_planners.find_one({"user_id": uid, "week_ending": week_end}, {"personal": 1})
        f = str(((plan or {}).get("personal") or {}).get("scoring_focus") or "").strip()
        focus = [f] if f else []
    return {"date": iso, "synced_at": (last or {}).get("synced_at"), "week_focus": focus,
            "averages": await my_averages(uid, d), "label": _label(iso), "sunday": now.weekday() == 6,
            "setup": await my_setup(uid, iso),
            "live": {k: int(live.get(k) or 0) for k in ("doors", "spoken", "pitched", "closed", "hit")},
            "has_live": bool(live)}


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
    end_win = (0, 0) if sat else (19 * 60 + 30, 22 * 60)   # no breakdown on a Saturday
    phase = None if sun else "setup" if start_win[0] <= mins < start_win[1] else "breakdown" if end_win[0] <= mins < end_win[1] else None
    is_coach = (user.get("role") or "").lower() in ("leader", "admin")
    sec = await _sector_of_leader(str(user["id"]), iso)
    is_leader = is_coach or bool(sec)
    members = (sec or {}).get("member_ids") or []
    setups = breakdowns = 0
    if members:
        async for d in db.sector_days.find({"date": iso, "user_id": {"$in": members}}, {"setup": 1, "breakdown": 1}):
            setups += 1 if d.get("setup") else 0
            breakdowns += 1 if d.get("breakdown") else 0
    from routes.coverage import sector_of
    mine = await sector_of(str(user["id"]), iso, user.get("office_id"))
    in_sector = bool(mine)
    sector_info = None
    if mine:
        names = [p["user_name"] for p in await _users_by_ids(mine.get("member_ids") or [])]
        sector_info = {"leader_name": mine.get("leader_name") or "", "postcode": mine.get("postcode") or "",
                       "goal": mine.get("goal"), "leads": mine.get("leader_id") == str(user["id"]), "members": names}
    mine_day = await db.sector_days.find_one({"date": iso, "user_id": str(user["id"])}, {"breakdown": 1})
    # Planning the day's sectors: from 09:30 (Saturday 08:30) until the field.
    from routes.sector_plan import can_plan
    plan_win = (8 * 60 + 30, 10 * 60) if sat else (9 * 60 + 30, 13 * 60 + 30)
    planning = not sun and plan_win[0] <= mins < plan_win[1] and await can_plan(user, iso)
    plan_doc = await db.sector_plan_sends.find_one({"office_id": user.get("office_id"), "date": iso}, {"_id": 0}) or {}
    plan_sent = bool(plan_doc.get("at"))
    plan_confirmed = bool(plan_doc.get("confirmed_at"))
    plan_count = await db.sectors.count_documents({"office_id": user.get("office_id"), "date": iso})
    return {"date": iso, "phase": phase, "is_leader": is_leader, "is_coach": is_coach, "has_sector": bool(members),
            "breakdown_posted_at": (sec or {}).get("breakdown_posted_at"),
            "planning": planning, "plan_sent": plan_sent, "plan_confirmed": plan_confirmed, "plan_sectors": plan_count,
            "can_plan": await can_plan(user, iso),
            "my_breakdown_done": bool((mine_day or {}).get("breakdown")),
            "in_sector": in_sector, "sector": sector_info,
            "members": len(members), "setups": setups, "breakdowns": breakdowns,
            "my_setup": await my_setup(str(user["id"]), iso)}


async def _leaders_out_today() -> list[str]:
    """Coaches and Admins out today: anyone not marked away on Bells (an
    Admin coaches in the field too)."""
    now = datetime.now(APP_TZ)
    d = now.date()
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    away: set[str] = set()
    in_today: set[str] = set()
    async for e in db.bells_entries.find({"week_ending": week_ending}, {"user_id": 1, "days": 1}):
        days = e.get("days") or []
        st = (days[d.weekday()] or {}).get("status") if d.weekday() < len(days) else None
        if st in ("ab", "ns", "rt", "pc"):
            away.add(str(e.get("user_id")))
        elif st == "in":
            in_today.add(str(e.get("user_id")))
    out = []
    async for u in db.users.find({"role": {"$in": ["leader", "admin"]}, "deleted": {"$ne": True},
                                  "is_active": {"$ne": False}, "is_demo": {"$ne": True}}, {"_id": 1, "role": 1}):
        uid = str(u["_id"])
        if uid in away:
            continue
        out.append(uid)
    return out


async def sector_start_tick() -> int:
    """Field start: every Coach out today is asked to start their sector set-up."""
    from core.push import send_push_to_user
    sent = 0
    # Sectors planned in the morning: their leaders are asked for the set-ups.
    async for sec in db.sectors.find({"date": today_iso()}, {"leader_id": 1, "member_ids": 1, "postcode": 1}):
        members = sec.get("member_ids") or []
        done = await db.sector_days.count_documents({"date": today_iso(), "user_id": {"$in": members}, "setup": {"$ne": None}})
        if members and done < len(members):
            try:
                await send_push_to_user(sec["leader_id"], f"🎯 Your sector: do the set-ups{' · ' + sec['postcode'] if sec.get('postcode') else ''}",
                                        "Everyone's goal, KPI and focus, and your map.",
                                        {"type": "sector_setup", "url": "/sector"})
                sent += 1
            except Exception as ex:
                logger.warning("sector set-up push failed for %s: %s", sec.get("leader_id"), ex)
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


# ── The sector map: one sector's outline and its marked-off streets ──────────

@router.get("/sector/map")
async def sector_map(request: Request, date: Optional[str] = None, leader: Optional[str] = None):
    """The map for the sector the caller is in that day (or, for an Admin or
    the leader, `leader`'s sector): Acwyre's outline of the sector its
    postcode is in, streets confirmed in the last 12 weeks (black), and the
    day's draft mark-offs. Only this one sector: never the territory list."""
    from routes.coverage import KEEP_DAYS, sector_of
    from routes.territory import sector_for_postcode
    from core.territory import KIND_LABEL
    user = await get_current_user(request)
    iso = _clean_date(date)
    me = str(user["id"])
    is_admin = (user.get("role") or "").lower() == "admin"
    # Only the sector's own people see its map (and Admins).
    if leader and (is_admin or leader == me):
        sec = await db.sectors.find_one({"office_id": user.get("office_id"), "date": iso, "leader_id": str(leader)}, {"_id": 0})
    else:
        sec = await sector_of(me, iso, user.get("office_id"))
    if not sec:
        return {"date": iso, "sector": None}
    shape = await sector_for_postcode(user.get("office_id"), sec.get("postcode") or "", with_shape=True)
    box = (shape or {}).get("bbox")
    since = (Date.fromisoformat(iso) - timedelta(days=KEEP_DAYS)).isoformat()
    q: dict = {"office_id": user.get("office_id")}
    ors: list = [{"date": iso, "sector_leader_id": sec["leader_id"]}]
    if box:
        # Confirmed streets anywhere in (or crossing) the sector's box.
        pad = 0.002
        ors.append({"date": {"$gte": since}, "status": {"$nin": ["draft", "plan", "requested"]},
                    "bbox.s": {"$lte": box["n"] + pad}, "bbox.n": {"$gte": box["s"] - pad},
                    "bbox.w": {"$lte": box["e"] + pad}, "bbox.e": {"$gte": box["w"] - pad}})
    elif sec.get("postcode"):
        ors.append({"date": {"$gte": since}, "status": {"$nin": ["draft", "plan", "requested"]}, "district": district_of(sec["postcode"])})
    # Other sectors working the same area that day: their plan and what
    # they've marked done so far, shown faintly and view-only.
    if box:
        ors.append({"date": iso, "sector_leader_id": {"$nin": [sec["leader_id"], None]}, "status": {"$in": ["plan", "draft"]},
                    "bbox.s": {"$lte": box["n"]}, "bbox.n": {"$gte": box["s"]},
                    "bbox.w": {"$lte": box["e"]}, "bbox.e": {"$gte": box["w"]}})
    elif sec.get("postcode"):
        ors.append({"date": iso, "sector_leader_id": {"$nin": [sec["leader_id"], None]}, "status": {"$in": ["plan", "draft"]},
                    "district": district_of(sec["postcode"])})
    q["$or"] = ors
    marks = await db.coverage_marks.find(q, {"_id": 0, "office_id": 0}).sort("date", -1).to_list(800)
    today = Date.fromisoformat(today_iso())
    other_ids = {m["sector_leader_id"] for m in marks if m.get("sector_leader_id") and m["sector_leader_id"] != sec["leader_id"]
                 and m.get("status") in ("plan", "draft")}
    other_names = {p["user_id"]: p["user_name"] for p in await _users_by_ids(list(other_ids))} if other_ids else {}
    for m in marks:
        m["days_ago"] = (today - Date.fromisoformat(m["date"])).days
        m["status"] = m.get("status") or "confirmed"
        other = m.get("sector_leader_id") not in (None, sec["leader_id"]) and m["status"] in ("plan", "draft")
        if other:
            m["other"] = True
            m["other_leader"] = other_names.get(m.get("sector_leader_id"), "")
        author = m.get("author_id") or m.get("leader_id")
        m["can_delete"] = not other and (is_admin or author == me or (m.get("sector_leader_id") == me))
        for k in ("bbox", "author_id", "leader_id", "sector_leader_id"):
            m.pop(k, None)
    members = await _users_by_ids(sec.get("member_ids") or [])
    names = {p["user_id"]: p["user_name"] for p in members}
    leads = sec["leader_id"] == me
    from routes.coverage import HOP_COLOURS, my_hop_colour
    hops = [{"colour": h.get("colour"), "member_ids": h.get("member_ids") or [],
             "members": [names.get(i, "") for i in h.get("member_ids") or [] if i in names]}
            for h in sec.get("hops") or [] if h.get("colour") in HOP_COLOURS]
    if shape:
        shape.pop("office", None)
        shape["label"] = KIND_LABEL.get(shape.get("kind"), "")
    return {
        "date": iso,
        "sector": {"leader_id": sec["leader_id"], "leader_name": sec.get("leader_name") or "",
                   "postcode": sec.get("postcode") or "", "goal": sec.get("goal"),
                   "members": [m["user_name"] for m in members],
                   "people": [{"user_id": m["user_id"], "name": m["user_name"]} for m in members]},
        "hops": hops,
        "colours": HOP_COLOURS,
        "my_colour": my_hop_colour(sec, me),
        "leads": leads,
        "shape": shape,
        "marks": marks,
        # The day and the day after, for streets forgotten at the breakdown.
        "can_draw": (Date.fromisoformat(today_iso()) - Date.fromisoformat(iso)).days in (0, 1)
                    and (leads or is_admin or me in (sec.get("member_ids") or [])),
        "late": iso != today_iso(),
        "can_confirm": leads or is_admin,
        "can_share": leads,
        "shared": bool(sec.get("map_shared_at")),
        "drafts": sum(1 for m in marks if m["status"] == "draft" and not m.get("other")),
        "requests": sum(1 for m in marks if m["status"] == "requested"),
        "others": sorted({m["other_leader"] for m in marks if m.get("other") and m.get("other_leader")}),
        "me": me,
    }


def district_of(pc: str) -> str:
    from core.areas import district
    return district(pc)


@router.put("/sector/hops")
async def save_hops(request: Request, date: Optional[str] = None):
    """The sector leader's bunny hops: a colour each and who's in it. Only
    people in the sector; someone is in one hop at a time."""
    from routes.coverage import HOP_COLOURS
    user = await get_current_user(request)
    iso = _clean_date(date)
    sec = await _sector_of_leader(str(user["id"]), iso)
    if not sec:
        raise HTTPException(status_code=400, detail="Pick who's in your sector first")
    body = await request.json()
    members = set(sec.get("member_ids") or [])
    seen: set = set()
    hops = []
    for h in body.get("hops") or []:
        colour = str((h or {}).get("colour") or "").lower()
        if colour not in HOP_COLOURS or any(x["colour"] == colour for x in hops):
            continue
        ids = [i for i in dict.fromkeys(str(x) for x in (h.get("member_ids") or [])) if i in members and i not in seen]
        seen.update(ids)
        hops.append({"colour": colour, "member_ids": ids})
    await db.sectors.update_one({"leader_id": str(user["id"]), "date": iso}, {"$set": {"hops": hops}})
    return {"hops": hops}


@router.post("/sector/map/share")
async def share_sector_map(request: Request, date: Optional[str] = None):
    """Send the sector map to everyone the leader added to the sector."""
    from core.push import send_push_to_user
    from core.territory import postcode_to_sector
    user = await get_current_user(request)
    iso = _clean_date(date)
    sec = await _sector_of_leader(str(user["id"]), iso)
    if not sec:
        raise HTTPException(status_code=400, detail="Pick who's in your sector first")
    code = postcode_to_sector(sec.get("postcode") or "")
    from routes.coverage import my_hop_colour
    # Once it's sent the map is set: it opens in "move" for everyone and
    # BAs only draw by pressing a button (Mark done / Request more streets).
    await db.sectors.update_one({"leader_id": sec["leader_id"], "date": iso},
                                {"$set": {"map_shared_at": datetime.now(timezone.utc).isoformat()}})
    sent = 0
    for uid in sec.get("member_ids") or []:
        if uid == str(user["id"]):
            continue
        colour = my_hop_colour(sec, uid)
        area = f"Your area: {colour.capitalize()}" if colour else "Your sector map"
        try:
            await send_push_to_user(uid, f"🗺️ {area}{f' · {code}' if code else ''}",
                                    (f"Work the {colour} area. " if colour else "") + "Draw over the streets as you finish them.",
                                    {"type": "sector_setup", "url": f"/sector-map?date={iso}"})
            sent += 1
        except Exception as ex:
            logger.warning("sector map push failed for %s: %s", uid, ex)
    return {"sent": sent}
