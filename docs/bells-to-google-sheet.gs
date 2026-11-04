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
 *     office, red not current (from the day someone exited). A shadow day,
 *     and a new start's first three days (Academy Monday and Tuesday, shadow
 *     Wednesday) unless they have sign-ups, are yellow in office. Any other
 *     day (nothing entered yet, retrain) is emptied and goes back to gold and
 *     silver. A team's label in column A that's been broken into one squashed
 *     copy per row is merged back down its block. Change the colours below to match your sheet exactly.
 *   • It fills this week's tab and last week's (so late changes to Saturday
 *     land), and skips a week whose tab doesn't exist yet.
 *   • Someone new on Bells gets a row straight under their Coach's name on
 *     this week's tab (first name; "First L" if two share a first name), with
 *     ST and PR from the app. Formulas and totals stretch to include them.
 *   • A new start with a Coach sits straight under that Coach, in the
 *     Coach's team, as on Bells; one added before they had a Coach is moved.
 *     The office totals (and any team total) always count every person's
 *     row. Every week's tab is tidied this way once after an update.
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
      const moved = placeNewStarts(tab, people, sunday);
      const mended = repairTeamBlocks(tab);
      if (mended.length) log.push([tab.getName(), 'Team labels mended: ' + mended.join(', '), '']);
      const totals = fixTotals(tab);
      const r = fillTab(tab, people, sunday);
      log.push([tab.getName(), 'Filled ' + r.filled + ' people' + (added.length ? ' · added ' + added.join(', ') : '')
        + (moved.length ? ' · moved ' + moved.join(', ') : '') + (totals.changed ? ' · totals now count everyone' : ''),
        (r.unmatched.length ? 'Not matched: ' + r.unmatched.join(', ') : '')
        + (totals.skipped.length ? (r.unmatched.length ? ' · ' : '') + 'Totals to check by hand: ' + totals.skipped.join(', ') : '')]);
    } catch (e) {
      log.push([tab.getName(), 'Failed: ' + e.message, '']);
    }
  });
  // Sunday from 21:00: next week's tab, ready for Monday.
  if (isSundayEvening(now) && !findWeekTab(book, nextWeek)) {
    try { makeWeekTab(book, nextWeek, log); } catch (e) { log.push([weekLabel(nextWeek), 'Could not make the tab: ' + e.message, '']); }
  }
  tidyAllWeeks(book, log);
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
  // Column A is the team's label, one merged cell down the block: inserting
  // inside the block stretches it, so only B onwards is copied (copying A
  // broke the label into one squashed copy per row, 28 Oct 2026).
  const cols = width - NAME_COLUMN + 1;
  let target;
  if (below) {
    tab.insertRowAfter(row);
    target = row + 1;
    tab.getRange(row, NAME_COLUMN, 1, cols).copyTo(tab.getRange(target, NAME_COLUMN, 1, cols));
  } else {
    // `row` is the last in its block: add the row above it (inside the
    // totals' ranges), move `row` up into it, and use the old row.
    tab.insertRowBefore(row);
    tab.getRange(row + 1, NAME_COLUMN, 1, cols).copyTo(tab.getRange(row, NAME_COLUMN, 1, cols));
    target = row + 1;
    // A one-person team has no merged label to stretch: its label moved down
    // with the old row, so give the new top row the label too and let
    // repairTeamBlocks merge them into one.
    const labelCell = tab.getRange(row + 1, 1);
    if (!labelCell.isPartOfMerge() && String(labelCell.getDisplayValue()).trim() && !String(tab.getRange(row, 1).getDisplayValue()).trim()) {
      tab.getRange(row, 1).setValue(labelCell.getValue());
    }
  }
  tab.getRange(target, NAME_COLUMN, 1, COL.focusTo - NAME_COLUMN + 1).clearContent();
  const days = tab.getRange(target, MONDAY_GOLD_COLUMN, 1, 14);
  days.clearContent();
  days.setBackgrounds([[0, 1, 2, 3, 4, 5, 6].reduce(function (a) { return a.concat([COLOURS.gold, COLOURS.silver]); }, [])]);
  return target;
}

/** Column A: each team's label is one merged cell down its block, with thin
 *  lines between people and thick lines round the block. Where a label has
 *  been broken into one cell per row, or a block has thick lines inside it,
 *  put it back. Returns the labels mended. */
