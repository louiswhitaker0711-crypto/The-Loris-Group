"""OwnerIQ DataByte / Field KPIs endpoints.

  POST /api/owneriq/sync       (admin)         run a sync now; optional {from,to}
  GET  /api/owneriq/status     (admin/leader)  last-sync heartbeat
  GET  /api/owneriq/kpis       (scoped)        raw stored rows for a date range
  GET  /api/owneriq/summary    (scoped)        totals + averages + ratios-to-one-sale
  GET  /api/owneriq/averages   (scoped)        own + team avg/day (team-plan integration)

Scope is derived from the caller's role (never trusted from the client):
  • trainee → self only          • leader → self + downline subtree
  • admin   → their office        • super-admin → everything

Reps are linked to CG1 users by BADGE NUMBER (AMPB…) at sync time, so all
scoping/averaging keys off the canonical badge id.
"""
import logging
import re
import time
from datetime import date, datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import require_admin, require_super_admin, get_current_user, get_subtree_ids, sees_whole_office
from database import db
from owneriq_sync import sync_owneriq, aggregate_rows, OwnerIQError, _build_rep_resolvers, _norm_name, ID_LINKED, is_oid
from owneriq_sync import _client  # noqa: E402
from owneriq_live import (
    get_live_operations, get_sector, get_ba, compile_funnel,
    sector_pin, sector_office_name, today_iso,
)

logger = logging.getLogger(__name__)
router = APIRouter()

from core.app_time import APP_TZ
from core.rate_limit import Limiter


def _yesterday_iso() -> str:
    return (datetime.now(APP_TZ).date() - timedelta(days=1)).isoformat()


def _norm_range(from_date: Optional[str], to_date: Optional[str]) -> tuple[str, str]:
    """Default both ends to yesterday (the admin default); range if given."""
    if not from_date and not to_date:
        d = _yesterday_iso()
        return d, d
    to_date = to_date or from_date
    from_date = from_date or to_date
    if from_date > to_date:
        from_date, to_date = to_date, from_date
    return from_date, to_date


async def _office_pin(office_id: str | None) -> str | None:
    """Map an app office to its OwnerIQ marketing-company pin (office doc
    `owneriq_pin`, OWNERIQ_OFFICE_PINS, or discovery — see owneriq_config)."""
    from owneriq_config import office_pin
    return await office_pin(office_id, db)


async def _scoped_rows(caller: dict, from_date: str, to_date: str, own_office: bool = False) -> list[dict]:
    """Fetch owneriq_kpis rows the caller is allowed to see, within the range.

    own_office=True forces even a super-admin down to their OWN office (used by
    the Home LOA card, where each office admin must see only their own office).
    Admins are scoped by their office's mc_pin directly, so it works regardless
    of whether individual reps are badge-linked yet."""
    date_q = {"date": {"$gte": from_date, "$lte": to_date}}
    role = caller.get("role")
    is_super = bool(caller.get("is_super_admin"))
    proj = {"_id": 0}

    if is_super and not own_office:
        return await db.owneriq_kpis.find(date_q, proj).to_list(length=20000)

    if sees_whole_office(caller):   # an Admin, or a Coach+
        pin = await _office_pin(caller.get("office_id"))
        if pin:
            return await db.owneriq_kpis.find({**date_q, "mc_pin": pin}, proj).to_list(length=20000)
        # No resolvable office pin: fall back to this office's linked users.
        office_ids = [
            str(u["_id"])
            async for u in db.users.find(
                {"office_id": caller.get("office_id"), "deleted": {"$ne": True}}, {"_id": 1}
            )
        ] if caller.get("office_id") else []
        return await db.owneriq_kpis.find(
            {**date_q, "cg1_user_id": {"$in": office_ids}, **ID_LINKED}, proj
        ).to_list(length=20000)

    # leader → self + downline; trainee → self only
    if role == "leader":
        allowed = await get_subtree_ids(caller["id"])
    else:
        allowed = [caller["id"]]
    return await db.owneriq_kpis.find(
        {**date_q, "cg1_user_id": {"$in": allowed}, **ID_LINKED}, proj
    ).to_list(length=20000)



@router.get("/owneriq/connect")
async def owneriq_connect_status(request: Request):
    """The Reconnect screen's state (never the token). Owner only."""
    await require_super_admin(request)
    from core.owneriq_session import status
    return await status()


class _PasteBody(BaseModel):
    token: str


@router.post("/owneriq/connect")
async def owneriq_connect(request: Request, body: _PasteBody):
    """The Owner pastes a session token (bare, 'Bearer …', or the whole
    auth-storage value). Verify and save it. Owner only."""
    await require_super_admin(request)
    from core.owneriq_session import reconnect
    from owneriq_sync import _client
    try:
        async with _client(timeout=30.0) as client:
            return await reconnect(client, body.token)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.post("/owneriq/connect/off")
async def owneriq_turn_off(request: Request):
    """Switch OwnerIQ off and run on the breakdowns. Owner only."""
    await require_super_admin(request)
    from core.owneriq_session import turn_off
    return await turn_off()


@router.post("/owneriq/connect/retry")
async def owneriq_connect_retry(request: Request):
    """False alarm: clear the stopped state and let one password sign-in run
    (only works while MFA isn't on the account). Owner only."""
    await require_super_admin(request)
    from core.owneriq_session import retry_password
    return await retry_password()


# ── Browser relay ────────────────────────────────────────────────────────────
# The UK/EU edge blocks server-to-server calls to the owner API, so the Owner's
# own logged-in browser fetches the data (its real-browser request is allowed)
# and POSTs it here. These endpoints take the RAW OwnerIQ payloads and feed them
# into exactly the stores the server sync would (owneriq_kpis, owneriq_live_cache),
# so every screen fills in with no change to the read paths. Authorised by a
# shared secret in the body (OWNERIQ_RELAY_SECRET) — not a logged-in session,
# because the post comes cross-origin from the owner-iq.ai tab. See
# docs/owneriq-browser-relay.user.js.
import os as _os
import json as _json
import secrets as _secrets


def _relay_secret() -> str:
    return (_os.getenv("OWNERIQ_RELAY_SECRET") or "").strip()


