// Is it field time right now (UK time)? Home leads with the field when it is:
// the office timetable has the field 13:30–20:00 Monday to Friday and
// 10:00–17:00 on Saturday (backend core/schedule_template.py).
import { APP_TZ } from './appTime';

export function ukNow(at: Date = new Date()): { day: number; mins: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, mins: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function inFieldHours(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0) return false;
  if (day === 6) return mins >= 10 * 60 && mins < 17 * 60;
  return mins >= 13 * 60 + 30 && mins < 20 * 60;
}

/** Breakdown time: from the end of the field (20:00) until midnight,
 * Monday to Friday; there's no breakdown on a Saturday. Home leads with the
 * breakdowns then. */
export function inBreakdownHours(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0 || day === 6) return false;
  return mins >= 20 * 60;
}

/** Has today's field started (UK time)? From then on the plan to make is
 * the next working day's. */
export function fieldStarted(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0) return false;
  return mins >= (day === 6 ? 10 * 60 : 13 * 60 + 30);
}

/** Morning planning (the Owner, 26 Oct 2026): until 11:00 Monday to Friday,
 * and until the field (10:00) on a Saturday. Home leads with plan sectors,
 * Primetime and today's Coaches Meeting / COD pick then. */
export function inMorningPlanning(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0) return false;
  return mins < (day === 6 ? 10 * 60 : 11 * 60);
}

/** Primetime (the Owner, 27 Oct 2026): 11:00–11:45 Monday to Friday. Home
 * puts the pitch at the top for everyone then. */
export function inPrimetime(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0 || day === 6) return false;
  return mins >= 11 * 60 && mins < 11 * 60 + 45;
}

/** The morning meeting (11:45–12:15) until set-ups open at 12:30, Monday to
 * Friday. Home leads with the Bells read-out and today's meeting plan. */
export function inMorningMeeting(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0 || day === 6) return false;
  return mins >= 11 * 60 + 45 && mins < 12 * 60 + 30;
}

/** Today in the weekly plan: the Sunday that ends this week and Mon=0…Sat=5
 * (Sunday → -1, there's no day page). */
export function planDayNow(at: Date = new Date()): { weekEnding: string; dayIndex: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const d = new Date(Date.UTC(g('year'), g('month') - 1, g('day')));
  const idx = (d.getUTCDay() + 6) % 7;
  const sun = new Date(d);
  sun.setUTCDate(d.getUTCDate() + (6 - idx));
  return { weekEnding: sun.toISOString().slice(0, 10), dayIndex: idx === 6 ? -1 : idx };
}

/** Which part of the day Home's quick actions are for (the Owner, 29 Oct
 * 2026): morning planning until 11:00 → Primetime and the meeting until
 * 12:30 → set-ups until 13:30 → the field until 18:00 → the evening (the 6pm
 * reset, breakdowns, tomorrow's plan). Saturday runs morning until 10:00,
 * the field 10:00–17:00, then the evening; Sunday is planning day. */
export type HomeSlot = 'morning' | 'prime' | 'setup' | 'field' | 'evening' | 'sunday';
export function homeSlot(at: Date = new Date()): HomeSlot {
  const { day, mins } = ukNow(at);
  if (day === 0) return 'sunday';
  if (day === 6) return mins < 10 * 60 ? 'morning' : mins < 17 * 60 ? 'field' : 'evening';
  if (mins < 11 * 60) return 'morning';
  if (mins < 12 * 60 + 30) return 'prime';
  if (mins < 13 * 60 + 30) return 'setup';
  if (mins < 18 * 60) return 'field';
  return 'evening';
}
