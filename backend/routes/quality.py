"""Quality: Acwyre's weekly Modern Milkman quality report, per BA (core/quality).

  POST /api/quality/read     Admin: screenshots and/or Excel exports of the
                             report → a preview with each row matched to a
                             person. Nothing is saved.
  POST /api/quality/import   Admin: save a checked preview for its week.
  GET  /api/quality          a week, 4 weeks, a month, 13 weeks or all time
                             (the running average), with each person's week
                             by week: a BA sees only their own, a Coach
                             themselves and everyone under them, an Admin
                             (and Coach+) the whole office.

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
from core.quality import (AI_PROMPT, merge_week, LABELS, MEASURES, TARGETS, VIEWS, aggregate, clean_metrics,
                          is_filter_note, percent_fix, from_ai, from_tables, merge, month_label, parse_week,
                          pick_weeks, rag, week_label, xlsx_tables, is_fourth_week_report, fourth_week_shows_on,
                          from_pdf)
from core.app_time import APP_TZ
from core.quality_alerts import is_current
from core.rate_limit import take_ai_quota
from database import db
from owneriq_sync import ID_LINKED

router = APIRouter()

MAX_FILES = 10
MAX_FILE_BYTES = 12 * 1024 * 1024
WEEK_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


async def _office_people(office_id: str) -> list[dict]:
    """Everyone in the office, including people who've exited: a report can
    still have their last weeks, and their history stays with them."""
    return [u async for u in db.users.find(
        {"office_id": office_id, "is_demo": {"$ne": True}},
        {"name": 1, "amplifi_codes": 1, "is_active": 1, "deleted": 1})]


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
    """'Haider M - MMC9974' / 'Haider M MMC9974' → 'haider m'. Separators like
    the report's ' - ' before the badge are not part of the name."""
    parts = [p for p in re.split(r"[\s\-\u2013\u2014,]+", label.replace(badge, "")) if any(ch.isalpha() for ch in p)]
    return f"{parts[0].lower()} {parts[-1][0].lower()}" if len(parts) >= 2 else ""


async def relink_saved(office_id: str, users: list[dict] | None = None) -> int:
    """Saved quality rows nobody was linked to when they were uploaded (no
    badge on the profile yet, or the name didn't match) link themselves as
    soon as the app can tell who they are: by badge, a link the Admin made by
    hand, or 'first name + initial'. Returns how many rows were linked."""
    found = [d async for d in db.quality_weeks.find(
        {"office_id": office_id, "bas": {"$elemMatch": {"user_id": None}}}, {"bas": 1})]
    if not found:
        return 0
    users = users if users is not None else await _office_people(office_id)
    by_badge, by_name = await _badge_index(office_id, users)
    linked = 0
    for d in found:
        changed = False
        for b in d.get("bas") or []:
            if b.get("user_id") or is_filter_note(b.get("label")):
                continue
            badge = str(b.get("badge") or "").strip().upper()
            uid = by_badge.get(badge) or by_name.get(_first_l(str(b.get("label") or ""), badge))
            if uid:
                b["user_id"] = uid
                changed = True
                linked += 1
        if changed:
            await db.quality_weeks.update_one({"_id": d["_id"]}, {"$set": {"bas": d["bas"]}})
    return linked


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


def _all_zero(rep: dict) -> bool:
    vals = [(r.get("metrics") or {}).get("fourth_week") for r in rep.get("rows") or []]
    vals = [v for v in vals + [(rep.get("total") or {}).get("fourth_week")] if v is not None]
    return bool(vals) and all(v == 0 for v in vals)


