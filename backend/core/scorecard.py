"""Who the best people are, from their numbers rather than personality (the
Owner, 10 Nov 2026). For the Owner and Coaches only, never BAs.

Each person is scored against what good looks like (never against each
other) over the last 4 weeks: piece average, Gold %, The Round %, fails,
reliability, drop days and average order value, plus, only for people who've
coached in that time, how much they've coached and how their new starts did.
Someone needs 6+ field days in the window to be scored; new starts in their
first 8 days show as "too early".

Two short lists come out of it, each name with a one-line reason:
  - ready to lead a sector: strong numbers and reliable
  - best to give a new start to: strong quality and reliable, plus good
    new-start results if they've had any

Used by the AI (Analyse me and Ask, for Admins and Coaches), and by the
weekly review (the two lists and a short AI paragraph).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from core.app_time import APP_TZ

from bson import ObjectId

from database import db

WEEKS = 4
MIN_DAYS = 6
NEW_START_WEEKS = 12      # how far back a Coach's new starts count

# What good looks like (the Owner's standards).
GOOD = {"piece_average": 4.0, "gold_pct": 90, "round_pct": 75, "reliability_pct": 100,
        "drops": 2.5, "aov": 13.0}
FAILS_GOOD, FAILS_ZERO = 10.0, 30.0     # under 10% is full marks, 30%+ is none

# Piece average and quality count most, then reliability, drops and AOV.
WEIGHTS = {"piece_average": 30, "gold_pct": 15, "round_pct": 10, "fails": 10, "reliability_pct": 15,
           "drops": 7.5, "aov": 7.5}
COACH_WEIGHTS = {"coaching": 7.5, "new_starts": 7.5}


def _ratio(value, good) -> float | None:
    if value is None or not good:
        return None
    return max(0.0, min(1.0, float(value) / float(good)))


def _fails_score(pct) -> float | None:
    if pct is None:
        return None
    p = float(pct)
    if p <= FAILS_GOOD:
        return 1.0
    return max(0.0, 1 - (p - FAILS_GOOD) / (FAILS_ZERO - FAILS_GOOD))


def _today() -> date:
    return datetime.now(APP_TZ).date()


def _week_ending(d: date) -> date:
    return d + timedelta(days=(6 - d.weekday()) % 7)


async def _bells(office_id: str, ids: set[str], weeks: list[str]) -> dict:
    """Per person over the weeks: sign-ups, Gold, The Round, days in, and the
    days they planned to work vs turned up (same rules as Bells' reliability)."""
    from routes.bells import _is_in_day, _safe_num
    excused = {"ab", "rt", "pc", "sd"}
    out: dict = {}
    async for b in db.bells_entries.find({"office_id": office_id, "week_ending": {"$in": weeks},
                                          "user_id": {"$in": list(ids)}},
                                         {"_id": 0, "user_id": 1, "days": 1}):
        r = out.setdefault(str(b["user_id"]), {"sign_ups": 0, "gold": 0, "round": 0, "days": 0,
                                               "planned": 0, "turned_up": 0})
        days = [d for d in (b.get("days") or []) if isinstance(d, dict)]
        for d in days:
            if _is_in_day(d):
                r["days"] += 1
                r["sign_ups"] += int(_safe_num(d.get("over30")) + _safe_num(d.get("under30")))
                r["gold"] += int(_safe_num(d.get("over30")))
                r["round"] += int(_safe_num(d.get("memberships")))
        for d in days[:6]:
            st = d.get("status") or "off"
            if st not in excused:
                r["planned"] += 1
                r["turned_up"] += 1 if st == "in" else 0
    return out


async def _quality(office_id: str, ids: set[str]) -> dict:
    """Per person from the last 4 quality reports: AOV and drop days (weighted
    by sales) and fails (their sales × fail %)."""
    out: dict = {}
    docs = await db.quality_weeks.find({"office_id": office_id, "bas.0": {"$exists": True}},
                                       {"_id": 0, "week_ending": 1, "bas": 1}
                                       ).sort("week_ending", -1).to_list(WEEKS)
    for doc in docs:
        for b in doc.get("bas") or []:
            uid = str(b.get("user_id") or "")
            m = b.get("metrics") or {}
            if uid not in ids or not m:
                continue
            r = out.setdefault(uid, {"sales": 0, "aov_w": 0.0, "aov_n": 0, "drops_w": 0.0, "drops_n": 0,
                                     "fails": 0.0, "fail_sales": 0})
            sales = int(m.get("sales") or 0)
            w = sales or 1
            if m.get("aov") is not None:
                r["aov_w"] += float(m["aov"]) * w
                r["aov_n"] += w
            if m.get("drops") is not None:
                r["drops_w"] += float(m["drops"]) * w
                r["drops_n"] += w
            if m.get("fail_rate") is not None and sales:
                r["fails"] += sales * float(m["fail_rate"]) / 100
                r["fail_sales"] += sales
            r["sales"] += sales
    return out


async def _coaching(office_id: str, ids: set[str], since: date) -> tuple[dict, dict]:
    """(graded new-start days in the window by who coached them, and each
    Coach's new starts from the last 12 weeks: how many, their own sign-ups
    over their graded days, and how many are still here)."""
    graded: dict = {}
    results: dict = {}
    hires = await db.new_hires.find({"office_id": office_id}, {"_id": 0, "id": 1, "leader_user_id": 1,
                                                               "trainee_user_id": 1, "start_date": 1,
                                                               "closed_out_reason": 1}).to_list(2000)
    hires = [h for h in hires if h.get("closed_out_reason") != "not_new_start"]
    by_hire = {h["id"]: h for h in hires}
    if not by_hire:
        return graded, results
    rows = await db.daily_assessments.find({"new_hire_id": {"$in": list(by_hire)}, "completed": True},
                                           {"_id": 0, "new_hire_id": 1, "kpi_sales": 1, "leader_assisted_sales": 1,
                                            "assessment_date": 1, "graded_by_id": 1}).to_list(20000)
    own_by_hire: dict = {}
    for a in rows:
        h = by_hire.get(a.get("new_hire_id"))
        if not h:
            continue
        if a.get("kpi_sales") is not None:
            own = max(0, int(a.get("kpi_sales") or 0) - int(a.get("leader_assisted_sales") or 0))
            own_by_hire.setdefault(h["id"], []).append(own)
        when = str(a.get("assessment_date") or "")[:10]
        if when and when >= since.isoformat():
            who = str(a.get("graded_by_id") or h.get("leader_user_id") or "")
            if who in ids:
                graded[who] = graded.get(who, 0) + 1
    recent = (_today() - timedelta(weeks=NEW_START_WEEKS)).isoformat()
    trainee_ids = [h["trainee_user_id"] for h in hires if h.get("trainee_user_id")]
    gone = {str(u["_id"]) async for u in db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in trainee_ids if ObjectId.is_valid(i)]},
         "$or": [{"deleted": True}, {"is_active": False}, {"left_on": {"$nin": [None, ""]}}]}, {"_id": 1})}
    for h in hires:
        coach = str(h.get("leader_user_id") or "")
        if coach not in ids or str(h.get("start_date") or "") < recent:
            continue
        r = results.setdefault(coach, {"new_starts": 0, "still_here": 0, "own_sign_ups": 0, "graded_days": 0})
        r["new_starts"] += 1
        r["still_here"] += 0 if h.get("trainee_user_id") in gone else 1
        own = own_by_hire.get(h["id"]) or []
        r["own_sign_ups"] += sum(own)
        r["graded_days"] += len(own)
    return graded, results


