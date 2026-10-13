// A new start's day: its name and the day's targets in plain words (from
// Manual → KPIs, the office's day targets).
export function journeyDayName(day: number): string {
  return day <= 2 ? `BA Academy Day ${day}` : `Field day ${day - 2}`;
}
export function journeyDayOf(day: number): string {
  return day <= 2 ? `BA Academy Day ${day} of 2` : `Field day ${day - 2} of 6`;
}
/** ["20 intros", "10 pitches", …] — only the targets set for that day. */
export function dayTargetChips(t: any): string[] {
  if (!t) return [];
  const out: string[] = [];
  const add = (n: any, one: string, many: string) => { const v = Number(n) || 0; if (v > 0) out.push(`${v} ${v === 1 ? one : many}`); };
  add(t.target_introductions, 'intro', 'intros');
  add(t.target_presentations, 'pitch', 'pitches');
  add(t.target_short_stories, 'short story', 'short stories');
  add(t.target_closes, 'close', 'closes');
  add(t.target_sales, 'sign-up', 'sign-ups');
  return out;
}
