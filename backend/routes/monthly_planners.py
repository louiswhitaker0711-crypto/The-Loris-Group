"""Monthly Goal Planner — per-user monthly self-assessment + planning.

Mirrors the printed "Monthly Goal Planner" the office fills out. Stored one document per (user, month).

Collection: monthly_planners
Document shape:
  {
    id: uuid,
    user_id, office_id, month: "YYYY-MM",
    locked: bool,                # true once a newer month exists for this user
    goals: {
      short_business, short_personal,
      medium_business, medium_personal,
      long_business, long_personal
    },
    monthly_planning: {
      sales_impacts: { coach_others: str, still_to_master: str },
      development:  [ { id, topic, who, when, completed } ],
      recruitment:  [ { id, topic, who, when, completed } ],
      networking:   [ { id, topic, who, when, completed } ]
    },
    learning: { summary: str, items: [ { id, topic, mentor, notes } ] },
    budget: {
      needs:  [ { id, label, amount, sales } ],
      wants:  [ { id, label, amount, sales } ],
      sale_value, total_money_needs, total_sales_needs,
      total_money_wants, total_sales_wants, total_sales_required
    },
    swot: { strengths, weaknesses, opportunities, threats },
    gap_analysis: { scores: { trait_key: 1..5 } },     # leader/admin only
    created_at, updated_at
  }

Permission rules:
- The owner can read+write their own months (only the most-recent month is
  editable; older months auto-lock when a newer one is created).
- A "leader" can READ the months of any user whose `reports_to` chain
  eventually points to that leader (transitive sub-tree).
- An admin can READ every planner in their office.
- A super-admin can READ everything.
- Trainees DO NOT have a Gap Analysis (filtered out at fetch time).
"""
import os
import uuid
from datetime import datetime, timezone, date
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from bson import ObjectId
from dotenv import load_dotenv

from auth import get_current_user, require_admin

load_dotenv()

router = APIRouter()
from database import db  # the shared client; one DB_NAME default (database.py)


# ── Goal model (v2) ─────────────────────────────────────────────────────────
# v2 goals are STRUCTURED: KPIs (numbers/measurables) + Rocks (did-I/didn't-I
# tasks), each with a horizon and an attached reward — this is what the guided
# Goal Builder writes. Legacy planners stored six free-text strings; those docs
# are detected by the ABSENCE of a version/kpis key and rendered read-only by
# the client. New/edited planners always write v2.
GOAL_VERSION = 2
_HORIZONS = ("short", "medium", "long")
_MAX_GOAL_ROWS = 8

# Legacy free-text keys — kept only so an un-migrated editable doc isn't wiped
# if its owner saves before the builder converts it.
LEGACY_GOAL_KEYS = (
    "short_business", "short_personal",
    "medium_business", "medium_personal",
    "long_business", "long_personal",
)


def _default_goals() -> dict:
    """Fresh empty v2 goals block (own list instances — never share refs)."""
    return {"version": GOAL_VERSION, "kpis": [], "rocks": [], "mids": [], "whys": [], "vision": ""}


def _norm_horizon(v) -> str:
    v = (str(v or "")).strip().lower()
    return v if v in _HORIZONS else "short"


def _norm_area(v) -> str:
    """Business or Personal, as the booklet splits goals (default Business)."""
    return "personal" if str(v or "").strip().lower() == "personal" else "business"


WHY_TAGS = ("people", "lifestyle", "choices", "time", "project")


def _how(raw) -> str:
    """How they'll do a goal (the Owner, 13 Nov 2026): free text."""
    return (str(raw or "")).strip()[:2000] if not isinstance(raw, (list, dict)) else ""


def _normalize_goals(raw) -> dict:
    """Normalize the goals payload. A payload carrying kpis/rocks/version is
    v2 (structured); anything else is treated as the legacy 6-field shape and
    passed through so an un-migrated editable doc isn't blanked."""
    raw = raw or {}
    is_v2 = (raw.get("kpis") is not None) or (raw.get("rocks") is not None) or bool(raw.get("version"))
    if not is_v2:
        return {k: (str(raw.get(k) or "")).strip() for k in LEGACY_GOAL_KEYS}

    def _kpi(r: dict) -> dict:
        return {
            "id": (r.get("id") or str(uuid.uuid4())),
            "name": (str(r.get("name") or "")).strip(),
            "target": (str(r.get("target") or "")).strip(),
            "horizon": _norm_horizon(r.get("horizon")),
            "area": _norm_area(r.get("area")),
            "reward": (str(r.get("reward") or "")).strip(),
            "how": _how(r.get("how")),
            "smart_ok": bool(r.get("smart_ok")),
        }

    def _rock(r: dict) -> dict:
        return {
            "id": (r.get("id") or str(uuid.uuid4())),
            "name": (str(r.get("name") or "")).strip(),
            "horizon": _norm_horizon(r.get("horizon")),
            "area": _norm_area(r.get("area")),
            "reward": (str(r.get("reward") or "")).strip(),
            "how": _how(r.get("how")),
            "done": bool(r.get("done")),
        }

    def _mid(r: dict) -> dict:
        return {
            "id": (r.get("id") or str(uuid.uuid4())),
            "name": (str(r.get("name") or "")).strip(),
            "area": _norm_area(r.get("area")),
            "how": _how(r.get("how")),
            "done": bool(r.get("done")),
        }

    kpis = [_kpi(r) for r in (raw.get("kpis") or []) if isinstance(r, dict)][:_MAX_GOAL_ROWS]
    rocks = [_rock(r) for r in (raw.get("rocks") or []) if isinstance(r, dict)][:_MAX_GOAL_ROWS]
    mids = [_mid(r) for r in (raw.get("mids") or []) if isinstance(r, dict) and str(r.get("name") or "").strip()][:_MAX_GOAL_ROWS]
    # Mid term (6-12 months) replaces the 6-month vision (the Owner, 13 Nov
    # 2026): a vision already written becomes their first mid-term goal.
    vision = (str(raw.get("vision") or "")).strip()
    if vision and not mids:
        mids = [_mid({"name": vision})]
    # Long term is their why (the Owner, 13 Nov 2026), each tagged.
    whys = []
    for r in (raw.get("whys") or [])[:_MAX_GOAL_ROWS * 2]:
        if isinstance(r, dict) and str(r.get("text") or "").strip():
            tag = str(r.get("tag") or "").strip().lower()
            whys.append({"id": r.get("id") or str(uuid.uuid4()), "text": str(r.get("text")).strip()[:2000],
                         "tag": tag if tag in WHY_TAGS else "people"})
    return {"version": GOAL_VERSION, "kpis": kpis, "rocks": rocks, "mids": mids, "whys": whys, "vision": ""}


