"""Add the team from OwnerIQ: create app accounts for the people in the
office's OwnerIQ tree who aren't in the app yet.

Read-only towards OwnerIQ (it reads the roster: /v2/users). For each active
person in the office's company it works out:

  • already in the app   — an app account is linked to them already (stored
                           OwnerIQ id, the same email, or a badge number)
  • can't add            — OwnerIQ has no email for them (an app login needs one)
  • new                  — can be added: name, email and badge numbers from
                           OwnerIQ; Coach if they are stage 3 or above in
                           OwnerIQ, otherwise BA; their coach is their parent
                           in the OwnerIQ tree

`plan_import` is pure (roster + app users → rows); `apply_import` creates the
accounts the admin ticked. New accounts get the starter password the admin
types (a shared first-login password: on first login each person must choose
their own, see routes/auth_routes.py), are linked to OwnerIQ by id and badge,
and are NOT put through the Day 1–8 BA Academy (they're existing team
members; brand-new starters are added with Add Coach / BA instead).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from auth import MIN_PASSWORD_LENGTH, hash_password

BADGE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,23}$")
STARTER_DAYS_DEFAULT = 7


def _stage_num(stage) -> Optional[float]:
    """'stage_3' → 3, 'stage_3_plus' → 3.5, None/unknown → None."""
    if stage in (None, ""):
        return None
    s = str(stage).lower().replace("stage_", "").strip()
    m = re.match(r"(\d+)", s)
    if not m:
        return None
    return int(m.group(1)) + (0.5 if s.endswith("_plus") else 0.0)


def _norm_email(v) -> str:
    return str(v or "").strip().lower()


def _badges(attrs: dict) -> list[str]:
    out: list[str] = []
    raw = [str(attrs.get("badge_number") or "")] + re.split(r"[,;\s]+", str(attrs.get("badge_number_list") or ""))
    for b in raw:
        b = b.strip().upper()
        if b and BADGE_RE.match(b) and b not in out:
            out.append(b)
    return out


def parse_roster(payload: dict) -> list[dict]:
    """OwnerIQ /v2/users JSON:API payload → plain people."""
    people = []
    for u in (payload or {}).get("data") or []:
        a = u.get("attributes") or {}
        people.append({
            "owneriq_user_id": str(u.get("id")),
            "name": str(a.get("full_name") or a.get("name") or "").strip(),
            "email": _norm_email(a.get("email")),
            "badges": _badges(a),
            "stage": a.get("stage"),
            "parent_id": (str(a["parent_id"]) if a.get("parent_id") not in (None, 0, "0", "") else None),
            "active": bool(a.get("active")),
        })
    return people


def owner_node(people: list[dict], skip_roots: Iterable[str] = ()) -> Optional[str]:
    """The office owner in the tree: the active top-level account (no parent)
    with the most direct reports (same rule as owneriq_write.pick_owner_node)."""
    skip = {str(x) for x in skip_roots}
    children: dict[str, int] = {}
    for p in people:
        if p["parent_id"]:
            children[p["parent_id"]] = children.get(p["parent_id"], 0) + 1
    roots = [p["owneriq_user_id"] for p in people if p["active"] and not p["parent_id"]]
    pool = [r for r in roots if r not in skip] or roots
    if not pool:
        return None
    return max(pool, key=lambda oid: children.get(oid, 0))


def plan_import(people: list[dict], app_users: list[dict], owner_oid: Optional[str] = None) -> list[dict]:
    """One row per active OwnerIQ person (the owner node left out).

    app_users: live app accounts with `_id`, `name`, `email`, `amplifi_codes`,
    `owneriq_user_id`. Matching is by stored OwnerIQ id, then email, then badge
    number — never by name."""
    by_oid = {str(u["owneriq_user_id"]): u for u in app_users if u.get("owneriq_user_id")}
    by_email = {_norm_email(u.get("email")): u for u in app_users if u.get("email")}
    by_badge: dict[str, dict] = {}
    for u in app_users:
        for b in u.get("amplifi_codes") or []:
            by_badge[str(b).strip().upper()] = u
    names = {p["owneriq_user_id"]: p["name"] for p in people}
    rows = []
    for p in people:
        oid = p["owneriq_user_id"]
        if not p["active"] or oid == owner_oid:
            continue
        match = by_oid.get(oid) or (by_email.get(p["email"]) if p["email"] else None) \
            or next((by_badge[b] for b in p["badges"] if b in by_badge), None)
        stage = _stage_num(p["stage"])
        if match:
            status = "in_app"
        elif not p["email"] or "@" not in p["email"]:
            status = "no_email"
        else:
            status = "new"
        rows.append({
            "owneriq_user_id": oid,
            "name": p["name"] or "(no name in OwnerIQ)",
            "email": p["email"],
            "badges": p["badges"],
            "stage": p["stage"],
            "role": "leader" if (stage or 0) >= 3 else "trainee",
            "coach_owneriq_id": p["parent_id"],
            "coach_name": names.get(p["parent_id"]) if p["parent_id"] else None,
            # Top-level accounts that aren't the owner are often admins,
            # agency staff or applicants: listed, but not ticked by default.
            "in_tree": bool(p["parent_id"]),
            "status": status,
            "app_user_id": str(match["_id"]) if match else None,
            "app_user_name": match.get("name") if match else None,
        })
    order = {"new": 0, "no_email": 1, "in_app": 2}
    rows.sort(key=lambda r: (order[r["status"]], not r["in_tree"], r["role"] != "leader", r["name"].lower()))
    return rows


async def apply_import(database, *, office_id: str, admin: dict, rows: list[dict],
                       picks: list[dict], starter_password: str,
                       days: int = STARTER_DAYS_DEFAULT) -> dict:
    """Create the picked `new` rows. picks: [{owneriq_user_id, role}]."""
    if len(starter_password or "") < MIN_PASSWORD_LENGTH:
        raise ValueError(f"The starter password must be at least {MIN_PASSWORD_LENGTH} characters")
    days = max(1, min(int(days or STARTER_DAYS_DEFAULT), 30))
    row_by_oid = {r["owneriq_user_id"]: r for r in rows}
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(days=days)).isoformat()
    pw_hash = hash_password(starter_password)

    created, skipped = [], []
    oid_to_app: dict[str, str] = {r["owneriq_user_id"]: r["app_user_id"] for r in rows if r.get("app_user_id")}
    for pick in picks or []:
        oid = str(pick.get("owneriq_user_id") or "")
        row = row_by_oid.get(oid)
        if not row or row["status"] != "new":
            skipped.append({"owneriq_user_id": oid, "name": (row or {}).get("name"), "reason": "not available to add"})
            continue
        role = pick.get("role") if pick.get("role") in ("leader", "trainee") else row["role"]
        if await database.users.find_one({"email": row["email"]}, {"_id": 1}):
            skipped.append({"owneriq_user_id": oid, "name": row["name"], "reason": "that email already has an account"})
            continue
        badges = []
        for b in row["badges"]:
            taken = await database.users.find_one(
                {"amplifi_codes": {"$regex": f"^{re.escape(b)}$", "$options": "i"}, "deleted": {"$ne": True}},
                {"_id": 1})
            if not taken:
                badges.append(b)
        doc = {
            "email": row["email"],
            "password_hash": pw_hash,
            "name": row["name"],
            "role": role,
            "office_id": office_id,
            "email_verified": True,
            "reports_to": None,
            "amplifi_codes": badges,
            "owneriq_user_id": oid,
            "owneriq_stage": row.get("stage"),
            "must_change_password": True,
            "starter_password_set_at": now.isoformat(),
            "starter_password_expires_at": expires,
            "created_at": now.isoformat(),
            "created_by_admin_id": admin.get("id"),
            "created_from": "owneriq_import",
        }
        res = await database.users.insert_one(doc)
        oid_to_app[oid] = str(res.inserted_id)
        created.append({"owneriq_user_id": oid, "id": str(res.inserted_id), "name": row["name"],
                        "email": row["email"], "role": role, "badges": badges})

    # Second pass: each new person's coach is their parent in the OwnerIQ tree,
    # when that parent is a Coach or Admin in this office (new or existing).
    for c in created:
        parent_oid = row_by_oid[c["owneriq_user_id"]].get("coach_owneriq_id")
        parent_app = oid_to_app.get(parent_oid) if parent_oid else None
        if not parent_app:
            continue
        from bson import ObjectId
        try:
            parent = await database.users.find_one({"_id": ObjectId(parent_app)}, {"role": 1, "office_id": 1, "name": 1})
        except Exception:
            parent = None
        if parent and parent.get("role") in ("leader", "admin") and parent.get("office_id") == office_id:
            await database.users.update_one({"_id": ObjectId(c["id"])}, {"$set": {"reports_to": parent_app}})
            c["coach_name"] = parent.get("name")
    return {"created": created, "skipped": skipped, "starter_password_expires_at": expires, "days": days}
