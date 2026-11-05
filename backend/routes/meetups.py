"""Meet-ups (the Owner, 5 Nov 2026): a networking planner for when people go
to a meet-up (the first: two going to a BA meet-up abroad).

The Owner creates a meet-up in Admin → Meet-ups (name, place, dates, who's
going, any agenda they already have) and sends it out. From a week before it
starts, each person going gets a Home card and their own planner:

  * their numbers on hand (last 4 weeks of sign-ups, Gold/Round %, the funnel,
    their biggest gap from recent breakdowns, this week's COD focus), so their
    questions are aimed at what would move them
  * goals for the trip, the agenda (they add sessions themselves) and their
    picks, who they want to meet, questions, things to work on
  * people they met (name, where from, number, notes, followed up)
  * notes, which file into Notes → Meet-ups → <meet-up name>
  * "bring it back" (unlocks on the last day): top 3 takeaways and a Primetime
    topic they'll run

The card leaves Home once the debrief is done (or 14 days after the end). The
day after the meet-up ends, anyone with contacts not yet followed up gets one
push to message them. The Owner (any Admin in the office) sees every planner.

Collections:
  meetups       {id, office_id, name, place, start_date, end_date, agenda,
                 attendee_ids, sent_at, created_by, created_at, updated_at}
  meetup_plans  {meetup_id, user_id, office_id, goals, picks, sessions, meet,
                 questions, work_on, contacts, notes, debrief, nudged_at,
                 opened_at, updated_at}

    GET    /api/meetups                 Admin: every meet-up with progress, and the office's people
    POST   /api/meetups                 Admin: create
    PUT    /api/meetups/{id}            Admin: change
    DELETE /api/meetups/{id}            Admin: delete (and its planners and notes)
    POST   /api/meetups/{id}/send       Admin: send it out (a push to each person going)
    GET    /api/meetups/{id}/plans      Admin: everyone's planner
    GET    /api/meetups/mine            the meet-ups on my Home now
    GET    /api/meetups/{id}/me         my planner, with my numbers
    PUT    /api/meetups/{id}/me         save my planner
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, require_admin
from core.app_time import APP_TZ
from database import db

router = APIRouter()

SHOW_DAYS_BEFORE = 7
HIDE_DAYS_AFTER = 14
MAX_ITEMS = 30
MAX_TEXT = 600
MAX_NOTE = 8000
_ID = re.compile(r"^[A-Za-z0-9_-]{6,40}$")
MEETUP_HEAD = re.compile(r"^meetup:[A-Za-z0-9-]{6,40}$")
LIST_KEYS = ("meet", "questions", "work_on")


def _today() -> date:
    return datetime.now(APP_TZ).date()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(v, n: int = MAX_TEXT) -> str:
    return " ".join(str(v or "").split())[:n]


def _date(v, field: str) -> str:
    try:
        return date.fromisoformat(str(v or "")[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Pick a {field}")


def _nid(v) -> str:
    v = str(v or "")
    return v if _ID.match(v) else uuid.uuid4().hex[:12]


def clean_sessions(raw) -> list[dict]:
    out = []
    for s in (raw if isinstance(raw, list) else [])[:MAX_ITEMS]:
        if not isinstance(s, dict):
            continue
        title = _text(s.get("title"), 160)
        if not title:
            continue
        day = str(s.get("day") or "")[:10]
        try:
            day = date.fromisoformat(day).isoformat()
        except ValueError:
            day = ""
        time = str(s.get("time") or "")
        out.append({"id": _nid(s.get("id")), "day": day,
                    "time": time if re.match(r"^\d{2}:\d{2}$", time) else "", "title": title})
    out.sort(key=lambda s: (s["day"] or "9", s["time"] or "99"))
    return out


def clean_plan(raw: dict) -> dict:
    """A planner as saved by its owner: bad entries dropped, sizes capped."""
    raw = raw if isinstance(raw, dict) else {}

    def items(key, fields):
        out = []
        for x in (raw.get(key) if isinstance(raw.get(key), list) else [])[:MAX_ITEMS]:
            if not isinstance(x, dict):
                continue
            row = {"id": _nid(x.get("id"))}
            for f, n in fields.items():
                row[f] = (x.get(f) is True) if n == 0 else _text(x.get(f), n)
            if any(row[f] for f, n in fields.items() if n):
                out.append(row)
        return out

    notes = []
    for x in (raw.get("notes") if isinstance(raw.get("notes"), list) else [])[:MAX_ITEMS]:
        if not isinstance(x, dict):
            continue
        title, body = _text(x.get("title"), 120), str(x.get("body") or "")[:MAX_NOTE]
        if title or body.strip():
            notes.append({"id": _nid(x.get("id")), "title": title, "body": body})
    d = raw.get("debrief") if isinstance(raw.get("debrief"), dict) else {}
    take = [_text(t, MAX_TEXT) for t in (d.get("takeaways") if isinstance(d.get("takeaways"), list) else [])][:3]
    take += [""] * (3 - len(take))
    plan = {
        "goals": items("goals", {"text": MAX_TEXT, "done": 0}),
        "sessions": clean_sessions(raw.get("sessions")),
        "picks": [str(p) for p in (raw.get("picks") if isinstance(raw.get("picks"), list) else []) if _ID.match(str(p))][:60],
        "contacts": items("contacts", {"name": 120, "where": 160, "phone": 40, "notes": MAX_TEXT, "followed_up": 0}),
        "notes": notes,
        "debrief": {"takeaways": take, "primetime": _text(d.get("primetime"), 200), "done": d.get("done") is True},
    }
    for k in LIST_KEYS:
        plan[k] = items(k, {"text": MAX_TEXT})
    return plan


SECTIONS = ("goals", "meet", "questions", "work_on", "contacts")


def progress(plan: Optional[dict]) -> dict:
    """How far through someone is: one per section with something in it."""
    p = plan or {}
    done = sum(1 for k in SECTIONS if p.get(k))
    return {"done": done, "of": len(SECTIONS), "contacts": len(p.get("contacts") or []),
            "opened": bool(p.get("opened_at")), "debrief_done": bool((p.get("debrief") or {}).get("done"))}


def on_home(m: dict, plan: Optional[dict], today: Optional[date] = None) -> bool:
    """Shows from a week before it starts until the debrief is done (or two weeks after)."""
    t = today or _today()
    if not m.get("sent_at"):
        return False
    start, end = date.fromisoformat(m["start_date"]), date.fromisoformat(m["end_date"])
    if t < start - timedelta(days=SHOW_DAYS_BEFORE) or t > end + timedelta(days=HIDE_DAYS_AFTER):
        return False
    return not ((plan or {}).get("debrief") or {}).get("done")


def _out(m: dict) -> dict:
    return {k: m.get(k) for k in ("id", "name", "place", "start_date", "end_date", "agenda", "attendee_ids", "sent_at")}


async def _names(ids: list[str]) -> dict:
    oids = [ObjectId(i) for i in ids if ObjectId.is_valid(i)]
    return {str(u["_id"]): u.get("name") or "" async for u in db.users.find({"_id": {"$in": oids}}, {"name": 1})}


async def _meetup(mid: str, office_id) -> dict:
    m = await db.meetups.find_one({"id": mid, "office_id": office_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Meet-up not found")
    return m


async def _clean_meetup(user: dict, raw: dict) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    name = _text(raw.get("name"), 80)
    if not name:
        raise HTTPException(status_code=400, detail="Give the meet-up a name")
    start, end = _date(raw.get("start_date"), "start date"), _date(raw.get("end_date") or raw.get("start_date"), "end date")
    if end < start:
        raise HTTPException(status_code=400, detail="The end date is before the start date")
    ids = [str(i) for i in (raw.get("attendee_ids") if isinstance(raw.get("attendee_ids"), list) else []) if ObjectId.is_valid(str(i))][:40]
    # Only people in your office.
    ok = {str(u["_id"]) async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in ids]}, "office_id": user.get("office_id"), "deleted": {"$ne": True}}, {"_id": 1})}
    return {"name": name, "place": _text(raw.get("place"), 80), "start_date": start, "end_date": end,
            "agenda": clean_sessions(raw.get("agenda")), "attendee_ids": [i for i in ids if i in ok]}


def _no_viewer(user: dict) -> None:
    if user.get("is_viewer"):
        raise HTTPException(status_code=403, detail="Read-only account")


# ── The Owner: Admin → Meet-ups ──────────────────────────────────────────

@router.get("/meetups")
async def list_meetups(request: Request):
    user = await require_admin(request)
    office = user.get("office_id")
    ms = await db.meetups.find({"office_id": office}, {"_id": 0}).sort("start_date", -1).to_list(100)
    plans = {(p["meetup_id"], p["user_id"]): p async for p in db.meetup_plans.find(
        {"meetup_id": {"$in": [m["id"] for m in ms]}}, {"_id": 0})}
    names = await _names(sorted({i for m in ms for i in m.get("attendee_ids") or []}))
    out = []
    for m in ms:
        out.append({**_out(m), "people": [{"user_id": i, "name": names.get(i, "Someone"),
                                           **progress(plans.get((m["id"], i)))} for i in m.get("attendee_ids") or []]})
    people = [{"id": str(u["_id"]), "name": u.get("name") or ""} async for u in db.users.find(
        {"office_id": office, "deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_demo": {"$ne": True},
         "is_viewer": {"$ne": True}, "role": {"$in": ["trainee", "leader", "admin"]}}, {"name": 1}).sort("name", 1)]
    return {"meetups": out, "people": people, "today": _today().isoformat()}


@router.post("/meetups")
async def create_meetup(request: Request):
    user = await require_admin(request)
    _no_viewer(user)
    doc = await _clean_meetup(user, await request.json())
    doc.update({"id": str(uuid.uuid4()), "office_id": user.get("office_id"), "sent_at": None,
                "created_by": str(user["id"]), "created_at": _now(), "updated_at": _now()})
    await db.meetups.insert_one(doc.copy())
    return {"meetup": _out(doc)}


@router.put("/meetups/{mid}")
async def update_meetup(mid: str, request: Request):
    user = await require_admin(request)
    _no_viewer(user)
    m = await _meetup(mid, user.get("office_id"))
    upd = await _clean_meetup(user, await request.json())
    upd["updated_at"] = _now()
    await db.meetups.update_one({"id": mid}, {"$set": upd})
    # Someone taken off the list: their planner goes too.
    gone = [i for i in m.get("attendee_ids") or [] if i not in upd["attendee_ids"]]
    if gone:
        await db.meetup_plans.delete_many({"meetup_id": mid, "user_id": {"$in": gone}})
        await db.folder_notes.delete_many({"head": f"meetup:{mid}", "user_id": {"$in": gone}})
    if upd["name"] != m.get("name"):
        await db.folder_notes.update_many({"head": f"meetup:{mid}"}, {"$set": {"head_label": upd["name"]}})
    return {"meetup": _out({**m, **upd})}


@router.delete("/meetups/{mid}")
async def delete_meetup(mid: str, request: Request):
    user = await require_admin(request)
    _no_viewer(user)
    await _meetup(mid, user.get("office_id"))
    await db.meetups.delete_one({"id": mid})
    await db.meetup_plans.delete_many({"meetup_id": mid})
    await db.folder_notes.delete_many({"head": f"meetup:{mid}"})
    return {"ok": True}


@router.post("/meetups/{mid}/send")
async def send_meetup(mid: str, request: Request):
    user = await require_admin(request)
    _no_viewer(user)
    m = await _meetup(mid, user.get("office_id"))
    if not m.get("attendee_ids"):
        raise HTTPException(status_code=400, detail="Add who's going first")
    first_time = not m.get("sent_at")
    await db.meetups.update_one({"id": mid}, {"$set": {"sent_at": m.get("sent_at") or _now()}})
    sent = 0
    if first_time:
        from core.push import send_push_to_user
        for uid in m["attendee_ids"]:
            try:
                await send_push_to_user(uid, f"{m['name']}: your planner's ready",
                                        "Set your goals, who you want to meet and your questions before you go.",
                                        {"url": f"/meetup?id={mid}", "type": "meetup"})
                sent += 1
            except Exception:  # noqa: BLE001
                pass
    return {"ok": True, "pushed": sent}


@router.get("/meetups/{mid}/plans")
async def meetup_plans(mid: str, request: Request):
    user = await require_admin(request)
    m = await _meetup(mid, user.get("office_id"))
    names = await _names(m.get("attendee_ids") or [])
    plans = {p["user_id"]: p async for p in db.meetup_plans.find({"meetup_id": mid}, {"_id": 0})}
    return {"meetup": _out(m), "people": [
        {"user_id": i, "name": names.get(i, "Someone"), **progress(plans.get(i)),
         "plan": {k: v for k, v in (plans.get(i) or {}).items() if k not in ("meetup_id", "office_id", "user_id")}}
        for i in m.get("attendee_ids") or []]}


# ── The people going ─────────────────────────────────────────────────────

@router.get("/meetups/mine")
async def my_meetups(request: Request):
    user = await get_current_user(request)
    me = str(user["id"])
    out = []
    async for m in db.meetups.find({"office_id": user.get("office_id"), "attendee_ids": me, "sent_at": {"$ne": None}},
                                   {"_id": 0}):
        plan = await db.meetup_plans.find_one({"meetup_id": m["id"], "user_id": me}, {"_id": 0})
        if on_home(m, plan):
            days = (date.fromisoformat(m["start_date"]) - _today()).days
            out.append({**_out(m), **progress(plan), "days_to_go": days,
                        "debrief_open": _today() >= date.fromisoformat(m["end_date"])})
    out.sort(key=lambda x: x["start_date"])
    return {"meetups": out}


async def my_numbers(user: dict) -> dict:
    """What someone takes with them: last 4 weeks, the funnel, their gap, COD focus."""
    from core.ai_context import weekly_rows, week_ending_of
    from core.person_breakdown import law_of_averages
    from routes.people import _kpi_rows
    me = str(user["id"])
    today = _today()
    last_full = date.fromisoformat(week_ending_of(today)) - timedelta(days=7)
    weeks = [(last_full - timedelta(days=7 * i)).isoformat() for i in range(4)][::-1]
    rows, _ = await weekly_rows(user.get("office_id"), {me}, weeks)
    mine = rows.get(me, {}).get("weeks", {})
    wk = [{"week_ending": w, "sign_ups": (mine.get(w) or {}).get("sign_ups") or 0} for w in weeks]
    total = sum(w["sign_ups"] for w in wk)
    gold = sum((mine.get(w) or {}).get("gold") or 0 for w in weeks)
    rnd = sum((mine.get(w) or {}).get("the_round") or 0 for w in weeks)
    days = sum((mine.get(w) or {}).get("days_worked") or 0 for w in weeks)
    try:
        loa = law_of_averages(await _kpi_rows({"cg1_user_id": me}, (today - timedelta(days=27)).isoformat(), today.isoformat()))
    except Exception:  # noqa: BLE001
        loa = None
    gap = None
    from routes.sector import GAP_LABELS
    async for d in db.sector_days.find({"user_id": me, "breakdown.gap": {"$in": list(GAP_LABELS)}},
                                       {"_id": 0, "date": 1, "breakdown.gap": 1, "breakdown.why": 1}).sort("date", -1).limit(1):
        b = d.get("breakdown") or {}
        gap = {"label": GAP_LABELS[b["gap"]], "why": b.get("why") or "", "date": d.get("date")}
    focus = None
    try:
        from routes.cod_focus import focus_for
        focus = (await focus_for([me], week_ending_of(today))).get(me)
    except Exception:  # noqa: BLE001
        pass
    return {
        "weeks": wk,
        "piece_average": round(total / days, 2) if days else None,
        "gold_pct": round(100 * gold / total) if total else None,
        "round_pct": round(100 * rnd / total) if total else None,
        "avg_per_day": (loa or {}).get("avg_per_day") if (loa or {}).get("active_days") else None,
        "steps": (loa or {}).get("steps") if (loa or {}).get("active_days") else None,
        "gap": gap,
        "cod_focus": (focus or {}).get("topic"),
    }


async def _mine(mid: str, user: dict) -> dict:
    m = await _meetup(mid, user.get("office_id"))
    if str(user["id"]) not in (m.get("attendee_ids") or []) or not m.get("sent_at"):
        raise HTTPException(status_code=404, detail="Meet-up not found")
    return m


@router.get("/meetups/{mid}/me")
async def my_plan(mid: str, request: Request):
    user = await get_current_user(request)
    me = str(user["id"])
    m = await _mine(mid, user)
    plan = await db.meetup_plans.find_one({"meetup_id": mid, "user_id": me}, {"_id": 0})
    if not plan:
        plan = {"meetup_id": mid, "user_id": me, "office_id": user.get("office_id"), **clean_plan({}),
                "opened_at": _now(), "updated_at": _now()}
        await db.meetup_plans.insert_one(plan.copy())
    elif not plan.get("opened_at"):
        await db.meetup_plans.update_one({"meetup_id": mid, "user_id": me}, {"$set": {"opened_at": _now()}})
    return {"meetup": _out(m), "plan": {k: plan.get(k) for k in ("goals", "sessions", "picks", "meet", "questions",
                                                                    "work_on", "contacts", "notes", "debrief")},
            "numbers": await my_numbers(user), "today": _today().isoformat(),
            "debrief_open": _today() >= date.fromisoformat(m["end_date"])}


@router.put("/meetups/{mid}/me")
async def save_plan(mid: str, request: Request):
    user = await get_current_user(request)
    _no_viewer(user)
    me = str(user["id"])
    m = await _mine(mid, user)
    plan = clean_plan(await request.json())
    if plan["debrief"]["done"] and _today() < date.fromisoformat(m["end_date"]):
        plan["debrief"]["done"] = False
    await db.meetup_plans.update_one(
        {"meetup_id": mid, "user_id": me},
        {"$set": {**plan, "office_id": user.get("office_id"), "updated_at": _now()},
         "$setOnInsert": {"opened_at": _now()}}, upsert=True)
    await file_notes(user, m, plan)
    return {"ok": True, **progress(plan)}


async def file_notes(user: dict, m: dict, plan: dict) -> None:
    """Notes → Meet-ups → <name>: each note, plus the debrief once there's one."""
    uid = str(user["id"])
    head = f"meetup:{m['id']}"
    entries = [(f"meetup:{uid}:{m['id']}:n:{n['id']}", n["title"] or "Meet-up note", n["body"], "Meet-up notes")
               for n in plan["notes"]]
    d = plan["debrief"]
    take = [t for t in d["takeaways"] if t]
    if take or d["primetime"]:
        body = "\n".join(f"{i}. {t}" for i, t in enumerate(take, 1))
        if d["primetime"]:
            body += ("\n\n" if body else "") + f"Primetime topic I'll run: {d['primetime']}"
        entries.append((f"meetup:{uid}:{m['id']}:debrief", "What I'm bringing back", body, "Debrief"))
    now = _now()
    keep = []
    for ref, title, body, src in entries:
        keep.append(ref)
        await db.folder_notes.update_one(
            {"ref": ref},
            {"$set": {"office_id": user.get("office_id"), "user_id": uid, "author_name": user.get("name") or "",
                      "head": head, "head_label": m["name"], "stage": None, "category": "",
                      "title": title, "body": body, "photos": [], "date": m["start_date"],
                      "source_label": src, "shared": False, "updated_at": now},
             "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}}, upsert=True)
    await db.folder_notes.delete_many({"ref": {"$regex": f"^meetup:{re.escape(uid)}:{re.escape(m['id'])}:", "$nin": keep}})


async def edit_from_notes(user: dict, note: dict, title: str, body: str) -> bool:
    """A meet-up note changed in Notes: change it in the planner too."""
    parts = str(note.get("ref") or "").split(":")
    if len(parts) != 5 or parts[0] != "meetup" or parts[1] != str(user["id"]) or parts[3] != "n":
        return False
    mid, nid = parts[2], parts[4]
    plan = await db.meetup_plans.find_one({"meetup_id": mid, "user_id": str(user["id"])}, {"_id": 0})
    m = await db.meetups.find_one({"id": mid}, {"_id": 0})
    if not plan or not m:
        return False
    for n in plan.get("notes") or []:
        if n.get("id") == nid:
            n["title"], n["body"] = title or n.get("title") or "", body
    clean = clean_plan(plan)
    await db.meetup_plans.update_one({"meetup_id": mid, "user_id": str(user["id"])}, {"$set": {"notes": clean["notes"], "updated_at": _now()}})
    await file_notes(user, m, clean)
    return True


async def add_from_notes(user: dict, mid: str, title: str, body: str) -> Optional[str]:
    """Write a note in Notes under a meet-up: it goes in that meet-up's planner."""
    m = await db.meetups.find_one({"id": mid, "office_id": user.get("office_id")}, {"_id": 0})
    uid = str(user["id"])
    if not m or uid not in (m.get("attendee_ids") or []):
        raise HTTPException(status_code=403, detail="You're not going to that meet-up")
    plan = await db.meetup_plans.find_one({"meetup_id": mid, "user_id": uid}, {"_id": 0}) or {}
    nid = uuid.uuid4().hex[:12]
    clean = clean_plan({**plan, "notes": (plan.get("notes") or []) + [{"id": nid, "title": title, "body": body}]})
    await db.meetup_plans.update_one({"meetup_id": mid, "user_id": uid},
                                     {"$set": {**clean, "office_id": user.get("office_id"), "updated_at": _now()}}, upsert=True)
    await file_notes(user, m, clean)
    fn = await db.folder_notes.find_one({"ref": f"meetup:{uid}:{mid}:n:{nid}"}, {"_id": 0, "id": 1})
    return (fn or {}).get("id")


async def followup_tick() -> int:
    """The day after a meet-up ends: one push to message the people you met."""
    yesterday = (_today() - timedelta(days=1)).isoformat()
    sent = 0
    from core.push import send_push_to_user
    async for m in db.meetups.find({"end_date": {"$lte": yesterday}, "sent_at": {"$ne": None}}, {"_id": 0}):
        if m["end_date"] < (_today() - timedelta(days=3)).isoformat():
            continue
        async for p in db.meetup_plans.find({"meetup_id": m["id"], "nudged_at": None}, {"_id": 0}):
            left = [c for c in p.get("contacts") or [] if not c.get("followed_up")]
            await db.meetup_plans.update_one({"meetup_id": m["id"], "user_id": p["user_id"]}, {"$set": {"nudged_at": _now()}})
            if not left:
                continue
            try:
                await send_push_to_user(p["user_id"], f"Message who you met at {m['name']}",
                                        f"{len(left)} {'person' if len(left) == 1 else 'people'} to follow up while it's fresh.",
                                        {"url": f"/meetup?id={m['id']}", "type": "meetup"})
                sent += 1
            except Exception:  # noqa: BLE001
                pass
    return sent
