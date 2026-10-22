"""Bunny hops, solos and shadows on a sector (the Owner's call, 22 Oct 2026).

A sector's people are split into lines, like the office whiteboard:

    Jon - Dan (Val)        a bunny hop of Jon and Dan, with Val shadowing
    Louis                  a solo: a one-person hop, the same in every way
    Liam - AB              another bunny hop

Each line is a hop with its own colour (routes.coverage.HOP_COLOURS, in
order) that its people draw in on the sector map. A shadow is out with the
hop for the day, watching (a new start's first field day): no sales goal,
Bells reads SD (shadow day), left out of scoring and piece average.

Stored on the sector as hops: [{colour, member_ids, shadow_ids}], with
shadow_ids a subset of member_ids.
"""
from __future__ import annotations

from typing import Iterable, Optional


def _colours() -> list[str]:
    from routes.coverage import HOP_COLOURS
    return list(HOP_COLOURS)


def clean_lines(lines: Iterable, members: Iterable[str]) -> list[dict]:
    """Lines from the planner → hops. Only the sector's people, each once;
    empty lines dropped; a colour each in order; at most one line per colour."""
    allowed = {str(m) for m in members}
    seen: set[str] = set()
    out: list[dict] = []
    colours = _colours()
    for line in lines or []:
        if len(out) >= len(colours):
            break
        line = line or {}
        ids = [i for i in dict.fromkeys(str(x) for x in (line.get("member_ids") or []))
               if i in allowed and i not in seen]
        if not ids:
            continue
        shadows = [i for i in dict.fromkeys(str(x) for x in (line.get("shadow_ids") or [])) if i in ids]
        if len(shadows) == len(ids):
            # A line of only shadows has nobody to watch: they work it as a solo.
            shadows = []
        seen.update(ids)
        out.append({"colour": colours[len(out)], "member_ids": ids, "shadow_ids": shadows})
    return out


def keep_shadows(new_hops: list[dict], old_hops: list[dict]) -> list[dict]:
    """The leader re-sets hops on their map (which knows nothing of shadows):
    anyone who was a shadow and is still in a hop stays a shadow."""
    was = {i for h in old_hops or [] for i in (h.get("shadow_ids") or [])}
    for h in new_hops:
        ids = h.get("member_ids") or []
        shadows = [i for i in ids if i in was]
        h["shadow_ids"] = shadows if len(shadows) < len(ids) else []
    return new_hops


def shadow_ids(sec: Optional[dict]) -> set[str]:
    return {str(i) for h in (sec or {}).get("hops") or [] for i in (h.get("shadow_ids") or [])}


def _first(n: str) -> str:
    return (n or "").strip().split(" ")[0]


def _and(names: list[str]) -> str:
    names = [n for n in names if n]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1] if names else ""


def describe(sec: Optional[dict], uid: str, names: dict) -> Optional[str]:
    """'With Dan · Blue', 'On a solo · Green', 'Shadowing Jon and Dan · Blue',
    or None when they're not on a line."""
    for h in (sec or {}).get("hops") or []:
        ids = [str(i) for i in h.get("member_ids") or []]
        if uid not in ids:
            continue
        colour = (h.get("colour") or "").capitalize()
        shadows = {str(i) for i in h.get("shadow_ids") or []}
        workers = [i for i in ids if i not in shadows]
        if uid in shadows:
            return f"Shadowing {_and([_first(names.get(i, '')) for i in workers])} · {colour}"
        others = [_first(names.get(i, '')) for i in workers if i != uid]
        watching = [_first(names.get(i, '')) for i in ids if i in shadows]
        tail = f" (with {_and(watching)} shadowing)" if watching else ""
        return (f"With {_and(others)} · {colour}" if others else f"On a solo · {colour}") + tail
    return None


async def sync_shadow_days(office_id: str, iso: str, before: Iterable[dict], after: Iterable[dict]) -> None:
    """Bells for the day: a shadow reads SD (shadow day); someone who was a
    shadow and isn't any more goes back to In. A day with sign-ups on it, or
    marked Not scheduled / No show / In office, is left alone."""
    from datetime import date, timedelta
    from bson import ObjectId
    from database import db
    from owneriq_performance import _bells_entry
    was = set().union(*[shadow_ids(s) for s in before]) if before else set()
    now = set().union(*[shadow_ids(s) for s in after]) if after else set()
    changes = {i: "sd" for i in now - was} | {i: "in" for i in was - now}
    if not changes:
        return
    d = date.fromisoformat(iso)
    week_ending = (d + timedelta(days=6 - d.weekday())).isoformat()
    idx = d.weekday()
    ids = [ObjectId(i) for i in changes if ObjectId.is_valid(i)]
    async for u in db.users.find({"_id": {"$in": ids}, "office_id": office_id}):
        want = changes[str(u["_id"])]
        entry = await _bells_entry(u, week_ending)
        if not entry:
            continue
        days = list(entry.get("days") or [])
        while len(days) < 7:
            days.append({"over30": None, "under30": None, "memberships": None, "status": "off"})
        day = dict(days[idx] or {})
        has_sales = any(day.get(k) for k in ("over30", "under30", "memberships"))
        st = day.get("status")
        if want == "sd" and (has_sales or st not in (None, "off", "normal", "in")):
            continue
        if want == "in" and st != "sd":
            continue
        day["status"] = want
        days[idx] = day
        await db.bells_entries.update_one({"office_id": entry.get("office_id"), "week_ending": week_ending,
                                           "user_id": str(u["_id"])}, {"$set": {"days": days}})
