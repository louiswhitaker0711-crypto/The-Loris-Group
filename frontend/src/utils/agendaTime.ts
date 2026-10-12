/**
 * Times on the weekly plan (Agenda) are typed freely: "10:30", "9:30 AM",
 * "3pm", "9.30". These helpers read them the same way the server does
 * (parse_time in backend/routes/agenda.py).
 */

/** Minutes after midnight, or null when the text isn't a time. */
export function timeMinutes(text?: string | null): number | null {
  let t = (text || '').trim();
  if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, -2)}:${t.slice(-2)}`;
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2] || '0', 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || mins > 59) return null;
  return h * 60 + mins;
}

/** Rows with a time first, earliest first; the rest keep their order after. */
export function sortByTime<T>(items: T[], timeOf: (x: T) => string | null | undefined): T[] {
  const withT = items.map((x, i) => ({ x, i, t: timeMinutes(timeOf(x)) }));
  const timed = withT.filter((w) => w.t != null).sort((a, b) => (a.t! - b.t!) || (a.i - b.i));
  const untimed = withT.filter((w) => w.t == null);
  return [...timed, ...untimed].map((w) => w.x);
}
