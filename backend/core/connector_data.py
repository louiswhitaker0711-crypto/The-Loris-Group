"""The full Claude connector: every part of the app, read and (with a yes) changed.

The Owner, 16 Nov 2026: Claude should see every single thing on the app (the
monthly goal planner, people's AI chats, everything), but never personal
details (phone numbers, emails, passwords), and be able to change anything once
they've confirmed it.

Admins only (the Owner's link, or an Admin's personal link). BAs' and Coaches'
links keep the hand-made tools in routes/claude_connector.py.

  list_areas       every collection in the app: what it is, how many records,
                   the fields it holds
  read_data        any area, kept to the Admin's office, personal details and
                   secrets stripped, names added beside people's ids
  change_data      update / add / delete records. Never changes anything: it
                   shows what would change and returns a confirm code
  confirm_change   makes that change (the code lasts 15 minutes, one use)
  undo_change      puts a confirmed change back as it was

Every confirmed change is kept in `connector_changes` with a copy of each
record before it, so it can be undone.
"""
from __future__ import annotations

import json
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId

from database import db

# Never read or written: sign-in codes, links, keys and sessions.
BLOCKED_AREAS = {
    "password_resets", "email_otps", "email_change_otps", "join_tokens", "room_codes", "visitor_codes",
    "connector_links", "connector_pending", "connector_changes", "server_keys", "web_push_subscriptions",
    "owneriq_session", "owneriq_meta", "owneriq_link_state", "sessions", "migrations", "content_migrations",
}

# Field names that are never sent or written, wherever they sit.
_PRIVATE = re.compile(
    r"(password|passcode|token|secret|otp|cookie|e_?mail|phone|mobile|vapid|api_?key|p256dh|"
    r"^auth$|_hash$|^hash$|badge_number|amplifi_code|photo_base64|profile_image)", re.I)
# Fields Claude may never set (who someone is and how they sign in).
_LOCKED = {"office_id", "is_super_admin", "_id", "_doc_id"}
_BIG_STRING = 6000      # longer strings that look like files are left out
MAX_READ = 200
MAX_CHANGE = 50
PENDING_MINUTES = 15

# What each area is, in the Owner's words (the rest are named by their key).
DESCRIBE = {
    "users": "People: name, role (trainee = BA, leader = Coach, admin), reports_to (their Coach), team name, stage, "
             "earnings_plan (breakeven), flags",
    "bells_entries": "Bells: one row per person per week (week_ending = Sunday): days[] status and sign-ups "
                     "(under30 = Silver, over30 = Gold, memberships = The Round), weekly_goal, break_even",
    "monthly_planners": "Monthly goal planner (MGP): per person per month, goals, KPIs, rocks, mid term, whys, "
                        "gap analysis, SWOT, budget",
    "weekly_planners": "Weekly planner: per person per week, days.<0-5>.<box> text and slot_notes",
    "weekly_agendas": "The office's Weekly Plan (Schedule → Plan): themes, stats, rows of cells",
    "ai_conversations": "AI chats in the app (Ask the AI), per person, with their messages",
    "ai_analyses": "Analyse me results, per person per day",
    "coaching_assistant_conversations": "Coaching assistant chats",
    "sector_days": "Each person's day in a sector: setup (goal, focus, KPI) and breakdown (numbers, proud of, gap)",
    "sectors": "Sectors per day: leader_id, postcode, goal, member_ids, hops",
    "daily_assessments": "Graded new-start days (Days 1–8): 5 steps, skills, KPIs, graded_by_id",
    "new_hires": "New-start records: trainee_user_id, start_date, current_day, coach",
    "quality_weeks": "Power BI quality report per week: per BA order value, drop days, The Round, 4th week, fails",
    "coaching_notes": "Private coaching notes on a person (never shown to that person)",
    "folder_notes": "Notes folder: every planner note filed under its heading",
    "cod_focus": "Weekly COD focus per person",
    "module_progress": "COD progress: Know/Do/Deliver/Teach/Systemise sign-offs with dates",
    "training_modules": "COD items and their content",
    "academy_workbooks": "BA Academy Day 1/2 workbooks: answers and quiz scores per new start",
    "meetups": "Meet-ups (trips)", "meetup_plans": "Each person's meet-up networking planner",
    "primetime_entries": "Primetime boards per day",
    "schedule_blocks": "Schedules (who's in when)",
    "coaching_impacts": "The Coaching library", "product_knowledge_topics": "Campaign Knowledge",
    "training_manual": "The Manual (day pages, KPIs)", "office_pitch": "The office's pitch words",
    "commission_fees": "Earnings rates", "scorecard_summaries": "Weekly scorecard AI paragraphs",
    "team_moves": "Log of every change of Coach", "goal_audit": "Log of weekly goal changes",
    "ba_week_plans": "BAs' own weekly plans", "notifications": "In-app notifications",
    "territory_sectors": "Territory postcode sectors", "offices": "The office's settings",
}


