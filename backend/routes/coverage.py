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

  GET    /api/coverage?south&west&north&east&days=84   marks in view (Coach/Admin)
  POST   /api/coverage                                  save a draft mark-off
  POST   /api/coverage/confirm {date, leader_id?}       sector leader confirms the day
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
    q = {"office_id": user.get("office_id"), "date": {"$gte": since},
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
    pc = clean_pc(body.get("postcode") or (sec or {}).get("postcode"))
    name = user.get("name") or ""
    doc = {"id": str(uuid.uuid4()), "office_id": user.get("office_id"), "date": d.isoformat(),
           "sector_leader_id": (sec or {}).get("leader_id"),
           "author_id": str(user["id"]), "author_name": name,
           "leader_id": str(user["id"]), "leader_name": name,
           "postcode": pc, "district": district(pc), "lines": lines, "bbox": _bbox(lines),
           "status": "draft",
           "note": " ".join(str(body.get("note") or "").split())[:200],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.coverage_marks.insert_one(dict(doc))
    return doc


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
