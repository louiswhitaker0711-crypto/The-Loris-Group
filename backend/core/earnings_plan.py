"""Plan your earnings — a person's needs and wants, and their weekly
breakeven (the Owner, 26 Oct 2026).

Each row is an amount per week or per month; monthly becomes weekly as
× 12 ÷ 52. One sign-up is counted at the Gold fee up front plus The Round on
75% of sign-ups (£20 + 75% × £8 = £26 by default, from the office's Rates).

  breakeven = weekly needs ÷ per sign-up, rounded up
  target    = (weekly needs + weekly wants) ÷ per sign-up, rounded up

Stored on the user (`users.earnings_plan`). It fills the BE column on Bells,
shows on the weekly plan, and the monthly goal planner's budget saves into it.
"""
from __future__ import annotations

import math
import uuid
from typing import Any, Optional

from core.vertex_pay import normalize_fees

ROUND_SHARE = 0.75
MAX_ROWS = 30


def per_sign_up(fees: Optional[dict]) -> float:
    k = normalize_fees(fees)
    return round(float(k["fee_target"]) + ROUND_SHARE * float(k["fee_membership"]), 2)


def _amount(v: Any) -> float:
    try:
        n = float(str(v if v is not None else "").replace("£", "").replace(",", "").strip() or 0)
    except ValueError:
        return 0.0
    return n if math.isfinite(n) and n > 0 else 0.0


def weekly(amount: Any, per: str) -> float:
    a = _amount(amount)
    return a * 12 / 52 if per == "month" else a


def clean_rows(raw: Any, default_per: str = "week") -> list[dict]:
    out = []
    for r in (raw if isinstance(raw, list) else [])[:MAX_ROWS]:
        if not isinstance(r, dict):
            continue
        per = r.get("per") if r.get("per") in ("week", "month") else default_per
        out.append({"id": str(r.get("id") or uuid.uuid4())[:40], "label": str(r.get("label") or "").strip()[:60],
                    "amount": str(r.get("amount") or "").strip()[:12], "per": per})
    return out


def compute(plan: Optional[dict], fees: Optional[dict]) -> dict:
    plan = plan or {}
    fee = per_sign_up(fees)
    needs = sum(weekly(r.get("amount"), r.get("per") or "week") for r in plan.get("needs") or [])
    wants = sum(weekly(r.get("amount"), r.get("per") or "week") for r in plan.get("wants") or [])
    return {
        "weekly_needs": round(needs, 2), "weekly_wants": round(wants, 2), "per_sign_up": fee,
        "breakeven": math.ceil(needs / fee) if needs > 0 and fee > 0 else None,
        "target": math.ceil((needs + wants) / fee) if (needs + wants) > 0 and fee > 0 else None,
    }
