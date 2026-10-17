// ==UserScript==
// @name         OwnerIQ → The Loris Group relay
// @namespace    the-loris-group
// @version      2.1
// @description  Runs in the Owner's own logged-in OwnerIQ tab. Once a day, between 20:00 and 20:15, it reads the office's own data for that day (the same data the dashboard shows) and posts it to the app. Used because the UK edge blocks server-to-server calls; the Owner's real browser is allowed.
// @match        https://owner-iq.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// WHAT IT DOES (v2.1, the Owner's settings, 17 Oct 2026)
//
//  • Pulls ONCE A DAY, at a random time between 20:00 and 20:15 on this
//    computer's clock (a new time each day). If the tab wasn't open (or the
//    laptop was asleep) then, it pulls once when the tab is next open that
//    evening, before midnight. Nothing at any other time.
//  • Only THAT DAY's data: the roster, today's KPIs, today's Live Operations,
//    and this week's Performance Hub (the view today sits in). No yesterday,
//    no earlier weeks, no next week.
//  • Waits a random 15 to 45 SECONDS between every request to OwnerIQ, like
//    someone tapping through the pages.
//    A full pull takes a few minutes (longer on a busy day): leave the tab
//    open until the console says "sync complete".
//  • To pull straight away (e.g. to test): in this tab's console type
//      oiqSyncNow()
//    and press Enter.
//
// HOW TO INSTALL (Tampermonkey): add this as a new userscript, fill in the
// RELAY_SECRET line below, save. It runs whenever an owner-iq.ai tab is open.
//
//  Fill these two in before using:
(function () {
  "use strict";

  // ─── CONFIG ────────────────────────────────────────────────────────────
  const APP_URL = "https://the-loris-group-production.up.railway.app"; // the app
  const RELAY_SECRET = "PASTE_OWNERIQ_RELAY_SECRET_HERE";              // = Railway OWNERIQ_RELAY_SECRET
  const OIQ = "https://uk.owner-iq.ai";    // OwnerIQ API host for this account
  const PULL_HOUR = 20;                    // pull once a day from 20:00…
  const START_SPREAD_MIN = 15;             // …at a random minute up to 20:15
  const GAP_MIN_MS = 15 * 1000;            // a random 15-45 s between OwnerIQ requests
  const GAP_MAX_MS = 45 * 1000;
  // ───────────────────────────────────────────────────────────────────────

  const log = (...a) => console.log("%c[OIQ relay]", "color:#0a7", ...a);
  const warn = (...a) => console.warn("[OIQ relay]", ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function readToken(store) {
    try {
      const raw = store && store.getItem("auth-storage");
      const j = raw ? JSON.parse(raw) : null;
      return (j && j.state && j.state.token) || (j && j.token) || null;
    } catch (e) { return null; }
  }
  // OwnerIQ has kept the session in sessionStorage AND (older) localStorage.
  function token() {
    return readToken(sessionStorage) || readToken(localStorage) || null;
  }

  // The calendar date on this computer's clock (UK time), not UTC.
  function iso(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function ddmmyyyy(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function thisMondayISO() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // back to Monday
    return iso(d);
  }

  // GET from OwnerIQ using the current session, a random 15-45 s after the last one.
  let lastCall = 0;
  const gap = () => GAP_MIN_MS + Math.floor(Math.random() * (GAP_MAX_MS - GAP_MIN_MS + 1));
  async function oiq(path, params) {
    const wait = lastCall + gap() - Date.now();
    if (lastCall && wait > 0) await sleep(wait);
    lastCall = Date.now();
    const tok = token();
    if (!tok) throw new Error("not-logged-in");
    const url = new URL(OIQ + path);
    (params || []).forEach(([k, v]) => url.searchParams.append(k, v));
    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "accept": "application/vnd.api+json, application/json, text/plain, */*",
        "x-requested-with": "XMLHttpRequest",
        "x-client-app": "owneriq",
        "x-client-app-version": "1.6.0",
        "authorization": "Bearer " + tok,
      },
    });
    if (r.status === 401) throw new Error("session-expired");
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
    return r.json();
  }

  // POST to the app (text/plain: no CORS preflight; the app checks the secret).
  async function toApp(path, obj) {
    obj.secret = RELAY_SECRET;
    await fetch(APP_URL + path, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(obj),
    });
  }

  // Looked up once per pull, not once per step.
  let pinsCache = null, idsCache = null;
  async function companyPins() {
    if (pinsCache) return pinsCache;
    const j = await oiq("/v2/marketing_companies");
    pinsCache = (j.data || []).map((c) => c.attributes && c.attributes.pin).filter((p) => p != null).map(String);
    return pinsCache;
  }
  async function companyIds() {
    if (idsCache) return idsCache;
    const j = await oiq("/v3/owner/marketing_companies/light_index");
    idsCache = (j.data || []).map((c) => c.id).filter((x) => x != null).map(String);
    return idsCache;
  }

  // 1 — the roster, so the app links each OwnerIQ person to the right person.
  async function syncRoster() {
    const pins = await companyPins();
    const walk = pins.length === 0 ? [null] : pins;
    const payloads = [];
    for (const pin of walk) {
      if (pin) await oiq("/v2/marketing_companies", [["mc_pin", pin]]); // select office
      payloads.push(await oiq("/v2/users", [["limit", 2000]]));
    }
    await toApp("/api/owneriq/relay/roster", { payloads, pins: walk });
    const n = payloads.reduce((a, p) => a + ((p.data || []).length), 0);
    log(`Roster: posted ${n} people`);
  }

  // 2 — today's KPIs, every office, every page.
  async function syncKpis() {
    const today = new Date();
    const between = `${ddmmyyyy(today)},${ddmmyyyy(today)}`;
    const pins = await companyPins();
    const payloads = [];
    const walk = pins.length === 0 ? [null] : pins;
    for (const pin of walk) {
      if (pin) await oiq("/v2/marketing_companies", [["mc_pin", pin]]); // select office
      let page = 1;
      for (;;) {
        const j = await oiq("/v2/door_interaction_kpis", [
          ["between_dates", between], ["page", page], ["per_page", 100],
          ["include", "user"], ["sortColumn", ""], ["sortDirection", ""],
        ]);
        payloads.push(j);
        const total = (j.meta && j.meta.total_pages) || 1;
        if (page >= total) break;
        page += 1;
      }
    }
    await toApp("/api/owneriq/relay/kpis", { from: iso(today), to: iso(today), payloads });
    const rows = payloads.reduce((n, p) => n + ((p.data || []).length), 0);
    log(`KPIs: posted ${rows} rows for today`);
  }

  // 3 — today's Live Operations (top → each sector → each BA's door log).
  async function syncLive() {
    const date = iso(new Date());
    const ids = await companyIds();
    const extra = ids.map((i) => ["marketing_company_id[]", i]);
    const top = await oiq("/v3/owner/live_operations", [["date", date], ...extra]);
    const sectors = {}, bas = {};
    const nSec = (top.sectors || []).length;
    if (nSec) log(`Live: ${nSec} sector(s) to read — this part takes a few minutes`);
    for (const s of (top.sectors || [])) {
      if (s.id == null) continue;
      const sd = await oiq(`/v3/owner/live_operations/sectors/${s.id}`, [["date", date]]);
      sectors[s.id] = sd;
      for (const m of (sd.members || [])) {
        if (m.id == null) continue;
        bas[m.id] = await oiq(`/v3/owner/live_operations/bas/${m.id}`, [["date", date]]);
      }
    }
    await toApp("/api/owneriq/relay/live", { date, top, sectors, bas });
    log(`Live: posted ${Object.keys(sectors).length} sectors + ${Object.keys(bas).length} BAs for today`);
  }

  // 4 — this week's Performance Hub (the week today is in): the office, the
  // no-team bucket and each team. Fills this week's Bells goals and marks.
  async function syncHub() {
    const ws = thisMondayISO();
    const views = [];
    for (const mc of await companyIds()) {
      const mcView = await oiq(`/v3/owner/bells_performance/marketing_companies/${mc}`, [["week_start_on", ws]]);
      views.push({ kind: "mc", ref: mc, payload: mcView });
      try {
        const noTeam = await oiq(`/v3/owner/bells_performance/marketing_companies/${mc}/no_team`, [["week_start_on", ws]]);
        views.push({ kind: "no_team", ref: mc, payload: noTeam });
      } catch (e) {
        if (e.message === "session-expired" || e.message === "not-logged-in") throw e;
      }
      for (const t of (mcView.teams || [])) {
        if (t.id == null) continue;
        const tv = await oiq(`/v3/owner/bells_performance/teams/${t.id}`, [["week_start_on", ws]]);
        views.push({ kind: "team", ref: t.id, payload: tv });
      }
    }
    if (views.length) await toApp("/api/owneriq/relay/hub", { week_start: ws, views });
    log(`Hub: posted ${views.length} views for this week`);
  }

  // ── Once a day at 20:00 ─────────────────────────────────────────────────
  const DONE_KEY = "loris-relay-done-for";
  const doneFor = () => { try { return localStorage.getItem(DONE_KEY); } catch (e) { return null; } };
  const markDone = (d) => { try { localStorage.setItem(DONE_KEY, d); } catch (e) { /* fine */ } };

  let running = false;
  async function run(force) {
    if (running) return;
    const today = iso(new Date());
    if (!force && doneFor() === today) return;
    if (!token()) { warn("Not logged in to OwnerIQ — sign in at owner-iq.ai and the 20:00 pull will run."); return; }
    running = true;
    pinsCache = null; idsCache = null; lastCall = 0;
    log("pulling today's data (15-45 s between requests — leave this tab open)…");
    try {
      await syncRoster();
      await syncKpis();
      await syncLive();
      await syncHub();
      markDone(today);
      log("sync complete", new Date().toLocaleTimeString());
    } catch (e) {
      if (e.message === "session-expired") warn("OwnerIQ session expired — sign in again; it will retry within the hour.");
      else if (e.message === "not-logged-in") warn("Not logged in to OwnerIQ.");
      else warn("sync failed:", e.message, "— it will retry within the hour.");
    } finally {
      running = false;
    }
  }

  // Today's start minute (0-15 past 20:00): picked at random once a day and
  // remembered, so a page reload doesn't move it.
  const START_KEY = "loris-relay-start";
  function startMinute() {
    const today = iso(new Date());
    try {
      const saved = JSON.parse(localStorage.getItem(START_KEY) || "null");
      if (saved && saved.d === today) return saved.m;
    } catch (e) { /* pick a new one */ }
    const m = Math.floor(Math.random() * (START_SPREAD_MIN + 1));
    try { localStorage.setItem(START_KEY, JSON.stringify({ d: today, m })); } catch (e) { /* fine */ }
    return m;
  }

  // Checked once a minute: from today's start time to midnight, pull once if
  // today's pull hasn't happened. A failed pull is retried at most once an hour.
  let lastTry = 0;
  function tick() {
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < PULL_HOUR * 60 + startMinute()) return;
    if (doneFor() === iso(new Date())) return;
    if (Date.now() - lastTry < 60 * 60 * 1000) return;
    lastTry = Date.now();
    run(false);
  }

  if (RELAY_SECRET.includes("PASTE_")) {
    warn("Set RELAY_SECRET (and check APP_URL) at the top of the script first.");
    return;
  }
  window.oiqSyncNow = () => run(true);
  const sm = String(startMinute()).padStart(2, "0");
  log(`ready — pulls today's data once a day, today at ${PULL_HOUR}:${sm} (${doneFor() === iso(new Date()) ? "today's is done" : "not yet today"}). Type oiqSyncNow() to pull now.`);
  tick();
  setInterval(tick, 60 * 1000);
})();
