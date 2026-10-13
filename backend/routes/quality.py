"""Quality: Acwyre's weekly Modern Milkman quality report, per BA (core/quality).

  POST /api/quality/read     Admin: screenshots and/or Excel exports of the
                             report → a preview with each row matched to a
                             person. Nothing is saved.
  POST /api/quality/import   Admin: save a checked preview for its week.
  GET  /api/quality          a week, 4 weeks, a month, 13 weeks or all time
                             (the running average), with each person's week
                             by week: a BA sees their own, a Coach themselves
                             and everyone under them, an Admin (and Coach+)
                             the whole office.

Stored in `quality_weeks`, one document per (office_id, week_ending). People
are matched by badge number (users.amplifi_codes, ID badges, OwnerIQ rows,
links the Admin made at import in `quality_links`), then by a unique
"First L" name as a suggestion the Admin sees before saving.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user, get_subtree_ids, require_admin, sees_whole_office
from core.quality import (AI_PROMPT, LABELS, MEASURES, TARGETS, VIEWS, aggregate, clean_metrics,
                          excel_percent_fix, from_ai, from_tables, merge, month_label, parse_week,
                          pick_weeks, rag, week_label, xlsx_tables)
from core.rate_limit import take_ai_quota
from database import db
from owneriq_sync import ID_LINKED

router = APIRouter()

MAX_FILES = 6
MAX_FILE_BYTES = 12 * 1024 * 1024
WEEK_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


async def _office_people(office_id: str) -> list[dict]:
    return [u async for u in db.users.find(
        {"office_id": office_id, "deleted": {"$ne": True}, "is_demo": {"$ne": True}},
        {"name": 1, "amplifi_codes": 1, "is_active": 1})]


async def _badge_index(office_id: str, users: list[dict]) -> tuple[dict, dict]:
    """(badge → user_id, 'first l' → user_id) for the office's people."""
    ids = {str(u["_id"]) for u in users}
    by_badge: dict[str, str] = {}
    async for lk in db.quality_links.find({"office_id": office_id}, {"badge": 1, "user_id": 1}):
        if lk.get("user_id") in ids:
            by_badge.setdefault(str(lk["badge"]).upper(), lk["user_id"])
    for u in users:
        for c in u.get("amplifi_codes") or []:
            by_badge.setdefault(str(c).strip().upper(), str(u["_id"]))
    async for b in db.badges.find({"user_id": {"$in": list(ids)}}, {"badge_number": 1, "user_id": 1}):
        if b.get("badge_number"):
            by_badge.setdefault(str(b["badge_number"]).strip().upper(), str(b["user_id"]))
    async for r in db.owneriq_kpis.find({"cg1_user_id": {"$in": list(ids)}, "badge_number": {"$nin": [None, ""]}, **ID_LINKED},
                                        {"badge_number": 1, "cg1_user_id": 1}):
        by_badge.setdefault(str(r["badge_number"]).strip().upper(), str(r["cg1_user_id"]))
    by_name: dict[str, str] = {}
    counts: dict[str, int] = {}
    for u in users:
        parts = str(u.get("name") or "").strip().split()
        if len(parts) >= 2:
            k = f"{parts[0].lower()} {parts[-1][0].lower()}"
            counts[k] = counts.get(k, 0) + 1
            by_name[k] = str(u["_id"])
    return by_badge, {k: v for k, v in by_name.items() if counts[k] == 1}


def _first_l(label: str, badge: str) -> str:
    parts = label.replace(badge, "").split()
    return f"{parts[0].lower()} {parts[-1][0].lower()}" if len(parts) >= 2 else ""


async def _read_image(user: dict, raw: bytes, media: str) -> dict:
    from core.llm_keys import anthropic_api_key
    if not anthropic_api_key():
        raise HTTPException(status_code=503, detail="Reading screenshots needs AI switched on (ANTHROPIC_API_KEY).")
    from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
    take_ai_quota(user)
    chat = LlmChat(session_id=f"quality-{uuid.uuid4().hex[:10]}",
                   system_message="You read numbers from report screenshots exactly. You reply with JSON only.").with_model("vision")
    msg = UserMessage(text=AI_PROMPT, file_contents=[ImageContent(image_base64=base64.b64encode(raw).decode("ascii"), mime_type=media)])
    try:
        text = await asyncio.wait_for(chat.send_message(msg), timeout=55)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Reading the screenshot took too long. Try again, or crop it to the tables.")
    except Exception as ex:  # the model call failed
        raise HTTPException(status_code=502, detail=f"Couldn't read the screenshot: {ex}")
    try:
        return from_ai(text)
    except ValueError:
        raise HTTPException(status_code=422, detail="Couldn't make out the tables in that screenshot. Try a clearer one.")


