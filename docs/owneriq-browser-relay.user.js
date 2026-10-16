// ==UserScript==
// @name         OwnerIQ → The Loris Group relay
// @namespace    the-loris-group
// @version      1.5
// @description  Runs in the Owner's own logged-in OwnerIQ tab. Every few minutes it reads the office's own data (the same data the dashboard shows) and posts it to the app, which stores it exactly as the server sync would. Used because the UK edge blocks server-to-server calls; the Owner's real browser is allowed.
// @match        https://owner-iq.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// HOW TO USE (two ways)
//
//  A) Quick / console:   open owner-iq.ai, sign in, press F12 → Console,
//     paste this whole file, press Enter. It syncs now, then on every quarter
//     hour (:00, :15, :30, :45) while the tab stays open and you stay logged in.
//
//  B) Always-on / Tampermonkey: install the Tampermonkey extension, add this as
//     a new userscript, and fill in the two CONFIG lines below. It then runs
//     automatically whenever an owner-iq.ai tab is open.
//
//  Fill these two in before using:
(function () {
  "use strict";

  // ─── CONFIG ────────────────────────────────────────────────────────────
  const APP_URL = "https://the-loris-group-production.up.railway.app"; // the app
  const RELAY_SECRET = "PASTE_OWNERIQ_RELAY_SECRET_HERE";              // = Railway OWNERIQ_RELAY_SECRET
  const OIQ = "https://uk.owner-iq.ai";    // OwnerIQ API host for this account
  const EVERY_MIN = 15;                    // sync on every quarter hour (:00/:15/:30/:45)
  // ───────────────────────────────────────────────────────────────────────

  const log = (...a) => console.log("%c[OIQ relay]", "color:#0a7", ...a);
  const warn = (...a) => console.warn("[OIQ relay]", ...a);

  function readToken(store) {
    try {
      const raw = store && store.getItem("auth-storage");
      const j = raw ? JSON.parse(raw) : null;
      return (j && j.state && j.state.token) || (j && j.token) || null;
    } catch (e) { return null; }
  }
  // OwnerIQ has kept the session in sessionStorage AND (older) localStorage;
  // check both so a "Not logged in" never happens while you're signed in.
  function token() {
    return readToken(sessionStorage) || readToken(localStorage) || null;
  }

  // The calendar date on this computer's clock (UK time on the Owner's
  // laptop), not UTC: just after midnight in summer, UTC is still yesterday.
  function iso(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function ddmmyyyy(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function mondayISO(weeksBack) {
    const d = new Date();
    const mon = (d.getDay() + 6) % 7;            // 0 = Monday
    d.setDate(d.getDate() - mon - 7 * (weeksBack || 0));
    return iso(d);
  }

  // GET from OwnerIQ using the current session (real browser request → allowed).
  async function oiq(path, params) {
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

  // Fire-and-forget POST to the app. text/plain = a "simple" cross-origin
  // request, so the browser sends it with no CORS preflight; no-cors means we
  // don't read the (irrelevant) response. The app authorises by the secret.
  async function toApp(path, obj) {
    obj.secret = RELAY_SECRET;
    await fetch(APP_URL + path, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(obj),
    });
  }

  async function companyPins() {
    const j = await oiq("/v2/marketing_companies");
    return (j.data || []).map((c) => c.attributes && c.attributes.pin)
      .filter((p) => p != null).map(String);
  }

  async function companyIds() {
    const j = await oiq("/v3/owner/marketing_companies/light_index");
    return (j.data || []).map((c) => c.id).filter((x) => x != null).map(String);
  }

  // Walk 0 — the roster (every office), so the app can match each OwnerIQ
  // person to the right person in your app (by badge/email) and keep stages
  // fresh. Runs first so the KPI + Bells fill below land on the right people.
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
    log(`Roster: posted ${n} people across ${walk.length} office(s)`);
  }

  // Walk 1 — KPIs for yesterday + today, every office, every page.
  async function syncKpis() {
    const today = new Date();
    const yday = new Date(today.getTime() - 864e5);
    const between = `${ddmmyyyy(yday)},${ddmmyyyy(today)}`;
    const pins = await companyPins();
    const payloads = [];
    const walkDefault = pins.length === 0 ? [null] : pins;
    for (const pin of walkDefault) {
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
    await toApp("/api/owneriq/relay/kpis", { from: iso(yday), to: iso(today), payloads });
    const rows = payloads.reduce((n, p) => n + ((p.data || []).length), 0);
    log(`KPIs: posted ${rows} rows across ${walkDefault.length} office(s)`);
  }

  // Walk 2 — a day's Live Operations tree (top → each sector → each BA).
  // Today on every sync; yesterday once a day (see syncYesterdayOnce).
  async function syncLive(day) {
    const date = iso(day || new Date());
    const ids = await companyIds();
    const extra = ids.map((i) => ["marketing_company_id[]", i]);
    const top = await oiq("/v3/owner/live_operations", [["date", date], ...extra]);
    const sectors = {}, bas = {};
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
    log(`Live${day ? " " + date : ""}: posted top + ${Object.keys(sectors).length} sectors + ${Object.keys(bas).length} BAs`);
  }

  // Yesterday, settled: on the first sync of each day, send yesterday's whole
  // Live Operations tree and door logs again. It catches the end of the field
  // day if the laptop slept early, and any late corrections, and fills the
  // Timeline. (The server used to re-pull yesterday at 03:00; it can't now.)
  const YDAY_KEY = "loris-relay-yesterday-sent";
  function ydaySentFor() { try { return localStorage.getItem(YDAY_KEY); } catch (e) { return null; } }
  function markYdaySent(d) { try { localStorage.setItem(YDAY_KEY, d); } catch (e) { /* fine: resends tomorrow */ } }
  async function syncYesterdayOnce() {
    const today = iso(new Date());
    if (ydaySentFor() === today) return;
    const yday = new Date(); yday.setDate(yday.getDate() - 1);
    await syncLive(yday);
    markYdaySent(today);
  }

  // Walk 3 — Performance Hub views: company + no-team for this & last week,
  // and each team for this week (feeds the Hub screen's cache). Also NEXT week's
  // company view (wk -1), so the week you're planning preloads its Field IQ day
  // plan into Bells — applied only, not shown on the Hub (schedule_only).
  async function syncHub() {
    const ids = await companyIds();
    for (const wk of [-1, 0, 1]) {
      const ws = mondayISO(wk);
      const views = [];
      for (const mc of ids) {
        let mcView;
        try {
          mcView = await oiq(`/v3/owner/bells_performance/marketing_companies/${mc}`, [["week_start_on", ws]]);
        } catch (e) {
          if (wk < 0) continue;   // next week may not exist in OwnerIQ yet
          throw e;
        }
        views.push({ kind: "mc", ref: mc, payload: mcView });
        if (wk >= 0) {
          try {
            const noTeam = await oiq(`/v3/owner/bells_performance/marketing_companies/${mc}/no_team`, [["week_start_on", ws]]);
            views.push({ kind: "no_team", ref: mc, payload: noTeam });
          } catch (e) { /* some offices have no "no team" bucket */ }
          if (wk === 0) {
            for (const t of (mcView.teams || [])) {
              if (t.id == null) continue;
              const tv = await oiq(`/v3/owner/bells_performance/teams/${t.id}`, [["week_start_on", ws]]);
              views.push({ kind: "team", ref: t.id, payload: tv });
            }
          }
        }
      }
      if (!views.length) continue;
      await toApp("/api/owneriq/relay/hub", { week_start: ws, views, schedule_only: wk < 0 });
      log(`Hub: posted ${views.length} views for week ${ws}${wk < 0 ? " (next week, plan only)" : ""}`);
    }
  }

  // Earlier weeks on the Performance Hub: once a day, send the office, no-team
  // and every team view for the last 11 weeks (the Hub goes back 12, and this
  // week is sent on every sync). Saved for viewing only (cache_only): the app
  // never rewrites a past week's Bells from these.
  const HUB_WEEKS_BACK = 11;
  const HUB_KEY = "loris-relay-hub-history-sent";
  async function syncHubHistoryOnce() {
    const today = iso(new Date());
    let sent = null;
    try { sent = localStorage.getItem(HUB_KEY); } catch (e) { /* resend */ }
    if (sent === today) return;
    const ids = await companyIds();
    let weeks = 0;
    for (let wk = 1; wk <= HUB_WEEKS_BACK; wk++) {
      const ws = mondayISO(wk);
      const views = [];
      for (const mc of ids) {
        let mcView;
        try {
          mcView = await oiq(`/v3/owner/bells_performance/marketing_companies/${mc}`, [["week_start_on", ws]]);
        } catch (e) {
          if (e.message === "session-expired" || e.message === "not-logged-in") throw e;
          continue;   // a week OwnerIQ won't serve: skip it
        }
        views.push({ kind: "mc", ref: mc, payload: mcView });
        try {
          const noTeam = await oiq(`/v3/owner/bells_performance/marketing_companies/${mc}/no_team`, [["week_start_on", ws]]);
          views.push({ kind: "no_team", ref: mc, payload: noTeam });
        } catch (e) { /* some offices have no "no team" bucket */ }
        for (const t of (mcView.teams || [])) {
          if (t.id == null) continue;
          try {
            const tv = await oiq(`/v3/owner/bells_performance/teams/${t.id}`, [["week_start_on", ws]]);
            views.push({ kind: "team", ref: t.id, payload: tv });
          } catch (e) {
            if (e.message === "session-expired" || e.message === "not-logged-in") throw e;
          }
        }
      }
      if (!views.length) continue;
      await toApp("/api/owneriq/relay/hub", { week_start: ws, views, cache_only: true });
      weeks += 1;
    }
    log(`Hub history: posted ${weeks} earlier week(s) for viewing`);
    try { localStorage.setItem(HUB_KEY, today); } catch (e) { /* fine: resends next sync */ }
  }

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      if (!token()) { warn("Not logged in to OwnerIQ — open owner-iq.ai and sign in."); return; }
      await syncRoster();
      await syncKpis();
      await syncLive();
      await syncHub();
      await syncYesterdayOnce();
      await syncHubHistoryOnce();
      log("sync complete", new Date().toLocaleTimeString());
    } catch (e) {
      if (e.message === "session-expired") warn("OwnerIQ session expired — sign in again at owner-iq.ai.");
      else if (e.message === "not-logged-in") warn("Not logged in to OwnerIQ.");
      else warn("sync failed:", e.message);
    } finally {
      running = false;
    }
  }

  if (RELAY_SECRET.includes("PASTE_")) {
    warn("Set RELAY_SECRET (and check APP_URL) at the top of the script first.");
    return;
  }
  // Sync on the clock, not every 15 min from whenever the tab opened: the
  // check-ins go out at 15:00, 16:30 and 19:00 (Saturday 12:00, 14:00, 16:00),
  // so a sync lands just after each one and the app sends that check-in on
  // numbers fetched seconds earlier. Re-aimed every time, so it never drifts.
  function msToNextSlot() {
    const now = new Date();
    const step = EVERY_MIN * 60 * 1000;
    const sinceHour = (now.getMinutes() * 60 + now.getSeconds()) * 1000 + now.getMilliseconds();
    return step - (sinceHour % step) + 5000;   // 5 s after the quarter hour
  }
  function scheduleNext() {
    setTimeout(() => { run(); scheduleNext(); }, msToNextSlot());
  }
  log(`starting — syncing now, then every quarter hour (:00, :15, :30, :45) while this tab is open`);
  run();
  scheduleNext();
})();