def _clean_reasons(raw) -> list[dict]:
    out = []
    for r in (raw or [])[:12]:
        try:
            name, n = str(r.get("reason") or "").strip()[:60], int(r.get("count"))
        except (TypeError, ValueError, AttributeError):
            continue
        if name and 0 <= n <= 5000:
            out.append({"reason": name, "count": n})
    return out


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
                parts.append(percent_fix(from_tables(xlsx_tables(raw))))
            except Exception:
                raise HTTPException(status_code=400, detail=f"Couldn't open {f.get('filename')} as an Excel file")
        elif raw[:5] == b"%PDF-":
            try:
                got = [percent_fix(p) for p in from_pdf(raw)]
            except Exception:
                raise HTTPException(status_code=400, detail=f"Couldn't open {f.get('filename') or 'that PDF'}")
            if not got:
                raise HTTPException(status_code=400, detail=f"{f.get('filename') or 'That PDF'}: no quality tables in it. "
                                                            "Export the whole Modern Milkman KPI report from Power BI as a PDF.")
            parts.extend(got)
        elif raw[:8] == b"\x89PNG\r\n\x1a\n":
            parts.append(percent_fix(await _read_image(admin, raw, "image/png")))
        elif raw[:3] == b"\xff\xd8\xff":
            parts.append(percent_fix(await _read_image(admin, raw, "image/jpeg")))
        else:
            raise HTTPException(status_code=400, detail=f"{f.get('filename') or 'That file'}: send the Power BI PDF, a screenshot (PNG or JPG) or an Excel export")
    # The 4th Delivery page comes with a later week's report (4th week for
    # WE 30 Aug with the report for WE 25 Oct): it shows on the week 8 weeks
    # after those sign-ups, and remembers which week's sign-ups it's from. A
    # 4th week that's 0% for everyone isn't in yet, so it's left out.
    reasons = next((p["fail_reasons"] for p in parts if p.get("fail_reasons")), [])
    fw_parts = [p for p in parts if is_fourth_week_report(p) and not _all_zero(p)]
    q_parts = [p for p in parts if not is_fourth_week_report(p)]
    fw_from = merge(fw_parts).get("week_ending") if fw_parts else None
    q_week = merge(q_parts).get("week_ending") if q_parts else None
    week = parse_week(body.get("week_ending")) or q_week or fourth_week_shows_on(fw_from)
    office_id = admin.get("office_id")
    users = await _office_people(office_id)
    by_badge, by_name = await _badge_index(office_id, users)
    names = {str(u["_id"]): u.get("name") or "" for u in users}

    def matched(rows_in):
        out = []
        for r in rows_in:
            uid, how = by_badge.get(r["badge"]), "badge"
            if not uid:
                uid, how = by_name.get(_first_l(r["label"], r["badge"])), "name"
            out.append({**r, "user_id": uid, "user_name": names.get(uid) if uid else None,
                        "matched_by": how if uid else None})
        return out

    fourth = None
    fw_on = fourth_week_shows_on(fw_from)
    if q_parts and fw_parts and fw_on != week:
        # A PDF holds both: the quality for its week, and the 4th Delivery
        # page for an earlier week's sign-ups, which goes on its own week.
        rep = merge(q_parts)
        fw = merge(fw_parts)
        fourth = {"week_ending": fw_on, "from": fw_from, "rows": matched(fw["rows"]), "total": fw.get("total") or {},
                  "existing": bool(await db.quality_weeks.find_one({"office_id": office_id, "week_ending": fw_on}, {"_id": 1}))}
        fw_from = None
    else:
        rep = merge(q_parts + fw_parts)   # the 4th Delivery page wins for 4th week
    rows = matched(rep["rows"])
    existing = bool(week and await db.quality_weeks.find_one({"office_id": office_id, "week_ending": week}, {"_id": 1}))
    newest = await db.quality_weeks.find_one({"office_id": office_id}, {"week_ending": 1}, sort=[("week_ending", -1)])
    people = sorted(({"id": str(u["_id"]), "name": u.get("name") or ""} for u in users
                     if u.get("is_active") is not False and not u.get("deleted")),
                    key=lambda p: p["name"].lower())
    return {"week_ending": week, "fourth_week_from": fw_from, "fourth_week": fourth, "fail_reasons": reasons,
            "rows": rows, "total": rep.get("total") or {},
            "fourth_week_due": rep.get("fourth_week_due", True), "existing": existing, "people": people,
            "newest_saved": (newest or {}).get("week_ending"),
            "current": bool(week and is_current(week, datetime.now(APP_TZ).date())),
            "measures": [{"key": k, "label": LABELS[k]} for k, _, _ in MEASURES]}