# ── Goal Builder menu (KPI presets + Rock suggestions) ──────────────────────
# Admin-editable per office (planner_goal_menu collection, mirrors the
# onboarding-content pattern). These are the built-in fallbacks — the exact
# lists from the org's goal-setting session.
DEFAULT_KPI_MENU: list = [
    "Sign-ups (personal)",
    "Team sign-ups",
    "Team piece average",
    "Team size",
    "Stage 3 count",
    "2nd-week retention %",
    "4th-week retention %",
    "Gold %",
    "The Round %",
    "Average order value",
    "Drop days",
    "Fail rate %",
    "First-day-ons taken out",
    "First-day coachings done",
    "New stars booked in",
    "PRs booked for Initial Appointment",
    "Initial Appointments run",
    "New starters",
    "Personal best",
]

# Old labels that may still sit in a saved menu: renamed or dropped on read.
_KPI_RENAMES: dict = {
    "ERs booked for Initial Appointment": "PRs booked for Initial Appointment",
    "Contract piece average": "Team piece average",
    "Contract sign-ups": None,
}

DEFAULT_ROCK_SUGGESTIONS: list = [
    "Visit another office",
    "Finish reading a book",
    "Gym 3 out of 7 days",
    "Run 2 team meetings",
    "Run an Initial Appointment",
    "Set up 2 conference calls",
    "Run a sector for a day",
    "Advance a stage",
    "Run the office for 2 days",
]

DEFAULT_SWOT: dict = {
    "strengths": "",
    "weaknesses": "",
    "opportunities": "",
    "threats": "",
}

# Default budget rows seeded into a NEW planner. Users can edit/add/remove.
DEFAULT_NEEDS_LABELS = ["Phone", "Food", "Insurance", "Travel", "Rent"]
DEFAULT_WANTS_LABELS = ["Savings"]

# The booklet's two wheels (the Owner, 13 Nov 2026), scored 1..5 each, for
# everyone. Gap Analysis is the field and office skills wheel; Leader Gap
# Analysis is the leadership one. Order is the booklet's, clockwise from the top.
FIELD_GAP_TRAITS: list = [
    "Pace Setting",
    "Making a Profit",
    "Sector Meetings",
    "Planning",
    "Controlling Conversations",
    "Working Different Territory",
    "Your Story",
    "Customer Service",
    "Coaching New People",
    "Observations",
    "Running Impacts",
    "Quality Control",
    "Primetime",
    "Networking",
    "Roadtrips",
    "Promoting Leaders",
]

LEADER_GAP_TRAITS: list = [
    "Adaptability",
    "Time-management",
    "Planning & Pre-prep",
    "Having a Calendar",
    "Planned Impacts",
    "Proactive Helper",
    "Solution-orientated",
    "Proactive Learner",
    "Accepting Criticism",
    "Hitting Sign Up Targets",
    "Setting Development Goals",
    "Networking",
    "Doing Extra 10%",
    "Relentlessness",
    "Professional Image",
    "Mind-set / Focus",
]
GAP_TRAITS = LEADER_GAP_TRAITS  # older name, still read by the radar's traits route

# Scores saved before 13 Nov 2026 sat on one mixed wheel: carry them over.
_LEADER_RENAMES = {"Hitting Sales Targets": "Hitting Sign Up Targets"}
_MOVED_TO_FIELD = ("Customer Service", "Coaching New People")


def _clamp_scores(raw, traits: list) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for t in traits:
        try:
            n = int(raw.get(t) or 0)
        except Exception:
            n = 0
        out[t] = max(0, min(5, n))
    return out


def _normalize_gap(raw) -> dict:
    """{scores: leader wheel, field_scores: Gap Analysis wheel}, old shape migrated."""
    raw = raw if isinstance(raw, dict) else {}
    leader_in = dict(raw.get("scores") or {})
    field_in = dict(raw.get("field_scores") or {})
    for old, new in _LEADER_RENAMES.items():
        if old in leader_in and not leader_in.get(new):
            leader_in[new] = leader_in.pop(old)
    for t in _MOVED_TO_FIELD:
        if leader_in.get(t) and not field_in.get(t):
            field_in[t] = leader_in[t]
    return {"scores": _clamp_scores(leader_in, LEADER_GAP_TRAITS),
            "field_scores": _clamp_scores(field_in, FIELD_GAP_TRAITS)}


# Recruitment, Sign Ups & Growth: the booklet's four monthly KPIs.
GROWTH_KPIS = ("shadowers", "sign_ups", "new_starts", "prs")
FOCUS_BOXES = 30  # Recruitment Focus and PR Focus are 1-30 each