# ── Shaping what goes out ─────────────────────────────────────────────────────

def private_key(k: str) -> bool:
    return bool(_PRIVATE.search(str(k)))


def _looks_like_file(s: str) -> bool:
    return len(s) > _BIG_STRING and (s.startswith("data:") or " " not in s[:400])


def clean(value: Any) -> Any:
    """Personal details out, at any depth; ids and dates JSON-friendly."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k == "_id":
                out["_doc_id"] = str(v)
            elif not private_key(k):
                out[k] = clean(v)
        return out
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return "[file left out]"
    if isinstance(value, str) and _looks_like_file(value):
        return "[file left out]"
    return value


def _add_names(value: Any, names: dict) -> Any:
    """Beside any field holding a person's id, add `<field>__name`."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            out[k] = _add_names(v, names)
            if (k.endswith("_id") or k in ("reports_to", "user", "leader")) and isinstance(v, str) and v in names:
                out[f"{k}__name"] = names[v]
            elif k.endswith("_ids") and isinstance(v, list) and v and all(isinstance(x, str) for x in v):
                if any(x in names for x in v):
                    out[f"{k}__names"] = [names.get(x, "?") for x in v]
        return out
    if isinstance(value, list):
        return [_add_names(v, names) for v in value]
    return value


# ── Who and what ──────────────────────────────────────────────────────────────

def require_admin(viewer: dict) -> str:
    if not (viewer.get("is_super_admin") or (viewer.get("role") or "").lower() == "admin"):
        raise ValueError("Only an Admin's link can open every part of the app. Use the other tools.")
    if not viewer.get("office_id"):
        raise ValueError("This link has no office.")
    return viewer["office_id"]


async def _names(office_id: str) -> dict:
    return {str(u["_id"]): u.get("name") or "" async for u in db.users.find({"office_id": office_id}, {"name": 1})}


def _area(raw: Any) -> str:
    name = str(raw or "").strip()
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,60}", name):
        raise ValueError("Say which area, by its name from list_areas (e.g. monthly_planners).")
    if name in BLOCKED_AREAS:
        raise ValueError(f"'{name}' holds sign-in codes or keys, so it's never opened.")
    return name


async def _scope(area: str, office_id: str) -> dict:
    """The filter that keeps an area to this office."""
    if area == "offices":
        return {"id": office_id}
    if area == "users":
        return {"office_id": office_id}
    if await db[area].find_one({"office_id": {"$exists": True}}, {"_id": 1}):
        return {"office_id": office_id}
    sample = await db[area].find_one({"user_id": {"$exists": True}}, {"_id": 1})
    if sample:
        ids = [str(u["_id"]) async for u in db.users.find({"office_id": office_id}, {"_id": 1})]
        return {"user_id": {"$in": ids + [ObjectId(i) for i in ids]}}
    return {}      # shared content (COD items, Manual, Campaign Knowledge)


_BAD_OPS = {"$where", "$function", "$accumulator", "$expr"}


