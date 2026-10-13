"""Coverage marks: the streets a sector leader marked off on the map at the end
of the day, so tomorrow's set-up can see what's been done.

Collection `coverage_marks`, one per save:
    {id, office_id, date, leader_id, leader_name, postcode, district,
     lines: [[[lat, lng], …], …], note, created_at}

  GET    /api/coverage?south&west&north&east&days=84   marks in view
  POST   /api/coverage                                  save a mark-off
  DELETE /api/coverage/{id}                             remove your own (Admins: any in the office)

Coaches and Admins, their own office. Marks older than KEEP_DAYS are not
shown (the same 12 weeks CG Territory uses).
"""
from __future__ import annotations

import uuid
from datetime import date as Date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import require_admin_or_leader
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


@router.post("/coverage")
async def save_coverage(request: Request):
    user = await require_admin_or_leader(request)
    body = await request.json()
    lines = clean_lines(body.get("lines"))
    try:
        d = Date.fromisoformat(str(body.get("date") or _today().isoformat())[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad date")
    if d > _today() or (_today() - d).days > 14:
        raise HTTPException(status_code=400, detail="Mark off today or a day in the last fortnight")
    pc = clean_pc(body.get("postcode"))
    doc = {"id": str(uuid.uuid4()), "office_id": user.get("office_id"), "date": d.isoformat(),
           "leader_id": str(user["id"]), "leader_name": user.get("name") or "",
           "postcode": pc, "district": district(pc), "lines": lines, "bbox": _bbox(lines),
           "note": " ".join(str(body.get("note") or "").split())[:200],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.coverage_marks.insert_one(dict(doc))
    return doc


@router.delete("/coverage/{mark_id}")
async def delete_coverage(mark_id: str, request: Request):
    user = await require_admin_or_leader(request)
    m = await db.coverage_marks.find_one({"id": mark_id}, {"_id": 0})
    if not m or m.get("office_id") != user.get("office_id"):
        raise HTTPException(status_code=404, detail="That mark-off wasn't found")
    if m.get("leader_id") != str(user["id"]) and (user.get("role") or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only the person who drew it, or an Admin, can remove it")
    await db.coverage_marks.delete_one({"id": mark_id})
    return {"deleted": True}
