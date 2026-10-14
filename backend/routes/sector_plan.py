"""Planning the day's sectors at the morning sector leaders meeting.

From 09:30 (Saturday 08:30) the Owner (an Admin), or whoever the Owner has
made today's sector planner, builds every sector for the day in one place:
the leader, the postcode, who's in it and (optionally) the sector goal.
Confirm, and at SEND_AT (10:30, Saturday 09:30; straight away if later)
everyone's told: each person which sector they're in and with whom, each
leader that their sector's ready for the map and the set-ups, anyone out
today but not in a sector that they aren't yet. Nothing confirmed by
REMIND_AT (10:45, Saturday 09:45) reminds the Owner and the planner.

After sending, the planner can still change any sector's postcode (its
people are told the new one) and who's in which sector until the field
starts (everyone in the sectors that changed hears "Sectors have changed").
A planned sector's leader changes only its goal (routes/sector.py). The
sectors are the normal `sectors` documents, so maps, set-ups and
breakdowns work on them as usual.

  GET    /api/sector/plan?date=              the day's sectors and everyone
  PUT    /api/sector/plan/sector?date=       {leader_id, postcode, goal, member_ids}
  PUT    /api/sector/plan/postcode?date=     {leader_id, postcode}
  DELETE /api/sector/plan/sector?date=&leader=
  POST   /api/sector/plan/confirm?date=      confirm (sends now if past SEND_AT)
  PUT    /api/sector/plan/planner?date=      {user_id|null}  Admin: today's planner
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from database import db
from routes.sector import _clean_date, _deletable, _label, clean_postcode, _int

logger = logging.getLogger(__name__)
router = APIRouter()

_ACTIVE = {"deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_demo": {"$ne": True}}


SEND_AT = {"weekday": (10, 30), "sat": (9, 30)}
REMIND_AT = {"weekday": (10, 45), "sat": (9, 45)}
FIELD_START = {"weekday": (13, 30), "sat": (10, 0)}


def _slot(table: dict, d) -> tuple[int, int]:
    return table["sat" if d.weekday() == 5 else "weekday"]


def _past(now: datetime, hm: tuple[int, int]) -> bool:
    return (now.hour, now.minute) >= hm


def _now_uk() -> datetime:
    from core.app_time import APP_TZ
    return datetime.now(APP_TZ)


def _first(n: str) -> str:
    return (n or "").strip().split(" ")[0] or "Someone"


async def planner_for(office_id: str, iso: str) -> Optional[dict]:
    return await db.sector_planners.find_one({"office_id": office_id, "date": iso}, {"_id": 0})


async def can_plan(user: dict, iso: str) -> bool:
    if (user.get("role") or "").lower() == "admin" and not user.get("is_demo"):
        return True
    p = await planner_for(user.get("office_id"), iso)
    return bool(p) and p.get("user_id") == str(user["id"])


async def _require_planner(request: Request, date: Optional[str]) -> tuple[dict, str]:
    user = await get_current_user(request)
    iso = _clean_date(date)
    if not await can_plan(user, iso):
        raise HTTPException(status_code=403, detail="Only the Owner or today's sector planner plans the sectors")
    return user, iso


async def _office_people(office_id: str) -> list[dict]:
    rows = [{"user_id": str(u["_id"]), "name": u.get("name") or "", "role": u.get("role")}
            async for u in db.users.find({"office_id": office_id, "role": {"$in": ["trainee", "leader", "admin"]}, **_ACTIVE},
                                         {"name": 1, "role": 1})]
    rows.sort(key=lambda r: r["name"].lower())
    return rows


@router.get("/sector/plan")
async def get_plan(request: Request, date: Optional[str] = None):
    user = await get_current_user(request)
    iso = _clean_date(date)
    office_id = user.get("office_id")
    people = await _office_people(office_id)
    names = {p["user_id"]: p["name"] for p in people}
    sectors = []
    where: dict[str, str] = {}
    async for s in db.sectors.find({"office_id": office_id, "date": iso}, {"_id": 0}).sort("leader_name", 1):
        members = [m for m in s.get("member_ids") or [] if m in names]
        for m in members:
            where[m] = s["leader_id"]
        sectors.append({"leader_id": s["leader_id"], "leader_name": names.get(s["leader_id"]) or s.get("leader_name") or "",
                        "postcode": s.get("postcode") or "", "goal": s.get("goal"),
                        "member_ids": members, "can_delete": await _deletable(s)})
    planner = await planner_for(office_id, iso)
    sent = await db.sector_plan_sends.find_one({"office_id": office_id, "date": iso}, {"_id": 0})
    d = datetime.fromisoformat(iso).date()
    sh, sm = _slot(SEND_AT, d)
    fh, fm = _slot(FIELD_START, d)
    now = _now_uk()
    return {"date": iso, "label": _label(iso), "can_plan": await can_plan(user, iso),
            "confirmed_at": (sent or {}).get("confirmed_at"), "send_at": f"{sh:02d}:{sm:02d}",
            "people_locked": bool((sent or {}).get("at")) and (now.date().isoformat() > iso or _past(now, (fh, fm))),
            "is_admin": (user.get("role") or "").lower() == "admin",
            "planner": ({"user_id": planner["user_id"], "name": names.get(planner["user_id"], "")} if planner else None),
            "sectors": sectors,
            "people": [{**p, "sector_leader_id": where.get(p["user_id"])} for p in people],
            "sent_at": (sent or {}).get("at")}


@router.put("/sector/plan/sector")
async def save_planned_sector(request: Request, date: Optional[str] = None):
    user, iso = await _require_planner(request, date)
    office_id = user.get("office_id")
    body = await request.json()
    leader = str(body.get("leader_id") or "")
    if not ObjectId.is_valid(leader):
        raise HTTPException(status_code=400, detail="Pick the sector leader")
    wanted = [str(i) for i in (body.get("member_ids") or []) if ObjectId.is_valid(str(i))][:40]
    ids = list(dict.fromkeys([leader] + wanted))
    valid = {str(u["_id"]): u async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in ids]}, "office_id": office_id, **_ACTIVE}, {"name": 1})}
    if leader not in valid:
        raise HTTPException(status_code=400, detail="That leader isn't in your office")
    members = [i for i in ids if i in valid]
    sent = await db.sector_plan_sends.find_one({"office_id": office_id, "date": iso}, {"_id": 0})
    before = {x["leader_id"]: x async for x in db.sectors.find({"office_id": office_id, "date": iso}, {"_id": 0})}
    old_members = set((before.get(leader) or {}).get("member_ids") or [])
    if sent and sent.get("at") and set(members) != old_members:
        d = datetime.fromisoformat(iso).date()
        now = _now_uk()
        if now.date().isoformat() > iso or _past(now, _slot(FIELD_START, d)):
            raise HTTPException(status_code=400, detail="The field's started: who's in each sector can't change now")
    # Nobody's in two sectors.
    await db.sectors.update_many({"office_id": office_id, "date": iso, "leader_id": {"$ne": leader}},
                                 {"$pull": {"member_ids": {"$in": members}}})
    raw = body.get("goal")
    now = datetime.now(timezone.utc).isoformat()
    await db.sectors.update_one({"office_id": office_id, "leader_id": leader, "date": iso}, {
        "$set": {"leader_name": valid[leader].get("name") or "", "member_ids": members,
                 "postcode": clean_postcode(body.get("postcode")),
                 "goal": None if raw in (None, "") else _int(raw, 0, 200),
                 "planned_by": user.get("name") or "", "updated_at": now},
        "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}}, upsert=True)
    if sent and sent.get("at"):
        # Already told: everyone in the sectors that changed hears about it.
        after = {x["leader_id"]: x async for x in db.sectors.find({"office_id": office_id, "date": iso}, {"_id": 0})}
        changed = [k for k in set(before) | set(after)
                   if set((before.get(k) or {}).get("member_ids") or []) != set((after.get(k) or {}).get("member_ids") or [])
                   or (before.get(k) or {}).get("postcode") != (after.get(k) or {}).get("postcode")]
        if changed:
            await _tell(office_id, iso, changed, "🔄 Sectors have changed")
    return await get_plan(request, iso)


@router.put("/sector/plan/postcode")
async def change_postcode(request: Request, date: Optional[str] = None):
    """The planner changes a sector's postcode (also from the sector's page);
    once sent, its people are told the new one."""
    user, iso = await _require_planner(request, date)
    office_id = user.get("office_id")
    body = await request.json()
    leader = str(body.get("leader_id") or "")
    s0 = await db.sectors.find_one({"office_id": office_id, "date": iso, "leader_id": leader}, {"_id": 0})
    if not s0:
        raise HTTPException(status_code=404, detail="That sector wasn't found")
    pc = clean_postcode(body.get("postcode"))
    await db.sectors.update_one({"office_id": office_id, "date": iso, "leader_id": leader}, {"$set": {"postcode": pc}})
    sent = await db.sector_plan_sends.find_one({"office_id": office_id, "date": iso}, {"_id": 0})
    if pc != (s0.get("postcode") or "") and (sent or {}).get("at"):
        from core.push import send_push_to_user
        for m in dict.fromkeys([leader, *(s0.get("member_ids") or [])]):
            try:
                await send_push_to_user(m, f"📍 Your sector's now {pc or 'no postcode'}",
                                        f"Today's sector has moved to {pc}." if pc else "Your sector leader will confirm where.",
                                        {"type": "sector_setup", "url": "/my-sector"})
            except Exception as ex:
                logger.warning("postcode push failed for %s: %s", m, ex)
    return await get_plan(request, iso)


@router.delete("/sector/plan/sector")
async def delete_planned_sector(request: Request, date: Optional[str] = None, leader: Optional[str] = None):
    user, iso = await _require_planner(request, date)
    s = await db.sectors.find_one({"office_id": user.get("office_id"), "date": iso, "leader_id": str(leader or "")}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="That sector wasn't found")
    if not await _deletable(s):
        raise HTTPException(status_code=400, detail="This sector's day is finished, so it can't be deleted")
    await db.coverage_marks.delete_many({"office_id": s.get("office_id"), "date": iso, "sector_leader_id": s["leader_id"]})
    await db.sectors.delete_one({"office_id": s.get("office_id"), "date": iso, "leader_id": s["leader_id"]})
    return await get_plan(request, iso)


def plan_messages(sectors: list[dict], names: dict, everyone: list[str]) -> dict[str, tuple[str, str]]:
    """{user_id: (title, body)} for Send sectors."""
    out: dict[str, tuple[str, str]] = {}
    placed: set[str] = set()
    for s in sectors:
        code = s.get("postcode") or "no postcode yet"
        leader = s["leader_id"]
        crew = [m for m in s.get("member_ids") or [] if m != leader]
        placed.update([leader, *crew])
        with_names = ", ".join(_first(names.get(m, "")) for m in crew)
        goal = f" · sector goal {s['goal']}" if s.get("goal") is not None else ""
        out[leader] = ("🗺️ Your sector's ready · " + code,
                       f"You're leading {code} today{f' with {with_names}' if with_names else ''}{goal}. "
                       "Draw your map and do the set-ups.")
        for m in crew:
            others = ", ".join(_first(names.get(x, "")) for x in crew if x != m)
            out[m] = (f"📍 You're in {_first(names.get(leader, ''))}'s sector today · {code}",
                      f"{f'With {others}. ' if others else ''}Your set-up and map will follow from your sector leader.")
    for uid in everyone:
        if uid not in placed:
            out[uid] = ("You're not in a sector yet today", "Find the sector planner or your Coach.")
    return out


async def _tell(office_id: str, iso: str, leaders: Optional[list] = None, title_override: Optional[str] = None) -> int:
    """Send each person their sector (all of the day's sectors, or just
    `leaders`'). With `leaders` None, anyone out today but not in a sector
    is told too."""
    from core.push import send_push_to_user
    people = await _office_people(office_id)
    names = {p["user_id"]: p["name"] for p in people}
    sectors = [x async for x in db.sectors.find({"office_id": office_id, "date": iso}, {"_id": 0})]
    everyone: list[str] = []
    if leaders is None:
        from routes.field_reset import out_today
        out = await out_today(datetime.fromisoformat(iso).date())
        everyone = [p["user_id"] for p in people if p["role"] in ("trainee", "leader") and p["user_id"] in out]
    msgs = plan_messages(sectors, names, everyone)
    if leaders is not None:
        keep: set[str] = set()
        before_after = [x for x in sectors if x["leader_id"] in leaders]
        for x in before_after:
            keep.update([x["leader_id"], *(x.get("member_ids") or [])])
        # Someone taken out of a changed sector (and now in none) hears too.
        moved = {m async for x in db.sector_plan_sends.find({"office_id": office_id, "date": iso}, {"told": 1}) for m in (x.get("told") or [])}
        placed = {m for x in sectors for m in [x["leader_id"], *(x.get("member_ids") or [])]}
        for m in moved - placed:
            msgs[m] = ("You're not in a sector now", "Your sector has changed: find the sector planner or your Coach.")
            keep.add(m)
        msgs = {k: v for k, v in msgs.items() if k in keep}
    sent = 0
    for uid, (title, body) in msgs.items():
        try:
            await send_push_to_user(uid, title_override if title_override and uid in msgs else title,
                                    f"{title}. {body}" if title_override else body,
                                    {"type": "sector_setup", "url": "/my-sector"})
            sent += 1
        except Exception as ex:
            logger.warning("sector plan push failed for %s: %s", uid, ex)
    told = [m for x in sectors for m in [x["leader_id"], *(x.get("member_ids") or [])]]
    await db.sector_plan_sends.update_one({"office_id": office_id, "date": iso}, {"$set": {"told": told}}, upsert=True)
    return sent


@router.post("/sector/plan/confirm")
async def confirm_plan(request: Request, date: Optional[str] = None):
    """Confirm the day's sectors. They go out at SEND_AT, or now if it's past."""
    user, iso = await _require_planner(request, date)
    office_id = user.get("office_id")
    if not await db.sectors.count_documents({"office_id": office_id, "date": iso}):
        raise HTTPException(status_code=400, detail="Add the sectors first")
    await db.sector_plan_sends.update_one({"office_id": office_id, "date": iso},
                                          {"$set": {"confirmed_at": datetime.now(timezone.utc).isoformat(),
                                                    "confirmed_by": user.get("name") or ""}}, upsert=True)
    d = datetime.fromisoformat(iso).date()
    now = _now_uk()
    sent = None
    if now.date().isoformat() >= iso and _past(now, _slot(SEND_AT, d)):
        sent = await send_now(office_id, iso)
    out = await get_plan(request, iso)
    return {**out, "sent_now": sent}


async def send_now(office_id: str, iso: str) -> int:
    """Send once (a confirmed plan that hasn't gone yet)."""
    claim = await db.sector_plan_sends.update_one(
        {"office_id": office_id, "date": iso, "confirmed_at": {"$ne": None}, "at": None},
        {"$set": {"at": datetime.now(timezone.utc).isoformat()}})
    if not getattr(claim, "modified_count", 0):
        return 0
    return await _tell(office_id, iso)


async def send_tick() -> int:
    """At SEND_AT: every office with a confirmed plan that hasn't gone yet."""
    now = _now_uk()
    if not _past(now, _slot(SEND_AT, now.date())):
        return 0
    iso = now.date().isoformat()
    n = 0
    async for x in db.sector_plan_sends.find({"date": iso, "confirmed_at": {"$ne": None}, "at": None}, {"office_id": 1}):
        n += await send_now(x["office_id"], iso)
    return n


async def remind_tick() -> int:
    """At REMIND_AT: nothing confirmed today → remind the Owner and the planner."""
    from core.admin_scope import office_level_admin_ids
    from core.push import send_push_to_user
    iso = _now_uk().date().isoformat()
    n = 0
    offices = {o["id"] async for o in db.offices.find({}, {"id": 1}) if o.get("id")}
    for office_id in offices:
        if await db.sector_plan_sends.find_one({"office_id": office_id, "date": iso, "confirmed_at": {"$ne": None}}, {"_id": 1}):
            continue
        to = [str(a["_id"]) for a in await office_level_admin_ids(office_id, database=db)]
        p = await planner_for(office_id, iso)
        if p:
            to.append(p["user_id"])
        planned = await db.sectors.count_documents({"office_id": office_id, "date": iso})
        for uid in dict.fromkeys(to):
            try:
                await send_push_to_user(uid, "🧭 Today's sectors aren't confirmed",
                                        f"{planned} sector{'' if planned == 1 else 's'} planned so far. Confirm them so everyone knows where they are."
                                        if planned else "Nothing's planned yet. Build today's sectors, or leaders will start their own at field start.",
                                        {"type": "sector_setup", "url": "/sector-plan"})
                n += 1
            except Exception as ex:
                logger.warning("plan reminder failed for %s: %s", uid, ex)
    return n


@router.put("/sector/plan/planner")
async def set_planner(request: Request, date: Optional[str] = None):
    """The Owner hands today's sector planning to someone (or takes it back)."""
    from core.push import send_push_to_user
    user = await get_current_user(request)
    iso = _clean_date(date)
    if (user.get("role") or "").lower() != "admin" or user.get("is_demo"):
        raise HTTPException(status_code=403, detail="Only the Owner chooses the sector planner")
    body = await request.json()
    uid = str(body.get("user_id") or "")
    if not uid:
        await db.sector_planners.delete_one({"office_id": user.get("office_id"), "date": iso})
        return await get_plan(request, iso)
    u = await db.users.find_one({"_id": ObjectId(uid), "office_id": user.get("office_id"), **_ACTIVE}, {"name": 1}) \
        if ObjectId.is_valid(uid) else None
    if not u:
        raise HTTPException(status_code=400, detail="That person isn't in your office")
    await db.sector_planners.update_one({"office_id": user.get("office_id"), "date": iso},
                                        {"$set": {"user_id": uid, "set_by": user.get("name") or ""}}, upsert=True)
    try:
        await send_push_to_user(uid, "🧭 You're planning sectors today",
                                f"{_first(user.get('name') or '')} has asked you to build today's sectors. Open the app to start.",
                                {"type": "sector_setup", "url": "/sector-plan"})
    except Exception as ex:
        logger.warning("planner push failed: %s", ex)
    return await get_plan(request, iso)
