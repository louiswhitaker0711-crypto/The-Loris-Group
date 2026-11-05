"""The Hub's AI: a chat for everyone, a once-a-day "Analyse me", and plan
suggestions with "Use this" buttons (the Owner, 2 Nov 2026).

  GET  /api/ai/status          is AI on, and what's left today
  POST /api/ai/chat            talk to the AI (20 messages a person a day)
  GET  /api/ai/chat            today's conversation
  POST /api/ai/chat/new        start a fresh conversation
  POST /api/ai/analyse         the day's full analysis (once a person a day)
  GET  /api/ai/analyse         today's analysis, if done
  POST /api/ai/suggest-plan    a plan for tomorrow and the week (5 a day)
  POST /api/ai/apply           "Use this": fill in a suggestion

The AI sees what the person can see in the app (core/ai_context.py) and
never changes anything by itself: "Use this" goes through core/ai_actions.py
with the person's own permissions. Every model call goes through
take_ai_quota and the concurrency guard; the daily caps keep the bill small.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from auth import get_current_user
from core.ai_context import context_text, next_field_day, today_uk
from core.brand import APP_NAME, BRITISH_ENGLISH, SELF_EMPLOYED_TERMS
from core.llm_guard import acquire_llm_slot
from core.llm_keys import llm_configured
from core.rate_limit import take_ai_quota
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()

# Daily caps per person (the Owner, 2 Nov 2026: Analyse once a day; chat
# capped so one person can't run the bill up).
DAILY_LIMITS = {"chat": 20, "analyse": 1, "suggest": 5}
CHAT_HISTORY_TURNS = 10

ABOUT = (
    f"You are the AI coach inside {APP_NAME}, the field app for a UK Modern Milkman door-to-door sales office. "
    "Self-employed Brand Ambassadors (BAs) sign up customers to Modern Milkman's weekly milk and grocery delivery; "
    "Coaches develop them. Gold = a sign-up with a £10+ repeat weekly order, Silver = £5–£9.99, The Round = "
    "Modern Milkman's membership add-on. The office's standards: weekly traffic light Red under 8, Amber 8–14, "
    "Green 15–19, Super Green 20+ sign-ups; Gold 90%+; The Round 75%+; daily sign-ups 1 red, 2 amber, 3 light "
    "green, 4+ dark green; averaging under 1.8 sign-ups a day over the last 3 days in needs retraining. The Law "
    "of Averages for a day: 120 doors, 70 spoken to, 25 pitched, 15 closed, 4+ sign-ups (say 'pitched', not "
    "'presented'). Quality targets: £13+ average order value, 2.5+ drop days, fails under 10%, 75%+ taking The "
    "Round, 75%+ reaching their 4th week. Weeks run Monday to Saturday and are named by their Sunday. The team's "
    "motto: 'Tomorrow is a new day'. A bunny hop is a pair of BAs working one area of a sector; a solo is one BA "
    "alone. The breakdown is: numbers, one to three positives, the biggest gap (a step ratio or low volume), why, "
    "what will change, a Primetime topic and how they'll know it worked (a number to track).\n"
    "What good looks like (measure everyone against THIS, never against the office's average): a day of 120 doors, "
    "70 spoken to (58% of doors), 25 pitched (36% of spoken), 15 closed (60% of pitched), 4+ sign-ups (about 27% "
    "of closes); 3+ a day is light green, 4+ dark green; 15+ a week is Green, 20+ Super Green; Gold 90%+; The "
    "Round 75%+; £13+ order value; 2.5+ drop days; fails under 10%.\n"
    "How to coach: you are a top field Coach, not an analyst. Be direct, warm and brief. Use their real numbers "
    "against what good looks like. Find the ONE step costing them most (doors→spoken, spoken→pitched, "
    "pitched→closed, closed→sign-up, or simply not enough doors) and give practical tips they can use on the "
    "very next door: what to say or do differently, in the team's own language (S.E.E., hooklines, K.I.S.S., "
    "tone of voice, body language, building trust, taking control, timing the close, handling objections, "
    "qualifying early, the Rehash, call backs, not wasting time). When coaching material from the Hub is given, "
    "base your tips on it. Don't compare them with the office's average or other people unless they ask. Never "
    "invent numbers that aren't in the data; if something is missing, say so. Don't invent Modern Milkman facts "
    "or prices. Short sentences, no waffle: it's read on a phone between doors. "
    + BRITISH_ENGLISH + " " + SELF_EMPLOYED_TERMS
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_ai(user: dict) -> None:
    if not llm_configured():
        raise HTTPException(status_code=503, detail="The AI isn't switched on yet. The Owner needs to add the AI key.")
    if user.get("is_viewer"):
        raise HTTPException(status_code=403, detail="The AI isn't available on read-only accounts")


async def _used(uid: str, day: str) -> dict:
    doc = await db.ai_usage.find_one({"_id": f"{uid}:{day}"}) or {}
    return {k: int(doc.get(k) or 0) for k in DAILY_LIMITS}


async def _take(uid: str, kind: str) -> None:
    """Count one use of `kind` today, or 429 once today's allowance is gone."""
    day = today_uk().isoformat()
    key = f"{uid}:{day}"
    try:
        await db.ai_usage.update_one({"_id": key}, {"$setOnInsert": {"user_id": uid, "date": day}}, upsert=True)
    except DuplicateKeyError:
        pass
    got = await db.ai_usage.find_one_and_update(
        {"_id": key, "$or": [{kind: {"$lt": DAILY_LIMITS[kind]}}, {kind: {"$exists": False}}]},
        {"$inc": {kind: 1}}, return_document=ReturnDocument.AFTER)
    if not got:
        msg = {"chat": f"That's today's {DAILY_LIMITS['chat']} AI messages used. Tomorrow is a new day!",
               "analyse": "You've had today's analysis. Scroll back up to read it, and try again tomorrow.",
               "suggest": "That's today's plan suggestions used. Try again tomorrow."}[kind]
        raise HTTPException(status_code=429, detail=msg)