def _normalize_focus(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    def _ticks(v):
        out = set()
        for x in v or []:
            try:
                n = int(x)
            except Exception:
                continue
            if 1 <= n <= FOCUS_BOXES:
                out.add(n)
        return sorted(out)
    return {"recruitment": _ticks(raw.get("recruitment")), "pr": _ticks(raw.get("pr"))}


def _normalize_kpi_goals(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for k in GROWTH_KPIS:
        try:
            out[k] = max(0, int(raw.get(k) or 0))
        except Exception:
            out[k] = 0
    return out


def _quarter(month: str) -> str:
    try:
        y, m = str(month).split("-")[:2]
        return f"{int(y)}-Q{(int(m) - 1) // 3 + 1}"
    except Exception:
        return ""


def _empty_budget_row(label: str = "") -> dict:
    return {"id": str(uuid.uuid4()), "label": label, "amount": "", "sales": ""}


def _empty_planning_row() -> dict:
    return {"id": str(uuid.uuid4()), "topic": "", "who": "", "when": "", "completed": False}


def _empty_learning_item() -> dict:
    return {"id": str(uuid.uuid4()), "topic": "", "mentor": "", "notes": ""}


async def _sign_up_value(user_id: str) -> Optional[dict]:
    """What each sign-up is worth to this person (core.sign_up_value)."""
    from core.sign_up_value import rate_for
    try:
        u = await db.users.find_one({"_id": ObjectId(str(user_id))},
                                    {"office_id": 1, "role": 1, "is_viewer": 1, "pay_type": 1, "is_driver": 1})
    except Exception:
        u = None
    if not u:
        return None
    fees = (await db.commission_fees.find_one({"office_id": u.get("office_id")}, {"_id": 0})
            or await db.commission_fees.find_one({}, {"_id": 0}))
    return await rate_for(db, u, fees)


def _with_rate(budget: dict, rate: Optional[dict]) -> dict:
    """Show the locked figure: today's value, with totals worked from it."""
    if not rate:
        return budget
    b = dict(budget or {})
    b["sale_value"] = f"{rate['per_sign_up']:.2f}"
    b = _compute_budget_totals(b)
    b["sign_up_value"] = rate
    return b


async def _fill_budget_from_plan(seed: dict, user_id: str) -> dict:
    """A new month starts with last month's breakeven filled in (the Owner,
    29 Oct 2026): their current Plan your earnings rows, to review and change.
    Marks budget.from_plan so the page can say so."""
    try:
        u = await db.users.find_one({"_id": ObjectId(str(user_id))}, {"earnings_plan": 1, "office_id": 1})
    except Exception:
        u = None
    plan = (u or {}).get("earnings_plan") or {}
    rows = lambda key: [{"id": str(uuid.uuid4()), "label": str(r.get("label") or ""), "amount": str(r.get("amount") or ""),
                         "sales": "", "per": r.get("per") if r.get("per") in ("week", "month") else "month"}
                        for r in plan.get(key) or [] if _safe_num(r.get("amount"))]
    needs, wants = rows("needs"), rows("wants")
    if not needs and not wants:
        return seed
    from core.earnings_plan import compute
    fees = (await db.commission_fees.find_one({"office_id": (u or {}).get("office_id")}, {"_id": 0})
            or await db.commission_fees.find_one({}, {"_id": 0}))
    b = dict(seed.get("budget") or {})
    b["needs"] = needs or b.get("needs") or []
    b["wants"] = wants or b.get("wants") or []
    b = _compute_budget_totals(b)
    from core.sign_up_value import per_sign_up_for
    rate = await per_sign_up_for(db, user_id, fees)
    if rate:
        b["sale_value"] = f"{rate:.2f}"
        b = _compute_budget_totals(b)
    b["from_plan"] = {"breakeven": compute(plan, fees, rate).get("breakeven"), "updated_at": plan.get("updated_at")}
    seed["budget"] = b
    return seed


def _seed_planner(user_id: str, office_id: str, month: str, role: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "office_id": office_id,
        "month": month,
        "locked": False,
        "goals": _default_goals(),
        "monthly_planning": {
            "sales_impacts": {"coach_others": "", "still_to_master": ""},
            "development": [_empty_planning_row() for _ in range(4)],
            "recruitment": [_empty_planning_row() for _ in range(4)],
            "networking": [_empty_planning_row() for _ in range(4)],
        },
        "learning": {"summary": "", "items": [_empty_learning_item() for _ in range(3)]},
        "budget": {
            "needs": [_empty_budget_row(lbl) for lbl in DEFAULT_NEEDS_LABELS],
            "wants": [_empty_budget_row(lbl) for lbl in DEFAULT_WANTS_LABELS],
            "sale_value": "",
            "total_money_needs": 0,
            "total_sales_needs": 0,
            "total_money_wants": 0,
            "total_sales_wants": 0,
            "total_sales_required": 0,
        },
        "swot": dict(DEFAULT_SWOT),
        "gap_analysis": _normalize_gap({}),
        "focus": _normalize_focus({}),
        "kpi_goals": _normalize_kpi_goals({}),
        "targets": {"monthly_sales": 0, "personal_best": 0},
        "created_at": now,
        "updated_at": now,
    }


def _coerce_month(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    # Accept "YYYY-MM" or "YYYY-MM-DD"
    if len(s) == 7:
        try:
            y, m = s.split("-")
            int(y); mi = int(m)
            if 1 <= mi <= 12:
                return f"{int(y):04d}-{mi:02d}"
        except Exception:
            return None
    try:
        d = date.fromisoformat(s)
        return d.strftime("%Y-%m")
    except Exception:
        return None


def _scrub(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    if "_id" in doc:
        doc.pop("_id", None)
    return doc


async def _resolve_target_user(request: Request, target_user_id: Optional[str]) -> tuple[dict, dict]:
    """Resolve who the planner is FOR (target) given the requesting user.
    Returns (requesting_user_doc, target_user_doc). Permission-checks that
    the requester may read the target's planners.
    """
    me = await get_current_user(request)
    if not target_user_id or target_user_id == me["id"]:
        return me, me

    try:
        target = await db.users.find_one({"_id": ObjectId(target_user_id)})
    except Exception:
        target = None
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target = {**target, "id": str(target["_id"])}
    target.pop("_id", None)

    if me.get("is_super_admin"):
        return me, target
    if me.get("role") == "admin" and (target.get("office_id") or "") == (me.get("office_id") or ""):
        return me, target

    # Leader: allow if target is somewhere in the leader's reports tree
    if me.get("role") == "leader":
        cur = target
        for _ in range(20):  # depth-cap
            parent_id = cur.get("reports_to")
            if not parent_id:
                break
            if str(parent_id) == me["id"]:
                return me, target
            try:
                cur = await db.users.find_one({"_id": ObjectId(parent_id)})
            except Exception:
                cur = None
            if not cur:
                break
            cur = {**cur, "id": str(cur["_id"])}

    raise HTTPException(status_code=403, detail="Not authorised to view that user's planner")


def _strip_for_role(doc: dict, target_role: str) -> dict:
    """Fill in the parts older planners don't have yet. Everyone has both Gap
    Analysis wheels (the Owner, 13 Nov 2026), so nothing is stripped now."""
    doc["gap_analysis"] = _normalize_gap(doc.get("gap_analysis"))
    g = doc.get("goals") or {}
    if (g.get("kpis") is not None) or g.get("version"):
        doc["goals"] = _normalize_goals(g)
    doc["focus"] = _normalize_focus(doc.get("focus"))
    doc["kpi_goals"] = _normalize_kpi_goals(doc.get("kpi_goals"))
    return doc


# ── ENDPOINTS ──────────────────────────────────────────────────────────────


@router.get("/monthly-planners/traits")
async def list_traits(request: Request):
    """Both wheels' topics, for the radar charts. `traits` is the leader wheel
    (kept for older clients)."""
    await get_current_user(request)
    return {"traits": LEADER_GAP_TRAITS, "leader_traits": LEADER_GAP_TRAITS, "field_traits": FIELD_GAP_TRAITS}


# NOTE: goal-menu routes are declared BEFORE "/monthly-planners/{month}" so the
# single-segment path isn't captured as a month (same reason /traits sits here).
@router.get("/monthly-planners/goal-menu")
async def get_goal_menu(request: Request):
    """KPI presets + Rock suggestions for the guided Goal Builder. An office
    doc overrides the global doc, which falls back to the built-in defaults —
    so the builder always has a list even before an admin customises anything.
    Any authed user may read; only admins may edit."""
    me = await get_current_user(request)
    office_id = me.get("office_id")

    global_doc = await db.planner_goal_menu.find_one({"office_id": None}, {"_id": 0})
    office_doc = None
    if office_id:
        office_doc = await db.planner_goal_menu.find_one({"office_id": office_id}, {"_id": 0})

    def _pick(field: str, default: list) -> list:
        for d in (office_doc, global_doc):
            if d and d.get(field) is not None:
                return d.get(field)
        return default

    kpis = []
    for x in _pick("kpis", DEFAULT_KPI_MENU):
        label = str(x).strip()
        label = _KPI_RENAMES.get(label, label)
        if label and label not in kpis:
            kpis.append(label)
    rocks = [str(x).strip() for x in _pick("rock_suggestions", DEFAULT_ROCK_SUGGESTIONS) if str(x).strip()]
    return {
        "kpis": kpis,
        "rock_suggestions": rocks,
        "can_edit": (me.get("role") == "admin") or bool(me.get("is_super_admin")),
    }


@router.put("/monthly-planners/goal-menu")
async def put_goal_menu(request: Request):
    """Admin only. Upsert this admin's office menu (or the global menu when the
    admin has no office set). Body: { kpis: [str], rock_suggestions: [str] }."""
    admin = await require_admin(request)
    office_id = admin.get("office_id") or None
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}

    def _clean_list(v, cap: int = 40) -> list:
        out = []
        if isinstance(v, list):
            for x in v:
                s = str(x or "").strip()
                if s:
                    out.append(s)
        return out[:cap]

    update: dict = {"updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": admin.get("id")}
    if "kpis" in body:
        update["kpis"] = _clean_list(body.get("kpis"))
    if "rock_suggestions" in body:
        update["rock_suggestions"] = _clean_list(body.get("rock_suggestions"))
    if "kpis" not in update and "rock_suggestions" not in update:
        raise HTTPException(status_code=400, detail="Nothing to update")

    await db.planner_goal_menu.update_one(
        {"office_id": office_id},
        {"$set": update, "$setOnInsert": {"office_id": office_id}},
        upsert=True,
    )
    saved = await db.planner_goal_menu.find_one({"office_id": office_id}, {"_id": 0}) or {}
    return {
        "kpis": saved.get("kpis") or [],
        "rock_suggestions": saved.get("rock_suggestions") or [],
        "office_id": office_id,
    }


@router.get("/monthly-planners")
async def list_my_planners(request: Request, user_id: Optional[str] = None):
    """List all planner months for the current user (or a specified user the
    requester is allowed to view). Returns sparse summaries (no large
    sub-fields), newest month first."""
    me, target = await _resolve_target_user(request, user_id)
    cursor = db.monthly_planners.find(
        {"user_id": target["id"]},
        {"_id": 0, "id": 1, "month": 1, "locked": 1, "updated_at": 1},
    ).sort("month", -1)
    items = await cursor.to_list(120)
    return {
        "user": {"id": target["id"], "name": target.get("name") or target.get("email"), "role": target.get("role")},
        "items": items,
    }


@router.get("/monthly-planners/{month}")
async def get_planner(month: str, request: Request, user_id: Optional[str] = None):
    """Get the planner doc for a specific month. Auto-creates an EMPTY
    placeholder if none exists yet AND the requester is the owner. Other
    viewers (leaders/admins) get 404 if not yet created."""
    coerced = _coerce_month(month)
    if not coerced:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    me, target = await _resolve_target_user(request, user_id)

    doc = await db.monthly_planners.find_one(
        {"user_id": target["id"], "month": coerced},
        {"_id": 0},
    )
    if not doc:
        if target["id"] != me["id"]:
            raise HTTPException(status_code=404, detail=f"No planner exists for {coerced}")
        # Owner viewing their own non-existent month — return seed + flag
        seed = await _fill_budget_from_plan(
            _seed_planner(me["id"], me.get("office_id") or "", coerced, me.get("role") or "trainee"), me["id"])
        seed["budget"] = _with_rate(seed.get("budget") or {}, await _sign_up_value(me["id"]))
        return {
            "exists": False,
            "can_edit": True,
            "viewer_is_owner": True,
            "target_role": me.get("role"),
            "planner": _strip_for_role(seed, me.get("role") or "trainee"),
        }

    # Existing planner. Compute can_edit:
    # - Only the OWNER may edit
    # - And only when the planner is NOT locked
    can_edit = (target["id"] == me["id"]) and not bool(doc.get("locked"))
    doc["budget"] = _with_rate(doc.get("budget") or {}, await _sign_up_value(target["id"]))
    return {
        "exists": True,
        "can_edit": can_edit,
        "viewer_is_owner": (target["id"] == me["id"]),
        "target_role": target.get("role"),
        "planner": _strip_for_role(doc, target.get("role") or "trainee"),
    }


def _normalize_planning_rows(raw: list) -> list:
    out = []
    if isinstance(raw, list):
        for r in raw:
            if not isinstance(r, dict):
                continue
            out.append({
                "id": (r.get("id") or str(uuid.uuid4())),
                "topic": (r.get("topic") or "").strip(),
                "who": (r.get("who") or "").strip(),
                "when": (r.get("when") or "").strip(),
                "completed": bool(r.get("completed")),
            })
    return out


def _normalize_budget_rows(raw: list) -> list:
    out = []
    if isinstance(raw, list):
        for r in raw:
            if not isinstance(r, dict):
                continue
            out.append({
                "id": (r.get("id") or str(uuid.uuid4())),
                "label": (r.get("label") or "").strip(),
                "amount": (str(r.get("amount") or "")).strip(),
                "sales": (str(r.get("sales") or "")).strip(),
                "per": r.get("per") if r.get("per") in ("week", "month") else "month",
            })
    return out


def _safe_num(x) -> float:
    try:
        s = str(x or "").replace(",", "").replace("$", "").strip()
        if not s:
            return 0.0
        return float(s)
    except Exception:
        return 0.0


def _compute_budget_totals(b: dict) -> dict:
    needs = b.get("needs") or []
    wants = b.get("wants") or []
    # Weekly totals, because they're paid weekly (the Owner, 3 Nov 2026): a
    # per-month row counts as × 12 ÷ 52. Breakeven is needs only; the target
    # is needs + wants. Both are sign-ups a week, rounded up.
    def _weekly(r: dict) -> float:
        n = _safe_num(r.get("amount"))
        return n * 12 / 52 if r.get("per", "month") != "week" else n
    tm_n = sum(_weekly(r) for r in needs)
    ts_n = sum(_safe_num(r.get("sales")) for r in needs)
    tm_w = sum(_weekly(r) for r in wants)
    ts_w = sum(_safe_num(r.get("sales")) for r in wants)
    sale_v = _safe_num(b.get("sale_value"))
    import math as _m
    if sale_v > 0:
        b["breakeven_week"] = _m.ceil(tm_n / sale_v) if tm_n > 0 else 0
        derived = _m.ceil((tm_n + tm_w) / sale_v) if (tm_n + tm_w) > 0 else 0
    else:
        b["breakeven_week"] = ts_n
        derived = ts_n + ts_w
    b["per"] = "week"
    b["total_money_needs"] = round(tm_n, 2)
    b["total_sales_needs"] = round(ts_n, 2)
    b["total_money_wants"] = round(tm_w, 2)
    b["total_sales_wants"] = round(ts_w, 2)
    b["total_sales_required"] = derived
    return b


@router.put("/monthly-planners/{month}")
async def upsert_planner(month: str, request: Request):
    """Owner only. Creates or updates the planner for the given month. When
    a NEWER month exists in the same user's history the older months are
    locked from edits — so this endpoint is the only path to first-time
    creating a month, but only for the latest unlocked month.

    On creation of a brand-new month, this endpoint also LOCKS every prior
    month for that user (they become permanently read-only)."""
    coerced = _coerce_month(month)
    if not coerced:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    me = await get_current_user(request)
    user_id = me["id"]

    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}

    # ── Normalize incoming body ───────────────────────────────────────────
    goals = _normalize_goals(body.get("goals"))

    swot_in = body.get("swot") or {}
    swot = {k: (str(swot_in.get(k) or "")).strip() for k in DEFAULT_SWOT.keys()}

    mp_in = body.get("monthly_planning") or {}
    si_in = (mp_in.get("sales_impacts") or {})
    monthly_planning = {
        "sales_impacts": {
            "coach_others": (str(si_in.get("coach_others") or "")).strip(),
            "still_to_master": (str(si_in.get("still_to_master") or "")).strip(),
        },
        "development": _normalize_planning_rows(mp_in.get("development")),
        "recruitment": _normalize_planning_rows(mp_in.get("recruitment")),
        "networking": _normalize_planning_rows(mp_in.get("networking")),
    }

    learning_in = body.get("learning") or {}
    learning_items_in = learning_in.get("items") or []
    learning = {
        "summary": (str(learning_in.get("summary") or "")).strip(),
        "items": [
            {
                "id": (r.get("id") or str(uuid.uuid4())),
                "topic": (str(r.get("topic") or "")).strip(),
                "mentor": (str(r.get("mentor") or "")).strip(),
                "notes": (str(r.get("notes") or "")).strip(),
            }
            for r in learning_items_in
            if isinstance(r, dict)
        ],
    }

    budget_in = body.get("budget") or {}
    budget = {
        "needs": _normalize_budget_rows(budget_in.get("needs")),
        "wants": _normalize_budget_rows(budget_in.get("wants")),
        "sale_value": (str(budget_in.get("sale_value") or "")).strip(),
    }
    # Locked (the Owner, 2 Nov 2026): what each sign-up is worth comes from
    # their own last 4 weeks, never what's typed.
    _rate = await _sign_up_value(user_id)
    if _rate:
        budget["sale_value"] = f"{_rate['per_sign_up']:.2f}"
    budget = _compute_budget_totals(budget)
    # The budget is their Plan your earnings too (the Owner, 26 Oct 2026):
    # saving it here updates their breakeven on Bells and their weekly plan.
    if any(_safe_num(r.get("amount")) for r in budget["needs"] + budget["wants"]):
        from core.earnings_plan import clean_rows as _plan_rows
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"earnings_plan": {
            "needs": _plan_rows(budget["needs"], "month"), "wants": _plan_rows(budget["wants"], "month"),
            "updated_at": datetime.now(timezone.utc).isoformat(), "from": "monthly_planner"}}})

    gap = _normalize_gap(body.get("gap_analysis"))
    focus = _normalize_focus(body.get("focus"))
    kpi_goals = _normalize_kpi_goals(body.get("kpi_goals"))

    # Targets — both are optional positive integers; 0/blank = unset
    def _int_or_zero(v):
        try:
            n = int(v) if v not in (None, "") else 0
        except Exception:
            n = 0
        return max(0, n)
    targets_in = body.get("targets") or {}
    targets = {
        "monthly_sales": _int_or_zero(targets_in.get("monthly_sales")),
        "personal_best": _int_or_zero(targets_in.get("personal_best")),
    }

    now = datetime.now(timezone.utc).isoformat()

    # ── Lookup existing ────────────────────────────────────────────────────
    existing = await db.monthly_planners.find_one(
        {"user_id": user_id, "month": coerced},
        {"_id": 0},
    )

    # If trying to edit a locked older month, refuse.
    if existing and bool(existing.get("locked")):
        raise HTTPException(status_code=403, detail="This month is locked. Open the latest month to edit.")

    # If creating a NEW month, ensure no future month already exists (you
    # can't edit a past month once a future one was created).
    if not existing:
        future = await db.monthly_planners.find_one(
            {"user_id": user_id, "month": {"$gt": coerced}},
            {"_id": 0, "month": 1},
            sort=[("month", -1)],
        )
        if future:
            raise HTTPException(
                status_code=403,
                detail=f"A newer month ({future.get('month')}) already exists. New months can only be created at or after the latest one.",
            )

    if existing:
        update = {
            "goals": goals,
            "swot": swot,
            "monthly_planning": monthly_planning,
            "learning": learning,
            "budget": budget,
            "targets": targets,
            "gap_analysis": gap,
            "focus": focus,
            "kpi_goals": kpi_goals,
            "updated_at": now,
        }
        await db.monthly_planners.update_one({"id": existing["id"]}, {"$set": update})
        existing.update(update)
        return {"ok": True, "planner": _strip_for_role(existing, me.get("role") or "trainee")}

    # Brand-new month — first lock all earlier months for this user
    await db.monthly_planners.update_many(
        {"user_id": user_id, "month": {"$lt": coerced}},
        {"$set": {"locked": True}},
    )

    doc = _seed_planner(user_id, me.get("office_id") or "", coerced, me.get("role") or "trainee")
    doc.update({
        "goals": goals,
        "swot": swot,
        "monthly_planning": monthly_planning,
        "learning": learning,
        "budget": budget,
        "targets": targets,
        "gap_analysis": gap,
        "focus": focus,
        "kpi_goals": kpi_goals,
        "updated_at": now,
    })
    await db.monthly_planners.insert_one(doc.copy())
    return {"ok": True, "planner": _strip_for_role(doc, me.get("role") or "trainee")}


