"""Area history: where the office has knocked and how it went, by postcode
district, postcode sector and street (see core/areas.py).

  GET /api/areas?days=56                   every district worked, newest first
  GET /api/areas/district/{district}       one district: sectors, streets, visits
  GET /api/areas/lookup?postcode=LS6 1AB   for the sector set-up screen

Coaches and Admins, their own office (the Owner sees every office the
OwnerIQ login covers), the same office rule as the Timeline. Read only from
`owneriq_field_days`; nothing here asks OwnerIQ.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import require_admin_or_leader
from core.app_time import APP_TZ
from core.areas import clean_pc, district, district_detail, districts, lookup
from database import db
from owneriq_config import office_pin

router = APIRouter()

DEFAULT_DAYS = 56
MAX_DAYS = 186


async def _days(viewer: dict, days: Optional[int]) -> tuple[list[dict], str]:
    today = datetime.now(APP_TZ).date()
    n = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    m: dict = {"date": {"$gte": (today - timedelta(days=n)).isoformat(), "$lte": today.isoformat()},
               "empty": {"$ne": True}, "areas.0": {"$exists": True}}
    pin = None if viewer.get("is_super_admin") else await office_pin(viewer.get("office_id"), db)
    if pin:
        m["mc_pin"] = {"$in": [str(pin), None]}
    rows = await db.owneriq_field_days.find(m, {"_id": 0, "date": 1, "oid": 1, "name": 1, "areas": 1}).to_list(40000)
    return rows, today.isoformat()


@router.get("/areas")
async def area_list(request: Request, days: Optional[int] = None):
    viewer = await require_admin_or_leader(request)
    rows, today = await _days(viewer, days)
    return {"today": today, "days": days or DEFAULT_DAYS, "districts": districts(rows, today),
            "covered_from": min((r["date"] for r in rows), default=None)}


@router.get("/areas/district/{name}")
async def area_district(name: str, request: Request, days: Optional[int] = None):
    viewer = await require_admin_or_leader(request)
    if not district(name):
        raise HTTPException(status_code=400, detail="Enter a postcode district, like LS6")
    rows, today = await _days(viewer, days)
    return {"today": today, **district_detail(rows, name, today)}


@router.get("/areas/lookup")
async def area_lookup(request: Request, postcode: str = ""):
    viewer = await require_admin_or_leader(request)
    if not clean_pc(postcode):
        return {"postcode": "", "district": "", "district_total": None, "sector": None, "visits": []}
    rows, today = await _days(viewer, MAX_DAYS)
    return {"today": today, **lookup(rows, postcode, today)}