@router.post("/quality/read")
async def read_quality(request: Request):
    admin = await require_admin(request)
    body = await request.json()
    files = body.get("files") or []
    if not files or len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Add 1 to {MAX_FILES} screenshots or Excel files")
    parts = []
    for f in files:
        name = str(f.get("filename") or "").lower()
        try:
            raw = base64.b64decode(str(f.get("data_b64") or ""), validate=False)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail=f"Couldn't read {f.get('filename') or 'a file'}")
        if not raw or len(raw) > MAX_FILE_BYTES:
            raise HTTPException(status_code=400, detail=f"{f.get('filename') or 'A file'} is empty or too big")
        if name.endswith(".xlsx") or raw[:2] == b"PK":
            try:
                parts.append(excel_percent_fix(from_tables(xlsx_tables(raw))))
            except Exception:
                raise HTTPException(status_code=400, detail=f"Couldn't open {f.get('filename')} as an Excel file")
        elif raw[:8] == b"\x89PNG\r\n\x1a\n":
            parts.append(await _read_image(admin, raw, "image/png"))
        elif raw[:3] == b"\xff\xd8\xff":
            parts.append(await _read_image(admin, raw, "image/jpeg"))
        else:
            raise HTTPException(status_code=400, detail=f"{f.get('filename') or 'That file'}: send a screenshot (PNG or JPG) or an Excel export")
    rep = merge(parts)
    week = parse_week(body.get("week_ending")) or rep.get("week_ending")
    office_id = admin.get("office_id")
    users = await _office_people(office_id)
    by_badge, by_name = await _badge_index(office_id, users)
    names = {str(u["_id"]): u.get("name") or "" for u in users}
    rows = []
    for r in rep["rows"]:
        uid, how = by_badge.get(r["badge"]), "badge"
        if not uid:
            uid, how = by_name.get(_first_l(r["label"], r["badge"])), "name"
        rows.append({**r, "user_id": uid, "user_name": names.get(uid) if uid else None,
                     "matched_by": how if uid else None})
    existing = bool(week and await db.quality_weeks.find_one({"office_id": office_id, "week_ending": week}, {"_id": 1}))
    newest = await db.quality_weeks.find_one({"office_id": office_id}, {"week_ending": 1}, sort=[("week_ending", -1)])
    people = sorted(({"id": str(u["_id"]), "name": u.get("name") or ""} for u in users if u.get("is_active") is not False),
                    key=lambda p: p["name"].lower())
    return {"week_ending": week, "rows": rows, "total": rep.get("total") or {},
            "fourth_week_due": rep.get("fourth_week_due", True), "existing": existing, "people": people,
            "newest_saved": (newest or {}).get("week_ending"),
            "measures": [{"key": k, "label": LABELS[k]} for k, _, _ in MEASURES]}


@router.post("/quality/import")
async def import_quality(request: Request):
    admin = await require_admin(request)
    body = await request.json()
    week = str(body.get("week_ending") or "")
    if not WEEK_RE.match(week) or not parse_week(week):
        raise HTTPException(status_code=400, detail="Pick the week ending first")
    office_id = admin.get("office_id")
    users = await _office_people(office_id)
    ids = {str(u["_id"]) for u in users}
    by_badge, _ = await _badge_index(office_id, users)
    bas = []
    for r in body.get("rows") or []:
        badge = str(r.get("badge") or "").strip().upper()
        if not badge:
            continue
        uid = r.get("user_id") if r.get("user_id") in ids else None
        bas.append({"label": str(r.get("label") or badge)[:80], "badge": badge, "user_id": uid,
                    "metrics": clean_metrics(r.get("metrics"))})
        # Remember a link the Admin made by hand, so next week matches itself.
        if uid and by_badge.get(badge) != uid:
            await db.quality_links.update_one({"office_id": office_id, "badge": badge},
                                              {"$set": {"user_id": uid, "set_by": admin.get("id"),
                                                        "set_at": datetime.now(timezone.utc).isoformat()}},
                                              upsert=True)
    if not bas:
        raise HTTPException(status_code=400, detail="No rows to save")
    await db.quality_weeks.update_one(
        {"office_id": office_id, "week_ending": week},
        {"$set": {"office_id": office_id, "week_ending": week, "bas": bas,
                  "total": clean_metrics(body.get("total")),
                  "imported_at": datetime.now(timezone.utc).isoformat(), "imported_by": admin.get("id")}},
        upsert=True)
    sent = await _tell_the_team(bas, week) if body.get("notify") else 0
    return {"week_ending": week, "rows": len(bas), "linked": sum(1 for b in bas if b["user_id"]), "notified": sent}