@router.post("/monthly-planners/start/{month}")
async def start_new_month(month: str, request: Request):
    """Create a fresh planner for `month`, AUTOFILLING from the user's most
    recent existing planner (SWOT inherits, GAP scores inherit, budget
    structure inherits, planning rows reset to empty). Locks all prior
    months in the process. Owner only."""
    coerced = _coerce_month(month)
    if not coerced:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    me = await get_current_user(request)
    user_id = me["id"]
    role = me.get("role") or "trainee"

    # Already exists?
    existing = await db.monthly_planners.find_one(
        {"user_id": user_id, "month": coerced},
        {"_id": 0},
    )
    if existing:
        return {"ok": True, "created": False, "planner": _strip_for_role(existing, role)}

    # Most recent prior planner (for inheritance)
    prev = await db.monthly_planners.find_one(
        {"user_id": user_id, "month": {"$lt": coerced}},
        {"_id": 0},
        sort=[("month", -1)],
    )

    seed = _seed_planner(user_id, me.get("office_id") or "", coerced, role)
    if prev:
        # SWOT is done quarterly (the Owner, 13 Nov 2026): it carries over
        # within the quarter and starts fresh in a new one.
        if _quarter(prev.get("month") or "") == _quarter(coerced):
            seed["swot"] = {k: (str((prev.get("swot") or {}).get(k) or "")).strip() for k in DEFAULT_SWOT}
        # Both Gap Analysis wheels carry over, for everyone.
        seed["gap_analysis"] = _normalize_gap(prev.get("gap_analysis"))
        # The monthly KPI goals carry over; the tick boxes start empty.
        seed["kpi_goals"] = _normalize_kpi_goals(prev.get("kpi_goals"))
        # Inherit budget rows + sale_value (numbers stay; user adjusts)
        prev_budget = prev.get("budget") or {}
        seed["budget"]["needs"] = _normalize_budget_rows(prev_budget.get("needs")) or seed["budget"]["needs"]
        seed["budget"]["wants"] = _normalize_budget_rows(prev_budget.get("wants")) or seed["budget"]["wants"]
        seed["budget"]["sale_value"] = (str(prev_budget.get("sale_value") or "")).strip()
        seed["budget"] = _compute_budget_totals(seed["budget"])
        # Carry goals forward as scaffolding (user can rewrite). v2 keeps the
        # KPI/Rock names + targets but resets each Rock's done flag; a legacy
        # prev doc → fresh v2 (the guided builder rebuilds from scratch).
        prev_goals = prev.get("goals") or {}
        if (prev_goals.get("kpis") is not None) or bool(prev_goals.get("version")):
            carried = _normalize_goals(prev_goals)
            for r in carried.get("rocks", []):  # mid-term goals keep their tick: they run 6-12 months
                r["done"] = False
            seed["goals"] = carried
        else:
            seed["goals"] = _default_goals()

    # Their latest breakeven (Plan your earnings) beats last month's copy.
    seed = await _fill_budget_from_plan(seed, user_id)

    # Lock all earlier months
    await db.monthly_planners.update_many(
        {"user_id": user_id, "month": {"$lt": coerced}},
        {"$set": {"locked": True}},
    )

    await db.monthly_planners.insert_one(seed.copy())
    return {"ok": True, "created": True, "planner": _strip_for_role(seed, role)}