async def _too_early(office_id: str, ids: set[str]) -> set[str]:
    early = set()
    async for h in db.new_hires.find({"office_id": office_id, "active": {"$ne": False},
                                      "trainee_user_id": {"$in": list(ids)}},
                                     {"_id": 0, "trainee_user_id": 1, "current_day": 1}):
        if int(h.get("current_day") or 1) <= 8:
            early.add(str(h["trainee_user_id"]))
    return early


def _reason(p: dict, parts: list[str]) -> str:
    m = p["measures"]
    bits = {
        "gold": f"{m['gold_pct']}% Gold" if m.get("gold_pct") is not None else None,
        "pa": f"{m['piece_average']} a day" if m.get("piece_average") is not None else None,
        "rel": ("never missed a planned day" if m.get("reliability_pct") == 100
                else f"{m['reliability_pct']}% reliable") if m.get("reliability_pct") is not None else None,
        "fails": f"{m['fails_pct']}% fails" if m.get("fails_pct") is not None else None,
        "round": f"{m['round_pct']}% The Round" if m.get("round_pct") is not None else None,
        "ns": (f"{m['new_starts']['still_here']} of {m['new_starts']['new_starts']} new starts still here"
               if m.get("new_starts") else None),
    }
    return ", ".join(b for b in (bits[k] for k in parts) if b)


