/**
 * Bells → the Roll Call Google Sheet (Gold and Silver only).
 *
 * Every 15 minutes this fills each person's Gold and Silver for the week from
 * The Loris Hub, on the week's own tab ("WE 25102026"), and colours the day
 * the way the sheet does. It only touches the Gold/Silver cells (Monday L/M …
 * Sunday X/Y): names, goals, focus and every formula on the sheet are left
 * exactly as they are.
 *
 *   • The names are already on the sheet (column B). Each is matched to the
 *     person on Bells: full name, first name + surname initial ("Louis W"),
 *     first name alone when only one person has it, or capital initials
 *     ("AB" = Abdoulie B…). Anyone it can't match is listed on the
 *     "Bells sync" tab so you can fix the spelling.
 *   • The app wins: a day in the field gets its Gold and Silver (0 and 0 on a
 *     day with no sign-ups) on gold and silver. A day not in the field is
 *     emptied and coloured: grey Not scheduled, black No show, yellow In
 *     office, red not current (from the day someone exited). Any other day
 *     (nothing entered yet, shadow day, retrain) is emptied and goes back to
 *     gold and silver. Change the colours below to match your sheet exactly.
 *   • It fills this week's tab and last week's (so late changes to Saturday
 *     land), and skips a week whose tab doesn't exist yet.
 *   • Someone new on Bells gets a row straight under their Coach's name on
 *     this week's tab (first name; "First L" if two share a first name), with
 *     ST and PR from the app. Formulas and totals stretch to include them.
 *   • Sunday from 21:00 it makes next week's tab ("WE 01/11/2026") as a copy
 *     of this week's, put first: ST, PR and Break even kept, Last Week = each
 *     person's total, Goal from the app, Focus/Was/Goal/Team Goal cleared,
 *     days back to blank gold and silver, and anyone who exited taken off
 *     (they stay, in red, on the week they left).
 *
 * SET UP (once)
 *   1. In the Roll Call sheet: Extensions → Apps Script. Paste this whole
 *      file in place of what's there, and fill in the three settings below
 *      (the same address, office and code as your shared Bells link).
 *   2. Choose the function "setUp" at the top and press Run. Google asks you
 *      to allow it to edit this sheet and reach the app: Allow.
 *   3. Done. It runs every 15 minutes, and there's a "Bells" menu on the
 *      sheet with "Update now".
 */

// ── Settings: copy these from your shared Bells link ─────────────────────────
// The link looks like  https://APP_ADDRESS/public/bells/OFFICE?code=CODE
const APP_ADDRESS = 'https://your-app-address';   // no slash at the end
const OFFICE = 'your-office';                      // the part after /public/bells/
const SHARE_CODE = 'your-share-code';              // the part after ?code=

// ── The sheet's layout (from the Roll Call tab) ──────────────────────────────
const NAME_COLUMN = 2;        // B
const FIRST_ROW = 3;          // first person
const MONDAY_GOLD_COLUMN = 12; // L (Monday Gold); M Silver, N/O Tuesday … X/Y Sunday
const COL = { st: 3, pr: 4, breakEven: 5, lastWeek: 6, goal: 7, focusFrom: 8, focusTo: 11 };  // C D E F G, H–K
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

function setUp() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'updateBells'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('updateBells').timeBased().everyMinutes(15).create();
  updateBells();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bells').addItem('Update now', 'updateBells').addToUi();
}

function updateBells() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const thisWeek = sundayOf(now);
  const lastWeek = addDays(thisWeek, -7);
  const nextWeek = addDays(thisWeek, 7);
  const log = [];
  [lastWeek, thisWeek].forEach(function (sunday) {
    let tab = findWeekTab(book, sunday);
    // This week's tab missing (Sunday's run didn't happen): make it now.
    if (!tab && sunday === thisWeek) {
      try { tab = makeWeekTab(book, sunday, log); } catch (e) { log.push([weekLabel(sunday), 'Could not make the tab: ' + e.message, '']); }
    }
    if (!tab) { log.push([weekLabel(sunday), 'No tab for this week yet: skipped', '']); return; }
    try {
      const people = fetchWeek(sunday);
      const added = sunday === thisWeek ? addNewPeople(tab, people) : [];
      const r = fillTab(tab, people, sunday);
      log.push([tab.getName(), 'Filled ' + r.filled + ' people' + (added.length ? ' · added ' + added.join(', ') : ''),
        r.unmatched.length ? 'Not matched: ' + r.unmatched.join(', ') : '']);
    } catch (e) {
      log.push([tab.getName(), 'Failed: ' + e.message, '']);
    }
  });
  // Sunday from 21:00: next week's tab, ready for Monday.
  if (isSundayEvening(now) && !findWeekTab(book, nextWeek)) {
    try { makeWeekTab(book, nextWeek, log); } catch (e) { log.push([weekLabel(nextWeek), 'Could not make the tab: ' + e.message, '']); }
  }
  writeLog(book, log);
}

