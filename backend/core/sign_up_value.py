"""What one sign-up is worth to a person: the Monthly Goal Planner's "Each
sign-up is worth" and the figure every breakeven divides by.

The Owner (2 Nov 2026): it comes from the person's own last 4 weeks, not a
flat figure, and it's locked (nobody types it):

    Gold %  × (Gold up-front   + 4th-week % × Gold week-4 payment)
  + Silver% × (Silver up-front + 4th-week % × Silver week-4 payment)
  + Round % × The Round fee
  + driver bonus (drivers only, every sign-up)

Fails are left out on purpose. Gold % and Round % come from Bells (their last
4 weeks); 4th-week % from the quality reports (their last 4 weeks where the
4th week was due). Anything they don't have yet (a new start) uses the team
standards: 90% Gold, 75% Round, 75% 4th week. Each part falls back on its
own, so a BA with Bells numbers but no quality report yet still gets their own
Gold % and Round %.

Owner pay: the Owner is paid the MC fee and the BA fee on their PERSONAL
sign-ups, so their up-front is BA fee + MC fee (Gold £20 + £20 = £40, Silver
£12 + £16 = £28) and their week-4 payment is BA + MC (Gold £8 + £9). The
Owner is whoever has pay_type "owner", or by default an Admin who isn't a
read-only viewer.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from core.vertex_pay import normalize_fees

STANDARD = {"gold_pct": 90.0, "round_pct": 75.0, "fourth_pct": 75.0}
WEEKS = 4


def is_owner_pay(user: Optional[dict]) -> bool:
    u = user or {}
    if u.get("pay_type") in ("owner", "ba"):
        return u.get("pay_type") == "owner"
    return u.get("role") == "admin" and not u.get("is_viewer")


def value(fees: Optional[dict], gold_pct: float, round_pct: float, fourth_pct: float,
          owner: bool = False, driver: bool = False) -> float:
    k = normalize_fees(fees)
    g, r, f = gold_pct / 100.0, round_pct / 100.0, fourth_pct / 100.0
    gold_up, silver_up = float(k["fee_target"]), float(k["fee_standard"])
    gold_ret, silver_ret = float(k["retention_target"]), float(k["retention_standard"])
    if owner:
        gold_up += float(k["fee_mc_target"])
        silver_up += float(k["fee_mc_standard"])
        gold_ret += float(k["retention_mc_target"])
        silver_ret += float(k["retention_mc_standard"])
    v = g * (gold_up + f * gold_ret) + (1 - g) * (silver_up + f * silver_ret) + r * float(k["fee_membership"])
    if driver:
        v += float(k["driver_bonus"])
    return round(v, 2)


def _week_endings(today: date, n: int = WEEKS) -> list[str]:
    sunday = today + timedelta(days=6 - today.weekday())
    return [(sunday - timedelta(weeks=i)).isoformat() for i in range(n)]


def _n(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


async def own_numbers(database, user_id: str, office_id: Optional[str], today: Optional[date] = None) -> dict:
    """Their Gold %, Round % and 4th-week % over the last 4 weeks (None where
    they have nothing yet)."""
    today = today or datetime.now().date()
    gold = silver = rnd = 0.0
    async for e in database.bells_entries.find(
            {"user_id": str(user_id), "week_ending": {"$in": _week_endings(today)}}, {"_id": 0, "days": 1}):
        for d in (e.get("days") or [])[:7]:
            d = d or {}
            gold += _n(d.get("over30"))
            silver += _n(d.get("under30"))
            rnd += _n(d.get("memberships"))
    total = gold + silver
    out: dict = {"gold_pct": None, "round_pct": None, "fourth_pct": None, "sign_ups": int(total)}
    if total > 0:
        out["gold_pct"] = round(100 * gold / total, 1)
        out["round_pct"] = round(min(100.0, 100 * rnd / total), 1)

    fourth: list[float] = []
    if office_id:
        async for w in database.quality_weeks.find(
                {"office_id": office_id}, {"_id": 0, "bas": 1, "total": 1}).sort("week_ending", -1).limit(12):
            if not (w.get("total") or {}).get("fourth_week"):
                continue   # 4th week not due yet that week
            for b in w.get("bas") or []:
                if str(b.get("user_id") or "") == str(user_id):
                    fw = (b.get("metrics") or {}).get("fourth_week")
                    if isinstance(fw, (int, float)):
                        fourth.append(float(fw))
                    break
            if len(fourth) >= WEEKS:
                break
    if fourth:
        out["fourth_pct"] = round(sum(fourth) / len(fourth), 1)
    return out


async def rate_for(database, user: dict, fees: Optional[dict], today: Optional[date] = None) -> dict:
    """Everything the planner shows: the figure, the three percentages, where
    each came from, and whether owner pay / the driver bonus applied."""
    uid = str(user.get("_id") or user.get("id"))
    own = await own_numbers(database, uid, user.get("office_id"), today)
    parts, source = {}, {}
    for key in ("gold_pct", "round_pct", "fourth_pct"):
        if own.get(key) is None:
            parts[key], source[key] = STANDARD[key], "standard"
        else:
            parts[key], source[key] = own[key], "own"
    owner, driver = is_owner_pay(user), bool(user.get("is_driver"))
    return {"per_sign_up": value(fees, parts["gold_pct"], parts["round_pct"], parts["fourth_pct"], owner, driver),
            **parts, "source": source, "owner": owner, "driver": driver, "weeks": WEEKS}


async def per_sign_up_for(database, user_id: Any, fees: Optional[dict]) -> Optional[float]:
    """Just the figure, for breakeven sums. None if the person can't be found."""
    from bson import ObjectId
    try:
        u = await database.users.find_one({"_id": ObjectId(str(user_id))},
                                          {"office_id": 1, "role": 1, "is_viewer": 1, "pay_type": 1, "is_driver": 1})
    except Exception:
        u = None
    if not u:
        return None
    return (await rate_for(database, u, fees))["per_sign_up"]
