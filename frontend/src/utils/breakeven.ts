// "Breakeven 6 · your goal is 4 above" (the Owner, 29 Oct 2026): shown
// wherever a weekly goal is set, so everyone sees how far above breakeven
// they're aiming. Breakeven comes from Plan your earnings (GET /earnings-plan).
export function goalVsBreakeven(goal: string | number | null | undefined, breakeven: number | null | undefined, whose: 'your' | 'their' = 'your'): string | null {
  if (breakeven == null || !(breakeven > 0)) return null;
  const g = Number(String(goal ?? '').trim());
  const head = `Breakeven ${breakeven} a week`;
  if (String(goal ?? '').trim() === '' || !Number.isFinite(g)) return head;
  const diff = g - breakeven;
  if (diff > 0) return `${head} · ${whose} goal is ${diff} above`;
  if (diff === 0) return `${head} · ${whose} goal is right on breakeven`;
  return `${head} · ${whose} goal is ${-diff} below breakeven`;
}