async def _relay_body(request: Request) -> dict:
    """Parse + authorise a relay POST. The body is text/plain JSON (a 'simple'
    cross-origin request, so the browser sends it with no CORS preflight)."""
    secret = _relay_secret()
    if len(secret) < 16:
        raise HTTPException(status_code=503, detail="Relay is not configured (set OWNERIQ_RELAY_SECRET).")
    try:
        data = _json.loads((await request.body()) or b"{}")
    except Exception:
        raise HTTPException(status_code=400, detail="Bad JSON body.")
    supplied = str((data or {}).get("secret") or "")
    if not supplied or not _secrets.compare_digest(supplied.encode(), secret.encode()):
        raise HTTPException(status_code=403, detail="Bad relay secret.")
    return data


@router.post("/owneriq/relay/kpis")
async def owneriq_relay_kpis(request: Request):
    """Browser relay: raw door_interaction_kpis page payloads → owneriq_kpis.
    Body: {secret, from, to, payloads:[<raw JSON:API page>, ...]}."""
    data = await _relay_body(request)
    from owneriq_sync import _parse_kpi_payload, ingest_kpi_rows
    from core.owneriq_session import mark_relay_ingest
    iso_from = str(data.get("from") or "")[:10]
    iso_to = str(data.get("to") or "")[:10] or iso_from
    iso_from = iso_from or iso_to
    if not iso_from:
        raise HTTPException(status_code=400, detail="Missing from/to dates.")
    seen: dict[str, dict] = {}
    for payload in (data.get("payloads") or []):
        for row in _parse_kpi_payload(payload or {}):
            seen[row["owneriq_id"]] = row
    rows = list(seen.values())
    summary = await ingest_kpi_rows(rows, iso_from, iso_to, source="browser_relay")
    await mark_relay_ingest({"kpis_rows": len(rows), "kpis_range": [iso_from, iso_to]})
    return {"ok": True, **summary}


@router.post("/owneriq/relay/live")
async def owneriq_relay_live(request: Request):
    """Browser relay: a raw Live Operations walk → owneriq_live_cache.
    Body: {secret, date, top, sectors:{id:payload}, bas:{id:payload}}."""
    data = await _relay_body(request)
    from owneriq_live import store_live_from_relay
    from core.owneriq_session import mark_relay_ingest
    iso_date = str(data.get("date") or "")[:10]
    if not iso_date:
        raise HTTPException(status_code=400, detail="Missing date.")
    counts = await store_live_from_relay(
        iso_date, data.get("top"), data.get("sectors") or {}, data.get("bas") or {})
    await mark_relay_ingest({"live_date": iso_date, "live_counts": counts})
    return {"ok": True, "date": iso_date, **counts}


@router.post("/owneriq/relay/hub")
async def owneriq_relay_hub(request: Request):
    """Browser relay: raw Performance Hub views → owneriq_hub (the Hub screen's
    store). Body: {secret, week_start, views:[{kind, ref, payload}, ...]}
    where kind is 'mc' | 'team' | 'no_team'."""
    data = await _relay_body(request)
    from owneriq_hub import store as _store_hub, clean_week
    from core.owneriq_session import mark_relay_ingest
    week_start = clean_week(str(data.get("week_start") or ""))
    # Next week is sent "schedule_only": apply its Field IQ plan to Bells but
    # don't cache it on the Hub screen (which shows this week and earlier).
    schedule_only = bool(data.get("schedule_only"))
    stored = 0
    mc_payloads = []
    for v in (data.get("views") or []):
        kind, ref, payload = v.get("kind"), v.get("ref"), v.get("payload")
        if kind in ("mc", "team", "no_team") and ref is not None and payload:
            if not schedule_only:
                await _store_hub(kind, str(ref), week_start, payload)
                stored += 1
            if kind == "mc":
                mc_payloads.append(payload)
    # The company view carries every BA's week, so fill Bells from it (goals,
    # weekly stats, team names, Not-scheduled/No-show marks) — the same as the
    # live sync, respecting app-set goals and edited days.
    applied: dict = {}
    if mc_payloads:
        from owneriq_performance import apply_relayed_week
        try:
            applied = await apply_relayed_week(week_start, mc_payloads)
        except Exception as ex:
            logger.warning("relay Bells fill failed for week %s: %s", week_start, ex)
            applied = {"error": type(ex).__name__}
    await mark_relay_ingest({"hub_week": week_start, "hub_views": stored, "bells": applied})
    return {"ok": True, "week_start": week_start, "views_stored": stored, "applied": applied}


@router.post("/owneriq/relay/roster")
async def owneriq_relay_roster(request: Request):
    """Browser relay: raw /v2/users roster page(s) → refresh the OwnerIQ↔app
    links and stages, so KPI rows and the Bells fill land on the right people.
    Body: {secret, payloads:[<raw /v2/users page>, ...]}."""
    data = await _relay_body(request)
    from owneriq_performance import link_from_relayed_roster
    from core.owneriq_session import mark_relay_ingest
    res = await link_from_relayed_roster(data.get("payloads") or [])
    await mark_relay_ingest({"roster": res.get("roster"), "linked": res.get("linked")})
    return {"ok": True, **res}


@router.get("/owneriq/relay/status")
async def owneriq_relay_status(request: Request):
    """Is the browser relay feeding the app, and when did it last post? Admin."""
    await require_admin(request)
    from core.owneriq_session import relay_active, status as sess_status
    st = await sess_status()
    return {"active": await relay_active(), "configured": len(_relay_secret()) >= 16,
            "relay": st.get("relay"), "last_sync": st.get("last_ok_at")}


@router.get("/owneriq/switch")
async def owneriq_switch(request: Request):
    """Whether OwnerIQ is in use (a working session). Screens that only work
    with it hide while it's off."""
    await get_current_user(request)
    from owneriq_sync import owneriq_on
    return {"on": await owneriq_on()}

@router.get("/owneriq/companies")
async def owneriq_companies(request: Request):
    """The OwnerIQ marketing companies (offices) this deployment knows about,
    for the office switchers: [{pin, name}], name preferring the app office
    mapped to that pin. Empty until OWNERIQ_MC_PINS is set or a sync has
    discovered the login's companies."""
    await get_current_user(request)
    from owneriq_config import known_companies, office_pin_map
    names_by_pin: dict[str, str] = {}
    pin_by_office = await office_pin_map(db)
    if pin_by_office:
        async for o in db.offices.find({"id": {"$in": list(pin_by_office)}}, {"_id": 0, "id": 1, "name": 1}):
            names_by_pin.setdefault(pin_by_office[o["id"]], o.get("name") or "")
    out = []
    for c in await known_companies(db):
        pin = c.get("pin")
        out.append({"pin": pin, "name": names_by_pin.get(pin) or c.get("name") or f"Office {pin}"})
    return {"companies": out}