// ── Next week's tab ──────────────────────────────────────────────────────────
/** A copy of the week before's tab for `sunday`, set up for the new week. */
function makeWeekTab(book, sunday, log) {
  const before = addDays(sunday, -7);
  const from = findWeekTab(book, before);
  if (!from) throw new Error('no tab for the week before (' + weekLabel(before) + ') to copy');
  const finished = fetchWeek(before);            // the week that's ending: totals and who exited
  let coming = [];
  try { coming = fetchWeek(sunday); } catch (e) { coming = []; }   // goals already set for next week
  const tab = from.copyTo(book).setName(weekLabel(sunday));
  book.setActiveSheet(tab);
  book.moveActiveSheet(1);
  const monday = isoDate(addDays(sunday, -6));
  const removed = [];
  // Bottom up, so deleting a row doesn't move the ones still to check.
  const rows = personRows(tab);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const p = matchPerson(r.name, finished);
    if (p && p.leftOn && p.leftOn < monday) { tab.deleteRow(r.row); removed.push(r.name); }
  }
  personRows(tab).forEach(function (r) {
    const p = matchPerson(r.name, finished);
    const next = matchPerson(r.name, coming);
    tab.getRange(r.row, COL.lastWeek).setValue(p ? p.total : '');
    tab.getRange(r.row, COL.goal).setValue(next && next.goal != null ? next.goal : '');
    tab.getRange(r.row, COL.focusFrom, 1, COL.focusTo - COL.focusFrom + 1).clearContent();
    const days = tab.getRange(r.row, MONDAY_GOLD_COLUMN, 1, 14);
    days.clearContent();
    days.setBackgrounds([[0, 1, 2, 3, 4, 5, 6].reduce(function (a) { return a.concat([COLOURS.gold, COLOURS.silver]); }, [])]);
  });
  log.push([tab.getName(), 'New week made from ' + from.getName() + (removed.length ? ' · taken off (exited): ' + removed.join(', ') : ''), '']);
  return tab;
}

// ── New people ───────────────────────────────────────────────────────────────
/** Anyone on Bells who isn't on the tab gets a row under their Coach's name. */
function addNewPeople(tab, people) {
  const added = [];
  const live = people.filter(function (p) { return p.live && !(p.leftOn); });
  live.forEach(function (p) {
    const rows = personRows(tab);
    const onSheet = rows.some(function (r) { return matchPerson(r.name, people) === p; });
    if (onSheet) return;
    const coachRow = p.coach ? rows.filter(function (r) { return matchPerson(r.name, people) && clean(matchPerson(r.name, people).name) === clean(p.coach); })[0] : null;
    const at = coachRow || rows[0];
    if (!at) return;
    const row = insertPersonRow(tab, at.row);
    const name = sheetNameFor(p, live);
    tab.getRange(row, NAME_COLUMN).setValue(name);
    tab.getRange(row, COL.st).setValue(stageText(p.stage));
    tab.getRange(row, COL.pr).setValue(p.badge === 'OR' ? 'O' : p.badge || '');
    tab.getRange(row, COL.breakEven).setValue(p.breakEven != null ? p.breakEven : '');
    tab.getRange(row, COL.lastWeek).setValue('');
    tab.getRange(row, COL.goal).setValue(p.goal != null ? p.goal : '');
    added.push(name);
  });
  return added;
}

/** A new row straight under `row`, inside the same block so the sheet's
 *  totals stretch to include it, carrying that row's formats and formulas;
 *  its name, details and days start empty. Returns the new row's number. */