async def _save_week(admin: dict, office_id: str, users: list[dict], week: str, rows_in: list, total_in,
                     fw_from: str | None = None, reasons: list | None = None) -> tuple[list, bool]:
    """Save one week's rows (adding to the week if it's already saved).
    Returns (the people saved, whether the week was already there)."""
    ids = {str(u["_id"]) for u in users}
    by_badge, _ = await _badge_index(office_id, users)
    bas = []
    for r in rows_in or []:
        badge = str(r.get("badge") or "").strip().upper()
        if not badge or is_filter_note(r.get("label")):
            continue
        uid = r.get("user_id") if r.get("user_id") in ids else None
        if not uid:
            continue   # nobody on the Hub: a stray batch number, left out (the Owner, 3 Nov 2026)
        bas.append({"label": str(r.get("label") or badge)[:80], "badge": badge, "user_id": uid,
                    "metrics": clean_metrics(r.get("metrics"))})
        # Remember a link the Admin made by hand, so next week matches itself.
        if by_badge.get(badge) != uid:
            await db.quality_links.update_one({"office_id": office_id, "badge": badge},
                                              {"$set": {"user_id": uid, "set_by": admin.get("id"),
                                                        "set_at": datetime.now(timezone.utc).isoformat()}},
                                              upsert=True)
    if not bas:
        return [], False
    # Adding to a week already saved (e.g. The Round and 4th week from
    # another page of the report) fills in what's new and keeps the rest.
    existing = await db.quality_weeks.find_one({"office_id": office_id, "week_ending": week}, {"bas": 1, "total": 1})
    total = clean_metrics(total_in)
    if existing:
        bas, total = merge_week(existing.get("bas") or [], existing.get("total") or {}, bas, total)
    percent_fix({"rows": bas, "total": total})
    fields = {"office_id": office_id, "week_ending": week, "bas": bas, "total": total, "pct_ok": True,
              "imported_at": datetime.now(timezone.utc).isoformat(), "imported_by": admin.get("id")}
    if fw_from:
        fields["fourth_week_from"] = fw_from   # which week's sign-ups the 4th week is from
    if reasons:
        fields["fail_reasons"] = reasons       # the office's fails, by reason (from the PDF)
    await db.quality_weeks.update_one({"office_id": office_id, "week_ending": week}, {"$set": fields}, upsert=True)
    return bas, bool(existing)


@router.post("/quality/import")
async def import_quality(request: Request):
    admin = await require_admin(request)
    body = await request.json()
    week = str(body.get("week_ending") or "")
    if not WEEK_RE.match(week) or not parse_week(week):
        raise HTTPException(status_code=400, detail="Pick the week ending first")
    office_id = admin.get("office_id")
    users = await _office_people(office_id)
    bas, existing = await _save_week(admin, office_id, users, week, body.get("rows"), body.get("total"),
                                     parse_week(body.get("fourth_week_from")), _clean_reasons(body.get("fail_reasons")))
    if not bas:
        raise HTTPException(status_code=400, detail="Nobody on this report is on the Hub yet. Link at least one row to a person.")
    # The PDF's 4th Delivery page, for an earlier week's sign-ups: saved on
    # the week 8 weeks after them.
    fourth_saved = None
    fw = body.get("fourth_week") or None
    if isinstance(fw, dict):
        fw_week, fw_from = parse_week(fw.get("week_ending")), parse_week(fw.get("from"))
        if fw_week and fw_from and fw_week == fourth_week_shows_on(fw_from):
            got, _ = await _save_week(admin, office_id, users, fw_week, fw.get("rows"), fw.get("total"), fw_from)
            fourth_saved = fw_week if got else None
    try:
        await relink_saved(office_id, users)
    except Exception as ex:  # linking older weeks must never stop a save
        print(f"[quality] relinking saved weeks failed: {ex}")
    gone = {str(u["_id"]) for u in users if u.get("deleted") or u.get("is_active") is False}
    sent = await _tell_the_team(bas, week, gone) if body.get("notify") else 0
    alerts = []
    try:
        from core import quality_alerts
        alerts = await quality_alerts.run(db, office_id, week, datetime.now(APP_TZ).date())
    except Exception as ex:  # an alert must never stop a save
        print(f"[quality] retrain alert check failed: {ex}")
    return {"week_ending": week, "rows": len(bas), "linked": sum(1 for b in bas if b["user_id"]),
            "notified": sent, "added_to_saved_week": existing, "retrain_alerts": len(alerts),
            "fourth_week_saved_on": fourth_saved}


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


