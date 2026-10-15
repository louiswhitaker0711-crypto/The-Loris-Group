"""OwnerIQ session: sign in once, keep the token, reuse it everywhere, and
stop cleanly when OwnerIQ asks for an MFA code.

OwnerIQ started asking for an MFA code on every password sign-in (14 Oct 2026).
So the app can no longer sign in unattended. Instead the Owner signs in once
in a real browser (completing MFA themselves) and pastes the resulting session
token into the Reconnect screen; the app reuses that token until OwnerIQ
refuses it, then asks the Owner for a fresh one. While MFA is NOT yet on the
account, a password sign-in still works and is used automatically.

This never defeats MFA: the token is one the Owner created with their own
code. We only store and reuse it.

Store: one document `owneriq_session` (_id "session"):
  token, source ('password'|'browser'), minted_at, state, reason,
  last_ok_at, last_sign_in_at, last_status, last_body (token-like values
  blanked), api_base, alerted_at, retry_not_before.
The token is a secret: never logged, never returned by any API.

States (get_token behaves per state):
  connected      → return the saved token, no sign-in
  signed_out     → one password sign-in under the lock, then the new token
  needs_reconnect→ raise at once; no sign-in is attempted (each one may text
                   the Owner another code)
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

import httpx

from database import db

logger = logging.getLogger(__name__)

CONNECTED = "connected"
SIGNED_OUT = "signed_out"
NEEDS_RECONNECT = "needs_reconnect"
OFF = "off"   # the Owner switched it off: no sign-in, runs on the breakdowns

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36"
_DEFAULT_BASE = (os.getenv("OWNERIQ_API_BASE") or "https://uk.owner-iq.ai").rstrip("/")
_PASSWORD_LOOP_SECONDS = 600      # a password token refused this fast → MFA, not a fluke
_TRANSIENT_BACKOFF_SECONDS = 300  # 5xx / 429 / network: wait before the next try
# Browser relay: the Owner's own logged-in browser posts the data the server
# can't reach (the UK edge blocks server-to-server calls). While a relay has
# posted within this window, OwnerIQ counts as "connected" and the server's own
# OwnerIQ pulls stand down — the browser is the only thing that talks to OwnerIQ.
RELAY_TTL_S = int((os.getenv("OWNERIQ_RELAY_TTL_MIN") or "40")) * 60
RELAY = "relay"
_lock = asyncio.Lock()


class OwnerIQNeedsReconnect(RuntimeError):
    """OwnerIQ wants a fresh browser token; no sign-in will be attempted."""


class OwnerIQTransient(RuntimeError):
    """A temporary failure (5xx/429/network): try again shortly."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _blank_token_like(body: str) -> str:
    """Keep OwnerIQ's response for learning the MFA shape, token-like values
    blanked. Crude but safe: redact long values of token/auth/mfa keys."""
    import re
    s = (body or "")[:2000]
    return re.sub(r'("(?:[a-z_]*token|auth[a-z_]*|mfa[a-z_]*)"\s*:\s*")[^"]{6,}(")', r"\1***\2", s, flags=re.I)


async def _read() -> dict:
    try:
        return await db.owneriq_session.find_one({"_id": "session"}) or {}
    except Exception:
        return {}


async def _write(fields: dict) -> None:
    await db.owneriq_session.update_one({"_id": "session"}, {"$set": fields}, upsert=True)


async def mark_relay_ingest(meta: dict | None = None) -> None:
    """The browser relay just posted data. Stamp the time (and a little meta for
    the status screen) so the app counts OwnerIQ as live and the server's own
    pulls stand down. Best-effort; never raises into the ingest path."""
    try:
        await _write({"relay_at": _now_iso(), "relay_meta": (meta or {})})
    except Exception:
        pass


def _relay_is_fresh(doc: dict) -> bool:
    at = doc.get("relay_at")
    if not at:
        return False
    try:
        return (_now() - datetime.fromisoformat(at)).total_seconds() < RELAY_TTL_S
    except ValueError:
        return False


async def relay_active(doc: dict | None = None) -> bool:
    """True while the Owner's browser relay has posted recently. When it is, the
    server must NOT try to reach OwnerIQ itself (its IP is blocked at the edge);
    it serves what the relay has stored."""
    return _relay_is_fresh(doc if doc is not None else await _read())