def _headline(m: dict) -> str:
    bits = []
    if m.get("sales") is not None:
        bits.append(f"{m['sales']} sale{'' if m['sales'] == 1 else 's'}")
    if m.get("aov") is not None:
        bits.append(f"£{m['aov']:.2f} order value")
    if m.get("drops") is not None:
        bits.append(f"{m['drops']:g} drop days")
    if m.get("fail_rate") is not None:
        bits.append(f"{m['fail_rate']:g}% fails")
    return " · ".join(bits)


async def _tell_the_team(bas: list[dict], week: str) -> int:
    """'Quality report added' to everyone on it who's in the app, with their
    own headline numbers. The Admin chooses at save (on by default for a new
    newest week, so back-filling old weeks doesn't flood phones)."""
    from core.push import send_push_to_user
    label = week_label(week).rsplit(" ", 1)[0]
    sent = 0
    for b in bas:
        if not b.get("user_id"):
            continue
        line = _headline(b.get("metrics") or {})
        try:
            await send_push_to_user(b["user_id"], "📊 Quality report added",
                                    f"{label}: {line}" if line else f"{label} is in. Tap to see your quality.",
                                    {"type": "quality", "url": "/quality"})
            sent += 1
        except Exception:
            pass
    return sent


def _coloured(metrics: dict | None) -> dict:
    return {k: {"value": v, "rag": rag(k, v)} for k, v in (metrics or {}).items()}