class SyncBody(BaseModel):
    from_date: Optional[str] = None  # 'YYYY-MM-DD'
    to_date: Optional[str] = None


SYNC_MAX_DAYS = 14          # widest range one manual sync may pull
SYNC_COOLDOWN_SECONDS = 60  # one manual sync per minute, app-wide
_last_manual_sync = 0.0


def _iso_day(value: Optional[str], field: str) -> Optional[date]:
    if value in (None, ""):
        return None
    try:
        if not isinstance(value, str) or not _ISO_DATE.fullmatch(value):
            raise ValueError
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a date (YYYY-MM-DD)")


def _resolve_sync_range(from_date: Optional[str], to_date: Optional[str]) -> tuple[str, str] | None:
    """The range a manual sync will really pull, after the same defaults
    sync_owneriq applies (to = today, from = the day before `to`).

    A `to` after today (app time) is pulled up to today: ranges such as "this
    week" end on a future Sunday. The resolved range, not the raw input, must
    fit SYNC_MAX_DAYS. Returns None when the whole range is in the future."""
    today = datetime.now(APP_TZ).date()
    a, b = _iso_day(from_date, "from_date"), _iso_day(to_date, "to_date")
    b = min(b or today, today)
    a = a or (b - timedelta(days=1))
    if a > today:
        return None
    if a > b:
        raise HTTPException(status_code=400, detail="from_date must not be after to_date")
    if (b - a).days + 1 > SYNC_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Sync at most {SYNC_MAX_DAYS} days at a time.")
    return a.isoformat(), b.isoformat()


def _take_manual_sync_slot() -> None:
    """One manual OwnerIQ pull (KPI or Performance Hub) per cooldown, app-wide:
    each one logs in to OwnerIQ with the owner's credentials."""
    global _last_manual_sync
    now = time.monotonic()
    if _last_manual_sync and now - _last_manual_sync < SYNC_COOLDOWN_SECONDS:
        raise HTTPException(status_code=429, detail="A sync ran moments ago. Try again in a minute.")
    _last_manual_sync = now


@router.post("/owneriq/sync")
async def owneriq_sync_now(request: Request, body: SyncBody | None = None):
    """Admin: pull OwnerIQ KPIs now (the scheduled sync runs on its own).

    Each run logs in to OwnerIQ with the owner's credentials and writes the
    office-wide collection, so it is admin-only, capped at SYNC_MAX_DAYS and
    rate limited to one run per SYNC_COOLDOWN_SECONDS."""
    await require_admin(request)
    from core.owneriq_session import relay_active
    if await relay_active():
        # The browser relay feeds the data automatically; a server pull would
        # just hit the blocked edge. No-op with a friendly note.
        return {"ok": True, "rows_synced": 0,
                "note": "OwnerIQ is syncing automatically from the browser relay — no manual pull needed."}
    body = body or SyncBody()
    rng = _resolve_sync_range(body.from_date, body.to_date)
    if rng is None:
        return {"ok": True, "rows_synced": 0, "note": "That range is in the future; nothing to pull yet."}
    _take_manual_sync_slot()
    from core.owneriq_session import OwnerIQNeedsReconnect, OwnerIQTransient
    try:
        return await sync_owneriq(*rng)
    except OwnerIQNeedsReconnect as ex:
        raise HTTPException(status_code=409, detail=str(ex) or "OwnerIQ needs reconnecting. Open Admin → OwnerIQ.")
    except OwnerIQTransient as ex:
        raise HTTPException(status_code=503, detail=str(ex) or "OwnerIQ is busy; try again shortly.")
    except OwnerIQError as ex:
        logger.exception("OwnerIQ manual sync failed")
        # Owner-only test button: show the real reason so we can see the status.
        raise HTTPException(status_code=502, detail=(str(ex)[:300] or "OwnerIQ sync failed."))
    except Exception:
        logger.exception("OwnerIQ manual sync crashed")
        raise HTTPException(status_code=500, detail="Sync error. The server log has the details.")


PERF_SYNC_ADMIN_BELLS_WEEKS = 2   # an office admin may refill this week and last


@router.post("/owneriq/performance/sync")
async def owneriq_performance_sync(request: Request, weeks: int = 2, bells_weeks: int = 1):
    """Admin: pull the Performance Hub (targets, attendance, teams) and fill
    Bells from OwnerIQ. `bells_weeks` > 1 back-fills earlier weeks too (the KPI
    rows for those weeks are pulled first): up to 2 weeks for an admin; the
    owner's backfill tool (up to 8) for the super admin. Shares the manual-sync
    cooldown with POST /owneriq/sync."""
    admin = await require_admin(request)
    from owneriq_performance import sync_performance
    weeks = max(1, min(weeks, 8))
    bells_weeks = max(1, min(bells_weeks, 8))
    if bells_weeks > PERF_SYNC_ADMIN_BELLS_WEEKS and not admin.get("is_super_admin"):
        raise HTTPException(status_code=403,
                            detail=f"Only the owner can back-fill more than {PERF_SYNC_ADMIN_BELLS_WEEKS} weeks.")
    _take_manual_sync_slot()
    try:
        if bells_weeks > 1:
            today = datetime.now(APP_TZ).date()
            start = today - timedelta(days=today.weekday()) - timedelta(weeks=bells_weeks - 1)
            await sync_owneriq(start.isoformat(), today.isoformat())
        return await sync_performance(weeks=weeks, bells_weeks=bells_weeks)
    except OwnerIQError:
        logger.exception("OwnerIQ performance sync failed")
        raise HTTPException(status_code=502, detail="OwnerIQ performance sync failed. The server log has the details.")