@router.get("/monthly-planners/team/roster")
async def team_roster(request: Request):
    """For leaders + admins. Returns a list of users this requester is
    allowed to view planners for, with each user's most-recent month."""
    me = await get_current_user(request)
    role = me.get("role")
    if role not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coach or admin access required")

    if role == "admin":
        # Whole office (super-admin sees their own office; we don't expose
        # cross-office views from this endpoint to keep blast-radius small).
        office_id = me.get("office_id") or ""
        cursor = db.users.find({"office_id": office_id, "is_active": {"$ne": False}, "deleted": {"$ne": True}, "is_demo": {"$ne": True}}, {"_id": 1, "name": 1, "email": 1, "role": 1})
    else:
        # Leader → transitive reports tree
        seen = {me["id"]}
        roots = [me["id"]]
        depth = 0
        while roots and depth < 8:
            children = await db.users.find(
                {"reports_to": {"$in": roots}, "is_active": {"$ne": False}, "deleted": {"$ne": True}, "is_demo": {"$ne": True}},
                {"_id": 1, "name": 1, "email": 1, "role": 1},
            ).to_list(500)
            child_ids = [str(c["_id"]) for c in children]
            new_ids = [cid for cid in child_ids if cid not in seen]
            if not new_ids:
                break
            seen.update(new_ids)
            roots = new_ids
            depth += 1
        if not seen:
            return {"items": []}
        seen.discard(me["id"])
        if not seen:
            return {"items": []}
        try:
            obj_ids = [ObjectId(s) for s in seen]
        except Exception:
            obj_ids = []
        cursor = db.users.find({"_id": {"$in": obj_ids}, "is_active": {"$ne": False}, "deleted": {"$ne": True}}, {"_id": 1, "name": 1, "email": 1, "role": 1})

    users = await cursor.to_list(500)
    items: list = []
    for u in users:
        uid = str(u["_id"])
        latest = await db.monthly_planners.find_one(
            {"user_id": uid},
            {"_id": 0, "month": 1, "updated_at": 1},
            sort=[("month", -1)],
        )
        items.append({
            "id": uid,
            "name": u.get("name") or u.get("email"),
            "role": u.get("role"),
            "latest_month": (latest or {}).get("month"),
            "updated_at": (latest or {}).get("updated_at"),
        })
    items.sort(key=lambda x: ((0 if x.get("role") == "leader" else 1), (x.get("name") or "").lower()))
    return {"items": items}