function repairTeamBlocks(tab) {
  const last = tab.getLastRow();
  if (last < FIRST_ROW) return [];
  const width = tab.getLastColumn();
  const n = last - FIRST_ROW + 1;
  const labelOf = [];
  const names = tab.getRange(FIRST_ROW, 1, n, 2).getDisplayValues();
  let end = n;
  for (let i = 0; i < n; i++) {
    if (/\btotal\b/.test((names[i][0] + ' ' + names[i][1]).toLowerCase())) { end = i; break; }
  }
  // The label for each row: the merged cell it sits in, or its own value.
  const merges = tab.getRange(FIRST_ROW, 1, end, 1).getMergedRanges();
  for (let i = 0; i < end; i++) labelOf.push(String(names[i][0] || '').trim());
  merges.forEach(function (m) {
    const v = String(m.getCell(1, 1).getDisplayValue() || '').trim();
    for (let r = m.getRow(); r <= m.getLastRow(); r++) {
      const i = r - FIRST_ROW;
      if (i >= 0 && i < end) labelOf[i] = v;
    }
  });
  const mended = [];
  let i = 0;
  while (i < end) {
    const label = labelOf[i];
    if (!label) { i++; continue; }
    let j = i;
    while (j + 1 < end && labelOf[j + 1] === label) j++;
    const top = FIRST_ROW + i, rows = j - i + 1;
    const col = tab.getRange(top, 1, rows, 1);
    const whole = col.getMergedRanges();
    const ok = rows === 1 || (whole.length === 1 && whole[0].getRow() === top && whole[0].getNumRows() === rows);
    if (!ok) {
      // The label's look from its biggest remaining merged cell (the original).
      const biggest = whole.slice().sort(function (a, b) { return b.getNumRows() - a.getNumRows(); })[0];
      const rotation = (biggest ? biggest.getCell(1, 1) : tab.getRange(top, 1)).getTextRotation().getDegrees();
      col.breakApart();
      col.clearContent();
      col.merge();
      col.setValue(label).setVerticalAlignment('middle').setHorizontalAlignment('center').setTextRotation(rotation || 90);
      // Thin lines between people, thick along the top and bottom of the block.
      const block = tab.getRange(top, NAME_COLUMN, rows, width - NAME_COLUMN + 1);
      block.setBorder(null, null, null, null, null, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
      block.setBorder(true, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
      tab.getRange(top, 1, rows, 1).setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
      mended.push(label);
    }
    i = j + 1;
  }
  return mended;
}

// ── New starts under their Coach ─────────────────────────────────────────────
/** A new start (started in the 6 weeks up to this tab's Sunday) whose Coach
 *  is on the tab sits straight under that Coach, inside the Coach's team, the
 *  way Bells shows them (the Owner, 4 Nov 2026). Anyone sitting somewhere
 *  else (e.g. added before they had a Coach) is moved: a new row at the end
 *  of the Coach's group, their details and days copied in, the old row
 *  deleted. Returns the names moved. */
function placeNewStarts(tab, people, sunday) {
  const moved = [];
  const from = isoDate(addDays(sunday, -42));
  const fresh = people.filter(function (p) {
    return p.live && p.coach && p.startDate && p.startDate >= from && p.startDate <= isoDate(sunday);
  });
  fresh.forEach(function (p) {
    const rows = personRows(tab);
    const who = rows.map(function (r) { return matchPerson(r.name, people); });
    const mine = who.indexOf(p);
    if (mine < 0) return;
    const coachAt = who.findIndex(function (q) { return q && clean(q.name) === clean(p.coach); });
    if (coachAt < 0) return;
    // The Coach's group: the Coach's row and the rows straight under it of
    // people the same Coach coaches, in the same team block.
    const block = blockOfRow(tab, rows[coachAt].row);
    let end = coachAt;
    while (end + 1 < rows.length && who[end + 1] && clean(who[end + 1].coach) === clean(p.coach)
      && rows[end + 1].row === rows[end].row + 1
      && (!block || rows[end + 1].row <= block.bottom)) end++;
    if (mine > coachAt && mine <= end) return;   // already in place
    const oldRow = rows[mine].row;
    const at = rows[end].row;
    const width = tab.getLastColumn();
    const cols = width - NAME_COLUMN + 1;
    const src = tab.getRange(oldRow, NAME_COLUMN, 1, cols);
    const values = src.getValues()[0], formulas = src.getFormulas()[0];
    const dayFills = tab.getRange(oldRow, MONDAY_GOLD_COLUMN, 1, 14).getBackgrounds()[0];
    const target = insertPersonRow(tab, at);
    const old = oldRow > at ? oldRow + 1 : oldRow;
    // Their own typed details and days; the new row keeps its own formulas.
    const lastTyped = MONDAY_GOLD_COLUMN + 13;
    for (let c = 0; c < cols; c++) {
      const col = NAME_COLUMN + c;
      if (col > lastTyped || formulas[c]) continue;
      if (tab.getRange(target, col).getFormula()) continue;
      tab.getRange(target, col).setValue(values[c]);
    }
    tab.getRange(target, MONDAY_GOLD_COLUMN, 1, 14).setBackgrounds([dayFills]);
    tab.deleteRow(old);
    moved.push(String(values[0]) + ' → under ' + rows[coachAt].name);
  });
  return moved;
}

/** The team block (merged label in column A) a row sits in: {top, bottom}. */
function blockOfRow(tab, row) {
  const m = tab.getRange(row, 1).getMergedRanges()[0];
  return m ? { top: m.getRow(), bottom: m.getLastRow() } : { top: row, bottom: row };
}

// ── Totals ───────────────────────────────────────────────────────────────────
/** The office totals under the people (Total, Scoring BAs, BAs in field …)
 *  count every person on the tab, and a team's own total row counts its
 *  whole team, however rows have been added or moved (the Owner, 4 Nov 2026:
 *  new starts' rows weren't being counted). Only references inside the
 *  people's rows are touched. Returns the cells changed and any it couldn't. */
function fixTotals(tab) {
  const out = { changed: 0, skipped: [] };
  const last = tab.getLastRow();
  if (last < FIRST_ROW) return out;
  const width = tab.getLastColumn();
  const labels = tab.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, 2).getDisplayValues();
  let totalAt = -1;
  for (let i = 0; i < labels.length; i++) {
    if (/\btotal\b/.test((labels[i][0] + ' ' + labels[i][1]).toLowerCase())) { totalAt = FIRST_ROW + i; break; }
  }
  if (totalAt < 0) return out;
  const peopleEnd = totalAt - 1;
  const blocks = teamBlocks(tab, peopleEnd);
  const rowCount = last - totalAt + 1;
  const text = tab.getRange(totalAt, 1, rowCount, Math.min(width, COL.focusTo)).getDisplayValues();
  const formulas = tab.getRange(totalAt, 1, rowCount, width).getFormulas();
  let officeGroup = true;
  for (let i = 0; i < rowCount; i++) {
    const label = text[i].join(' ').trim();
    if (!label && !formulas[i].some(function (f) { return f; })) { officeGroup = false; continue; }
    let span = null;
    if (officeGroup) span = { top: FIRST_ROW, bottom: peopleEnd };
    else {
      const l = clean(label);
      const team = blocks.filter(function (b) { return b.label && l.indexOf(clean(b.label)) >= 0; })[0];
      if (team) span = { top: team.top, bottom: team.bottom };
    }
    if (!span) continue;
    for (let c = 0; c < width; c++) {
      const f = formulas[i][c];
      if (!f) continue;
      const fixed = widenFormula(f, span, FIRST_ROW, peopleEnd);
      if (fixed === null) { out.skipped.push(tab.getRange(totalAt + i, c + 1).getA1Notation()); continue; }
      if (fixed !== f) { tab.getRange(totalAt + i, c + 1).setFormula(fixed); out.changed++; }
    }
  }
  return out;
}

/** The team blocks above the totals: [{label, top, bottom}]. */
function teamBlocks(tab, peopleEnd) {
  const out = [];
  if (peopleEnd < FIRST_ROW) return out;
  tab.getRange(FIRST_ROW, 1, peopleEnd - FIRST_ROW + 1, 1).getMergedRanges().forEach(function (m) {
    out.push({ label: String(m.getCell(1, 1).getDisplayValue() || '').trim(), top: m.getRow(), bottom: m.getLastRow() });
  });
  return out;
}

/** `f` with every reference to the people's rows (rows `areaTop`–`areaBottom`)
 *  in a column turned into one range over `span`. Several references to the
 *  same column joined by "," or "+" become one range. Returns null when a
 *  formula uses the people's rows in a way it can't safely widen. */
function widenFormula(f, span, areaTop, areaBottom) {
  // Hide quoted text so nothing inside it is read as a cell.
  const masked = f.replace(/"[^"]*"/g, function (s) { return s.replace(/[^"]/g, ' '); });
  const re = /(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;
  const refs = [];
  let m;
  while ((m = re.exec(masked))) {
    const before = masked.charAt(m.index - 1), after = masked.charAt(m.index + m[0].length);
    if (/[A-Za-z0-9_!'.]/.test(before) || /[A-Za-z0-9_(]/.test(after)) continue;   // another sheet, a name or a function
    const r1 = Number(m[4]), r2 = m[8] ? Number(m[8]) : r1;
    const top = Math.min(r1, r2), bottom = Math.max(r1, r2);
    if (bottom < areaTop || top > areaBottom) continue;   // not the people's rows
    refs.push({ at: m.index, len: m[0].length, c1: m[2], c2: m[6] || m[2], d1: m[1], d2: m[6] ? m[5] : m[1],
      r1d: m[3], r2d: m[6] ? m[7] : m[3], range: !!m[6] });
  }
  if (!refs.length) return f;
  const groups = {};
  refs.forEach(function (r) { (groups[r.c1 + ':' + r.c2] = groups[r.c1 + ':' + r.c2] || []).push(r); });
  const edits = [];
  for (const key in groups) {
    const g = groups[key];
    const r0 = g[0];
    const whole = r0.d1 + r0.c1 + r0.r1d + span.top + ':' + r0.d2 + r0.c2 + r0.r2d + span.bottom;
    if (g.length === 1) {
      if (!r0.range) return null;      // a single cell: leave the formula alone
      edits.push({ at: r0.at, len: r0.len, text: whole });
      continue;
    }
    // Several: they must sit in a row joined only by "," or "+".
    let sep = '';
    for (let k = 1; k < g.length; k++) {
      const gap = masked.slice(g[k - 1].at + g[k - 1].len, g[k].at);
      if (!/^\s*[,+]\s*$/.test(gap)) return null;
      const s = gap.trim();
      if (sep && s !== sep) return null;
      sep = s;
    }
    const start = r0.at, stop = g[g.length - 1].at + g[g.length - 1].len;
    edits.push({ at: start, len: stop - start, text: sep === '+' ? 'SUM(' + whole + ')' : whole });
  }
  edits.sort(function (a, b) { return b.at - a.at; });
  let out = f;
  edits.forEach(function (e) { out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len); });
  return out;
}

/** The Sunday a week tab is for, from its name ("WE 08/11/2026", "WE 25102026"), or null. */
function tabSunday(tab) {
  const raw = tab.getName().toUpperCase().replace(/^\s*W\s*\/?\s*E\s*/, '');
  if (raw === tab.getName().toUpperCase()) return null;
  let parts = raw.split(/[\/.\-\s]+/).filter(String);
  let cands = [];
  if (parts.length === 3) cands = [[parts[0], parts[1], parts[2]]];
  else if (parts.length === 1 && /^\d{6,8}$/.test(parts[0])) {
    const s = parts[0], y = s.slice(-4), dm = s.slice(0, -4);
    for (let k = 1; k < dm.length; k++) cands.push([dm.slice(0, k), dm.slice(k), y]);
  }
  for (let i = 0; i < cands.length; i++) {
    const d = Number(cands[i][0]), mo = Number(cands[i][1]), y = Number(cands[i][2]);
    if (!d || !mo || mo > 12 || d > 31) continue;
    const date = new Date(y, mo - 1, d);
    if (date.getDay() === 0 && date.getDate() === d) return date;
  }
  return null;
}

/** Once after each change to how the sheet is tidied: every week's tab gets
 *  its new starts put under their Coach and its totals counting everyone. */
const TIDY_VERSION = 'new-starts-under-coach-1';
function tidyAllWeeks(book, log) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('tidied') === TIDY_VERSION) return;
  let ok = true;
  book.getSheets().forEach(function (tab) {
    const sunday = tabSunday(tab);
    if (!sunday) return;
    try {
      let people = [];
      try { people = fetchWeek(sunday); } catch (e) { people = []; }
      const moved = people.length ? placeNewStarts(tab, people, sunday) : [];
      repairTeamBlocks(tab);
      const t = fixTotals(tab);
      if (moved.length || t.changed || t.skipped.length) {
        log.push([tab.getName(), 'Tidied' + (moved.length ? ' · moved ' + moved.join(', ') : '') + (t.changed ? ' · ' + t.changed + ' total formulas now count everyone' : ''),
          t.skipped.length ? 'Totals to check by hand: ' + t.skipped.join(', ') : '']);
      }
    } catch (e) { ok = false; log.push([tab.getName(), 'Tidy failed: ' + e.message, '']); }
  });
  if (ok) props.setProperty('tidied', TIDY_VERSION);
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
      goal: e.weekly_goal, total: Number(e.total_sales || 0),
      startDate: e.start_date ? String(e.start_date).slice(0, 10) : '' };
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
      // A new start's first three days (Academy Monday and Tuesday, shadow
      // Wednesday) are in office, yellow, unless there are numbers in the field.
      const firstDays = person.startDate && date >= person.startDate
        && date <= isoDate(addDays(parseIso(person.startDate), 2));
      const numbers = day.status === 'in' && (Number(day.over30 || 0) + Number(day.under30 || 0)) > 0;
      const block = person.leftOn && date >= person.leftOn ? COLOURS.notCurrent
        : day.status === 'ab' ? COLOURS.notScheduled
        : day.status === 'ns' ? COLOURS.noShow
        : day.status === 'pc' || day.status === 'sd' ? COLOURS.inOffice
        : firstDays && !numbers ? COLOURS.inOffice : null;
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

function parseIso(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
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
