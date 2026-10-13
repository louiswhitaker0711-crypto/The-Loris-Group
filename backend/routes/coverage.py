"""Coverage marks: the streets marked off on the sector map.

Through the day anyone in the sector (the BAs the leader added, and the
leader) taps along the streets they've done: those save as DRAFTS. At the
end of the day the sector leader looks over the map, adds or removes what's
changed, and confirms: everything confirmed turns solid black, and feeds
the Owner's big territory map.

Collection `coverage_marks`, one per save:
    {id, office_id, date, sector_leader_id, author_id, author_name,
     leader_id/leader_name (= the author, older records), postcode, district,
     lines: [[[lat, lng], …], …], bbox, status: draft|confirmed,
     confirmed_by, confirmed_at, note, created_at}
A mark with no status is a confirmed one from before drafts existed.

Bunny hops: the sector leader gives each pair a colour (HOP_COLOURS) on the
sector (`sectors.hops`: [{colour, member_ids}]) and draws each hop's area in
its colour at set-up. Those PLAN strokes have status "plan": they're the
day's map, never confirmed and never on the Owner's map. What's been done
is drawn in the hop's colour as drafts, then confirmed black.

  GET    /api/coverage?south&west&north&east&days=84   marks in view (Coach/Admin)
  POST   /api/coverage                                  save a draft mark-off
  POST   /api/coverage/confirm {date, leader_id?}       sector leader confirms the day
  POST   /api/coverage/{id}/approve | /decline           sector leader answers a BA's request
                                                        for more streets (kind "request")
  DELETE /api/coverage/{id}                             author, sector leader or Admin
"""
from __future__ import annotations

import uuid
from datetime import date as Date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, require_admin_or_leader
from core.app_time import APP_TZ
from core.areas import clean_pc, district
from database import db

router = APIRouter()

KEEP_DAYS = 84
HOP_COLOURS = ["red", "blue", "green", "purple", "orange"]
MAX_LINES = 60
MAX_POINTS = 400
UK_BOX = (49.5, -8.8, 61.0, 2.2)    # south, west, north, east: a sanity check, not a border


def clean_lines(raw) -> list:
    """Lines of [lat, lng] points, rounded to ~1 m, inside the UK box. Lines
    with fewer than two points are dropped."""
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="Draw at least one street")
    out = []
    for line in raw[:MAX_LINES]:
        pts = []
        for p in (line or [])[:MAX_POINTS]:
            try:
                lat, lng = float(p[0]), float(p[1])
            except (TypeError, ValueError, IndexError):
                continue
            if UK_BOX[0] <= lat <= UK_BOX[2] and UK_BOX[1] <= lng <= UK_BOX[3]:
                pts.append([round(lat, 5), round(lng, 5)])
        if len(pts) >= 2:
            out.append(pts)
    if not out:
        raise HTTPException(status_code=400, detail="Draw at least one street (two taps or more)")
    return out


def _bbox(lines: list) -> dict:
    lats = [p[0] for l in lines for p in l]
    lngs = [p[1] for l in lines for p in l]
    return {"s": min(lats), "w": min(lngs), "n": max(lats), "e": max(lngs)}


def _today() -> Date:
    return datetime.now(APP_TZ).date()


@router.get("/coverage")
async def coverage_in_view(request: Request, south: float, west: float, north: float, east: float,
                           days: Optional[int] = None):
    user = await require_admin_or_leader(request)
    n = max(1, min(int(days or KEEP_DAYS), KEEP_DAYS))
    since = (_today() - timedelta(days=n)).isoformat()
    q = {"office_id": user.get("office_id"), "date": {"$gte": since}, "status": {"$nin": ["plan", "requested"]},
         # boxes that overlap the view
         "bbox.s": {"$lte": north}, "bbox.n": {"$gte": south}, "bbox.w": {"$lte": east}, "bbox.e": {"$gte": west}}
    rows = await db.coverage_marks.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    today = _today()
    for r in rows:
        r["days_ago"] = (today - Date.fromisoformat(r["date"])).days
        r["mine"] = r.get("leader_id") == str(user["id"])
    return {"marks": rows}


async def sector_of(user_id: str, iso: str, office_id: Optional[str]) -> Optional[dict]:
    """The sector someone is in on a day: the one they lead, else the one
    they were added to."""
    q = {"date": iso, "office_id": office_id}
    return (await db.sectors.find_one({**q, "leader_id": str(user_id)}, {"_id": 0})
            or await db.sectors.find_one({**q, "member_ids": str(user_id)}, {"_id": 0}))


def _is_admin(user: dict) -> bool:
    return (user.get("role") or "").lower() == "admin"