def _match(raw: Any) -> dict:
    """Claude's filter, made safe: no code operators, `_doc_id` → `_id`."""
    if raw in (None, ""):
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise ValueError("match must be an object, e.g. {\"user_id\": \"...\", \"month\": \"2026-11\"}.")
    if not isinstance(raw, dict):
        raise ValueError("match must be an object.")

    def walk(v):
        if isinstance(v, dict):
            out = {}
            for k, x in v.items():
                if k in _BAD_OPS:
                    raise ValueError(f"{k} isn't allowed in a filter.")
                if private_key(k):
                    raise ValueError(f"'{k}' is a personal detail, so it can't be searched on.")
                if k == "_doc_id":
                    k, x = "_id", _oid(x)
                out[k] = walk(x)
            return out
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return walk(raw)


def _oid(v: Any) -> Any:
    if isinstance(v, str) and ObjectId.is_valid(v):
        return ObjectId(v)
    if isinstance(v, dict):
        return {k: _oid(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_oid(x) for x in v]
    return v


def _fit(docs: list, limit_chars: int = 180_000) -> tuple[list, bool]:
    out, used = [], 0
    for d in docs:
        n = len(json.dumps(d, default=str))
        if out and used + n > limit_chars:
            return out, True
        out.append(d)
        used += n
    return out, False


# ── Reading ───────────────────────────────────────────────────────────────────

async def list_areas(viewer: dict) -> dict:
    office_id = require_admin(viewer)
    names = sorted(n for n in await db.list_collection_names()
                   if n not in BLOCKED_AREAS and not n.startswith("system."))
    out = []
    for n in names:
        scope = await _scope(n, office_id)
        count = await db[n].count_documents(scope)
        if not count:
            continue
        sample = await db[n].find_one(scope, sort=[("_id", -1)]) or {}
        fields = [k for k in sample.keys() if k != "_id" and not private_key(k)]
        out.append({"area": n, "what": DESCRIBE.get(n, ""), "records": count, "fields": fields[:40]})
    return {"areas": out,
            "how": "read_data(area, match, ...) reads any of these. Records are kept to your office; personal "
                   "details are never sent. People's ids have their names beside them (field__name)."}


async def read_data(viewer: dict, args: dict) -> dict:
    office_id = require_admin(viewer)
    area = _area(args.get("area"))
    q = {**_match(args.get("match")), **await _scope(area, office_id)}
    try:
        limit = max(1, min(MAX_READ, int(args.get("limit") or 20)))
        skip = max(0, int(args.get("skip") or 0))
    except (TypeError, ValueError):
        raise ValueError("limit and skip are numbers.")
    proj = None
    fields = [str(f) for f in (args.get("fields") or []) if str(f).strip()]
    if fields:
        proj = {f: 1 for f in fields if not private_key(f)}
    sort_by = str(args.get("sort") or "-_id").strip()
    sort = [(sort_by.lstrip("-") if sort_by.lstrip("-") != "_doc_id" else "_id", -1 if sort_by.startswith("-") else 1)]
    total = await db[area].count_documents(q)
    docs = [d async for d in db[area].find(q, proj).sort(sort).skip(skip).limit(limit)]
    names = await _names(office_id)
    shaped = [_add_names(clean(d), names) for d in docs]
    shaped, cut = _fit(shaped)
    out = {"area": area, "total": total, "showing": len(shaped), "skip": skip, "records": shaped}
    if cut or skip + len(shaped) < total:
        out["more"] = (f"{total - skip - len(shaped)} more: read again with skip={skip + len(shaped)}, "
                       "a narrower match, or fields=[...] for just what you need.")
    return out


# ── Changing (preview → yes → confirm) ───────────────────────────────────────

def _check_values(v: Any, where: str = "") -> None:
    if isinstance(v, dict):
        for k, x in v.items():
            if str(k).startswith("$"):
                raise ValueError(f"'{k}' isn't allowed in values.")
            top = str(k).split(".")[0]
            if top in _LOCKED or private_key(k):
                raise ValueError(f"'{k}' can't be changed through Claude.")
            _check_values(x, k)
    elif isinstance(v, list):
        for x in v:
            _check_values(x, where)


def _apply_preview(doc: dict, set_: dict, unset: list) -> dict:
    after = json.loads(json.dumps(doc, default=str))
    for path, val in set_.items():
        cur = after
        parts = path.split(".")
        for p in parts[:-1]:
            if isinstance(cur, list) and p.isdigit() and int(p) < len(cur):
                cur = cur[int(p)]
            elif isinstance(cur, dict):
                cur = cur.setdefault(p, {})
            else:
                break
        else:
            if isinstance(cur, list) and parts[-1].isdigit() and int(parts[-1]) < len(cur):
                cur[int(parts[-1])] = val
            elif isinstance(cur, dict):
                cur[parts[-1]] = val
    for path in unset:
        cur = after
        parts = path.split(".")
        for p in parts[:-1]:
            cur = cur.get(p, {}) if isinstance(cur, dict) else {}
        if isinstance(cur, dict):
            cur.pop(parts[-1], None)
    return after


def _diff(before: dict, set_: dict, unset: list) -> dict:
    def get(d, path):
        cur = d
        for p in path.split("."):
            if isinstance(cur, list) and p.isdigit() and int(p) < len(cur):
                cur = cur[int(p)]
            elif isinstance(cur, dict):
                cur = cur.get(p)
            else:
                return None
        return cur
    out = {p: {"now": clean(get(before, p)), "will_be": clean(v)} for p, v in set_.items()}
    out.update({p: {"now": clean(get(before, p)), "will_be": "(removed)"} for p in unset})
    return out


async def change_data(viewer: dict, args: dict) -> dict:
    """Works out a change and shows it. Nothing is written here."""
    office_id = require_admin(viewer)
    if viewer.get("is_viewer") or viewer.get("is_demo"):
        raise ValueError("This account can only look, not change things.")
    area = _area(args.get("area"))
    action = str(args.get("action") or "update").strip().lower()
    if action not in ("update", "add", "delete"):
        raise ValueError("action is update, add or delete.")
    why = " ".join(str(args.get("why") or "").split())[:300]
    scope = await _scope(area, office_id)
    names = await _names(office_id)
    plan: dict = {"area": area, "action": action, "why": why}

    if action == "add":
        docs = args.get("records") or ([args["record"]] if isinstance(args.get("record"), dict) else [])
        if not docs or not all(isinstance(d, dict) for d in docs) or len(docs) > MAX_CHANGE:
            raise ValueError(f"Give record (one object) or records (up to {MAX_CHANGE}).")
        for d in docs:
            _check_values(d)
        plan["records"] = docs
        shown = {"will_add": [_add_names(clean(d), names) for d in docs]}
    else:
        match = _match(args.get("match"))
        if not match:
            raise ValueError("Say which records (match), e.g. {\"_doc_id\": \"...\"}. Read them first with read_data.")
        q = {**match, **scope}
        found = [d async for d in db[area].find(q).limit(MAX_CHANGE + 1)]
        if not found:
            raise ValueError("Nothing matches that. Check it with read_data first.")
        if len(found) > MAX_CHANGE:
            raise ValueError(f"That matches more than {MAX_CHANGE} records: narrow it down.")
        plan["ids"] = [str(d["_id"]) for d in found]
        if action == "update":
            set_ = args.get("set") or {}
            unset = [str(u) for u in (args.get("unset") or [])]
            if not isinstance(set_, dict) or not (set_ or unset):
                raise ValueError("Say what to change: set {field: value} and/or unset [field].")
            _check_values(set_)
            _check_values({u: None for u in unset})
            plan["set"], plan["unset"] = set_, unset
            shown = {"will_change": [{"record": _add_names({"_doc_id": str(d["_id"]),
                                                            **{k: clean(d.get(k)) for k in
                                                               ("name", "user_id", "user_name", "week_ending",
                                                                "month", "date", "title") if k in d}}, names),
                                      "changes": _diff(d, set_, unset)} for d in found]}
        else:
            shown = {"will_delete": [_add_names(clean(d), names) for d in found][:10],
                     "count": len(found)}

    code = secrets.token_hex(4).upper()
    now = datetime.now(timezone.utc)
    await db.connector_pending.insert_one({
        "code": code, "viewer_id": str(viewer.get("id")), "office_id": office_id,
        "plan": json.loads(json.dumps(plan, default=str)), "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=PENDING_MINUTES)).isoformat(), "used": False})
    return {"nothing_changed_yet": True, **shown, "confirm_code": code,
            "next": "Show the person exactly this and ask for a clear yes. Only then call confirm_change with "
                    f"this code (it lasts {PENDING_MINUTES} minutes)."}


async def confirm_change(viewer: dict, args: dict) -> dict:
    office_id = require_admin(viewer)
    code = str(args.get("confirm_code") or "").strip().upper()
    now = datetime.now(timezone.utc)
    pend = await db.connector_pending.find_one_and_update(
        {"code": code, "viewer_id": str(viewer.get("id")), "used": False, "expires_at": {"$gt": now.isoformat()}},
        {"$set": {"used": True, "used_at": now.isoformat()}})
    if not pend:
        raise ValueError("That code isn't valid (wrong, used, or over 15 minutes old). Run change_data again.")
    plan = pend["plan"]
    area = _area(plan["area"])
    scope = await _scope(area, office_id)
    stamp = now.isoformat()
    record = {"id": secrets.token_hex(8), "viewer_id": str(viewer.get("id")), "viewer_name": viewer.get("name"),
              "office_id": office_id, "area": area, "action": plan["action"], "why": plan.get("why") or "",
              "at": stamp, "undone": False}

    if plan["action"] == "add":
        docs = []
        for d in plan["records"]:
            d = dict(d)
            if "office_id" in scope:
                d["office_id"] = office_id
            d.setdefault("created_at", stamp)
            d["added_by_claude"] = True
            docs.append(d)
        res = await db[area].insert_many(docs)
        record["added_ids"] = [str(i) for i in res.inserted_ids]
        done = {"added": len(docs)}
    else:
        q = {"_id": {"$in": [_oid(i) for i in plan["ids"]]}, **scope}
        before = [d async for d in db[area].find(q)]
        record["before"] = before
        if plan["action"] == "update":
            upd: dict = {}
            if plan.get("set"):
                upd["$set"] = {**plan["set"], "updated_at": stamp}
            else:
                upd["$set"] = {"updated_at": stamp}
            if plan.get("unset"):
                upd["$unset"] = {u: "" for u in plan["unset"]}
            res = await db[area].update_many(q, upd)
            done = {"changed": res.modified_count}
        else:
            res = await db[area].delete_many(q)
            done = {"deleted": res.deleted_count}
    await db.connector_changes.insert_one(record)
    return {**done, "area": area, "change_id": record["id"],
            "undo": "undo_change with this change_id puts it back as it was."}


async def undo_change(viewer: dict, args: dict) -> dict:
    office_id = require_admin(viewer)
    cid = str(args.get("change_id") or "").strip()
    rec = await db.connector_changes.find_one({"id": cid, "office_id": office_id, "undone": False})
    if not rec:
        raise ValueError("No change with that id to undo (or it's already been undone).")
    area = _area(rec["area"])
    if rec["action"] == "add":
        res = await db[area].delete_many({"_id": {"$in": [_oid(i) for i in rec.get("added_ids") or []]}})
        done = {"removed": res.deleted_count}
    else:
        n = 0
        for d in rec.get("before") or []:
            await db[area].replace_one({"_id": d["_id"]}, d, upsert=True)
            n += 1
        done = {"restored": n}
    await db.connector_changes.update_one({"_id": rec["_id"]}, {"$set": {
        "undone": True, "undone_at": datetime.now(timezone.utc).isoformat()}})
    return {**done, "area": area, "change_id": cid}


async def recent_changes(viewer: dict, args: dict) -> dict:
    office_id = require_admin(viewer)
    rows = [r async for r in db.connector_changes.find({"office_id": office_id}, {"before": 0}).sort("at", -1).limit(20)]
    return {"changes": [{"change_id": r["id"], "at": r["at"], "by": r.get("viewer_name"), "area": r["area"],
                         "action": r["action"], "why": r.get("why"), "undone": r.get("undone")} for r in rows]}