@router.get("/owneriq/hub")
async def owneriq_hub_view(request: Request, week_start: Optional[str] = None,
                           team: Optional[str] = None, refresh: bool = False):
    """The Performance Hub for one week, as OwnerIQ shows it: the whole office
    (teams + every BA), one team (`team=<OwnerIQ team id>`), or the BAs with no
    team (`team=none`).

    Admins and Coach+ see the whole office. A Coach sees their own team: the
    OwnerIQ team they are in, plus any team led by someone under them. Those
    are the only teams they can ask for, and the office view is never sent."""
    user = await get_current_user(request)
    if user.get("role") not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coach or admin access required")
    from owneriq_hub import app_user_ids, clean_week, coach_teams, company_id, get_view, week_options
    ws = clean_week(week_start)
    mc = await company_id()
    if not mc:
        raise HTTPException(status_code=404, detail="OwnerIQ isn't connected yet.")
    team = (team or "").strip().lower()
    if team and team != "none" and not is_oid(team):
        raise HTTPException(status_code=400, detail="team must be an OwnerIQ team id or 'none'")
    restricted = not sees_whole_office(user)
    my_teams: list = []
    if restricted:
        office = await get_view("mc", mc, ws)
        if office is None:
            raise HTTPException(status_code=404, detail="No Performance Hub data for that week yet.")
        my_teams = coach_teams(office, await app_user_ids(office), str(user["id"]),
                               set(await get_subtree_ids(user["id"])), user.get("name"))
        if not my_teams:
            raise HTTPException(status_code=404, detail="You weren't in a team in OwnerIQ that week, so there is no team performance to show.")
        if team and team not in {str(t["id"]) for t in my_teams}:
            raise HTTPException(status_code=403, detail="That team isn't yours to open.")
        team = team or str(my_teams[0]["id"])
    kind, ref = ("no_team", mc) if team == "none" else ("team", team) if team else ("mc", mc)
    view = await get_view(kind, ref, ws, force=bool(refresh) and user.get("role") == "admin")
    if view is None:
        raise HTTPException(status_code=404, detail="No Performance Hub data for that week yet.")
    app_users = await app_user_ids(view)
    if restricted:
        view = {**view, "available_teams": my_teams}
        # A row only opens a person the Coach coaches: the people under them.
        downline = set(await get_subtree_ids(user["id"])) - {str(user["id"])}
        app_users = {oid: u for oid, u in app_users.items() if u["id"] in downline}
    return {"week_start": ws, "scope": "none" if team == "none" else team or "all",
            "restricted": restricted, "my_teams": my_teams,
            "weeks": week_options(), "app_users": app_users, "view": view}


def mark_office_days(row: dict, idx: Optional[set]) -> dict:
    """Set `status` to in_office on the days (Mon=0) in `idx`."""
    if not row or not idx:
        return row
    for d in row.get("days") or []:
        try:
            i = date.fromisoformat(str(d.get("date"))[:10]).weekday()
        except (TypeError, ValueError):
            continue
        if i in idx:
            d["status"] = "in_office"
    return row


@router.get("/owneriq/performance/week")
async def owneriq_performance_week(request: Request, week_ending: Optional[str] = None):
    """The caller's Field IQ week (target, attendance, KPIs) plus, for coaches
    and admins, the same for everyone under them."""
    user = await get_current_user(request)
    today = datetime.now(APP_TZ).date()
    we = week_ending or (today + timedelta(days=6 - today.weekday())).isoformat()
    uid = str(user.get("id") or user.get("_id"))
    mine = await db.owneriq_weekly_stats.find_one({"user_id": uid, "week_ending": we}, {"_id": 0})
    team: list = []
    if user.get("role") in ("leader", "admin"):
        if sees_whole_office(user):
            q = {"week_ending": we, "office_id": user.get("office_id")} if not user.get("is_super_admin") else {"week_ending": we}
        else:
            ids = [i for i in await get_subtree_ids(uid) if i != uid]
            q = {"week_ending": we, "user_id": {"$in": ids}}
        rows = await db.owneriq_weekly_stats.find(q, {"_id": 0}).to_list(2000)
        from bson import ObjectId
        names = {str(u["_id"]): u.get("name") async for u in db.users.find(
            {"_id": {"$in": [ObjectId(r["user_id"]) for r in rows if ObjectId.is_valid(r["user_id"])]}}, {"name": 1})}
        for r in rows:
            if r["user_id"] == uid:
                continue
            k = r.get("kpis") or {}
            team.append({"user_id": r["user_id"], "name": names.get(r["user_id"]), "team_name": r.get("team_name"),
                         "sales": k.get("sales"), "sales_target": k.get("sales_target"),
                         "days": r.get("days") or []})
        team.sort(key=lambda x: (-(x["sales"] or 0), x["name"] or ""))
    # A day marked In office in the app (Bells `pc`) shows as in_office, not
    # Field IQ's "not present": Field IQ only knows the field.
    ids = [uid] + [t["user_id"] for t in team]
    office: dict[str, set] = {}
    async for e in db.bells_entries.find({"week_ending": we, "user_id": {"$in": ids}}, {"user_id": 1, "days": 1}):
        idx = {i for i, d in enumerate(e.get("days") or []) if (d or {}).get("status") == "pc"}
        if idx:
            office.setdefault(str(e.get("user_id")), set()).update(idx)
    if office:
        mine = mark_office_days(mine, office.get(uid)) if mine else mine
        for t in team:
            mark_office_days(t, office.get(t["user_id"]))
    state = await db.owneriq_sync_state.find_one({"_id": "performance"}, {"_id": 0})
    return {"week_ending": we, "today": today.isoformat(), "me": mine, "team": team,
            "synced_at": (state or {}).get("synced_at")}


class RepActionBody(BaseModel):
    cg1_user_id: Optional[str] = None        # resolve via badge link…
    owneriq_user_id: Optional[str] = None    # …or (super admin only) a numeric OwnerIQ id directly, for testing
    action: str                              # promote | demote | set_stage | deactivate | reactivate | reparent
    target_stage: Optional[int] = None       # for set_stage
    leader_cg1_user_id: Optional[str] = None # for reparent (the new leader)
    dry_run: bool = True                     # default safe — preview the plan


async def _guard_rep_target(admin: dict, cg1_user_id: Optional[str], label: str = "That person") -> None:
    """A rep-action target must be a real app user in the admin's office
    (super admins: any office). OwnerIQ ids are only ever resolved from it."""
    if not cg1_user_id:
        return
    if not ObjectId.is_valid(cg1_user_id):
        raise HTTPException(status_code=400, detail=f"{label}: invalid user id")
    u = await db.users.find_one({"_id": ObjectId(cg1_user_id)}, {"office_id": 1})
    if not u:
        raise HTTPException(status_code=404, detail=f"{label} wasn't found")
    if admin.get("is_super_admin"):
        return
    if not admin.get("office_id") or u.get("office_id") != admin.get("office_id"):
        raise HTTPException(status_code=403, detail=f"{label} isn't in your office")


