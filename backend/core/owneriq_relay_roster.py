"""The OwnerIQ people list as the browser relay last sent it.

The relay posts the office's /v2/users roster every 15 minutes (it already
uses it to refresh links and stages). The server can't fetch that list itself
while the relay is in charge (OwnerIQ's edge blocks the server's IP), so the
screens that need the whole list — Admin → "Add the team from OwnerIQ" and the
roster check page — read this copy instead.

Only the fields those screens use are kept, per person: id, name, email,
badge numbers, stage, parent and active.
"""
from datetime import datetime, timezone
from typing import Optional

from database import db

_ID = "latest"
_KEEP = ("full_name", "name", "email", "badge_number", "badge_number_list", "stage", "parent_id", "active")


def _trim(user: dict) -> dict:
    a = user.get("attributes") or {}
    return {"id": user.get("id"), "attributes": {k: a.get(k) for k in _KEEP if k in a}}


async def store(payloads: list, pins: Optional[list] = None) -> int:
    """Save the relayed roster pages, each tagged with its office pin (None
    when the script didn't say). Returns how many people were kept."""
    pins = list(pins or [])
    offices: list[dict] = []
    total = 0
    for i, payload in enumerate(payloads or []):
        rows = [_trim(u) for u in ((payload or {}).get("data") or []) if u and u.get("id") is not None]
        pin = pins[i] if i < len(pins) and pins[i] not in (None, "") else None
        offices.append({"pin": str(pin) if pin is not None else None, "users": rows})
        total += len(rows)
    await db.owneriq_relay_roster.update_one(
        {"_id": _ID},
        {"$set": {"offices": offices, "stored_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    return total


async def offices() -> Optional[list[dict]]:
    """[{pin, users: [JSON:API user rows]}] from the relay's last roster, or
    None when the relay isn't feeding the app (then callers fetch as before)."""
    from core.owneriq_session import relay_active
    if not await relay_active():
        return None
    doc = await db.owneriq_relay_roster.find_one({"_id": _ID})
    return (doc or {}).get("offices") or None


async def payload_for(pin: Optional[str]) -> Optional[dict]:
    """One office's roster as a /v2/users-shaped payload ({"data": [...]}), or
    None when the relay isn't feeding the app. With a single office, or when
    the script didn't tag pins, that office's list is used whatever the pin."""
    offs = await offices()
    if offs is None:
        return None
    match = [o for o in offs if pin is not None and o.get("pin") == str(pin)]
    if not match and (len(offs) == 1 or all(o.get("pin") is None for o in offs)):
        match = offs
    rows: dict = {}
    for o in match:
        for u in o.get("users") or []:
            rows[str(u.get("id"))] = u
    return {"data": list(rows.values())}