async def _tell_the_team(bas: list[dict], week: str, gone: set | None = None) -> int:
    """'Quality report added' to everyone on it who's in the app, with their
    own headline numbers. The Admin chooses at save (on by default for a new
    newest week, so back-filling old weeks doesn't flood phones)."""
    from core.push import send_push_to_user
    label = week_label(week).rsplit(" ", 1)[0]
    sent = 0
    for b in bas:
        if not b.get("user_id") or b["user_id"] in (gone or set()):
            continue   # not linked, or they've exited
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
    try:
        await relink_saved(office_id)
    except Exception as ex:
        print(f"[quality] relinking saved weeks failed: {ex}")
    now, before, label = pick_weeks(weeks, view, week, month)
    docs = {d["week_ending"]: d async for d in db.quality_weeks.find(
        {"office_id": office_id, "week_ending": {"$in": now + before}},
        {"_id": 0, "week_ending": 1, "bas": 1, "total": 1, "imported_at": 1, "fourth_week_from": 1, "fail_reasons": 1})}
    # Which sign-up weeks the 4th week figures in view are from (8 weeks back).
    fw_from = [{"week_ending": w, "from": docs[w]["fourth_week_from"], "label": week_label(docs[w]["fourth_week_from"])}
               for w in now if (docs.get(w) or {}).get("fourth_week_from")]

    uid = str(user.get("id"))
    role = user.get("role")
    whole = sees_whole_office(user)
    # A BA sees only themselves; a Coach themselves and everyone under them;
    # Admins and Coach+ the whole office.
    is_ba = not whole and role != "leader"
    visible = None if whole else ({uid} if is_ba else set(await get_subtree_ids(uid)) | {uid})

    # Each person across the weeks: linked people by id, anyone else by badge.
    people: dict[str, dict] = {}
    for w in now + before:
        for b in (docs.get(w) or {}).get("bas") or []:
            if not b.get("user_id"):
                continue   # nobody on the Hub (a stray batch number): never shown
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

    rows = []
    for key, p in people.items():
        if not p["now"]:
            continue
        rows.append({"user_id": p["user_id"], "name": names.get(p["user_id"]) or p["label"], "badge": p["badge"],
                     "linked": bool(p["user_id"]), "weeks": len(p["now"]),
                     "metrics": _coloured(aggregate(list(p["now"].values()))),
                     "prev": aggregate(p["before"]),
                     "history": [{"week_ending": w, "label": week_label(w), "metrics": _coloured(aggregate([p["now"][w]]))}
                                 for w in now if w in p["now"]],
                     "_key": key})

    # Teams, the same as the Bells sheet. A team includes the teams under it
    # (everyone in a sub-team counts in the team above too); each person is
    # listed under their nearest team; anyone with no team is the Mini team.
    from routes.bells import _enrich_entries_with_teams
    entries = [{"user_id": r["user_id"], "office_id": office_id} for r in rows] + [{"user_id": uid, "office_id": office_id}]
    await _enrich_entries_with_teams(entries)
    my_chain = [t for t in (entries[-1].get("teams") or []) if t.get("leader_id")]
    my_team = my_chain[0]["leader_id"] if my_chain else "mini"
    meta: dict[str, dict] = {"mini": {"leader_id": "mini"}}
    for r, e in zip(rows, entries):
        chain = [t for t in (e.get("teams") or []) if t.get("leader_id")]
        for t in chain:
            meta.setdefault(t["leader_id"], t)
        r["_chain"] = [t["leader_id"] for t in chain] or ["mini"]
        r["team_key"] = r["_chain"][0]
    if not whole and role != "leader":
        # A BA sees their own numbers only: never their team's or anyone else's.
        rows = [r for r in rows if r["user_id"] == uid]

    groups: dict[str, dict] = {}
    parent: dict[str, str] = {}
    for r in rows:
        p = people[r["_key"]]
        for i, k in enumerate(r["_chain"]):
            if i + 1 < len(r["_chain"]):
                parent.setdefault(k, r["_chain"][i + 1])
            t = meta.get(k) or {}
            g = groups.setdefault(k, {"key": k, "team_name": t.get("team_name") or None,
                                      "leader_name": t.get("leader_name"), "people": 0, "weeks": [], "before": []})
            g["people"] += 1
            g["weeks"].extend(p["now"].values())
            g["before"].extend(p["before"])
    for g in groups.values():
        g["metrics"] = _coloured(aggregate(g.pop("weeks")))
        g["prev"] = aggregate(g.pop("before"))
        g["parent_key"] = parent.get(g["key"]) if parent.get(g["key"]) in groups else None
    sales_of = lambda g: -((g["metrics"].get("sales") or {}).get("value") or 0)
    teams: list[dict] = []

    def walk(key, depth: int):
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
    if is_ba:
        teams = []

    def team_title(g: dict) -> str:
        return "Mini" if g["key"] == "mini" else (g["team_name"] or f"{(g['leader_name'] or '').split(' ')[0]}'s team")

    me = next((r for r in rows if r["user_id"] == uid), None)
    team = sorted((r for r in rows if r is not me),
                  key=lambda r: (-((r["metrics"].get("sales") or {}).get("value") or 0), r["name"].lower()))
    for r in rows:
        r.pop("_chain", None)
        r.pop("_key", None)

    # The box under "Your quality": the office for Admins and Coach+, or the
    # Coach's own team, in the same format. A BA has none.
    box = None
    if whole:
        box = {"title": "The office", "kind": "office",
               "metrics": _coloured(aggregate([(docs.get(w) or {}).get("total") or {} for w in now])),
               "prev": aggregate([(docs.get(w) or {}).get("total") or {} for w in before]),
               "history": [{"week_ending": w, "label": week_label(w), "metrics": _coloured(aggregate([(docs.get(w) or {}).get("total") or {}]))} for w in now],
               "fail_reasons": _sum_reasons([(docs.get(w) or {}).get("fail_reasons") or [] for w in now])}
    elif role == "leader":
        g = groups.get(uid)
        if g:
            box = {"title": f"Your team · {team_title(g)}", "kind": "team", "metrics": g["metrics"], "prev": g["prev"]}
        elif team:
            box = {"title": "Your team", "kind": "team",
                   "metrics": _coloured(aggregate([m for r in rows for m in people_now(people, r)])), "prev": {}}

    return {**base, "week_ending": now[0], "month": now[0][:7] if view == "month" else None,
            "label": label, "period_weeks": len(now), "fourth_week_from": fw_from, "me": me, "team": team, "teams": teams, "box": box,
            # when the newest week in view was added: Home shows the quality card for a week after
            "imported_at": (docs.get(now[0]) or {}).get("imported_at"),
            # older screens read these two
            "total": box["metrics"] if box and box["kind"] == "office" else None,
            "total_history": box.get("history") if box and box["kind"] == "office" else None}


def _sum_reasons(weeks: list[list]) -> list[dict]:
    """The office's fails by reason over the weeks in view, most first."""
    tot: dict[str, int] = {}
    for rs in weeks:
        for r in rs:
            tot[r["reason"]] = tot.get(r["reason"], 0) + int(r.get("count") or 0)
    return [{"reason": k, "count": v} for k, v in sorted(tot.items(), key=lambda kv: -kv[1]) if v]


def people_now(people: dict, row: dict) -> list:
    p = people.get(row.get("user_id") or f"badge:{row['badge']}") or {}
    return list((p.get("now") or {}).values())