@router.post("/owneriq/rep-action")
async def owneriq_rep_action(request: Request, body: RepActionBody):
    admin = await require_admin(request)
    from owneriq_write import clean_oid, perform, reparent, writes_enabled
    if not body.dry_run and not writes_enabled():
        raise HTTPException(
            status_code=403,
            detail="OwnerIQ writes are off. Set OWNERIQ_WRITES_ENABLED=true to allow them (dry runs always work).",
        )
    raw_oid = None
    if body.owneriq_user_id not in (None, ""):
        # A raw OwnerIQ id skips the office guard, so only the owner may use it.
        if not admin.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Only the owner can target an OwnerIQ id directly.")
        raw_oid = clean_oid(body.owneriq_user_id)
        if not raw_oid:
            raise HTTPException(status_code=400, detail="owneriq_user_id must be a numeric OwnerIQ id.")
    elif not body.cg1_user_id:
        raise HTTPException(status_code=400, detail="cg1_user_id is required")
    await _guard_rep_target(admin, body.cg1_user_id)
    try:
        if body.action == "reparent":
            if not body.cg1_user_id or not body.leader_cg1_user_id:
                raise HTTPException(status_code=400, detail="reparent needs cg1_user_id + leader_cg1_user_id")
            await _guard_rep_target(admin, body.leader_cg1_user_id, "The new coach")
            return await reparent(body.cg1_user_id, body.leader_cg1_user_id,
                                  dry_run=body.dry_run, actor=admin.get("id"))
        result = await perform(
            body.cg1_user_id, body.action, target_stage=body.target_stage,
            dry_run=body.dry_run, actor=admin.get("id"), owneriq_user_id=raw_oid,
        )
        # Keep the app's copy of their OwnerIQ stage in step straight away.
        after = (result or {}).get("after") or {}
        if body.cg1_user_id and "stage" in after and ObjectId.is_valid(body.cg1_user_id):
            await db.users.update_one({"_id": ObjectId(body.cg1_user_id)}, {"$set": {"owneriq_stage": after["stage"]}})
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("OwnerIQ rep-action failed")
        raise HTTPException(status_code=502, detail="OwnerIQ write failed. The server log has the details.")


@router.post("/owneriq/reconcile")
async def owneriq_reconcile(request: Request, dry_run: bool = True):
    """Owner only: align OwnerIQ to the app for every linked rep, in every
    office (parent/active/leader-stage). dry_run=true is read-only and returns
    the planned diff; a real run also needs OWNERIQ_WRITES_ENABLED."""
    admin = await require_super_admin(request)
    from owneriq_write import reconcile, writes_enabled
    if not dry_run and not writes_enabled():
        raise HTTPException(
            status_code=403,
            detail="OwnerIQ writes are off. Set OWNERIQ_WRITES_ENABLED=true to allow them (dry runs always work).",
        )
    try:
        return await reconcile(dry_run=dry_run, actor=admin.get("id"))
    except Exception:
        logger.exception("OwnerIQ reconcile failed")
        raise HTTPException(status_code=502, detail="Reconcile failed. The server log has the details.")


@router.get("/owneriq/link-debug")
async def owneriq_link_debug(request: Request):
    """Diagnose why reps show 'unlinked': shows whether app badges are assigned
    and whether OwnerIQ badge numbers / names actually match the app's.

    An office admin sees their own office only (its OwnerIQ company's rows and
    its own users and badges); the owner sees every office."""
    admin = await require_admin(request)
    by_badge, by_name = await _build_rep_resolvers()
    kpi_q: dict = {}
    user_q: dict = {}
    badge_q: dict = {}
    if not admin.get("is_super_admin"):
        office_id = admin.get("office_id")
        office_uids = [str(u["_id"]) async for u in db.users.find({"office_id": office_id}, {"_id": 1})] \
            if office_id else []
        pin = await _office_pin(office_id) if office_id else None
        # No OwnerIQ company for this office: only rows already linked to it.
        kpi_q = {"mc_pin": pin} if pin else {"cg1_user_id": {"$in": office_uids}}
        user_q = {"office_id": office_id} if office_id else {"_id": None}
        badge_q = {"user_id": {"$in": office_uids}}
        allowed = set(office_uids)
        by_badge = {k: v for k, v in by_badge.items() if v in allowed}
        by_name = {k: v for k, v in by_name.items() if v in allowed}
    badges_total = await db.badges.count_documents(badge_q)
    users_total = await db.users.count_documents(user_q)
    rows_total = await db.owneriq_kpis.count_documents(kpi_q)
    rows_linked = await db.owneriq_kpis.count_documents({**kpi_q, "cg1_user_id": {"$ne": None}})
    samples = []
    # Unlinked rows first: they are what this page is for.
    async for r in db.owneriq_kpis.find({**kpi_q, "cg1_user_id": None},
                                        {"_id": 0, "badge_number": 1, "rep_name": 1}).limit(12):
        bn = (r.get("badge_number") or "").strip().upper()
        samples.append({
            "badge_number": r.get("badge_number"),
            "rep_name": r.get("rep_name"),
            "badge_in_app": bn in by_badge,
            # A matching name is shown as a hint only: it never links anyone.
            "name_in_app": _norm_name(r.get("rep_name")) in by_name,
        })
    return {
        "app_badges_total": badges_total,
        "app_badges_assigned_to_users": len(by_badge),
        "app_users_total": users_total,
        "owneriq_rows_total": rows_total,
        "owneriq_rows_linked": rows_linked,
        "owneriq_rows_unlinked": rows_total - rows_linked,
        "unlinked_samples": samples,
    }


@router.get("/owneriq/status")
async def owneriq_status(request: Request):
    await get_current_user(request)
    state = await db.owneriq_sync_state.find_one({"_id": "last"}, {"_id": 0})
    return state or {"ok": None, "synced_at": None, "rows_synced": 0}


@router.get("/owneriq/kpis")
async def owneriq_kpis(request: Request, from_date: Optional[str] = None, to_date: Optional[str] = None):
    caller = await get_current_user(request)
    from_date, to_date = _norm_range(from_date, to_date)
    rows = await _scoped_rows(caller, from_date, to_date)
    rows.sort(key=lambda r: (r.get("points") or 0), reverse=True)
    return {"range": {"from": from_date, "to": to_date}, "count": len(rows), "rows": rows}


