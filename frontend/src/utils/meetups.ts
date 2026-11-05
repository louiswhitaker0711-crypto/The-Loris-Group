/** Meet-ups (the Owner, 5 Nov 2026): small helpers shared by the planner and Admin. */
import { APP_LOCALE } from './appTime';

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const fmtDay = (iso: string, long = false) => {
  try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString(APP_LOCALE, long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return iso; }
};
export const daysBetween = (a: string, b: string) => {
  const out: string[] = [];
  if (!a || !b) return out;
  const d = new Date(`${a}T12:00:00Z`);
  const end = new Date(`${b}T12:00:00Z`);
  while (d <= end && out.length < 14) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
};
