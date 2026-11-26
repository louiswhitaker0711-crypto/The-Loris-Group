"""Street snapping for the sector map (the Owner, 26 Nov 2026).

  POST /api/roads/snap {lines, tolerance_m}  each drawn stroke snapped to the roads
  POST /api/roads/warm {s, w, n, e}          fetch a sector's roads ahead of drawing

Roads come from OpenStreetMap (core/roads.py), cached in `road_tiles`.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from core import roads
from database import db
from routes.coverage import MAX_LINES, MAX_POINTS, UK_BOX

router = APIRouter()


def _lines(raw) -> list:
    out = []
    for line in (raw or [])[:MAX_LINES] if isinstance(raw, list) else []:
        pts = []
        for p in (line or [])[:MAX_POINTS * 2]:
            try:
                lat, lng = float(p[0]), float(p[1])
            except (TypeError, ValueError, IndexError):
                continue
            if UK_BOX[0] <= lat <= UK_BOX[2] and UK_BOX[1] <= lng <= UK_BOX[3]:
                pts.append([lat, lng])
        if len(pts) >= 2:
            out.append(pts)
    return out


@router.post("/roads/snap")
async def snap(request: Request):
    await get_current_user(request)
    body = await request.json()
    lines = _lines(body.get("lines"))
    if not lines:
        raise HTTPException(status_code=400, detail="Draw a line first")
    # A stroke covers a few streets: keep one request to a sensible area.
    pts = [p for l in lines for p in l]
    if max(p[0] for p in pts) - min(p[0] for p in pts) > 0.06 or max(p[1] for p in pts) - min(p[1] for p in pts) > 0.09:
        return {"lines": [{"line": l, "side": "left", "snapped": False} for l in lines]}
    try:
        tol = float(body.get("tolerance_m") or 25)
    except (TypeError, ValueError):
        tol = 25.0
    return {"lines": await roads.snap_lines(db, lines, tol)}


@router.post("/roads/warm")
async def warm(request: Request):
    await get_current_user(request)
    b = await request.json()
    try:
        s, w, n, e = float(b["s"]), float(b["w"]), float(b["n"]), float(b["e"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Which area?")
    if not (UK_BOX[0] <= s <= n <= UK_BOX[2] and UK_BOX[1] <= w <= e <= UK_BOX[3]) or n - s > 0.08 or e - w > 0.12:
        return {"tiles": 0}
    nodes, _ways = await roads.roads_in(db, s, w, n, e)
    return {"tiles": len(roads.tile_keys(s, w, n, e)), "nodes": len(nodes)}