@router.get("/owneriq/summary")
async def owneriq_summary(
    request: Request,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    mc_pin: Optional[str] = None,      # filter to one office (OwnerIQ company pin)
    own_office: bool = False,          # force to caller's own office (Home LOA card)
    exclude: Optional[str] = None,     # comma-separated badge numbers to drop from averages
    include_zero: bool = False,        # include 0-data BAs in the average (default: drop as "off")
    team_of: Optional[str] = None,     # narrow to this user's crew (leader → subtree, admin → office)
):
    caller = await get_current_user(request)
    from_date, to_date = _norm_range(from_date, to_date)
    rows = await _scoped_rows(caller, from_date, to_date, own_office=own_office)
    if mc_pin:
        rows = [r for r in rows if str(r.get("mc_pin")) == str(mc_pin)]
    if team_of:
        # "Whose numbers is this view about?" — the planner review passes the
        # plan owner so a leader's Team tab means THEIR team, not whatever the
        # viewer happens to be allowed to see (an owner opening a leader's
        # plan used to get the office/cross-office average here). This only
        # ever NARROWS the caller-scoped rows, so it grants nothing new.
        from bson import ObjectId
        try:
            tgt = await db.users.find_one({"_id": ObjectId(team_of)}, {"role": 1, "office_id": 1})
        except Exception:
            tgt = None
        pin = await _office_pin(tgt.get("office_id")) if tgt and tgt.get("role") == "admin" else None
        if pin:
            # An admin's crew IS their office.
            rows = [r for r in rows if str(r.get("mc_pin")) == str(pin)]
        else:
            team_ids = set(await get_subtree_ids(team_of))
            rows = [r for r in rows if r.get("cg1_user_id") in team_ids]
    exclude_keys = {b.strip().upper() for b in (exclude or "").split(",") if b.strip()}
    agg = aggregate_rows(rows, exclude_keys=exclude_keys, include_zero=include_zero)
    return {
        "range": {"from": from_date, "to": to_date},
        "single_day": from_date == to_date,
        **agg,
    }


### ── Live Operations (live passthrough, role-scoped) ────────────────────────
# Mirrors OwnerIQ's Live Operations dashboard on CG1's Home: today's teams in
# the field, their running KPIs, first-knock times, per-BA door logs. Data is
# proxied live per request (not stored); any day is fetchable via ?date=.

def _member_oids(sector: dict) -> set[str]:
    ids = {str(m.get("id")) for m in (sector.get("members") or []) if m.get("id") is not None}
    lid = ((sector.get("leader") or {}).get("id"))
    if lid is not None:
        ids.add(str(lid))
    return ids


async def _live_link_ctx(caller: dict):
    """(oid→cg1_user_id, name→cg1_user_id, this caller's OwnerIQ ids).

    OwnerIQ user ids are linked to CG1 users via previously-synced KPI rows
    (owneriq_user_id ⇄ cg1_user_id, id/badge links only) and the stored
    users.owneriq_user_id. The name map is for display tags only (_cg1_for);
    it never feeds caller_oids or any scope check."""
    oid2cg1: dict[str, str] = {}
    async for r in db.owneriq_kpis.find(
        {"cg1_user_id": {"$ne": None}, "owneriq_user_id": {"$ne": None}, **ID_LINKED},
        {"_id": 0, "owneriq_user_id": 1, "cg1_user_id": 1},
    ):
        oid2cg1[str(r["owneriq_user_id"])] = r["cg1_user_id"]
    _, by_name = await _build_rep_resolvers()
    caller_oids = {oid for oid, uid in oid2cg1.items() if uid == caller.get("id")}
    # The stored link on the account (set by the Performance Hub sync) counts too.
    if caller.get("owneriq_user_id") not in (None, ""):
        caller_oids.add(str(caller["owneriq_user_id"]))
    return oid2cg1, by_name, caller_oids


def _cg1_for(person: dict, oid2cg1: dict, by_name: dict) -> str | None:
    """App user id for an OwnerIQ person, for DISPLAY and linking (opens their
    profile): the id link first, then their name. Never use it to authorise;
    use _cg1_by_id, because anyone can change their own display name."""
    if not person:
        return None
    oid = person.get("id")
    if oid is not None and str(oid) in oid2cg1:
        return oid2cg1[str(oid)]
    return by_name.get(_norm_name(person.get("full_name")))


def _cg1_by_id(person: dict, oid2cg1: dict) -> str | None:
    """App user id for an OwnerIQ person by the stable id link only."""
    oid = (person or {}).get("id")
    return oid2cg1.get(str(oid)) if oid is not None else None


async def _visible_sectors(caller: dict, sectors: list[dict], oid2cg1, by_name, caller_oids, mc_pin=None):
    """Filter live sectors to the caller's scope (never trusted from client):
      • super-admin → all (optionally one office via mc_pin)
      • admin, Coach+ → their office's sectors
      • leader      → sectors they're in OR led by someone in their downline
      • trainee     → sectors they're personally in
    Each returned sector is tagged with mc_pin / office_name / leader cg1 id."""
    role = caller.get("role")
    is_super = bool(caller.get("is_super_admin"))

    office_wide = sees_whole_office(caller)
    admin_pin = await _office_pin(caller.get("office_id")) if office_wide else None
    subtree = set(await get_subtree_ids(caller["id"])) if role == "leader" and not office_wide else set()

    out = []
    for s in sectors:
        pin = sector_pin(s)
        if mc_pin and str(pin) != str(mc_pin):
            continue
        leader = s.get("leader") or {}
        leader_cg1 = _cg1_for(leader, oid2cg1, by_name)     # display/linking only
        leader_cg1_id = _cg1_by_id(leader, oid2cg1)        # authorisation
        # "Mine" is decided by OwnerIQ ids linked to this account, never by
        # display name (anyone can rename themselves).
        mine = bool(caller_oids & _member_oids(s))

        if is_super:
            allowed = True
        elif office_wide:
            allowed = (admin_pin is not None and str(pin) == str(admin_pin))
        elif role == "leader":
            allowed = mine or (leader_cg1_id is not None and leader_cg1_id in subtree)
        else:  # trainee
            allowed = mine

        if not allowed:
            continue
        s = {**s, "mc_pin": pin, "office_name": sector_office_name(s), "leader_cg1_user_id": leader_cg1, "is_mine": mine}
        out.append(s)
    return out


_ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _live_date(value: Optional[str]) -> str:
    """YYYY-MM-DD in ASCII digits, and a real calendar day (no trailing
    newline, no other scripts' digits)."""
    if not value:
        return today_iso()
    if not isinstance(value, str) or not _ISO_DATE.fullmatch(value):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return value


def _live_id(value: str, what: str) -> str:
    """OwnerIQ ids go into request paths: digits only (as /owneriq/hub does
    for `team`), so a crafted id can't point the call at another endpoint."""
    v = (value or "").strip()
    if not is_oid(v):
        raise HTTPException(status_code=400, detail=f"{what} must be a numeric OwnerIQ id")
    return v


# Live pages call OwnerIQ with the owner's login. Only admins may skip the
# cache (refresh=true); everyone else gets a generous per-person cap on live
# look-ups, so nobody can hammer OwnerIQ through the app.
_LIVE_LOOKUPS = Limiter(120, 10 * 60, detail="Too many live look-ups. Try again in a few minutes.")


def _may_force(user: dict) -> bool:
    return user.get("role") == "admin" or bool(user.get("is_super_admin"))


def _count_live_lookup(user: dict) -> None:
    if not _may_force(user):
        _LIVE_LOOKUPS.take(f"live:{user.get('id') or user.get('_id')}")


@router.get("/owneriq/live")
async def owneriq_live(
    request: Request,
    date: Optional[str] = None,
    mc_pin: Optional[str] = None,     # filter to one office (OwnerIQ company pin)
    own_office: bool = False,         # force to the caller's own office (Home tile)
    compiled: bool = False,           # also sum the full funnel across the caller's teams
    refresh: bool = False,            # bypass cache (pull-to-refresh)
):
    """Today's (or any day's) live teams, scoped to the caller. Powers the Home
    Live Operations entry tile and the Live Operations hub.

    Office filtering: admins are already locked to their office server-side; a
    super-admin sees all offices but can pass mc_pin (hub switcher) or
    own_office=true (Home tile → their own office only). Past days are served
    from cache; today is re-pulled after a short TTL, or immediately when
    refresh=true. compiled=true additionally sums each visible team's funnel."""
    caller = await get_current_user(request)
    iso = _live_date(date)
    refresh = bool(refresh) and _may_force(caller)
    _count_live_lookup(caller)
    try:
        payload = await get_live_operations(iso, force=refresh)
    except OwnerIQError:
        logger.exception("OwnerIQ live fetch failed")
        raise HTTPException(status_code=502, detail="OwnerIQ live fetch failed. The server log has the details.")
    effective_pin = mc_pin
    if own_office:
        own_pin = await _office_pin(caller.get("office_id"))
        if own_pin:
            effective_pin = own_pin
    oid2cg1, by_name, caller_oids = await _live_link_ctx(caller)
    sectors = await _visible_sectors(
        caller, payload.get("sectors") or [], oid2cg1, by_name, caller_oids, mc_pin=effective_pin
    )
    # Sort live teams first, then by sales desc.
    sectors.sort(key=lambda s: (not s.get("live"), -(s.get("total_sales") or 0)))
    # Office/leader admins can't see the vendor's cross-office top KPI card, so
    # derive an honest summary from the sectors they CAN see. Super-admin viewing
    # everything gets the vendor's own KPI block too.
    see_all = bool(caller.get("is_super_admin")) and not effective_pin
    # An office admin whose office IS every sector OwnerIQ returned sees the
    # same picture OwnerIQ's own tiles describe, so they get those tiles too.
    whole_company = sees_whole_office(caller) and len(sectors) == len(payload.get("sectors") or [])
    summary = {
        "teams": len(sectors),
        "sales": sum((s.get("total_sales") or 0) for s in sectors),
        "bas_in_field": sum(len(s.get("members") or []) for s in sectors),
        "live_teams": sum(1 for s in sectors if s.get("live")),
    }
    funnel = None
    if compiled and sectors:
        try:
            funnel = await compile_funnel([s["id"] for s in sectors], iso, force=refresh)
        except OwnerIQError as ex:
            logger.warning("compile_funnel failed: %s", ex)
    return {
        "date": iso,
        "summary": summary,
        "funnel": funnel,
        "kpis": payload.get("kpis") if (see_all or whole_company) else None,
        "sectors": sectors,
    }


async def _assert_sector_visible(caller: dict, detail: dict) -> None:
    """Authorize a sector/BA detail fetch using the detail's own members
    (avoids a second top-level call). Raises 403 if out of scope."""
    if bool(caller.get("is_super_admin")):
        return
    role = caller.get("role")
    members = detail.get("members") or []
    if sees_whole_office(caller):
        pin = await _office_pin(caller.get("office_id"))
        pins = {str(((m.get("marketing_company") or {}).get("pin"))) for m in members}
        if pin is not None and str(pin) in pins:
            return
        raise HTTPException(status_code=403, detail="Team not in your office")
    # leader / trainee: must be in the team (self or downline leader), by
    # linked OwnerIQ id only; display names never authorise.
    oid2cg1, _by_name, caller_oids = await _live_link_ctx(caller)
    member_oids = {str(m.get("id")) for m in members if m.get("id") is not None}
    if caller_oids & member_oids:
        return
    if role == "leader":
        subtree = set(await get_subtree_ids(caller["id"]))
        for m in members:
            uid = _cg1_by_id(m, oid2cg1)
            if (m.get("is_leader") or m.get("shared") is False) and uid is not None and uid in subtree:
                return
    raise HTTPException(status_code=403, detail="Team not in your scope")


@router.get("/owneriq/live/sector/{sector_id}")
async def owneriq_live_sector(request: Request, sector_id: str, date: Optional[str] = None, refresh: bool = False):
    """One team's live detail: hero KPIs + per-BA table (first-knock, doors→sales)."""
    caller = await get_current_user(request)
    sector_id = _live_id(sector_id, "sector_id")
    iso = _live_date(date)
    _count_live_lookup(caller)
    try:
        detail = await get_sector(sector_id, iso, force=bool(refresh) and _may_force(caller))
    except OwnerIQError:
        logger.exception("OwnerIQ sector fetch failed")
        raise HTTPException(status_code=502, detail="OwnerIQ sector fetch failed. The server log has the details.")
    await _assert_sector_visible(caller, detail)
    oid2cg1, by_name, _ = await _live_link_ctx(caller)
    for m in detail.get("members") or []:
        m["cg1_user_id"] = _cg1_for(m, oid2cg1, by_name)
    detail["date"] = iso
    return detail