def _month_bounds(month: str) -> tuple[str, str]:
    y, m = (int(p) for p in month.split("-"))
    next_y, next_m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}-01", f"{next_y:04d}-{next_m:02d}-01"


async def _bells_sign_ups(user_id: str, coerced: str) -> dict:
    """A person's Bells sign-ups for a calendar month (days marked In)."""
    # Compute month start/end (YYYY-MM-DD bounds inclusive)
    y, m = (int(p) for p in coerced.split("-"))
    next_y, next_m = (y + 1, 1) if m == 12 else (y, m + 1)
    month_start = f"{y:04d}-{m:02d}-01"
    next_month_start = f"{next_y:04d}-{next_m:02d}-01"

    # Each bells_entry has a week_ending (Sunday, YYYY-MM-DD). A week's days
    # span Mon-Sun, where day index 0 = Mon-of-(week_ending - 6 days) and day
    # index 6 = week_ending itself. We just iterate every entry and check each
    # day's actual date against the month bounds.
    from datetime import datetime as _dt, timedelta as _td

    cursor = db.bells_entries.find({"user_id": user_id}, {"_id": 0, "week_ending": 1, "days": 1})
    total = 0
    over30_total = 0
    under30_total = 0
    days_worked = 0
    async for e in cursor:
        we = e.get("week_ending") or ""
        try:
            we_dt = _dt.strptime(we, "%Y-%m-%d")
        except Exception:
            continue
        # Quick skip: if the entire week is before month-start or on/after next-month-start, skip
        last_day = we_dt
        first_day = we_dt - _td(days=6)
        if last_day.strftime("%Y-%m-%d") < month_start or first_day.strftime("%Y-%m-%d") >= next_month_start:
            continue
        days = e.get("days") or []
        for i in range(min(7, len(days))):
            d = days[i] or {}
            day_date = (we_dt - _td(days=(6 - i))).strftime("%Y-%m-%d")
            if day_date < month_start or day_date >= next_month_start:
                continue
            if (d.get("status") or "off") != "in":
                continue
            o = int(d.get("over30") or 0)
            u = int(d.get("under30") or 0)
            sales = o + u
            if sales > 0 or d.get("status") == "in":
                total += sales
                over30_total += o
                under30_total += u
                if sales > 0:
                    days_worked += 1

    return {"total": total, "over30": over30_total, "under30": under30_total, "days_worked": days_worked}


