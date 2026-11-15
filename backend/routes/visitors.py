"""Visitors from another office (the Owner, 15 Nov 2026). See core/visitors.py
for what a visitor is in and kept out of.

Admin → Visitors shows a visitor code / QR. A visitor scans it and makes their
own account: name, email, password, their home office, their stage and the
days they're here. The code lasts VISITOR_CODE_DAYS or until the Owner closes
it. The Owner can change a visitor's details or remove them.

    GET    /api/admin/visitors                       Admin → {visitors: [...]}
    GET    /api/visitors/code                        Admin → {code, expires_at}
    POST   /api/visitors/code/close                  Admin
    PUT    /api/admin/visitors/{id}  {name?, visit_office?, stage?, visit_from?, visit_to?}   Admin
    DELETE /api/admin/visitors/{id}                  Admin (their past sectors and grades stay)
    POST   /api/visitors/signup/check {code}         Public → {ok, office}
    POST   /api/visitors/signup {code, name, email, password, visit_office, stage, visit_from, visit_to}
                                                     Public → signed in (same reply as /auth/login)
"""
from __future__ import annotations

import re
import secrets
from datetime import date as Date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

import auth
from auth import (create_access_token, create_refresh_token, hash_password, require_admin,
                  set_auth_cookies, MIN_PASSWORD_LENGTH)
from core.app_time import APP_TZ
from core.visitors import clean_date, role_for_stage, today_iso
from database import db
from routes.auth_routes import _enforce_rate, _rate_key, _record_rate

router = APIRouter()

VISITOR_CODE_DAYS = 7
MAX_VISIT_DAYS = 31
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
STAGES = ("1", "2", "3", "SL", "4", "5", "6", "7", "8", "9", "10")
_CLOSED = "This visitor code has finished. Ask the Owner to show the visitor QR code again."


def _forget_cache() -> None:
    # The read-only guard caches demo ids for a minute.
    auth._demo_ids_cache["at"] = float("-inf")


def _clean_stage(raw) -> str:
    s = str(raw or "").strip().upper().replace("STAGE", "").strip()
    if s == "3+":
        s = "SL"
    if s not in STAGES:
        raise HTTPException(status_code=400, detail="Pick your stage")
    return s


def _clean_dates(start, end) -> tuple[str, str]:
    a, b = clean_date(start), clean_date(end)
    if not a or not b:
        raise HTTPException(status_code=400, detail="Add the first and last day you're here")
    if b < a:
        raise HTTPException(status_code=400, detail="Your last day can't be before your first")
    if (Date.fromisoformat(b) - Date.fromisoformat(a)).days >= MAX_VISIT_DAYS:
        raise HTTPException(status_code=400, detail=f"A visit can be up to {MAX_VISIT_DAYS} days")
    return a, b


def _clean_office(raw) -> str:
    office = " ".join(str(raw or "").split())[:60]
    if not office:
        raise HTTPException(status_code=400, detail="Add the office you're visiting from")
    return office


def _out(u: dict) -> dict:
    iso = today_iso()
    vf, vt = u.get("visit_from") or "", u.get("visit_to") or ""
    status = "upcoming" if vf > iso else "finished" if vt and vt < iso else "here"
    return {"id": str(u["_id"]), "name": u.get("name") or "", "email": u.get("email") or "",
            "visit_office": u.get("visit_office") or "", "stage": u.get("visitor_stage") or "",
            "coach": (u.get("role") == "leader"), "visit_from": vf, "visit_to": vt, "status": status}


# ── Admin ────────────────────────────────────────────────────────────────────
@router.get("/admin/visitors")
async def list_visitors(request: Request):
    admin = await require_admin(request)
    since = (datetime.now(APP_TZ).date() - timedelta(days=60)).isoformat()
    rows = await db.users.find(
        {"is_visitor": True, "office_id": admin.get("office_id"), "deleted": {"$ne": True}, "visit_to": {"$gte": since}},
        {"name": 1, "email": 1, "visit_office": 1, "visitor_stage": 1, "role": 1, "visit_from": 1, "visit_to": 1},
    ).sort([("visit_from", -1), ("name", 1)]).to_list(200)
    return {"visitors": [_out(u) for u in rows]}


@router.get("/visitors/code")
async def visitor_code(request: Request):
    admin = await require_admin(request)
    now = datetime.now(timezone.utc)
    row = await db.visitor_codes.find_one(
        {"office_id": admin.get("office_id"), "closed_at": None, "expires_at": {"$gt": now.isoformat()}},
        {"_id": 0, "code": 1, "expires_at": 1})
    if row:
        return row
    code = secrets.token_urlsafe(16)
    expires = (now + timedelta(days=VISITOR_CODE_DAYS)).isoformat()
    await db.visitor_codes.insert_one({"code": code, "office_id": admin.get("office_id"), "created_by": admin.get("id"),
                                       "created_at": now.isoformat(), "expires_at": expires, "closed_at": None})
    return {"code": code, "expires_at": expires}


@router.post("/visitors/code/close")
async def close_visitor_code(request: Request):
    admin = await require_admin(request)
    now = datetime.now(timezone.utc).isoformat()
    await db.visitor_codes.update_many({"office_id": admin.get("office_id"), "closed_at": None}, {"$set": {"closed_at": now}})
    return {"ok": True}