def api_base(doc: dict | None = None) -> str:
    """Account's API host: OWNERIQ_API_BASE env wins, else the one we resolved
    at reconnect, else the UK default."""
    if os.getenv("OWNERIQ_API_BASE"):
        return os.getenv("OWNERIQ_API_BASE").rstrip("/")
    return ((doc or {}).get("api_base") or _DEFAULT_BASE).rstrip("/")


def _creds() -> tuple[str, str]:
    return (os.getenv("OWNERIQ_EMAIL") or "").strip(), (os.getenv("OWNERIQ_PASSWORD") or "")


async def available() -> bool:
    """Is OwnerIQ usable right now? False once it needs a reconnect, or when
    there's neither a saved token nor a password to sign in with."""
    doc = await _read()
    if _relay_is_fresh(doc):
        return True
    if doc.get("state") in (NEEDS_RECONNECT, OFF):
        return False
    if doc.get("token"):
        return True
    _, password = _creds()
    return bool(password)


async def status() -> dict:
    """For the Reconnect screen. Never includes the token."""
    doc = await _read()
    email, password = _creds()
    if _relay_is_fresh(doc):
        # The browser relay is feeding the app; show it as connected so the
        # OwnerIQ screens stay on, and surface the last ingest for the Owner.
        return {
            "state": CONNECTED,
            "source": "browser_relay",
            "reason": None,
            "minted_at": doc.get("relay_at"),
            "last_ok_at": doc.get("relay_at"),
            "last_sign_in_at": doc.get("last_sign_in_at"),
            "last_status": 200,
            "has_token": False,
            "has_password": bool(password),
            "email": email or None,
            "api_base": api_base(doc),
            "relay": {"active": True, "at": doc.get("relay_at"), **(doc.get("relay_meta") or {})},
        }
    return {
        "state": doc.get("state") or (SIGNED_OUT if (doc.get("token") or password) else "off"),
        "source": doc.get("source"),
        "reason": doc.get("reason"),
        "minted_at": doc.get("minted_at"),
        "last_ok_at": doc.get("last_ok_at"),
        "last_sign_in_at": doc.get("last_sign_in_at"),
        "last_status": doc.get("last_status"),
        "has_token": bool(doc.get("token")),
        "has_password": bool(password),
        "email": email or None,
        "api_base": api_base(doc),
        "relay": {"active": False, "at": doc.get("relay_at")},
    }


def _headers(token: str | None = None) -> dict:
    h = {"accept": "application/vnd.api+json", "x-requested-with": "XMLHttpRequest",
         "origin": "https://owner-iq.ai", "referer": "https://owner-iq.ai/", "user-agent": _UA}
    if token:
        h["authorization"] = f"Bearer {token}"
    return h


async def probe(client: httpx.AsyncClient, token: str, base: str | None = None) -> int | None:
    """A cheap authenticated GET. Returns the HTTP status (None on a network
    error). 200 means good; 401/403 means OwnerIQ refused the token; anything
    else (e.g. the UK server moved the endpoint) is inconclusive."""
    base = base or api_base(await _read())
    for path in ("/v3/owner/marketing_companies/light_index", "/v3/owner/marketing_companies"):
        try:
            r = await client.get(f"{base}{path}", headers=_headers(token))
        except Exception:
            return None
        if r.status_code == 200 or r.status_code == 401:
            return r.status_code
    return r.status_code


async def verify(client: httpx.AsyncClient, token: str, base: str | None = None) -> bool:
    return (await probe(client, token, base)) == 200