async def scorecard(office_id: str, ids: set[str], through: date | None = None) -> dict:
    """The scorecard for these people (what the viewer can see) over the 4
    weeks to `through` (default: today)."""
    through = through or _today()
    last = _week_ending(through)
    weeks = [(last - timedelta(days=7 * i)).isoformat() for i in range(WEEKS)]
    since = last - timedelta(days=7 * WEEKS - 1)
    users = await db.users.find(
        {"_id": {"$in": [ObjectId(i) for i in ids if ObjectId.is_valid(i)]}, "office_id": office_id,
         "deleted": {"$ne": True}, "is_active": {"$ne": False}, "is_viewer": {"$ne": True},
         "is_demo": {"$ne": True}}, {"name": 1, "left_on": 1}).to_list(1000)
    names = {str(u["_id"]): u.get("name") or "?" for u in users if not u.get("left_on")}
    ids = set(names)
    bells = await _bells(office_id, ids, weeks)
    quality = await _quality(office_id, ids)
    graded, ns_results = await _coaching(office_id, ids, since)
    early = await _too_early(office_id, ids)

    people, too_early, not_enough = [], [], []
    for uid, name in names.items():
        if uid in early:
            too_early.append(name)
            continue
        b = bells.get(uid) or {}
        if (b.get("days") or 0) < MIN_DAYS:
            if b.get("days"):
                not_enough.append(name)
            continue
        q = quality.get(uid) or {}
        signed = b["sign_ups"]
        m = {
            "days": b["days"],
            "sign_ups": signed,
            "piece_average": round(signed / b["days"], 2),
            "gold_pct": round(100 * b["gold"] / signed) if signed else None,
            "round_pct": round(100 * b["round"] / signed) if signed else None,
            "reliability_pct": round(100 * b["turned_up"] / b["planned"]) if b.get("planned") else None,
            "aov": round(q["aov_w"] / q["aov_n"], 2) if q.get("aov_n") else None,
            "drops": round(q["drops_w"] / q["drops_n"], 2) if q.get("drops_n") else None,
            "fails_pct": round(100 * q["fails"] / q["fail_sales"]) if q.get("fail_sales") else None,
        }
        if graded.get(uid):
            m["graded_new_start_days"] = graded[uid]
        if ns_results.get(uid):
            r = ns_results[uid]
            m["new_starts"] = {**r, "own_sign_ups_a_day": round(r["own_sign_ups"] / r["graded_days"], 2)
                               if r["graded_days"] else None}
        parts = {
            "piece_average": _ratio(m["piece_average"], GOOD["piece_average"]),
            "gold_pct": _ratio(m["gold_pct"], GOOD["gold_pct"]),
            "round_pct": _ratio(m["round_pct"], GOOD["round_pct"]),
            "fails": _fails_score(m["fails_pct"]),
            "reliability_pct": _ratio(m["reliability_pct"], GOOD["reliability_pct"]),
            "drops": _ratio(m["drops"], GOOD["drops"]),
            "aov": _ratio(m["aov"], GOOD["aov"]),
        }
        weights = dict(WEIGHTS)
        coached = bool(m.get("graded_new_start_days") or m.get("new_starts"))
        if coached:
            parts["coaching"] = min(1.0, (m.get("graded_new_start_days") or 0) / 8)
            nsr = m.get("new_starts") or {}
            if nsr.get("new_starts"):
                kept = nsr["still_here"] / nsr["new_starts"]
                pace = _ratio(nsr.get("own_sign_ups_a_day"), 2.0) or 0.0
                parts["new_starts"] = round(0.5 * kept + 0.5 * pace, 3)
            weights.update(COACH_WEIGHTS)
        have = {k: v for k, v in parts.items() if v is not None}
        total_w = sum(weights[k] for k in have)
        score = round(100 * sum(weights[k] * v for k, v in have.items()) / total_w) if total_w else None
        quality_parts = [parts[k] for k in ("gold_pct", "round_pct", "fails") if parts.get(k) is not None]
        people.append({"user_id": uid, "name": name, "score": score, "measures": m,
                       "quality_score": round(100 * sum(quality_parts) / len(quality_parts)) if quality_parts else None})

    people.sort(key=lambda p: -(p["score"] or 0))
    rel = lambda p: p["measures"].get("reliability_pct") or 0  # noqa: E731
    lead = [p for p in people if p["measures"]["piece_average"] >= 2.5 and rel(p) >= 85][:3]
    def ns_key(p: dict) -> float:
        nsr = (p["measures"].get("new_starts") or {})
        bonus = 10 * (nsr["still_here"] / nsr["new_starts"]) if nsr.get("new_starts") else 0
        return (p["quality_score"] or 0) + 0.3 * (p["score"] or 0) + bonus
    give = sorted([p for p in people if rel(p) >= 85 and (p["measures"].get("gold_pct") or 0) >= 75
                   and (p["measures"].get("fails_pct") or 0) <= 15], key=lambda p: -ns_key(p))[:3]
    return {
        "weeks": sorted(weeks),
        "through": through.isoformat(),
        "standards": {"piece_average": "4+ a day", "gold": "90%+", "the_round": "75%+", "fails": "under 10%",
                      "reliability": "100%", "drop_days": "2.5+", "aov": "£13+"},
        "people": people,
        "ready_to_lead_a_sector": [{"name": p["name"], "reason": _reason(p, ["pa", "gold", "rel"])} for p in lead],
        "best_to_give_a_new_start_to": [{"name": p["name"],
                                         "reason": _reason(p, ["gold", "round", "fails", "rel", "ns"])} for p in give],
        "too_early": sorted(too_early),
        "not_enough_days": sorted(not_enough),
        "note": f"Scored against what good looks like over the last {WEEKS} weeks; {MIN_DAYS}+ field days needed. "
                "For the Owner and Coaches only: never show or mention it to BAs.",
    }


def slim(card: dict) -> dict:
    """The scorecard as the AI sees it: names, scores and measures, no ids."""
    return {**card, "people": [{k: v for k, v in p.items() if k != "user_id"} for p in card.get("people") or []]}

