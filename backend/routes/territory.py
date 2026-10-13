"""Territory: Acwyre's map of the office's postcode sectors (core/territory.py).

The Owner (an Admin) uploads the zip: a fresh set of sectors each quarter,
then a weekly one with the sales pins updated. Each upload replaces what's
in it (sectors, new-build zones, sales pins) and is logged.

Who sees what:
  • Admins: everything, on the big map (all sectors, new builds, sales pins,
    every street marked off and confirmed).
  • Sector leaders and BAs: only the one sector they're in that day, through
    /api/sector/map (routes/sector.py). Never the list, the new builds or
    the pins.
  • Coaches typing a postcode at set-up get that one sector's details
    (/territory/check), not the territory.

  POST /api/territory/upload          {filename, data_b64, save}   Admin
  GET  /api/territory                 uploads and counts            Admin
  GET  /api/territory/map             the big map                   Admin
  GET  /api/territory/check?postcode= one sector's details          Coach/Admin
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, require_admin
from core.app_time import APP_TZ
from core.territory import KIND_LABEL, parse_territory_file, postcode_to_sector, summary
from database import db

router = APIRouter()

MAX_UPLOAD_BYTES = 30 * 1024 * 1024
MARKS_DAYS = 84


def _office(user: dict) -> str:
    oid = user.get("office_id")
    if not oid:
        raise HTTPException(status_code=400, detail="Your account has no office")
    return oid


@router.post("/territory/upload")
async def upload_territory(request: Request):
    """Read the file and show what's in it; with save=true, store it."""
    admin = await require_admin(request)
    office_id = _office(admin)
    body = await request.json()
    try:
        data = base64.b64decode(str(body.get("data_b64") or ""), validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="That file couldn't be read")
    if not data:
        raise HTTPException(status_code=400, detail="Choose the territory zip first")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="That file is too big")
    filename = str(body.get("filename") or "territory.zip")[:200]
    try:
        parsed = parse_territory_file(filename, data)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"That doesn't look like a territory map: {str(ex)[:120]}")
    info = summary(parsed)
    if not info["sectors"] and not info["dots"]:
        raise HTTPException(status_code=400, detail="No sectors or sales pins found in that file")
    if not body.get("save"):
        return {"saved": False, "summary": info}

    now = datetime.now(timezone.utc).isoformat()
    upload_id = str(uuid.uuid4())
    if parsed["sectors"]:
        await db.territory_sectors.delete_many({"office_id": office_id})
        await db.territory_sectors.insert_many([{**s, "office_id": office_id, "upload_id": upload_id, "updated_at": now}
                                               for s in parsed["sectors"]])
    if parsed["zones"]:
        await db.territory_zones.delete_many({"office_id": office_id})
        await db.territory_zones.insert_many([{**z, "office_id": office_id, "upload_id": upload_id} for z in parsed["zones"]])
    if parsed["dots"]:
        await db.territory_pins.update_one({"office_id": office_id}, {"$set": {
            "dots": parsed["dots"], "upload_id": upload_id, "updated_at": now}}, upsert=True)
    if parsed["offices"]:
        await db.territory_pins.update_one({"office_id": office_id}, {"$set": {"offices": parsed["offices"]}}, upsert=True)
    await db.territory_uploads.insert_one({"id": upload_id, "office_id": office_id, "filename": filename,
                                           "by_id": str(admin["id"]), "by_name": admin.get("name") or "",
                                           "at": now, "summary": info})
    return {"saved": True, "summary": info}


@router.get("/territory")
async def territory_overview(request: Request):
    admin = await require_admin(request)
    office_id = _office(admin)
    uploads = await db.territory_uploads.find({"office_id": office_id}, {"_id": 0}).sort("at", -1).to_list(20)
    return {"uploads": uploads, "has_territory": bool(uploads)}


@router.get("/territory/map")
async def territory_map(request: Request, days: Optional[int] = None):
    """Everything, for the Owner's big map."""
    admin = await require_admin(request)
    office_id = _office(admin)
    sectors = await db.territory_sectors.find({"office_id": office_id}, {"_id": 0, "office_id": 0, "upload_id": 0}).to_list(2000)
    zones = await db.territory_zones.find({"office_id": office_id}, {"_id": 0, "kind": 1, "geometry": 1}).to_list(2000)
    pins = await db.territory_pins.find_one({"office_id": office_id}, {"_id": 0}) or {}
    n = max(1, min(int(days or MARKS_DAYS), 366))
    since = (datetime.now(APP_TZ).date() - timedelta(days=n)).isoformat()
    marks = await db.coverage_marks.find(
        {"office_id": office_id, "date": {"$gte": since}, "status": {"$nin": ["draft", "plan"]}},
        {"_id": 0, "lines": 1, "date": 1, "postcode": 1, "leader_name": 1}).to_list(5000)
    return {"sectors": sectors, "zones": zones, "dots": pins.get("dots") or [], "offices": pins.get("offices") or [],
            "pins_updated_at": pins.get("updated_at"), "worked": marks, "labels": KIND_LABEL}


async def sector_for_postcode(office_id: Optional[str], postcode: str, with_shape: bool = False) -> Optional[dict]:
    """The territory sector a postcode falls in (by its sector code)."""
    code = postcode_to_sector(postcode)
    if not office_id or not code:
        return None
    proj = {"_id": 0, "office_id": 0, "upload_id": 0}
    if not with_shape:
        proj.update({"geometry": 0})
    return await db.territory_sectors.find_one({"office_id": office_id, "code": code}, proj)


@router.get("/territory/check")
async def territory_check(request: Request, postcode: str = ""):
    """For the set-up screen: is this postcode in the territory, and how has
    its sector been worked? One sector's figures only."""
    user = await get_current_user(request)
    if (user.get("role") or "").lower() not in ("leader", "admin"):
        # A BA only when they lead a sector today: one sector at a time.
        from routes.coverage import _today
        if not await db.sectors.find_one({"office_id": user.get("office_id"), "date": _today().isoformat(),
                                          "leader_id": str(user["id"])}, {"_id": 1}):
            raise HTTPException(status_code=403, detail="For sector leaders")
    has = await db.territory_sectors.find_one({"office_id": user.get("office_id")}, {"_id": 1})
    if not has:
        return {"loaded": False}
    code = postcode_to_sector(postcode)
    s = await sector_for_postcode(user.get("office_id"), postcode)
    if not s:
        return {"loaded": True, "code": code, "found": False}
    s.pop("bbox", None)
    s.pop("office", None)
    return {"loaded": True, "found": True, **s, "label": KIND_LABEL.get(s.get("kind"), "")}