async def _password_sign_in(client: httpx.AsyncClient) -> str:
    """One password sign-in. Sets state and may alert; returns the token or
    raises. Caller holds the lock."""
    email, password = _creds()
    if not email or not password:
        raise OwnerIQNeedsReconnect("No saved OwnerIQ password; paste a session token to connect.")
    doc = await _read()
    base = api_base(doc)
    try:
        r = await client.post(f"{base}/v3/owner/sessions",
                              json={"session": {"email": email, "password": password}}, headers=_headers())
    except Exception as ex:
        await _write({"state": SIGNED_OUT, "last_sign_in_at": _now_iso(),
                      "retry_not_before": (_now().timestamp() + _TRANSIENT_BACKOFF_SECONDS)})
        raise OwnerIQTransient(f"OwnerIQ unreachable: {type(ex).__name__}")
    token = None
    try:
        token = r.json().get("data", {}).get("attributes", {}).get("auth_token")
    except Exception:
        token = None
    rec = {"last_sign_in_at": _now_iso(), "last_status": r.status_code,
           "last_body": _blank_token_like(r.text)}
    if r.status_code == 200 and token:
        rec.update(token=token, source="password", minted_at=_now_iso(), state=CONNECTED,
                   reason=None, last_ok_at=_now_iso(), alerted_at=None, retry_not_before=None)
        await _write(rec)
        return token
    if r.status_code in (429,) or r.status_code >= 500:
        rec.update(state=SIGNED_OUT, retry_not_before=(_now().timestamp() + _TRANSIENT_BACKOFF_SECONDS))
        await _write(rec)
        raise OwnerIQTransient(f"OwnerIQ sign-in HTTP {r.status_code}")
    # 200 without a token (MFA challenge), or a 4xx: stop and ask the Owner.
    rec.update(state=NEEDS_RECONNECT, token=None,
               reason="OwnerIQ now needs a code at sign-in. Paste a fresh session token to reconnect.")
    await _write(rec)
    return _raise_reconnect(rec["reason"])


def _raise_reconnect(reason: str):
    raise OwnerIQNeedsReconnect(reason)


async def get_token(client: httpx.AsyncClient) -> str:
    """The one token source. Every OwnerIQ call uses this."""
    doc = await _read()
    if _relay_is_fresh(doc):
        # The browser relay is live: the server must not reach OwnerIQ itself
        # (its IP is blocked at the edge). Callers serve the relay's stored data.
        raise OwnerIQNeedsReconnect("OwnerIQ is served by the browser relay; the server does not call out.")
    state = doc.get("state")
    if state == OFF:
        raise OwnerIQNeedsReconnect("OwnerIQ is switched off.")
    if state == NEEDS_RECONNECT:
        raise OwnerIQNeedsReconnect(doc.get("reason") or "OwnerIQ needs reconnecting.")
    if doc.get("token") and state == CONNECTED:
        return doc["token"]
    async with _lock:
        doc = await _read()
        if doc.get("token") and doc.get("state") == CONNECTED:
            return doc["token"]
        if doc.get("state") == NEEDS_RECONNECT:
            raise OwnerIQNeedsReconnect(doc.get("reason") or "OwnerIQ needs reconnecting.")
        rnb = doc.get("retry_not_before")
        if rnb and _now().timestamp() < float(rnb):
            raise OwnerIQTransient("OwnerIQ sign-in is backing off; try again shortly.")
        return await _password_sign_in(client)


async def on_unauthorized(token_used: str) -> None:
    """A call carrying `token_used` got a 401. Clear it, unless the store has
    already moved on. A password token refused within minutes means MFA is now
    on the account, so stop rather than loop."""
    async with _lock:
        doc = await _read()
        if doc.get("token") != token_used:
            return
        minted = doc.get("minted_at")
        young = False
        if doc.get("source") == "password" and minted:
            try:
                young = (_now() - datetime.fromisoformat(minted)).total_seconds() < _PASSWORD_LOOP_SECONDS
            except ValueError:
                young = False
        if young:
            await _write({"state": NEEDS_RECONNECT, "token": None,
                          "reason": "OwnerIQ now needs a code at sign-in. Paste a fresh session token to reconnect."})
        else:
            await _write({"state": SIGNED_OUT, "token": None})


def parse_pasted(raw: str) -> str:
    """A bare token, 'Bearer <token>', or the whole auth-storage JSON."""
    import json
    s = (raw or "").strip()
    if not s:
        return ""
    if s.lower().startswith("bearer "):
        return s[7:].strip()
    if s.startswith("{"):
        try:
            j = json.loads(s)
            return str((j.get("state") or {}).get("token") or j.get("token") or "").strip()
        except Exception:
            return ""
    return s


