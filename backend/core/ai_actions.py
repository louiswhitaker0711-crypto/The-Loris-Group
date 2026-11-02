"""Things the AI can fill in for someone, always as that person.

Shared by the in-app AI's "Use this" buttons (routes/ai_assistant.py) and the
Claude connector's write tools (routes/claude_connector.py). Every action runs
with the same permissions the screens use, so the AI can never do more than
the person could do themselves in the app:

  set_weekly_goal    their own weekly goal on Bells (this week)
  save_setup         a sector set-up: goal, focus, KPI, positive. Their own,
                     or someone else's if they lead that sector or are a
                     Coach/Admin over them (the same rule as PUT /sector/day)
  set_planner_box    one box of a day in their own weekly planner
  add_planner_note   a note in a day's Notes box in their own planner
  set_hops           bunny hops for a sector they lead (Admins: any sector)

Agreed with the Owner, 2 Nov 2026: suggestions only change anything once the
person taps "Use this" (in the app) or says yes (in Claude).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import HTTPException

from core.ai_context import today_uk, week_ending_of
from database import db

SETUP_FIELDS = ("goal", "focus", "kpi_metric", "kpi_target", "positive")


def _day(raw: Optional[str], default: Optional[date] = None) -> date:
    if not raw:
        return default or today_uk()
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"'{raw}' isn't a date. Use YYYY-MM-DD.")


def _not_viewer(actor: dict) -> None:
    if actor.get("is_viewer"):
        raise HTTPException(status_code=403, detail="Read-only account")


def _uid(person: dict) -> str:
    return str(person.get("id") or person.get("_id"))


# ── Weekly goal ───────────────────────────────────────────────────────────────

async def set_weekly_goal(actor: dict, goal) -> dict:
    """The actor's own weekly goal for this week (the same as Bells' "my goal")."""
    from core.goal_audit import record_goal_change
    from routes.bells import _normalize_days
    _not_viewer(actor)
    try:
        goal = int(goal)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="The goal needs to be a number of sign-ups")
    if not 0 <= goal <= 150:
        raise HTTPException(status_code=400, detail="That goal doesn't look right (0–150 sign-ups)")
    office_id = actor.get("office_id")
    me = _uid(actor)
    week = week_ending_of(today_uk())
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.bells_entries.find_one({"office_id": office_id, "week_ending": week, "user_id": me})
    if existing:
        await db.bells_entries.update_one({"_id": existing["_id"]}, {"$set": {
            "weekly_goal": goal, "weekly_goal_source": "app", "updated_at": now}})
    else:
        await db.bells_entries.update_one(
            {"office_id": office_id, "week_ending": week, "user_id": me},
            {"$set": {"weekly_goal": goal, "weekly_goal_source": "app", "updated_at": now},
             "$setOnInsert": {"id": str(uuid.uuid4()), "user_name": actor.get("name", ""), "role": actor.get("role"),
                              "stage": None, "break_even": None, "last_week_total": None,
                              "last_week_total_source": None, "days": _normalize_days([]),
                              "created_by_id": me, "created_at": now}},
            upsert=True)
    await record_goal_change(db, user_id=me, week_ending=week, field="weekly_goal",
                             old=(existing or {}).get("weekly_goal"), new=goal, actor=actor, source="AI: Use this")
    return {"week_ending": week, "weekly_goal": goal}


# ── Sector set-up ─────────────────────────────────────────────────────────────

async def save_setup(actor: dict, target_id: str, day: Optional[str], fields: dict) -> dict:
    """Goal / focus / KPI / positive on a set-up. Keeps whatever else is
    already on it (their COD pick, who's teaching them)."""
    from routes.sector import _can_edit, _my_sector, clean_setup
    _not_viewer(actor)
    iso = _day(day).isoformat()
    target_id = str(target_id or _uid(actor))
    me = _uid(actor)
    if not await _can_edit(actor, target_id, iso):
        raise HTTPException(status_code=403, detail="That person is not on your team or in your sector")
    if target_id != me:
        sec = await _my_sector(me, iso)
        leads = bool(sec) and sec.get("leader_id") == me
        if not (leads or (actor.get("role") or "").lower() in ("leader", "admin")):
            raise HTTPException(status_code=403, detail="Only the sector leader sets other people's set-ups")
    target = await db.users.find_one({"_id": ObjectId(target_id)}, {"name": 1, "office_id": 1}) \
        if ObjectId.is_valid(target_id) else None
    if not target:
        raise HTTPException(status_code=404, detail="Person not found")
    before = await db.sector_days.find_one({"user_id": target_id, "date": iso}, {"setup": 1}) or {}
    current = {k: v for k, v in (before.get("setup") or {}).items() if k not in ("by_id", "at")}
    wanted = {k: fields.get(k) for k in SETUP_FIELDS if fields.get(k) not in (None, "")}
    if not wanted:
        raise HTTPException(status_code=400, detail="Nothing to fill in")
    now = datetime.now(timezone.utc).isoformat()
    setup = {**clean_setup({**current, **wanted}), "by_id": me, "at": now, "by_ai": True}
    await db.sector_days.update_one(
        {"user_id": target_id, "date": iso},
        {"$set": {"setup": setup, "office_id": target.get("office_id"), "user_name": target.get("name") or "",
                  "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True)
    return {"date": iso, "person": target.get("name"),
            "setup": {k: setup.get(k) for k in SETUP_FIELDS if setup.get(k) not in (None, "")}}


# ── Planner ───────────────────────────────────────────────────────────────────

async def _my_planner(actor: dict, d: date) -> dict:
    from routes.weekly_planners import _seed
    me = _uid(actor)
    week = week_ending_of(d)
    p = await db.weekly_planners.find_one({"user_id": me, "week_ending": week})
    if not p:
        try:
            await db.weekly_planners.insert_one(_seed(me, actor.get("office_id") or "", week))
        except Exception:
            pass   # made by another request at the same moment
        p = await db.weekly_planners.find_one({"user_id": me, "week_ending": week})
    return p


def planner_boxes() -> dict:
    from routes.weekly_planners import DAY_FIELD_LABELS
    return dict(DAY_FIELD_LABELS)


async def set_planner_box(actor: dict, day: Optional[str], box: str, text: str, append: bool = True) -> dict:
    """Write into one box of a day in their own planner (Mon–Sat)."""
    from routes.notes_folder import _refile
    from routes.weekly_planners import DAY_FIELD_LABELS, DAY_NAMES
    _not_viewer(actor)
    d = _day(day)
    if d.weekday() == 6:
        raise HTTPException(status_code=400, detail="The planner runs Monday to Saturday")
    labels = {v.lower(): k for k, v in DAY_FIELD_LABELS.items()}
    key = box if box in DAY_FIELD_LABELS else labels.get(str(box or "").strip().lower())
    if not key:
        raise HTTPException(status_code=400, detail="Pick one of the planner's boxes: " + ", ".join(DAY_FIELD_LABELS.values()))
    text = str(text or "").strip()[:4000]
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to write")
    p = await _my_planner(actor, d)
    slot = str(d.weekday())
    old = ((p.get("days") or {}).get(slot) or {}).get(key) or ""
    new = f"{old.rstrip()}\n{text}" if append and old.strip() else text
    now = datetime.now(timezone.utc).isoformat()
    await db.weekly_planners.update_one({"_id": p["_id"]}, {"$set": {f"days.{slot}.{key}": new[:4000], "updated_at": now}})
    p = await db.weekly_planners.find_one({"_id": p["_id"]})
    try:
        await _refile(actor, p)
    except Exception:
        pass
    return {"date": d.isoformat(), "day": DAY_NAMES[d.weekday()], "box": DAY_FIELD_LABELS[key], "text": new[:4000]}


async def add_planner_note(actor: dict, day: Optional[str], title: str, body: str) -> dict:
    """A note in a day's big Notes box, in their own planner."""
    from routes.notes_folder import _refile, clean_slot_notes
    _not_viewer(actor)
    d = _day(day)
    if d.weekday() == 6:
        d = d - timedelta(days=1)
    title = " ".join(str(title or "").split())[:120]
    body = str(body or "").strip()[:8000]
    if not (title or body):
        raise HTTPException(status_code=400, detail="Write something first")
    p = await _my_planner(actor, d)
    slot_notes = {k: list(v) for k, v in (p.get("slot_notes") or {}).items()}
    nid = uuid.uuid4().hex[:16]
    slot_notes.setdefault(f"{d.weekday()}:day", []).append(
        {"id": nid, "title": title, "head": "", "body": body, "photos": [], "label": "Day notes"})
    upd = {"slot_notes": clean_slot_notes(slot_notes), "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.weekly_planners.update_one({"_id": p["_id"]}, {"$set": upd})
    p.update(upd)
    try:
        await _refile(actor, p)
    except Exception:
        pass
    return {"date": d.isoformat(), "note_id": nid, "title": title}


# ── Bunny hops ────────────────────────────────────────────────────────────────

async def set_hops(actor: dict, day: Optional[str], hops: list, leader_id: Optional[str] = None) -> dict:
    """Hops for a sector the actor leads (an Admin: any sector, by its leader).
    `hops` is a list of lists of names; names only pick from the people already
    in that sector, so they never widen who's in it."""
    from core.hops import keep_shadows, sync_shadow_days
    from routes.coverage import HOP_COLOURS
    _not_viewer(actor)
    iso = _day(day).isoformat()
    me = _uid(actor)
    is_admin = (actor.get("role") or "").lower() == "admin"
    leader = str(leader_id or me)
    if leader != me and not is_admin:
        raise HTTPException(status_code=403, detail="Only the sector's leader or an Admin can set its bunny hops")
    sec = await db.sectors.find_one({"office_id": actor.get("office_id"), "date": iso, "leader_id": leader}, {"_id": 0})
    if not sec:
        raise HTTPException(status_code=400, detail="There's no sector for that day yet: set who's in it first")
    members = [str(m) for m in (sec.get("member_ids") or [])]
    names = {str(u["_id"]): (u.get("name") or "") async for u in db.users.find(
        {"_id": {"$in": [ObjectId(m) for m in members if ObjectId.is_valid(m)]}}, {"name": 1})}

    def match(n: str) -> str:
        n = str(n or "").strip().lower()
        exact = [i for i, v in names.items() if v.lower() == n]
        part = exact or [i for i, v in names.items() if n and n in v.lower()]
        if len(part) != 1:
            raise HTTPException(status_code=400, detail=f"'{n}' isn't exactly one person in that sector")
        return part[0]

    if not isinstance(hops, list) or len(hops) > len(HOP_COLOURS):
        raise HTTPException(status_code=400, detail=f"Up to {len(HOP_COLOURS)} hops")
    seen: set = set()
    out = []
    for colour, group in zip(HOP_COLOURS, hops):
        ids = [i for i in dict.fromkeys(match(n) for n in (group or [])) if i not in seen]
        seen.update(ids)
        if ids:
            out.append({"colour": colour, "member_ids": ids})
    out = keep_shadows(out, sec.get("hops") or [])
    await db.sectors.update_one({"leader_id": sec["leader_id"], "date": iso}, {"$set": {"hops": out}})
    await sync_shadow_days(sec.get("office_id") or actor.get("office_id"), iso, [sec], [{**sec, "hops": out}])
    return {"date": iso, "hops": [{"colour": h["colour"], "people": [names.get(i, "?") for i in h["member_ids"]]}
                                  for h in out]}