@router.get("/monthly-planners/{month}/sales-actual")
async def planner_sales_actual(month: str, request: Request):
    """Compute the user's actual bells-recorded sales for the given month.
    Sums (over30 + under30) across every day in every bells_entry where
    week_ending falls within the calendar month and the day's status is 'in'
    (excludes off/ab/nc). Used by the monthly planner to show progress
    against the user's monthly_sales_target."""
    coerced = _coerce_month(month)
    if not coerced:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    me = await get_current_user(request)
    user_id = me["id"]

    t = await _bells_sign_ups(user_id, coerced)
    total, over30_total, under30_total, days_worked = t["total"], t["over30"], t["under30"], t["days_worked"]

    return {
        "month": coerced,
        "total_sales": total,
        "over30": over30_total,
        "under30": under30_total,
        "days_worked": days_worked,
    }


# ── Recruitment, Sign Ups & Growth (the Owner, 13 Nov 2026) ─────────────────
FIELD_DAY_ONE = 3   # assessment day_number 1-2 are BA Academy, 3-8 the six field days


async def _new_starts_due(target: dict, month: str) -> list[dict]:
    """New starts starting this month that are this person's: the whole office
    for an Admin, their team (and anyone they're Coach to) for a Coach, the
    ones they're Coach to for anyone else. Worked out, never typed."""
    from auth import get_subtree_ids
    start, nxt = _month_bounds(month)
    q: dict = {"start_date": {"$gte": start, "$lt": nxt}, "closed_out_reason": {"$ne": "not_new_start"}}
    role = target.get("role")
    if role == "admin":
        q["office_id"] = target.get("office_id")
    else:
        ids = [target["id"]]
        if role == "leader":
            ids = [str(i) for i in await get_subtree_ids(target["id"])]
        q["$or"] = [{"leader_user_id": target["id"]}, {"trainee_user_id": {"$in": [i for i in ids if i != target["id"]]}}]
        q["office_id"] = target.get("office_id")
    hires = await db.new_hires.find(q, {"_id": 0, "id": 1, "name": 1, "start_date": 1, "current_day": 1,
                                        "trainee_user_id": 1}).sort("start_date", 1).to_list(200)
    if not hires:
        return []
    rows = await db.daily_assessments.find(
        {"new_hire_id": {"$in": [h["id"] for h in hires]}, "completed": True},
        {"_id": 0, "new_hire_id": 1, "day_number": 1, "kpi_sales": 1}).to_list(5000)
    by_hire: dict = {}
    for a in rows:
        by_hire.setdefault(a.get("new_hire_id"), []).append(a)
    today = datetime.now(timezone.utc).date().isoformat()
    out = []
    for h in hires:
        graded = by_hire.get(h["id"], [])
        field = {int(a.get("day_number") or 0): a for a in graded if int(a.get("day_number") or 0) >= FIELD_DAY_ONE}
        first3 = [field[d] for d in range(FIELD_DAY_ONE, FIELD_DAY_ONE + 3) if d in field]
        sign_ups = sum(int(a.get("kpi_sales") or 0) for a in first3) if first3 else None
        days_done = len([d for d in field if d <= FIELD_DAY_ONE + 5])
        started = str(h.get("start_date") or "")[:10] <= today
        attended = started and (bool(graded) or int(h.get("current_day") or 1) > 1)
        out.append({"id": h["id"], "name": h.get("name") or "", "start_date": str(h.get("start_date") or "")[:10],
                    "sign_ups_first_3": sign_ups, "field_days_done": days_done,
                    "completed_6": days_done >= 6, "attended": attended})
    return out


