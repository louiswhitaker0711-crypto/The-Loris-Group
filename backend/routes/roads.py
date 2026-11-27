"""Street snapping for the sector map (the Owner, 26 Nov 2026).

  POST /api/roads/snap {lines, tolerance_m}  each drawn stroke snapped to the roads
  POST /api/roads/warm {s, w, n, e}          fetch a sector's roads ahead of drawing
  POST /api/roads/tile {key, data}           a tile the phone fetched itself, when the
                                             server couldn't reach OpenStreetMap

Roads come from OpenStreetMap (core/roads.py), cached in `road_tiles`.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

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
    user = await get_current_user(request)
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
    missing: list = []
    # Never wait on OpenStreetMap here (the server's own fetches time out):
    # only roads already saved; the phone fetches any that are missing.
    out = await roads.snap_lines(db, lines, tol, missing=missing, cached_only=True)
    if missing:
        # Vector tiles are quick (about a second): fetch them now and snap again.
        import asyncio
        for k in missing[:3]:
            roads._failed.pop(k, None)
            try:
                await asyncio.wait_for(roads._tile(db, k, fetch=roads.fetch_vector), 10)
            except Exception:
                pass
        missing = []
        out = await roads.snap_lines(db, lines, tol, missing=missing, cached_only=True)
    if missing:
        # The server couldn't get these roads: the phone can fetch them from
        # OpenStreetMap itself and send them (POST /roads/tile), then retry.
        return {"lines": out, "missing": [{"key": k, "query": roads.overpass_query(*_padded(k))} for k in missing[:6]]}
    return {"lines": out}


_tasks: set = set()   # keep background fetches alive until they finish


async def _background(keys: list, office_id) -> None:
    for k in keys[:12]:
        try:
            t = await roads._tile(db, k)
            await db.road_fetch_log.insert_one({"office_id": office_id, "at": datetime.now(timezone.utc).isoformat(), "by": "server",
                                                "tiles": [k], "error": "" if t else (roads.last_error.get(k, "")[:300] or "no roads"),
                                                "ok": bool(t)})
        except Exception:
            pass


def _padded(key: str):
    s, w, n, e = roads.tile_box(key)
    return (s - 0.001, w - 0.001, n + 0.001, e + 0.001)


@router.post("/roads/tile")
async def upload_tile(request: Request):
    await get_current_user(request)
    body = await request.json()
    key = str(body.get("key") or "")
    if not re.fullmatch(r"-?\d{1,5}:-?\d{1,5}", key):
        raise HTTPException(status_code=400, detail="Which tile?")
    try:
        doc = roads.tile_from_upload(key, body.get("data") or {})
    except Exception:
        raise HTTPException(status_code=400, detail="Those roads couldn't be read")
    if not doc["nodes"]:
        raise HTTPException(status_code=400, detail="No roads in that tile")
    await db.road_tiles.update_one({"key": key}, {"$set": doc}, upsert=True)
    roads._failed.pop(key, None)
    return {"ok": True, "nodes": len(doc["nodes"])}


@router.post("/roads/warm")
async def warm(request: Request):
    user = await get_current_user(request)
    b = await request.json()
    try:
        s, w, n, e = float(b["s"]), float(b["w"]), float(b["n"]), float(b["e"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Which area?")
    if not (UK_BOX[0] <= s <= n <= UK_BOX[2] and UK_BOX[1] <= w <= e <= UK_BOX[3]) or n - s > 0.08 or e - w > 0.12:
        return {"tiles": 0}
    missing: list = []
    nodes, _ways = await roads.roads_in(db, s, w, n, e, missing=missing, cached_only=True)
    if missing:
        # Try from the server too, in the background (the phone is fetching them as well).
        import asyncio
        t = asyncio.create_task(_background(list(missing), user.get("office_id")))
        _tasks.add(t)
        t.add_done_callback(_tasks.discard)
    return {"tiles": len(roads.tile_keys(s, w, n, e)), "nodes": len(nodes),
            "missing": [{"key": k, "query": roads.overpass_query(*_padded(k))} for k in missing[:6]]}


@router.post("/roads/log")
async def phone_log(request: Request):
    """What the phone saw while fetching streets (to fix snapping)."""
    user = await get_current_user(request)
    b = await request.json()
    await db.road_fetch_log.insert_one({"office_id": user.get("office_id"), "at": datetime.now(timezone.utc).isoformat(),
                                        "by": "phone", "stage": str(b.get("stage") or "")[:40],
                                        "error": str(b.get("detail") or "")[:300], "tiles": [str(x) for x in (b.get("tiles") or [])][:12]})
    return {"ok": True}
