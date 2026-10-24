/**
 * The Bells → Roll Call sheet sync, loaded by four typed lines in the sheet's
 * Apps Script (for setting up from a phone, where pasting doesn't work):
 *
 *   var BELLS={app:'https://ADDRESS',office:'OFFICE',code:'CODE'}
 *   function setUp(){ScriptApp.getProjectTriggers().forEach(function(t){ScriptApp.deleteTrigger(t)});ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();run()}
 *   function run(){eval(UrlFetchApp.fetch(
 *   'https://raw.githubusercontent.com/louiswhitaker0711-crypto/The-Loris-Group/main/docs/bells-sheet-sync.js').getContentText());updateBells()}
 *
 * BELLS holds the shared Bells link's address, office and code. Everything
 * else is docs/bells-to-google-sheet.gs (the same logic, kept in step):
 * Gold/Silver on the week's tab, day colours, names matched, a "Bells sync"
 * log tab. A fix pushed here reaches the sheet on its next run.
 */
// ── The sheet's layout (from the Roll Call tab) ──────────────────────────────
const NAME_COLUMN = 2;        // B
const FIRST_ROW = 3;          // first person
const MONDAY_GOLD_COLUMN = 12; // L (Monday Gold); M Silver, N/O Tuesday … X/Y Sunday
const LOG_TAB = 'Bells sync';

// ── The sheet's colours ──────────────────────────────────────────────────────
const COLOURS = {
  gold: '#f9d77e',          // a Gold cell, normally
  silver: '#cccccc',        // a Silver cell, normally
  notScheduled: '#666666',  // grey
  noShow: '#000000',        // black
  inOffice: '#ffff00',      // yellow
  notCurrent: '#ff0000',    // red: from the day someone exited
};

function updateBells() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const thisWeek = sundayOf(new Date());
  const lastWeek = new Date(thisWeek.getTime() - 7 * 86400000);
  const log = [];
  [lastWeek, thisWeek].forEach(function (sunday) {
    const tab = findWeekTab(book, sunday);
    if (!tab) { log.push([weekLabel(sunday), 'No tab for this week yet: skipped', '']); return; }
    try {
      const people = fetchWeek(sunday);
      const r = fillTab(tab, people, sunday);
      log.push([tab.getName(), 'Filled ' + r.filled + ' people', r.unmatched.length ? 'Not matched: ' + r.unmatched.join(', ') : '']);
    } catch (e) {
      log.push([tab.getName(), 'Failed: ' + e.message, '']);
    }
  });
  writeLog(book, log);
}

// ── The app ──────────────────────────────────────────────────────────────────
function fetchWeek(sunday) {
  const url = BELLS.app + '/api/public/bells/' + encodeURIComponent(BELLS.office)
    + '?code=' + encodeURIComponent(BELLS.code) + '&week=' + isoDate(sunday);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('the app said ' + resp.getResponseCode() + ' (check the address, office and code)');
  }
  const data = JSON.parse(resp.getContentText());
  const rows = (data.sheet && data.sheet.entries) || data.entries || [];
  return rows.map(function (e) {
    return { name: String(e.user_name || '').trim(), days: (e.days || []).slice(0, 7), leftOn: e.left_on ? String(e.left_on).slice(0, 10) : '',
      live: !!e.user_id && !e.archived };   // a real profile, not an old Roll Call import row
  }).filter(function (p) { return p.name; });
}

// ── The sheet ────────────────────────────────────────────────────────────────
function fillTab(tab, people, sunday) {
  const last = tab.getLastRow();
  if (last < FIRST_ROW) return { filled: 0, unmatched: [] };
  const names = tab.getRange(FIRST_ROW, NAME_COLUMN, last - FIRST_ROW + 1, 1).getDisplayValues();
  const labels = tab.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 2).getDisplayValues();
  let filled = 0;
  const unmatched = [];
  for (let i = 0; i < names.length; i++) {
    const row = FIRST_ROW + i;
    const label = (labels[i][0] + ' ' + labels[i][1]).toLowerCase();
    if (/\btotal\b/.test(label)) break;           // the totals block: stop
    const sheetName = String(names[i][0] || '').trim();
    if (!sheetName) continue;
    const person = matchPerson(sheetName, people);
    if (!person) { unmatched.push(sheetName); continue; }
    const values = [], fills = [];
    for (let d = 0; d < 7; d++) {
      const day = person.days[d] || {};
      const date = isoDate(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() - 6 + d));
      const block = person.leftOn && date >= person.leftOn ? COLOURS.notCurrent
        : day.status === 'ab' ? COLOURS.notScheduled
        : day.status === 'ns' ? COLOURS.noShow
        : day.status === 'pc' ? COLOURS.inOffice : null;
      if (day.status === 'in' && !block) values.push(Number(day.over30 || 0), Number(day.under30 || 0));
      else values.push('', '');
      fills.push(block || COLOURS.gold, block || COLOURS.silver);
    }
    const range = tab.getRange(row, MONDAY_GOLD_COLUMN, 1, 14);
    if (range.getValues()[0].join('|') !== values.join('|')) range.setValues([values]);
    const was = range.getBackgrounds()[0].map(function (c) { return String(c).toLowerCase(); });
    if (was.join('|') !== fills.join('|')) range.setBackgrounds([fills]);
    filled++;
  }
  return { filled: filled, unmatched: unmatched };
}