@router.get("/owneriq/live/ba/{ba_id}")
async def owneriq_live_ba(request: Request, ba_id: str, date: Optional[str] = None, refresh: bool = False):
    """One BA's live detail: hero KPIs + door-by-door laps for the day."""
    caller = await get_current_user(request)
    ba_id = _live_id(ba_id, "ba_id")
    iso = _live_date(date)
    _count_live_lookup(caller)
    try:
        detail = await get_ba(ba_id, iso, force=bool(refresh) and _may_force(caller))
    except OwnerIQError:
        logger.exception("OwnerIQ BA fetch failed")
        raise HTTPException(status_code=502, detail="OwnerIQ BA fetch failed. The server log has the details.")
    # Authorize via the BA's sector (fetch it once; reuse its member scope
    # check). Fail closed: no sector, no answer (except for the owner).
    if not bool(caller.get("is_super_admin")):
        sec_id = ((detail.get("sector") or {}).get("id"))
        sec_id = str(sec_id).strip() if sec_id is not None else ""
        if not is_oid(sec_id):
            raise HTTPException(status_code=403, detail="BA not in your scope")
        try:
            sec = await get_sector(sec_id, iso)
        except OwnerIQError:
            # Can't confirm the sector: only the BA themselves (by linked
            # OwnerIQ id) may see their own laps.
            _, _, caller_oids = await _live_link_ctx(caller)
            if str(((detail.get("ba") or {}).get("id"))) not in caller_oids:
                raise HTTPException(status_code=403, detail="BA not in your scope")
        else:
            await _assert_sector_visible(caller, sec)
    detail["date"] = iso
    return detail


@router.get("/owneriq/averages")
async def owneriq_averages(
    request: Request,
    user_id: Optional[str] = None,     # defaults to caller; must be within caller's scope
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    """Own avg/day + team avg/day for the team-plan integration.

    'own' = the target rep's average per active day over the range.
    'team' = the average per rep per active day across the rep's team (the
    leader's subtree, or the office for admins) over the same range.
    """
    caller = await get_current_user(request)
    from_date, to_date = _norm_range(from_date, to_date)
    target_id = user_id or caller["id"]

    team_rows = await _scoped_rows(caller, from_date, to_date)
    # Guard: callers may only introspect a user inside their own scope.
    scope_ids = {r.get("cg1_user_id") for r in team_rows}
    if target_id != caller["id"] and target_id not in scope_ids:
        raise HTTPException(status_code=403, detail="User not in your scope")

    team_agg = aggregate_rows(team_rows, include_zero=False)
    own_rows = [r for r in team_rows if r.get("cg1_user_id") == target_id]
    own_agg = aggregate_rows(own_rows, include_zero=True)
    own = own_agg["reps"][0]["avg_per_day"] if own_agg["reps"] else {m: 0 for m in team_agg["group_totals"]}

    return {
        "range": {"from": from_date, "to": to_date},
        "user_id": target_id,
        "own_avg_per_day": own,
        "team_avg_per_day": team_agg["avg_per_rep_day"],
        "team_included_count": team_agg["included_count"],
    }


# ── Add the team from OwnerIQ ────────────────────────────────────────────────
class ImportPick(BaseModel):
    owneriq_user_id: str
    role: Optional[str] = None


class ImportPeopleBody(BaseModel):
    dry_run: bool = True
    people: list[ImportPick] = []
    starter_password: Optional[str] = None
    days: Optional[int] = None
    office_id: Optional[str] = None


async def _owneriq_roster_for(pin: Optional[str]) -> list[dict]:
    """Read the office's OwnerIQ people (read-only)."""
    import httpx
    from owneriq_import import parse_roster
    from owneriq_sync import _login, _select_company, _api_headers, OWNERIQ_API_BASE
    async with _client(timeout=60.0) as client:
        token = await _login(client)
        if pin:
            await _select_company(client, token, pin)
        hdrs = {**_api_headers(), "authorization": f"Bearer {token}"}
        r = await client.get(f"{OWNERIQ_API_BASE}/v2/users", params={"limit": 2000, "active": "true"},
                             headers=hdrs, timeout=90.0)
        if r.status_code != 200:
            raise OwnerIQError(f"GET /v2/users failed: HTTP {r.status_code}")
        return parse_roster(r.json())


@router.post("/owneriq/import-people")
async def owneriq_import_people(request: Request, body: ImportPeopleBody):
    """List (dry run) or create app accounts for the office's OwnerIQ people.
    Reads OwnerIQ only; never writes to it."""
    from owneriq_config import root_user_ids
    from owneriq_import import apply_import, owner_node, plan_import
    admin = await require_admin(request)
    office_id = admin.get("office_id")
    if body.office_id and body.office_id != office_id:
        if not admin.get("is_super_admin"):
            raise HTTPException(403, "You can only add people to your own office")
        office_id = body.office_id
    if not office_id:
        raise HTTPException(400, "Choose an office first")
    pin = await _office_pin(office_id)
    try:
        people = await _owneriq_roster_for(pin)
    except OwnerIQError as ex:
        logger.warning("OwnerIQ import: %s", ex)
        raise HTTPException(502, "Couldn't read your team from OwnerIQ. Try again in a minute.")
    app_users = await db.users.find(
        {"deleted": {"$ne": True}},
        {"name": 1, "email": 1, "amplifi_codes": 1, "owneriq_user_id": 1, "office_id": 1}).to_list(20000)
    office_of = {str(u["_id"]): u.get("office_id") for u in app_users}
    rows = plan_import(people, app_users, owner_node(people, root_user_ids()))
    if not admin.get("is_super_admin"):
        # Don't show names of accounts that belong to another office.
        for r in rows:
            if r.get("app_user_id") and office_of.get(r["app_user_id"]) != office_id:
                r["app_user_name"] = "an account in another office"
    if body.dry_run:
        return {"office_id": office_id, "rows": rows}
    try:
        result = await apply_import(
            db, office_id=office_id, admin=admin, rows=rows,
            picks=[p.model_dump() for p in body.people],
            starter_password=body.starter_password or "", days=body.days or 7)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    logger.info("OwnerIQ import: %d created, %d skipped (office %s)",
                len(result["created"]), len(result["skipped"]), office_id)
    return result
