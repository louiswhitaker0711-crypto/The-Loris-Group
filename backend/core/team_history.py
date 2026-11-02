"""Teams as they were (the Owner, 2 Nov 2026).

Every past week shows the teams the way they stood that week: exit a leader
today and this week their people sit under the leader above, while last week
still shows the old team with everyone in it.

How: every change to someone's Coach (`users.reports_to`) is logged in
`team_moves` as {user_id, office_id, from, to, on (UK date), why}. A move on
day D counts from D. Someone's Coach as at day X is the `from` of their first
move after X, or their current Coach if nothing has moved since.

The current week always reads live; only weeks that have ended use history.
Moves from before this log existed can be put back with the Admin
"Who was on their team?" fix (`routes/team_history.py`).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from core.app_time import APP_TZ

GRACE_DAYS = 28


def today_iso() -> str:
    return datetime.now(APP_TZ).date().isoformat()


def current_week_ending(today: Optional[str] = None) -> str:
    d = date.fromisoformat(today or today_iso())
    return (d + timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def as_at_for_week(week_ending: Optional[str], today: Optional[str] = None) -> Optional[str]:
    """The day a week's teams are read at: its last day once it has ended,
    else None (read live)."""
    if not week_ending:
        return None
    we = str(week_ending)[:10]
    return we if we < current_week_ending(today) else None


def _norm(pid) -> Optional[str]:
    return str(pid) if pid else None


async def record_move(db, user_id: str, office_id: Optional[str], from_parent, to_parent,
                      why: str = "", on: Optional[str] = None) -> None:
    """Log a change of Coach. Best effort: a missed log only means that one
    past week shows the later team."""
    f, t = _norm(from_parent), _norm(to_parent)
    if f == t:
        return
    try:
        await db.team_moves.insert_one({
            "user_id": str(user_id), "office_id": office_id, "from": f, "to": t,
            "on": (on or today_iso())[:10], "why": why,
            "logged_at": datetime.utcnow().isoformat(),
        })
    except Exception:
        pass


async def set_coach(db, user: dict, new_parent, why: str = "") -> None:
    """Change someone's Coach and log it. `new_parent` None clears it."""
    uid = user["_id"]
    new = _norm(new_parent)
    if new:
        await db.users.update_one({"_id": uid}, {"$set": {"reports_to": new}})
    else:
        await db.users.update_one({"_id": uid}, {"$unset": {"reports_to": ""}})
    await record_move(db, str(uid), user.get("office_id"), user.get("reports_to"), new, why)


def parents_at(current: dict, moves: Iterable[dict], as_at: str) -> dict:
    """uid -> Coach on `as_at`, from today's Coaches and the move log."""
    first_after: dict = {}
    for m in moves:
        on = str(m.get("on") or "")[:10]
        if on <= as_at:
            continue
        uid = m.get("user_id")
        prev = first_after.get(uid)
        key = (on, str(m.get("logged_at") or ""))
        if prev is None or key < prev[0]:
            first_after[uid] = (key, m.get("from"))
    out = dict(current)
    for uid, (_k, frm) in first_after.items():
        out[uid] = _norm(frm)
    return out


def was_here(user: dict, as_at: str) -> bool:
    """On the books on `as_at`: not exited before it."""
    if not (user.get("deleted") or user.get("is_active") is False):
        return True
    left = str(user.get("left_on") or user.get("deleted_at") or "")[:10]
    return bool(left) and left >= as_at


async def office_history(db, office_ids: Iterable[str], as_at: str):
    """Everyone in the offices (exited too), and Coaches as at each of the 4
    weeks ending on `as_at` (for the 4-week team rule).

    Returns (users_by_id, parents_by_day) where parents_by_day maps the day
    (as_at, as_at-7, as_at-14, as_at-21) to {uid: Coach}.
    """
    offices = [o for o in office_ids if o]
    q = {"office_id": {"$in": offices}} if offices else {}
    users: dict = {}
    async for u in db.users.find(q, {"_id": 1, "name": 1, "team_name": 1, "team_logo": 1, "reports_to": 1,
                                     "role": 1, "deleted": 1, "is_active": 1, "left_on": 1, "deleted_at": 1,
                                     "office_id": 1, "is_demo": 1}):
        users[str(u["_id"])] = u
    current = {uid: _norm(u.get("reports_to")) for uid, u in users.items()}
    earliest = (date.fromisoformat(as_at) - timedelta(days=21)).isoformat()
    moves = []
    mq = {"on": {"$gt": earliest}}
    if offices:
        mq["office_id"] = {"$in": offices}
    async for m in db.team_moves.find(mq, {"_id": 0}):
        moves.append(m)
    days = [(date.fromisoformat(as_at) - timedelta(days=7 * k)).isoformat() for k in range(4)]
    return users, {d: parents_at(current, moves, d) for d in days}


def leaders_at(users: dict, parents_by_day: dict, as_at: str) -> set:
    """Who had a team on `as_at`: someone on their team that day, or within
    the 4 weeks before it."""
    out: set = set()
    for day, parents in parents_by_day.items():
        if day > as_at:
            continue
        for uid, p in parents.items():
            u = users.get(uid)
            if p and u and not u.get("is_demo") and was_here(u, day) and p in users:
                out.add(p)
    # Someone exited that day has no team from then on.
    return {p for p in out if was_here(users[p], as_at)}


async def subtree_at(db, office_id: str, root: str, as_at: str) -> list:
    """Everyone under `root` (and root) as the team stood on `as_at`."""
    users, by_day = await office_history(db, [office_id], as_at)
    parents = by_day[as_at]
    kids: dict = {}
    for uid, p in parents.items():
        if p and was_here(users.get(uid) or {}, as_at):
            kids.setdefault(p, []).append(uid)
    out, stack, seen = [], [root], set()
    while stack:
        x = stack.pop()
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
        stack.extend(kids.get(x, []))
    return out


async def parents_for_week(db, office_id: Optional[str], week_ending: Optional[str]) -> Optional[dict]:
    """{uid: Coach} as a week that has ended stood, or None for the current week."""
    as_at = as_at_for_week(week_ending)
    if not as_at:
        return None
    _users, by_day = await office_history(db, [office_id] if office_id else [], as_at)
    return by_day[as_at]