/** The person on Bells for a name on the sheet, or null when it's not clear.
 *  Real profiles first; an old Roll Call import row only when nobody real fits. */
function matchPerson(sheetName, people) {
  const live = people.filter(function (p) { return p.live; });
  return matchIn(sheetName, live) || matchIn(sheetName, people.filter(function (p) { return !p.live; }));
}

function matchIn(sheetName, people) {
  const n = clean(sheetName);
  const parts = n.split(' ');
  const one = function (list) { return list.length === 1 ? list[0] : null; };
  // 1. The full name.
  let hit = one(people.filter(function (p) { return clean(p.name) === n; }));
  if (hit) return hit;
  // 2. First name + surname initial: "Louis W".
  if (parts.length === 2 && parts[1].length === 1) {
    hit = one(people.filter(function (p) {
      const q = clean(p.name).split(' ');
      return q[0] === parts[0] && q.length > 1 && q[q.length - 1].charAt(0) === parts[1];
    }));
    if (hit) return hit;
  }
  // 3. Capital initials: "AB".
  if (/^[A-Z]{2,3}$/.test(sheetName.trim())) {
    const letters = sheetName.trim().toLowerCase();
    hit = one(people.filter(function (p) {
      const q = clean(p.name).split(' ');
      return q.map(function (w) { return w.charAt(0); }).join('') === letters
        || q[0].slice(0, letters.length) === letters;
    }));
    if (hit) return hit;
  }
  // 4. First name alone, when only one person has it.
  hit = one(people.filter(function (p) { return clean(p.name).split(' ')[0] === parts[0]; }));
  if (hit) return hit;
  // 5. A shortened first name: "Alex" = Alexander, when only one fits.
  if (parts.length === 1 && parts[0].length >= 3) {
    return one(people.filter(function (p) { return clean(p.name).split(' ')[0].indexOf(parts[0]) === 0; }));
  }
  return null;
}

function clean(s) {
  return String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The tab for a week: "WE 25/10/2026", "W/E 13/9/2026" or "WE 25102026": spaces, slashes and zero padding don't matter. */
function findWeekTab(book, sunday) {
  const d = sunday.getDate(), m = sunday.getMonth() + 1, y = sunday.getFullYear();
  const pad = function (x) { return (x < 10 ? '0' : '') + x; };
  const wanted = [d + '' + m + y, pad(d) + pad(m) + y, d + pad(m) + y, pad(d) + m + y];
  const tabs = book.getSheets();
  for (let i = 0; i < tabs.length; i++) {
    const name = tabs[i].getName().replace(/[\s\/.\-]/g, '').toUpperCase();   // 'WE 25/10/2026', 'W/E 13/9/2026'
    if (name.indexOf('WE') !== 0) continue;
    if (wanted.indexOf(name.slice(2)) >= 0) return tabs[i];
  }
  return null;
}

/** Sunday of the week (Monday to Sunday) a date falls in, UK time. */
function sundayOf(date) {
  const uk = Utilities.formatDate(date, 'Europe/London', 'yyyy-MM-dd').split('-').map(Number);
  const day = new Date(uk[0], uk[1] - 1, uk[2]);
  const dow = (day.getDay() + 6) % 7;          // Monday 0 … Sunday 6
  return new Date(uk[0], uk[1] - 1, uk[2] + (6 - dow));
}

function isoDate(d) {
  const pad = function (x) { return (x < 10 ? '0' : '') + x; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function weekLabel(d) { return 'WE ' + d.getDate() + (d.getMonth() + 1) + d.getFullYear(); }

function writeLog(book, rows) {
  let tab = book.getSheetByName(LOG_TAB);
  if (!tab) tab = book.insertSheet(LOG_TAB);
  tab.clear();
  tab.getRange(1, 1, 1, 3).setValues([['Last run: ' + Utilities.formatDate(new Date(), 'Europe/London', 'dd/MM/yyyy HH:mm'), '', '']]);
  tab.getRange(2, 1, 1, 3).setValues([['Tab', 'What happened', 'Names to check']]).setFontWeight('bold');
  if (rows.length) tab.getRange(3, 1, rows.length, 3).setValues(rows);
}
