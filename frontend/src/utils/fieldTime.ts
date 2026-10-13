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

/** Breakdown time: from the end of the field until midnight (weekdays from
 * 20:00, Saturday from 17:00). Home leads with the breakdowns then. */
export function inBreakdownHours(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0) return false;
  return mins >= (day === 6 ? 17 * 60 : 20 * 60);
}

/** Has today's field started (UK time)? From then on the plan to make is
 * the next working day's. */
export function fieldStarted(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  if (day === 0) return false;
  return mins >= (day === 6 ? 10 * 60 : 13 * 60 + 30);
}