@router.post("/coverage")
async def save_coverage(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    lines = clean_lines(body.get("lines"))
    try:
        d = Date.fromisoformat(str(body.get("date") or _today().isoformat())[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad date")
    if d > _today() or (_today() - d).days > 14:
        raise HTTPException(status_code=400, detail="Mark off today or a day in the last fortnight")
    role = (user.get("role") or "").lower()
    sec = None
    if body.get("leader_id") and _is_admin(user):
        sec = await db.sectors.find_one({"office_id": user.get("office_id"), "date": d.isoformat(),
                                         "leader_id": str(body["leader_id"])}, {"_id": 0})
    if not sec:
        sec = await sector_of(str(user["id"]), d.isoformat(), user.get("office_id"))
    if role not in ("leader", "admin") and (not sec or d != _today()):
        raise HTTPException(status_code=403, detail="You can mark off your own sector's streets on the day")
    kind = body.get("kind") if body.get("kind") in ("plan", "request") else "done"
    leads = bool(sec) and (sec.get("leader_id") == str(user["id"]) or _is_admin(user))
    if kind == "plan" and not leads:
        raise HTTPException(status_code=403, detail="Only the sector leader plans the areas")
    colour = str(body.get("colour") or "").lower()
    if kind in ("done", "request") and not leads:
        # A BA draws in their bunny hop's colour.
        colour = my_hop_colour(sec, str(user["id"])) or ""
    if colour not in HOP_COLOURS:
        colour = ""
    pc = clean_pc(body.get("postcode") or (sec or {}).get("postcode"))
    name = user.get("name") or ""
    doc = {"id": str(uuid.uuid4()), "office_id": user.get("office_id"), "date": d.isoformat(),
           "sector_leader_id": (sec or {}).get("leader_id"),
           "author_id": str(user["id"]), "author_name": name,
           "leader_id": str(user["id"]), "leader_name": name,
           "postcode": pc, "district": district(pc), "lines": lines, "bbox": _bbox(lines),
           "status": {"plan": "plan", "request": "requested"}.get(kind, "draft"), "kind": kind, "colour": colour,
           "note": " ".join(str(body.get("note") or "").split())[:200],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.coverage_marks.insert_one(dict(doc))
    if kind == "request" and sec and sec.get("leader_id") and sec["leader_id"] != str(user["id"]):
        await _push(sec["leader_id"], f"📍 {(name or 'Someone').split(' ')[0]} wants more streets",
                    "Open the sector map to approve or decline.", f"/sector-map?date={d.isoformat()}")
    return doc


async def _push(user_id: str, title: str, body: str, url: str) -> None:
    try:
        from core.push import send_push_to_user
        await send_push_to_user(user_id, title, body, {"type": "sector_setup", "url": url})
    except Exception:
        pass


async def _request_for_leader(user: dict, mark_id: str) -> dict:
    m = await db.coverage_marks.find_one({"id": mark_id, "status": "requested"}, {"_id": 0})
    if not m or m.get("office_id") != user.get("office_id"):
        raise HTTPException(status_code=404, detail="That request has already been dealt with")
    if m.get("sector_leader_id") != str(user["id"]) and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the sector leader approves more streets")
    return m


@router.post("/coverage/{mark_id}/approve")
async def approve_request(mark_id: str, request: Request):
    """The sector leader says yes: the streets join that BA's area (a plan
    line in their colour)."""
    user = await get_current_user(request)
    m = await _request_for_leader(user, mark_id)
    await db.coverage_marks.update_one({"id": mark_id}, {"$set": {
        "status": "plan", "kind": "plan", "approved_by": user.get("name") or "",
        "approved_at": datetime.now(timezone.utc).isoformat()}})
    if m.get("author_id"):
        await _push(m["author_id"], "✅ More streets approved", "They're on your map now.", f"/sector-map?date={m['date']}")
    return {"ok": True}


@router.post("/coverage/{mark_id}/decline")
async def decline_request(mark_id: str, request: Request):
    user = await get_current_user(request)
    m = await _request_for_leader(user, mark_id)
    await db.coverage_marks.delete_one({"id": mark_id})
    if m.get("author_id"):
        await _push(m["author_id"], "Extra streets not this time", "Stick with your area for now: ask your sector leader if you need more.",
                    f"/sector-map?date={m['date']}")
    return {"ok": True}


def my_hop_colour(sec: Optional[dict], user_id: str) -> Optional[str]:
    for h in (sec or {}).get("hops") or []:
        if user_id in (h.get("member_ids") or []):
            return h.get("colour")
    return None


@router.post("/coverage/confirm")
async def confirm_coverage(request: Request):
    """The sector leader confirms the day's mark-offs: they turn solid black."""
    user = await get_current_user(request)
    body = await request.json()
    iso = str(body.get("date") or _today().isoformat())[:10]
    leader = str(body.get("leader_id") or user["id"])
    if leader != str(user["id"]) and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the sector leader confirms the map")
    sec = await db.sectors.find_one({"office_id": user.get("office_id"), "date": iso, "leader_id": leader}, {"_id": 1})
    if not sec and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the sector leader confirms the map")
    q = {"office_id": user.get("office_id"), "date": iso, "status": "draft",
         "$or": [{"sector_leader_id": leader}, {"sector_leader_id": None, "author_id": leader}]}
    r = await db.coverage_marks.update_many(q, {"$set": {
        "status": "confirmed", "confirmed_by": user.get("name") or "",
        "confirmed_at": datetime.now(timezone.utc).isoformat()}})
    return {"confirmed": r.modified_count}


@router.delete("/coverage/{mark_id}")
async def delete_coverage(mark_id: str, request: Request):
    user = await get_current_user(request)
    m = await db.coverage_marks.find_one({"id": mark_id}, {"_id": 0})
    if not m or m.get("office_id") != user.get("office_id"):
        raise HTTPException(status_code=404, detail="That mark-off wasn't found")
    me = str(user["id"])
    author = m.get("author_id") or m.get("leader_id")
    if not (_is_admin(user) or author == me or m.get("sector_leader_id") == me):
        raise HTTPException(status_code=403, detail="Only the person who drew it, the sector leader or an Admin can remove it")
    await db.coverage_marks.delete_one({"id": mark_id})
    return {"deleted": True}
