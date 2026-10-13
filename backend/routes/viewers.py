"""Read-only viewers: someone the Owner lets see what they see (their own
coach, say) without being able to change anything.

A viewer is an Admin account in the Owner's office with `is_demo: true`: the
same blanket guard that keeps trial accounts read-only (auth.demo_write_blocked,
enforced by server.py's middleware on every POST/PUT/PATCH/DELETE) keeps a
viewer from saving anything, and `is_demo` keeps them off Bells, rosters and
team lists. `is_viewer: true` marks it as a viewer rather than a trial.
A viewer can't change their own password (that's a write), so the Owner sets
it and can reset it here.

  GET    /api/admin/viewers                      Owner
  POST   /api/admin/viewers   {name, email, password}
  PUT    /api/admin/viewers/{id}/password {password}
  DELETE /api/admin/viewers/{id}
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

import auth
from auth import hash_password, require_super_admin
from database import db

router = APIRouter()

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8


def _forget_cache() -> None:
    # The guard caches who's read-only for a minute; a new viewer counts now.
    auth._demo_ids_cache["at"] = float("-inf")


def _out(u: dict) -> dict:
    return {"id": str(u["_id"]), "name": u.get("name") or "", "email": u.get("email") or "",
            "created_at": u.get("created_at"), "active": u.get("is_active") is not False}


@router.get("/admin/viewers")
async def list_viewers(request: Request):
    owner = await require_super_admin(request)
    rows = await db.users.find({"is_viewer": True, "deleted": {"$ne": True}, "office_id": owner.get("office_id")},
                               {"name": 1, "email": 1, "created_at": 1, "is_active": 1}).sort("name", 1).to_list(50)
    return {"viewers": [_out(u) for u in rows]}


@router.post("/admin/viewers")
async def add_viewer(request: Request):
    owner = await require_super_admin(request)
    body = await request.json()
    name = " ".join(str(body.get("name") or "").split())[:80]
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if not name or not _EMAIL.match(email):
        raise HTTPException(status_code=400, detail="Enter their name and email")
    if len(password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Use a password of at least {MIN_PASSWORD} characters")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="That email already has an account")
    doc = {"email": email, "password_hash": hash_password(password), "name": name, "role": "admin",
           "office_id": owner.get("office_id"), "email_verified": True, "is_demo": True, "is_viewer": True,
           "viewer_added_by": str(owner["id"]), "created_at": datetime.now(timezone.utc).isoformat()}
    r = await db.users.insert_one(doc)
    _forget_cache()
    return _out({**doc, "_id": r.inserted_id})


async def _viewer(owner: dict, viewer_id: str) -> dict:
    if not ObjectId.is_valid(viewer_id):
        raise HTTPException(status_code=404, detail="Not found")
    u = await db.users.find_one({"_id": ObjectId(viewer_id), "is_viewer": True, "office_id": owner.get("office_id")})
    if not u:
        raise HTTPException(status_code=404, detail="Not found")
    return u


@router.put("/admin/viewers/{viewer_id}/password")
async def reset_viewer_password(viewer_id: str, request: Request):
    owner = await require_super_admin(request)
    u = await _viewer(owner, viewer_id)
    password = str((await request.json()).get("password") or "")
    if len(password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Use a password of at least {MIN_PASSWORD} characters")
    await db.users.update_one({"_id": u["_id"]}, {"$set": {"password_hash": hash_password(password)}})
    return {"ok": True}


@router.delete("/admin/viewers/{viewer_id}")
async def remove_viewer(viewer_id: str, request: Request):
    owner = await require_super_admin(request)
    u = await _viewer(owner, viewer_id)
    await db.users.update_one({"_id": u["_id"]}, {"$set": {"is_active": False, "deleted": True,
                                                           "deleted_at": datetime.now(timezone.utc).isoformat()}})
    _forget_cache()
    return {"ok": True}
