"""Pay rules — the one place the fee schedule's shape and defaults live.

(The module keeps its original name so nothing that imports it needs to
change; the rules are the Modern Milkman campaign's.)

A Brand Ambassador (BA) is paid per sign-up, by the customer's repeat weekly
order value (the value of the repeat items, before any delivery fee):

    Silver  — order of £5.00 to £9.99  → fee_standard        (default £12)
    Gold    — order of £10.00 or more  → fee_target          (default £20)

paid up front, plus a retention payment when that customer is still ordering
in their 4th week:

    Silver  → retention_standard   (default £5)
    Gold    → retention_target     (default £8)

A sign-up on either tier can also take The Round, Modern Milkman's
membership, which adds `fee_membership` (default £8) for the BA.

A sign-up that FAILS pays nothing: the customer cancels before their first
delivery, the first delivery is more than 8 days away, the order is under
£5, or there are no repeat items on it.

The office (the Marketing Company, MC) is paid its own fee for every sign-up:
`fee_mc`. It is the office's figure, not a BA's: Bells shows the MC fees
column to Admins only, and the rates endpoint leaves the knob out for
everyone else. It ships at 0 until the Owner enters it in Earnings → Rates.

Bells records, per day: `under30` = Silver sign-ups, `over30` = Gold
sign-ups, `memberships` = sign-ups that took The Round. The field names are
kept from the original data model; a membership is an add-on to a sign-up,
never a sign-up of its own.

The per-office knobs are stored in the `commission_fees` collection (one doc
per office). Documents written by an earlier pay model are tolerated: any
key that is not a valid knob is ignored and the default is used instead. The
frontend mirrors these formulas in frontend/src/pay/vertexPay.ts — change
both together.
"""
from __future__ import annotations

import math
from typing import Any, Optional

DEFAULT_FEES: dict[str, float] = {
    "fee_standard": 12,
    "fee_target": 20,
    "fee_membership": 8,
    "retention_standard": 5,
    "retention_target": 8,
    "fee_mc": 0,
}

# Knobs only an Admin is shown (the office's own income, not a BA's).
ADMIN_ONLY_FEE_KEYS: tuple[str, ...] = ("fee_mc",)

FEE_KEYS: tuple[str, ...] = tuple(DEFAULT_FEES)

# Inclusive bounds per knob. Money is whole or part pounds.
_BOUNDS: dict[str, tuple[float, float]] = {
    "fee_standard": (0, 1000),
    "fee_target": (0, 1000),
    "fee_membership": (0, 1000),
    "retention_standard": (0, 1000),
    "retention_target": (0, 1000),
    "fee_mc": (0, 1000),
}
_INT_KEYS: set[str] = set()


def _as_number(v: Any) -> Optional[float]:
    """A finite number, or None. Booleans and dicts (old nested tiers) are not numbers."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            f = float(v.strip())
        except ValueError:
            return None
    else:
        return None
    return f if math.isfinite(f) else None


def _tidy(key: str, f: float) -> float | int:
    if key in _INT_KEYS:
        return int(round(f))
    return int(f) if float(f).is_integer() else round(f, 2)


def normalize_fees(doc: Optional[dict]) -> dict:
    """The office's knobs: stored values where valid, defaults elsewhere.

    Never raises — an old-shape or partly-filled document just falls back to
    the defaults for whatever it lacks."""
    out: dict = dict(DEFAULT_FEES)
    if not isinstance(doc, dict):
        return out
    for key in FEE_KEYS:
        f = _as_number(doc.get(key))
        if f is None:
            continue
        lo, hi = _BOUNDS[key]
        if lo <= f <= hi:
            out[key] = _tidy(key, f)
    return out


def clean_fee_update(body: Any) -> dict:
    """Validate an admin's fee edit. Unknown keys are dropped; a known key with
    a missing/invalid value raises ValueError (so the editor can say which)."""
    if not isinstance(body, dict):
        raise ValueError("Send the fees as a JSON object")
    out: dict = {}
    for key in FEE_KEYS:
        if key not in body:
            continue
        f = _as_number(body.get(key))
        lo, hi = _BOUNDS[key]
        if f is None or not (lo <= f <= hi):
            raise ValueError(f"{key} must be a number from {int(lo)} to {int(hi)}")
        out[key] = _tidy(key, f)
    return out


def mc_fees(sign_ups: float, fees: Optional[dict]) -> float:
    """The office's (MC's) fees for a number of sign-ups, at `fee_mc` each."""
    return round(max(0.0, float(sign_ups or 0)) * float(normalize_fees(fees)["fee_mc"]), 2)


def sign_up_fees(standard: float, target: float, fees: Optional[dict], memberships: float = 0) -> dict:
    """A BA's UP-FRONT fees for a week of Bells: Silver sign-ups at
    fee_standard, Gold sign-ups at fee_target, plus fee_membership for each
    sign-up that took The Round. Before the week-4 retention payments (Bells
    does not record which customers reach week 4; the Earnings Calculator
    estimates those) and before any fails are taken off.

    Memberships are an add-on to a sign-up, so no more of them are paid than
    there are sign-ups."""
    f = normalize_fees(fees)
    standard = max(0.0, float(standard or 0))
    target = max(0.0, float(target or 0))
    memberships = min(max(0.0, float(memberships or 0)), standard + target)
    standard_earnings = standard * float(f["fee_standard"])
    target_earnings = target * float(f["fee_target"])
    membership_earnings = memberships * float(f["fee_membership"])
    return {
        "fee_standard": f["fee_standard"],
        "fee_target": f["fee_target"],
        "fee_membership": f["fee_membership"],
        "standard_count": int(standard),
        "target_count": int(target),
        "membership_count": int(memberships),
        "standard_earnings": round(standard_earnings, 2),
        "target_earnings": round(target_earnings, 2),
        "membership_earnings": round(membership_earnings, 2),
        "sign_up_fees": round(standard_earnings + target_earnings + membership_earnings, 2),
    }


def retention_fees(standard_kept: float, target_kept: float, fees: Optional[dict]) -> dict:
    """Week-4 retention payments for customers still ordering in their 4th
    week: Silver at retention_standard, Gold at retention_target."""
    f = normalize_fees(fees)
    standard_kept = max(0.0, float(standard_kept or 0))
    target_kept = max(0.0, float(target_kept or 0))
    standard_earnings = standard_kept * float(f["retention_standard"])
    target_earnings = target_kept * float(f["retention_target"])
    return {
        "retention_standard": f["retention_standard"],
        "retention_target": f["retention_target"],
        "standard_kept": int(standard_kept),
        "target_kept": int(target_kept),
        "standard_earnings": round(standard_earnings, 2),
        "target_earnings": round(target_earnings, 2),
        "retention_fees": round(standard_earnings + target_earnings, 2),
    }
