"""Set up today's new starts — accounts in the room on BA Academy days.

The Owner's call (26 Oct 2026): on Monday and Tuesday after 13:30 the Owner
adds each new start by name and email from their phone. Email isn't set up,
so the app shows a simple starter password to read out AND a personal QR
code that signs the new start straight in; either way they choose their own
password first (the usual starter-password rule, see routes/auth_routes.py).
No Coach yet: they're given one on Wednesday, so they start Unassigned.

    POST /api/new-starts                 {name, email}          Admin
      → {user_id, name, email, password, join_token, expires_at}
    POST /api/new-starts/{user_id}/again                        Admin
      A fresh starter password and join code for someone who hasn't chosen
      their own yet (lost it, mistyped it, or the code ran out).
    GET  /api/new-starts/today                                  Admin
      → {people: [{user_id, name, email, ready, added_at}]} — this week's
      new starts still on Days 1-2; `ready` once they've chosen a password.
    POST /api/new-starts/join/check      {token}                Public
      → {name}: who the code is for, before they choose a password.
    POST /api/new-starts/join            {token, password}      Public
      Choose your password with your code: signs you in (same reply as
      /auth/login). A code works once, for JOIN_DAYS, and only while the
      account is still on its starter password.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from auth import (
    hash_password, create_access_token, create_refresh_token, set_auth_cookies,
    require_admin, MIN_PASSWORD_LENGTH,
)
from core.app_time import APP_TZ
from core.trainee_records import create_training_record
from database import db
from routes.auth_routes import _rate_key, _enforce_rate, _record_rate, STARTER_PASSWORD_DAYS

router = APIRouter()

JOIN_DAYS = 3
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Short words from the campaign, so a password is easy to read out in a room.
_WORDS = ("milk", "eggs", "glass", "float", "dairy", "round", "fresh", "bottle")


def starter_password() -> str:
    """e.g. 'glass-4821': easy to say, at least MIN_PASSWORD_LENGTH long."""
    pw = f"{secrets.choice(_WORDS)}-{secrets.randbelow(9000) + 1000}"
    return pw if len(pw) >= MIN_PASSWORD_LENGTH else pw + str(secrets.randbelow(10))


def token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode()).hexdigest()


def clean_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 200:
        raise HTTPException(status_code=400, detail="That email doesn't look right. Check it and try again.")
    return email


async def _issue(user_id: str, office_id: Optional[str]) -> tuple[str, str, str]:
    """A new starter password + join code for one person. Returns
    (password, token, expires_at). Earlier unused codes stop working."""
    now = datetime.now(timezone.utc)
    password = starter_password()
    token = secrets.token_urlsafe(24)
    expires = (now + timedelta(days=JOIN_DAYS)).isoformat()
    await db.users.update_one({"_id": ObjectId(user_id)}, {
        "$set": {"password_hash": hash_password(password), "must_change_password": True,
                 "starter_password_set_at": now.isoformat(),
                 "starter_password_expires_at": (now + timedelta(days=STARTER_PASSWORD_DAYS)).isoformat()},
        "$inc": {"session_version": 1},
    })
    await db.join_tokens.update_many({"user_id": user_id, "used_at": None}, {"$set": {"used_at": "replaced"}})
    await db.join_tokens.insert_one({"token_hash": token_hash(token), "user_id": user_id, "office_id": office_id,
                                     "created_at": now.isoformat(), "expires_at": expires, "used_at": None})
    return password, token, expires


class NewStartBody(BaseModel):
    name: str
    email: str


@router.post("/new-starts")
async def add_new_start(body: NewStartBody, request: Request):
    admin = await require_admin(request)
    name = " ".join((body.name or "").split())
    if not name or len(name) > 80:
        raise HTTPException(status_code=400, detail="Add their first and last name")
    email = clean_email(body.email)
    office_id = admin.get("office_id")
    if not office_id:
        raise HTTPException(status_code=400, detail="Your account isn't in an office")
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Someone already has an account with that email")
    now = datetime.now(timezone.utc).isoformat()
    res = await db.users.insert_one({
        "email": email, "password_hash": "", "name": name, "role": "trainee",
        "office_id": office_id, "email_verified": True, "reports_to": None,
        "created_at": now, "created_by_admin_id": admin.get("id"), "added_in_academy": True,
    })
    user_id = str(res.inserted_id)
    await create_training_record(db, name=name, office_id=office_id, trainee_user_id=user_id,
                                 leader_name="Unassigned",
                                 start_date=datetime.now(APP_TZ).date().isoformat())
    password, token, expires = await _issue(user_id, office_id)
    return {"user_id": user_id, "name": name, "email": email, "password": password,
            "join_token": token, "expires_at": expires}


@router.post("/new-starts/{user_id}/again")
async def issue_again(user_id: str, request: Request):
    admin = await require_admin(request)
    try:
        oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Person not found")
    u = await db.users.find_one({"_id": oid, "deleted": {"$ne": True}})
    if not u or (u.get("office_id") != admin.get("office_id") and not admin.get("is_super_admin")):
        raise HTTPException(status_code=404, detail="Person not found")
    if u.get("role") != "trainee":
        raise HTTPException(status_code=400, detail="This is only for new starts")
    if not u.get("must_change_password") and u.get("password_changed_at"):
        raise HTTPException(status_code=400, detail=f"{u.get('name') or 'They'} already chose their own password")
    password, token, expires = await _issue(user_id, u.get("office_id"))
    return {"user_id": user_id, "name": u.get("name") or "", "email": u.get("email") or "",
            "password": password, "join_token": token, "expires_at": expires}


@router.get("/new-starts/today")
async def todays_new_starts(request: Request):
    admin = await require_admin(request)
    since = (datetime.now(APP_TZ).date() - timedelta(days=6)).isoformat()
    hires = await db.new_hires.find(
        {"office_id": admin.get("office_id"), "active": True, "current_day": {"$lte": 2},
         "start_date": {"$gte": since}, "trainee_user_id": {"$nin": [None, ""]}},
        {"_id": 0, "trainee_user_id": 1, "name": 1, "created_at": 1},
    ).to_list(100)
    ids = []
    for h in hires:
        try:
            ids.append(ObjectId(h["trainee_user_id"]))
        except (InvalidId, TypeError):
            pass
    users = {str(u["_id"]): u for u in await db.users.find(
        {"_id": {"$in": ids}, "deleted": {"$ne": True}},
        {"name": 1, "email": 1, "must_change_password": 1, "password_changed_at": 1}).to_list(100)}
    people = []
    for h in hires:
        u = users.get(str(h["trainee_user_id"]))
        if not u:
            continue
        people.append({"user_id": str(u["_id"]), "name": u.get("name") or h.get("name") or "",
                       "email": u.get("email") or "", "added_at": h.get("created_at"),
                       "ready": bool(u.get("password_changed_at")) and not u.get("must_change_password")})
    people.sort(key=lambda p: p.get("added_at") or "", reverse=True)
    return {"people": people}


class JoinBody(BaseModel):
    token: str
    password: Optional[str] = None


async def _valid_token(token: str, request: Request) -> tuple[dict, dict]:
    key = _rate_key(request, "new-start-join")
    _enforce_rate(key, limit=30, window_seconds=15 * 60)
    row = await db.join_tokens.find_one({"token_hash": token_hash(token)}) if token else None
    now = datetime.now(timezone.utc).isoformat()
    bad = not row or row.get("used_at") or (row.get("expires_at") or "") < now
    u = None
    if not bad:
        try:
            u = await db.users.find_one({"_id": ObjectId(row["user_id"]), "deleted": {"$ne": True},
                                         "is_active": {"$ne": False}})
        except (InvalidId, TypeError):
            u = None
    if bad or not u or not u.get("must_change_password"):
        _record_rate(key)
        raise HTTPException(status_code=404, detail="This code has been used or has run out. Ask the Owner for a new one.")
    return row, u


@router.post("/new-starts/join/check")
async def join_check(body: JoinBody, request: Request):
    _row, u = await _valid_token(body.token, request)
    return {"name": u.get("name") or ""}


@router.post("/new-starts/join")
async def join(body: JoinBody, request: Request, response: Response):
    row, u = await _valid_token(body.token, request)
    pw = body.password or ""
    if len(pw) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Your password needs at least {MIN_PASSWORD_LENGTH} characters")
    if len(pw) > 200:
        raise HTTPException(status_code=400, detail="That password is too long")
    now = datetime.now(timezone.utc).isoformat()
    # Claim the code first, so two taps can't both use it.
    claimed = await db.join_tokens.update_one({"_id": row["_id"], "used_at": None}, {"$set": {"used_at": now}})
    if not claimed.modified_count:
        raise HTTPException(status_code=404, detail="This code has been used or has run out. Ask the Owner for a new one.")
    new_version = int(u.get("session_version") or 0) + 1
    await db.users.update_one({"_id": u["_id"]}, {
        "$set": {"password_hash": hash_password(pw), "password_changed_at": now},
        "$unset": {"must_change_password": "", "starter_password_expires_at": ""},
        "$inc": {"session_version": 1},
    })
    user_id = str(u["_id"])
    access = create_access_token(user_id, u["email"], new_version)
    refresh = create_refresh_token(user_id, new_version)
    set_auth_cookies(response, access, refresh)
    return {"id": user_id, "email": u["email"], "name": u.get("name", ""), "role": u.get("role"),
            "token": access, "refresh_token": refresh, "must_change_password": False,
            "profile_image": u.get("profile_image"), "office_id": u.get("office_id"),
            "is_super_admin": False, "accessible_offices": []}