@router.get("/quality")
async def get_quality(request: Request, view: str = "week", week: Optional[str] = None, month: Optional[str] = None):
    """A period's numbers. view: week | 4w | month | 13w | all (all time is
    the running average). Each person's row is their average for the period
    (core.quality.aggregate) plus their week-by-week history in it."""
    user = await get_current_user(request)
    office_id = user.get("office_id")
    view = view if view in {v for v, _ in VIEWS} else "week"
    weeks = [d["week_ending"] async for d in db.quality_weeks.find({"office_id": office_id}, {"week_ending": 1}).sort("week_ending", -1).limit(156)]
    base = {"weeks": [{"week_ending": w, "label": week_label(w)} for w in weeks],
            "months": [{"month": m, "label": month_label(m)} for m in sorted({w[:7] for w in weeks}, reverse=True)],
            "views": [{"key": k, "label": label} for k, label in VIEWS], "view": view,
            "measures": [{"key": k, "label": LABELS[k], "target": (TARGETS.get(k) or {}).get("text")} for k, _, _ in MEASURES]}
    if not weeks:
        return {**base, "week_ending": None, "me": None, "team": [], "total": None}
    now, before, label = pick_weeks(weeks, view, week, month)
    docs = {d["week_ending"]: d async for d in db.quality_weeks.find(
        {"office_id": office_id, "week_ending": {"$in": now + before}}, {"_id": 0, "week_ending": 1, "bas": 1, "total": 1})}

    uid = str(user.get("id"))
    whole = sees_whole_office(user)
    visible = None if whole else (set(await get_subtree_ids(uid)) | {uid} if user.get("role") == "leader" else {uid})

    # Each person across the weeks: linked people by id, anyone else by badge.
    people: dict[str, dict] = {}
    for w in now + before:
        for b in (docs.get(w) or {}).get("bas") or []:
            if visible is not None and b.get("user_id") not in visible:
                continue
            key = b.get("user_id") or f"badge:{b['badge']}"
            p = people.setdefault(key, {"user_id": b.get("user_id"), "badge": b["badge"], "label": b.get("label"),
                                        "now": {}, "before": []})
            if w in now:
                p["now"][w] = b.get("metrics") or {}
            else:
                p["before"].append(b.get("metrics") or {})
    ids = [p["user_id"] for p in people.values() if p["user_id"]]
    names = {str(u["_id"]): u.get("name") async for u in db.users.find(
        {"_id": {"$in": [ObjectId(x) for x in ids if ObjectId.is_valid(x)]}}, {"name": 1})}

    me, team = None, []
    for p in people.values():
        if not p["now"]:
            continue
        row = {"user_id": p["user_id"], "name": names.get(p["user_id"]) or p["label"], "badge": p["badge"],
               "linked": bool(p["user_id"]), "weeks": len(p["now"]),
               "metrics": _coloured(aggregate(list(p["now"].values()))),
               "prev": aggregate(p["before"]),
               "history": [{"week_ending": w, "label": week_label(w), "metrics": _coloured(p["now"][w])}
                           for w in now if w in p["now"]]}
        if p["user_id"] == uid:
            me = row
        else:
            team.append(row)
    team.sort(key=lambda r: (-((r["metrics"].get("sales") or {}).get("value") or 0), r["name"].lower()))

    # Group by team, the same teams as the Bells sheet. A team includes the
    # teams under it (everyone in Next Gen under John's team counts in John's
    # team too); each person is listed under their nearest team. Anyone with
    # no team is the Mini team.
    teams = []
    if whole or user.get("role") == "leader":
        from routes.bells import _enrich_entries_with_teams
        rows = [r for r in ([me] if me else []) + team]
        entries = [{"user_id": r["user_id"], "office_id": office_id} for r in rows]
        await _enrich_entries_with_teams(entries)
        groups: dict[str, dict] = {}
        parent: dict[str, str] = {}

        def group(key: str, t: dict) -> dict:
            return groups.setdefault(key, {"key": key, "team_name": t.get("team_name") or None,
                                           "leader_name": t.get("leader_name"), "people": 0, "weeks": []})

        for r, e in zip(rows, entries):
            chain = [t for t in (e.get("teams") or []) if t.get("leader_id")]
            r["team_key"] = chain[0]["leader_id"] if chain else "mini"
            for i, t in enumerate(chain[:-1]):
                parent.setdefault(t["leader_id"], chain[i + 1]["leader_id"])
            p = people.get(r["user_id"] or f"badge:{r['badge']}") or {}
            for t in (chain or [{"leader_id": "mini"}]):
                g = group(t["leader_id"], t)
                g["people"] += 1
                g["weeks"].extend((p.get("now") or {}).values())
        for g in groups.values():
            g["metrics"] = _coloured(aggregate(g.pop("weeks")))
            g["parent_key"] = parent.get(g["key"]) if parent.get(g["key"]) in groups else None
        sales_of = lambda g: -((g["metrics"].get("sales") or {}).get("value") or 0)

        # Parents first, each followed by the teams under it.
        def walk(key: str | None, depth: int):
            kids = sorted((g for g in groups.values() if g["parent_key"] == key and g["key"] != "mini"), key=sales_of)
            for g in kids:
                g["depth"] = depth
                g["includes"] = [c["team_name"] or c["leader_name"] for c in groups.values() if c["parent_key"] == g["key"]]
                teams.append(g)
                walk(g["key"], depth + 1)
        walk(None, 0)
        if "mini" in groups:
            groups["mini"].update(depth=0, includes=[])
            teams.append(groups["mini"])

    total = prev_total = total_history = None
    if whole:
        total = _coloured(aggregate([(docs.get(w) or {}).get("total") or {} for w in now]))
        prev_total = aggregate([(docs.get(w) or {}).get("total") or {} for w in before])
        total_history = [{"week_ending": w, "label": week_label(w), "metrics": _coloured((docs.get(w) or {}).get("total"))} for w in now]
    return {**base, "week_ending": now[0], "month": now[0][:7] if view == "month" else None,
            "label": label, "period_weeks": len(now), "me": me, "team": team, "teams": teams,
            "total": total, "prev_total": prev_total, "total_history": total_history}