async def _give_back(uid: str, kind: str) -> None:
    """A failed model call doesn't use up the person's allowance."""
    await db.ai_usage.update_one({"_id": f"{uid}:{today_uk().isoformat()}", kind: {"$gt": 0}}, {"$inc": {kind: -1}})


async def _ask(user: dict, system: str, prompt: str) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    take_ai_quota(user)
    chat = LlmChat(session_id=str(uuid.uuid4()), system_message=system).with_model("anthropic")
    async with acquire_llm_slot():
        try:
            return await chat.send_message(UserMessage(text=prompt))
        except Exception as ex:
            logger.exception("ai assistant: model call failed")
            raise HTTPException(status_code=502, detail="The AI didn't answer. Try again in a moment.") from ex


def _json_from(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("no JSON")
    return json.loads(m.group(0))


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/ai/status")
async def ai_status(request: Request):
    user = await get_current_user(request)
    used = await _used(str(user["id"]), today_uk().isoformat())
    return {"enabled": llm_configured() and not user.get("is_viewer"),
            "limits": DAILY_LIMITS,
            "left": {k: max(0, DAILY_LIMITS[k] - used[k]) for k in DAILY_LIMITS}}


# ── Chat ──────────────────────────────────────────────────────────────────────

async def _todays_chat(uid: str, create: bool = False) -> Optional[dict]:
    day = today_uk().isoformat()
    conv = await db.ai_conversations.find_one({"user_id": uid, "date": day, "closed": {"$ne": True}},
                                              {"_id": 0}, sort=[("created_at", -1)])
    if conv or not create:
        return conv
    conv = {"id": str(uuid.uuid4()), "user_id": uid, "date": day, "messages": [], "created_at": _now()}
    await db.ai_conversations.insert_one(dict(conv))
    return conv


@router.get("/ai/chat")
async def get_chat(request: Request):
    user = await get_current_user(request)
    conv = await _todays_chat(str(user["id"]))
    return {"conversation": conv}


@router.post("/ai/chat/new")
async def new_chat(request: Request):
    user = await get_current_user(request)
    await db.ai_conversations.update_many({"user_id": str(user["id"]), "closed": {"$ne": True}},
                                          {"$set": {"closed": True}})
    return {"ok": True}


@router.post("/ai/chat")
async def chat(request: Request):
    user = await get_current_user(request)
    _require_ai(user)
    body = await request.json()
    question = str((body or {}).get("message") or "").strip()[:2000]
    if not question:
        raise HTTPException(status_code=400, detail="Type a message first")
    uid = str(user["id"])
    await _take(uid, "chat")
    conv = await _todays_chat(uid, create=True)
    history = (conv.get("messages") or [])[-2 * CHAT_HISTORY_TURNS:]
    transcript = "\n".join(f"{'Them' if m['role'] == 'user' else 'You'}: {m['text']}" for m in history)
    prompt = (
        f"What this person can see in the app (JSON):\n{await context_text(user)}\n\n"
        + (f"The conversation so far today:\n{transcript}\n\n" if transcript else "")
        + f"Their message: {question}\n\nReply to their message. If they ask for a plan, keep it practical "
          "and tell them they can tap 'Suggest my plan' to get it with Use this buttons."
    )
    try:
        reply = await _ask(user, ABOUT, prompt)
    except HTTPException:
        await _give_back(uid, "chat")
        raise
    msgs = [{"role": "user", "text": question, "at": _now()}, {"role": "assistant", "text": reply, "at": _now()}]
    await db.ai_conversations.update_one({"id": conv["id"]}, {"$push": {"messages": {"$each": msgs}},
                                                              "$set": {"updated_at": _now()}})
    used = await _used(uid, today_uk().isoformat())
    return {"conversation_id": conv["id"], "reply": reply, "left": max(0, DAILY_LIMITS["chat"] - used["chat"])}


# ── Analyse me ────────────────────────────────────────────────────────────────

# Bump when the analysis changes shape: an analysis made today in the old
# shape can be done again once, without using up the day's allowance.
ANALYSE_VERSION = 2

ANALYSE_SHAPE = (
    'Reply with JSON only, in this shape, and keep to the word limits: '
    '{"headline": "how they are doing, max 14 words", '
    '"going_well": ["1–2 items, max 14 words each, a number against what good looks like"], '
    '"gap": {"what": "the one step or volume costing them most, max 6 words", '
    '"numbers": "theirs vs good, e.g. \'24% spoken→pitched vs 36%\', max 12 words", '
    '"why": "the likely reason from their own breakdowns, max 18 words"}, '
    '"tips": [{"tip": "a practical thing to say or do on the doors, max 25 words", "why": "how it fixes the gap, '
    'max 12 words"}] (exactly 3 tips, all aimed at the gap), '
    '"tomorrow": {"focus": "max 8 words", "kpi_metric": one of "doors", "spoken", "pitched", "closes", '
    '"callbacks", "kpi_target": a number, "goal": sign-ups goal for tomorrow}, '
    '"this_week": {"weekly_goal": a realistic stretch number of sign-ups for this week, "why": "max 12 words"}, '
    '"team": "only if they have a team: who needs help with what, max 25 words, else empty string", '
    '"quality": "only if something is off target: max 14 words, else empty string"}'
)


async def coaching_material(user: dict) -> str:
    """The Hub's own coaching content that matches their recent gaps, for tips."""
    from core.ai_context import recent_sector_days
    from routes.coaching_assistant import _retrieve_impacts
    from routes.sector import GAP_LABELS
    words = []
    for d in (await recent_sector_days(str(user["id"])))[-3:]:
        b = d.get("breakdown") or {}
        words += [GAP_LABELS.get(b.get("gap") or "", ""), b.get("change") or "", b.get("why") or ""]
    query = " ".join(w for w in words if w) or "closing pitching speaking to more people"
    try:
        found = await _retrieve_impacts(user, query, k=4)
    except Exception:
        return ""
    out = []
    for d in found:
        body = " ".join(str(d.get("summary") or d.get("body") or "").split())[:700]
        takeaways = "; ".join(str(x) for x in (d.get("key_takeaways") or [])[:4])
        out.append(f"- {d.get('title')}: {body}" + (f" Key points: {takeaways}" if takeaways else ""))
    return "\n".join(out)


@router.get("/ai/analyse")
async def get_analysis(request: Request):
    user = await get_current_user(request)
    doc = await db.ai_analyses.find_one({"user_id": str(user["id"]), "date": today_uk().isoformat()}, {"_id": 0})
    return {"analysis": doc if doc and doc.get("v") == ANALYSE_VERSION else None}


@router.post("/ai/analyse")
async def analyse(request: Request):
    user = await get_current_user(request)
    _require_ai(user)
    uid = str(user["id"])
    day = today_uk().isoformat()
    done = await db.ai_analyses.find_one({"user_id": uid, "date": day}, {"_id": 0})
    if done and done.get("v") == ANALYSE_VERSION:
        return {"analysis": done}
    if done:
        # Made today in the old shape: do it again in the new one, at no cost.
        await db.ai_analyses.delete_one({"user_id": uid, "date": day})
        await _give_back(uid, "analyse")
    await _take(uid, "analyse")
    material = await coaching_material(user)
    prompt = (f"What this person can see in the app (JSON):\n{await context_text(user)}\n\n"
              + (f"Coaching material from the Hub that matches their recent gaps:\n{material}\n\n" if material else "")
              + "Give them today's analysis: their breakdowns, results, trends and plans against what good "
                f"looks like, with practical tips. {ANALYSE_SHAPE}")
    try:
        text = await _ask(user, ABOUT, prompt)
        result = _json_from(text)
    except HTTPException:
        await _give_back(uid, "analyse")
        raise
    except Exception:
        await _give_back(uid, "analyse")
        raise HTTPException(status_code=502, detail="The AI's answer came back garbled. Try again.")
    doc = {"id": str(uuid.uuid4()), "user_id": uid, "date": day, "result": result, "v": ANALYSE_VERSION,
           "next_field_day": next_field_day().isoformat(), "created_at": _now()}
    try:
        await db.ai_analyses.insert_one(dict(doc))
    except DuplicateKeyError:
        doc = await db.ai_analyses.find_one({"user_id": uid, "date": day}, {"_id": 0})
    doc.pop("_id", None)
    return {"analysis": doc}


# ── Suggest my plan ───────────────────────────────────────────────────────────

PLAN_SHAPE = (
    'Reply with JSON only: {"summary": "one or two sentences", '
    '"weekly_goal": {"goal": number of sign-ups, "why": "short"} or null if it\'s Saturday or they have one '
    'that already fits, '
    '"setup": {"date": "YYYY-MM-DD (the next field day)", "goal": number, "focus": "short", "kpi_metric": one '
    'of "doors", "spoken", "pitched", "closes", "callbacks", "kpi_target": number, "positive": "what to keep '
    'doing"}, '
    '"planner": [{"date": "YYYY-MM-DD", "box": one of BOXES, "text": "what to write"}] (0–6 items, only boxes '
    'that suit this person; Coaches plan Primetime, Sector, Crew Meetings, Stage 1/Stage 2 coaching; BAs '
    'mostly Sector and Primetime), '
    '"notes": [{"date": "YYYY-MM-DD", "title": "short", "body": "a note to keep"}] (0–2 items)}'
)


@router.post("/ai/suggest-plan")
async def suggest_plan(request: Request):
    from core.ai_actions import planner_boxes
    user = await get_current_user(request)
    _require_ai(user)
    try:
        body = await request.json()
    except Exception:
        body = {}
    ask = str((body or {}).get("ask") or "").strip()[:600]
    uid = str(user["id"])
    await _take(uid, "suggest")
    boxes = ", ".join(f'"{k}"' for k in planner_boxes())
    prompt = (f"What this person can see in the app (JSON):\n{await context_text(user)}\n\n"
              + (f"What they asked for: {ask}\n\n" if ask else "")
              + "Suggest their plan: tomorrow's sector set-up, this week's goal and what to put in their "
                "planner. Base it on their numbers against what good looks like, their breakdowns and what they said "
                "they'd change. Keep every text short. "
              + PLAN_SHAPE.replace("BOXES", boxes))
    try:
        text = await _ask(user, ABOUT, prompt)
        result = _json_from(text)
    except HTTPException:
        await _give_back(uid, "suggest")
        raise
    except Exception:
        await _give_back(uid, "suggest")
        raise HTTPException(status_code=502, detail="The AI's answer came back garbled. Try again.")
    labels = planner_boxes()
    result["planner"] = [{**p, "box_label": labels.get(p.get("box"), p.get("box"))}
                         for p in (result.get("planner") or []) if isinstance(p, dict) and p.get("box") in labels]
    await db.ai_suggestions.insert_one({"id": str(uuid.uuid4()), "user_id": uid, "date": today_uk().isoformat(),
                                        "result": result, "created_at": _now()})
    result.pop("_id", None)
    return {"suggestion": result}


# ── Use this ──────────────────────────────────────────────────────────────────

@router.post("/ai/apply")
async def apply(request: Request):
    """Fill in one suggestion, as the person (the same permissions as the app)."""
    from core import ai_actions
    user = await get_current_user(request)
    body = await request.json()
    kind = str((body or {}).get("kind") or "")
    data = (body or {}).get("data") or {}
    if kind == "weekly_goal":
        return await ai_actions.set_weekly_goal(user, data.get("goal"))
    if kind == "setup":
        return await ai_actions.save_setup(user, str(user["id"]), data.get("date"), data)
    if kind == "planner":
        return await ai_actions.set_planner_box(user, data.get("date"), data.get("box"), data.get("text"))
    if kind == "note":
        return await ai_actions.add_planner_note(user, data.get("date"), data.get("title"), data.get("body"))
    raise HTTPException(status_code=400, detail="Unknown suggestion")


# ── Personal Claude connector links ───────────────────────────────────────────
# Profile → Connect Claude. The link is shown once, stored only as a hash
# (routes/claude_connector.py reads it). Admins make their own; anyone else
# once an Admin has allowed them.

def _may_connect(user: dict) -> bool:
    return not user.get("is_viewer") and ((user.get("role") or "").lower() == "admin"
                                          or bool(user.get("connector_allowed")))


@router.get("/ai/connector-link")
async def connector_link_status(request: Request):
    user = await get_current_user(request)
    link = await db.connector_links.find_one({"user_id": str(user["id"]), "revoked": {"$ne": True}},
                                             {"_id": 0, "created_at": 1, "last_used_at": 1})
    return {"allowed": _may_connect(user), "has_link": bool(link),
            "created_at": (link or {}).get("created_at"), "last_used_at": (link or {}).get("last_used_at")}


@router.post("/ai/connector-link")
async def make_connector_link(request: Request):
    """A new personal link (any old one stops working). Shown once."""
    import secrets as _secrets
    from routes.claude_connector import hash_link
    user = await get_current_user(request)
    if not _may_connect(user):
        raise HTTPException(status_code=403, detail="Ask the Owner to switch Claude on for you")
    uid = str(user["id"])
    await db.connector_links.update_many({"user_id": uid, "revoked": {"$ne": True}},
                                         {"$set": {"revoked": True, "revoked_at": _now()}})
    token = _secrets.token_urlsafe(32)
    await db.connector_links.insert_one({"user_id": uid, "token_hash": hash_link(token), "created_at": _now()})
    return {"path": f"/mcp/{token}"}


@router.delete("/ai/connector-link")
async def revoke_connector_link(request: Request):
    user = await get_current_user(request)
    await db.connector_links.update_many({"user_id": str(user["id"]), "revoked": {"$ne": True}},
                                         {"$set": {"revoked": True, "revoked_at": _now()}})
    return {"ok": True}


@router.put("/ai/connector-allowed/{user_id}")
async def set_connector_allowed(user_id: str, request: Request):
    """Admin: let someone in the office connect Claude (or stop them)."""
    from bson import ObjectId
    user = await get_current_user(request)
    if (user.get("role") or "").lower() != "admin" or user.get("is_viewer"):
        raise HTTPException(status_code=403, detail="Admins only")
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=404, detail="Person not found")
    target = await db.users.find_one({"_id": ObjectId(user_id), "deleted": {"$ne": True}}, {"office_id": 1})
    if not target or (target.get("office_id") != user.get("office_id") and not user.get("is_super_admin")):
        raise HTTPException(status_code=404, detail="Person not found")
    allowed = bool((await request.json() or {}).get("allowed"))
    await db.users.update_one({"_id": target["_id"]}, {"$set": {"connector_allowed": allowed}})
    if not allowed:
        await db.connector_links.update_many({"user_id": user_id, "revoked": {"$ne": True}},
                                             {"$set": {"revoked": True, "revoked_at": _now()}})
    return {"ok": True, "allowed": allowed}


@router.get("/ai/connector-people")
async def connector_people(request: Request):
    """Admin: who in the office can connect Claude."""
    user = await get_current_user(request)
    if (user.get("role") or "").lower() != "admin" or user.get("is_viewer"):
        raise HTTPException(status_code=403, detail="Admins only")
    linked = {d["user_id"] async for d in db.connector_links.find({"revoked": {"$ne": True}}, {"user_id": 1})}
    out = []
    async for u in db.users.find({"office_id": user.get("office_id"), "deleted": {"$ne": True},
                                  "is_active": {"$ne": False}, "is_demo": {"$ne": True}, "is_viewer": {"$ne": True},
                                  "role": {"$in": ["trainee", "leader", "admin"]}},
                                 {"name": 1, "role": 1, "connector_allowed": 1}).sort("name", 1):
        uid = str(u["_id"])
        out.append({"id": uid, "name": u.get("name"), "role": u.get("role"),
                    "allowed": (u.get("role") == "admin") or bool(u.get("connector_allowed")),
                    "connected": uid in linked})
    return {"people": out}