async def _visitor_of(admin: dict, visitor_id: str) -> dict:
    u = await db.users.find_one({"_id": ObjectId(visitor_id), "is_visitor": True, "deleted": {"$ne": True}}) \
        if ObjectId.is_valid(visitor_id) else None
    if not u or (u.get("office_id") != admin.get("office_id") and not admin.get("is_super_admin")):
        raise HTTPException(status_code=404, detail="Visitor not found")
    return u


@router.put("/admin/visitors/{visitor_id}")
async def update_visitor(visitor_id: str, request: Request):
    admin = await require_admin(request)
    u = await _visitor_of(admin, visitor_id)
    body = await request.json()
    upd: dict = {}
    if "name" in body:
        name = " ".join(str(body.get("name") or "").split())[:80]
        if not name:
            raise HTTPException(status_code=400, detail="Add their name")
        upd["name"] = name
    if "visit_office" in body:
        upd["visit_office"] = _clean_office(body.get("visit_office"))
    if "stage" in body:
        upd["visitor_stage"] = _clean_stage(body.get("stage"))
        upd["role"] = role_for_stage(upd["visitor_stage"])
    if "visit_from" in body or "visit_to" in body:
        upd["visit_from"], upd["visit_to"] = _clean_dates(body.get("visit_from", u.get("visit_from")),
                                                          body.get("visit_to", u.get("visit_to")))
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.users.update_one({"_id": u["_id"]}, {"$set": upd})
    return _out({**u, **upd})


@router.delete("/admin/visitors/{visitor_id}")
async def remove_visitor(visitor_id: str, request: Request):
    """Take a visitor off: they can't sign in and drop off every picker. Past
    sectors, hops and grades keep them (a soft delete, like Exit)."""
    admin = await require_admin(request)
    u = await _visitor_of(admin, visitor_id)
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"_id": u["_id"]}, {"$set": {
        "deleted": True, "deleted_at": now, "left_on": today_iso(),
        "session_version": int(u.get("session_version") or 0) + 1}})
    _forget_cache()
    return {"ok": True}


# ── Public: the visitor makes their own account ──────────────────────────────
class VisitorSignup(BaseModel):
    code: str
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    visit_office: Optional[str] = None
    stage: Optional[str] = None
    visit_from: Optional[str] = None
    visit_to: Optional[str] = None


async def _code_row(code: str, request: Request) -> dict:
    key = _rate_key(request, "visitor-signup")
    _enforce_rate(key, limit=40, window_seconds=15 * 60)
    now = datetime.now(timezone.utc).isoformat()
    row = await db.visitor_codes.find_one({"code": code, "closed_at": None, "expires_at": {"$gt": now}}) if code else None
    if not row:
        _record_rate(key)
        raise HTTPException(status_code=404, detail=_CLOSED)
    return row


@router.post("/visitors/signup/check")
async def visitor_signup_check(body: VisitorSignup, request: Request):
    await _code_row(body.code, request)
    return {"ok": True}


@router.post("/visitors/signup")
async def visitor_signup(body: VisitorSignup, request: Request, response: Response):
    row = await _code_row(body.code, request)
    _record_rate(_rate_key(request, "visitor-signup"))
    name = " ".join((body.name or "").split())
    if not name or len(name) > 80 or " " not in name:
        raise HTTPException(status_code=400, detail="Add your first and last name")
    email = (body.email or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 200:
        raise HTTPException(status_code=400, detail="Add a proper email address")
    pw = body.password or ""
    if len(pw) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Your password needs at least {MIN_PASSWORD_LENGTH} characters")
    if len(pw) > 200:
        raise HTTPException(status_code=400, detail="That password is too long")
    office = _clean_office(body.visit_office)
    stage = _clean_stage(body.stage)
    vf, vt = _clean_dates(body.visit_from, body.visit_to)
    if vt < today_iso():
        raise HTTPException(status_code=400, detail="Your last day has already passed")
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="There's already an account with that email. Ask the Owner to sort it out for you.")
    office_id = row.get("office_id")
    now = datetime.now(timezone.utc).isoformat()
    role = role_for_stage(stage)
    try:
        res = await db.users.insert_one({
            "email": email, "password_hash": hash_password(pw), "name": name, "role": role,
            "office_id": office_id, "email_verified": True, "reports_to": None,
            "created_at": now, "password_changed_at": now,
            # is_demo keeps a visitor off Bells, KPIs and team lists (core/visitors.py).
            "is_demo": True, "is_visitor": True, "visit_office": office, "visitor_stage": stage,
            "visit_from": vf, "visit_to": vt,
        })
    except Exception:
        raise HTTPException(status_code=400, detail="There's already an account with that email. Ask the Owner to sort it out for you.")
    _forget_cache()
    user_id = str(res.inserted_id)
    access = create_access_token(user_id, email, 0)
    refresh = create_refresh_token(user_id, 0)
    set_auth_cookies(response, access, refresh)
    return {"id": user_id, "email": email, "name": name, "role": role,
            "token": access, "refresh_token": refresh, "must_change_password": False,
            "profile_image": None, "office_id": office_id, "is_super_admin": False, "accessible_offices": []}