async def _shadowers_taken(user_id: str, month: str) -> int:
    """Days this month they led a bunny hop with a shadow on it."""
    start, nxt = _month_bounds(month)
    n = 0
    async for sec in db.sectors.find({"date": {"$gte": start, "$lt": nxt}, "member_ids": user_id},
                                     {"_id": 0, "hops": 1}):
        for h in sec.get("hops") or []:
            shadows = [str(i) for i in h.get("shadow_ids") or []]
            members = [str(i) for i in h.get("member_ids") or []]
            if shadows and user_id in members and user_id not in shadows:
                n += len(shadows)
    return n


@router.get("/monthly-planners/{month}/growth")
async def planner_growth(month: str, request: Request, user_id: Optional[str] = None):
    """The booklet's Recruitment, Sign Ups & Growth page, worked out: this
    month's sign-ups (for the Sign Up Focus boxes), shadowers taken, PRs
    attended (their PR Focus ticks) and New Starts Due with how each is doing.
    Hit is yes once the month's number reaches the goal."""
    coerced = _coerce_month(month)
    if not coerced:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    me, target = await _resolve_target_user(request, user_id)
    doc = await db.monthly_planners.find_one({"user_id": target["id"], "month": coerced},
                                             {"_id": 0, "focus": 1, "kpi_goals": 1}) or {}
    focus = _normalize_focus(doc.get("focus"))
    goals = _normalize_kpi_goals(doc.get("kpi_goals"))
    sign_ups = (await _bells_sign_ups(target["id"], coerced))["total"]
    new_starts = await _new_starts_due(target, coerced)
    actual = {
        "shadowers": await _shadowers_taken(target["id"], coerced),
        "sign_ups": sign_ups,
        "new_starts": sum(1 for r in new_starts if r["attended"]),
        "prs": len(focus["pr"]),
    }
    month_over = _month_bounds(coerced)[1] <= datetime.now(timezone.utc).date().isoformat()
    kpis = []
    for k in GROWTH_KPIS:
        goal, got = goals[k], actual[k]
        hit = None if not goal else (True if got >= goal else (False if month_over else None))
        kpis.append({"key": k, "goal": goal, "actual": got, "hit": hit})
    return {"month": coerced, "sign_ups": sign_ups, "kpis": kpis, "new_starts": new_starts, "month_over": month_over}