async def resolve_api_base(client: httpx.AsyncClient, email: str) -> str | None:
    """Ask OwnerIQ which API host this account uses (UK/US/EU)."""
    try:
        r = await client.get("https://fr.owner-iq.ai/v3/owner/sessions/activation_info",
                             params={"email": email}, headers=_headers())
        if r.status_code == 200:
            url = (r.json() or {}).get("api_url")
            if url:
                return str(url).rstrip("/")
    except Exception:
        pass
    return None


async def reconnect(client: httpx.AsyncClient, pasted: str) -> dict:
    """The Owner pastes a token (any of the three shapes). Verify it against the
    account's host and save it. Returns a status dict (no token)."""
    token = parse_pasted(pasted)
    if not token or len(token) < 8:
        raise ValueError("That doesn't look like a session token. Copy it again from OwnerIQ.")
    email, _ = _creds()
    base = api_base(await _read())
    resolved = await resolve_api_base(client, email) if email else None
    check_base = resolved or base
    code = await probe(client, token, check_base)
    if code == 200:
        now = _now_iso()
        await _write({"token": token, "source": "browser", "minted_at": now, "state": CONNECTED,
                      "reason": None, "alerted_at": None, "retry_not_before": None, "api_base": check_base,
                      "last_ok_at": now, "last_status": 200})
        return await status()
    if code == 401:
        raise ValueError("OwnerIQ didn't recognise that token (401). Sign in again on owner-iq.ai and copy a fresh one.")
    if code == 403:
        raise ValueError("OwnerIQ's security gate is blocking the app (403). Your token is fine, but OwnerIQ isn't letting "
                         "outside apps through — they'd need to allow your app in. Nothing is saved.")
    raise ValueError(f"Couldn't reach OwnerIQ to check the token (HTTP {code}). Nothing is saved; try again shortly.")


async def turn_off() -> dict:
    """The Owner switches OwnerIQ off: clear the session and run on the
    breakdowns. Reconnecting later brings it back."""
    await _write({"state": OFF, "token": None, "source": None, "reason": None,
                  "alerted_at": None, "retry_not_before": None, "last_status": None})
    return await status()


async def retry_password() -> dict:
    """Clear the stopped state and let one password sign-in run (false alarm)."""
    await _write({"state": SIGNED_OUT, "reason": None, "alerted_at": None, "retry_not_before": None})
    return await status()


async def mark_ok() -> None:
    """A call succeeded: note it (keeps last_ok_at fresh). Best-effort."""
    try:
        await _write({"last_ok_at": _now_iso()})
    except Exception:
        pass


async def alert_tick() -> int:
    """Every few minutes: if OwnerIQ needs reconnecting and the Owner hasn't
    been told this time, tell them — by email and a banner on the Hub. Held
    between 22:00 and 07:00 so it doesn't land overnight. Owner (super-admin)
    only. Returns 1 if an alert was sent."""
    doc = await _read()
    if doc.get("state") != NEEDS_RECONNECT or doc.get("alerted_at"):
        return 0
    from core.app_time import APP_TZ
    now_local = datetime.now(APP_TZ)
    if now_local.hour < 7 or now_local.hour >= 22:
        return 0
    owner = await db.users.find_one({"is_super_admin": True, "deleted": {"$ne": True}}, {"email": 1, "name": 1, "_id": 1})
    if not owner:
        return 0
    await _write({"alerted_at": _now_iso()})
    reason = doc.get("reason") or "OwnerIQ needs reconnecting."
    try:
        from core.push import send_push_to_user
        await send_push_to_user(str(owner["_id"]), "🔌 OwnerIQ needs reconnecting",
                                "Open Admin → OwnerIQ and paste a fresh session token.",
                                {"type": "broadcast", "url": "/owneriq-connect"})
    except Exception as ex:
        logger.warning("owneriq alert push failed: %s", ex)
    try:
        if owner.get("email"):
            from core.email_utils import render_email, send_email
            html = render_email("OwnerIQ needs reconnecting",
                                "The automatic connection has stopped",
                                f"<p>{reason}</p><p>On a computer, sign in at owner-iq.ai, then open "
                                "<b>Admin → OwnerIQ</b> in the Hub and paste a fresh session token. "
                                "Until then, the team's numbers come from the breakdowns as usual.</p>")
            send_email(owner["email"], "OwnerIQ needs reconnecting", html)
    except Exception as ex:
        logger.warning("owneriq alert email failed: %s", ex)
    return 1