function insertPersonRow(tab, row) {
  const width = tab.getLastColumn();
  const below = String(tab.getRange(row + 1, NAME_COLUMN).getDisplayValue() || '').trim();
  let target;
  if (below) {
    tab.insertRowAfter(row);
    target = row + 1;
    tab.getRange(row, 1, 1, width).copyTo(tab.getRange(target, 1, 1, width));
  } else {
    // `row` is the last in its block: add the row above it (inside the
    // totals' ranges), move `row` up into it, and use the old row.
    tab.insertRowBefore(row);
    tab.getRange(row + 1, 1, 1, width).copyTo(tab.getRange(row, 1, 1, width));
    target = row + 1;
  }
  tab.getRange(target, NAME_COLUMN, 1, COL.focusTo - NAME_COLUMN + 1).clearContent();
  const days = tab.getRange(target, MONDAY_GOLD_COLUMN, 1, 14);
  days.clearContent();
  days.setBackgrounds([[0, 1, 2, 3, 4, 5, 6].reduce(function (a) { return a.concat([COLOURS.gold, COLOURS.silver]); }, [])]);
  return target;
}

/** First name, or "First L" when someone else on Bells has the same first name. */
function sheetNameFor(p, people) {
  const words = String(p.name).trim().split(/\s+/);
  const first = words[0];
  const twin = people.some(function (q) { return q !== p && clean(q.name).split(' ')[0] === clean(first); });
  return twin && words.length > 1 ? first + ' ' + words[words.length - 1].charAt(0).toUpperCase() : first;
}

/** The app's stage as the sheet writes it: "3" → "s3", "SL" → "s3+". */
function stageText(stage) {
  const s = String(stage || '').trim();
  if (!s) return '';
  if (s.toUpperCase() === 'SL') return 's3+';
  return 's' + s;
}

/** The person rows on a tab: [{row, name}], from the first person to the totals. */
function personRows(tab) {
  const last = tab.getLastRow();
  if (last < FIRST_ROW) return [];
  const names = tab.getRange(FIRST_ROW, NAME_COLUMN, last - FIRST_ROW + 1, 1).getDisplayValues();
  const labels = tab.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 2).getDisplayValues();
  const out = [];
  for (let i = 0; i < names.length; i++) {
    if (/\btotal\b/.test((labels[i][0] + ' ' + labels[i][1]).toLowerCase())) break;
    const name = String(names[i][0] || '').trim();
    if (name) out.push({ row: FIRST_ROW + i, name: name });
  }
  return out;
}

function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

function isSundayEvening(date) {
  const uk = Utilities.formatDate(date, 'Europe/London', 'u HH').split(' ');   // u: 7 = Sunday
  return uk[0] === '7' && Number(uk[1]) >= 21;
}

// ── The app ──────────────────────────────────────────────────────────────────
function fetchWeek(sunday) {
  const url = APP_ADDRESS + '/api/public/bells/' + encodeURIComponent(OFFICE)
    + '?code=' + encodeURIComponent(SHARE_CODE) + '&week=' + isoDate(sunday);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('the app said ' + resp.getResponseCode() + ' (check the address, office and code)');
  }
  const data = JSON.parse(resp.getContentText());
  const rows = (data.sheet && data.sheet.entries) || data.entries || [];
  return rows.map(function (e) {
    return { name: String(e.user_name || '').trim(), days: (e.days || []).slice(0, 7), leftOn: e.left_on ? String(e.left_on).slice(0, 10) : '',
      live: !!e.user_id && !e.archived,   // a real profile, not an old Roll Call import row
      coach: String(e.coach_name || '').trim(), role: e.role || '',
      stage: e.stage_label || '', badge: e.recruit_badge || '', breakEven: e.break_even,
      goal: e.weekly_goal, total: Number(e.total_sales || 0) };
  }).filter(function (p) { return p.name; });
}

// ── The sheet ────────────────────────────────────────────────────────────────
function fillTab(tab, people, sunday) {
  let filled = 0;
  const unmatched = [];
  const rows = personRows(tab);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].row;
    const sheetName = rows[i].name;
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

/** A tab name in the sheet's style: "WE 01/11/2026". */
function weekLabel(d) { return 'WE ' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }

function writeLog(book, rows) {
  let tab = book.getSheetByName(LOG_TAB);
  if (!tab) tab = book.insertSheet(LOG_TAB);
  tab.clear();
  tab.getRange(1, 1, 1, 3).setValues([['Last run: ' + Utilities.formatDate(new Date(), 'Europe/London', 'dd/MM/yyyy HH:mm'), '', '']]);
  tab.getRange(2, 1, 1, 3).setValues([['Tab', 'What happened', 'Names to check']]).setFontWeight('bold');
  if (rows.length) tab.getRange(3, 1, rows.length, 3).setValues(rows);
}
