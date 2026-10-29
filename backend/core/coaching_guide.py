"""Today's coaching guide (the Owner, 29 Oct 2026).

A Coach with a new start shouldn't wade through every topic every day. The
day's Manual page is compared with yesterday's, and each of today's topics is

  * new        — not on yesterday's page: teach it today (full guide);
  * keep       — on yesterday's page too: one line, with a notice when what's
                 expected has changed (e.g. yesterday Know, today Do).

Two flags come from how they were graded on earlier days:

  * behind     — a topic whose latest grade is Not Learnt: go back over it
                 first ("Didn't land yet"). A pass is never behind.
  * ahead      — a topic of today's already graded above today's expectation.

Topics are matched by name, ignoring case, so a Manual page edited in the app
still lines up. Pure functions here; routes/coaching_today.py feeds them.
"""
from __future__ import annotations

from typing import Iterable, Optional

_LEVEL = {
    "not learnt": 0, "not learned": 0, "": 0,
    "learnt": 1, "learned": 1, "understand": 1, "know": 1, "aware": 1,
    "do": 2, "practise": 2, "practice": 2, "assisted": 2,
    "deliver": 3, "teach": 3, "master": 3, "independent": 3,
}


def level(grade: Optional[str]) -> int:
    return _LEVEL.get(str(grade or "").strip().lower(), 1)


def _key(topic: Optional[str]) -> str:
    return " ".join(str(topic or "").lower().split())


def classify(today: list[dict], yesterday: Iterable[dict]) -> list[dict]:
    """Each of today's items with `status` ('new' | 'keep') and, for a kept
    one whose expectation moved, `changed_from` (yesterday's expectation)."""
    prev = {_key(y.get("topic")): y for y in yesterday or []}
    out = []
    for it in today:
        y = prev.get(_key(it.get("topic")))
        row = dict(it)
        if y is None:
            row["status"], row["changed_from"] = "new", None
        else:
            before, now = str(y.get("confidence_expected") or ""), str(it.get("confidence_expected") or "")
            row["status"] = "keep"
            row["changed_from"] = before if before and now and before.strip().lower() != now.strip().lower() else None
        out.append(row)
    return out


def latest_grades(past: Iterable[dict]) -> dict[str, dict]:
    """The most recent grade per topic from earlier days: past rows are
    {topic, grade, expected, day} (any order); the latest day wins."""
    best: dict[str, dict] = {}
    for p in past or []:
        if not p.get("grade"):
            continue
        k = _key(p.get("topic"))
        if k and (k not in best or int(p.get("day") or 0) >= int(best[k].get("day") or 0)):
            best[k] = p
    return best


_SCALE = {"know", "do", "deliver"}      # the field-day grades; Academy days are Learnt / Not Learnt


def flags(today: list[dict], past: Iterable[dict]) -> tuple[list[dict], list[dict]]:
    """(today's items with `ahead` set, the behind list).

    behind: topics whose latest grade is Not Learnt — a real miss. A pass
    ("Learnt" on an Academy day, or any Know/Do/Deliver) is never behind.
    ahead: today's topics already graded on the field scale (Know/Do/Deliver)
    above today's aim."""
    latest = latest_grades(past)
    behind = []
    for k, p in latest.items():
        if level(p.get("grade")) == 0:
            behind.append({"topic": p.get("topic") or k, "grade": p.get("grade"), "expected": p.get("expected") or None,
                           "day": p.get("day")})
    behind.sort(key=lambda b: (b.get("day") or 0))
    out = []
    for it in today:
        p = latest.get(_key(it.get("topic")))
        g = str((p or {}).get("grade") or "").strip().lower()
        row = dict(it)
        row["ahead"] = bool(p and g in _SCALE and level(g) > level(it.get("confidence_expected")))
        out.append(row)
    return out, behind
