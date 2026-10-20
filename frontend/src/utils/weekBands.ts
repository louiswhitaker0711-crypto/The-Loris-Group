/**
 * The owner's traffic light system — sign-ups in one week.
 *
 *   Super Green  20+
 *   Green        15–19
 *   Amber        8–14
 *   Red          under 8
 *
 * "A Green Week" means Green or better (15+). Every screen that colour-codes
 * or counts a week by its sign-ups reads these, so the bands live in one
 * place.
 *
 * NOTE: the backend computes its own copies (Bells `green_pct`, the Green
 * Week badge, the Sales Path's GREEN_WEEK_SALES) — keep them in step.
 */
export const SUPER_GREEN_WEEK_MIN = 20;
export const GREEN_WEEK_MIN = 15;
export const AMBER_WEEK_MIN = 8;
/** Red is this many sign-ups or fewer. */
export const RED_WEEK_MAX = AMBER_WEEK_MIN - 1;

export type WeekBand = 'super_green' | 'green' | 'amber' | 'red';

/** Which tier a week's sign-up count falls in. */
export function weekBand(signUps: number): WeekBand {
  if (signUps >= SUPER_GREEN_WEEK_MIN) return 'super_green';
  if (signUps >= GREEN_WEEK_MIN) return 'green';
  if (signUps >= AMBER_WEEK_MIN) return 'amber';
  return 'red';
}

/** Green or better — the week counts as a Green Week. */
export function isGreenWeek(signUps: number): boolean {
  return signUps >= GREEN_WEEK_MIN;
}

/** On-screen names and ranges, top tier first. */
export const WEEK_BAND_LABELS: Record<WeekBand, { name: string; range: string }> = {
  super_green: { name: 'Super Green', range: `${SUPER_GREEN_WEEK_MIN}+` },
  green: { name: 'Green', range: `${GREEN_WEEK_MIN}–${SUPER_GREEN_WEEK_MIN - 1}` },
  amber: { name: 'Amber', range: `${AMBER_WEEK_MIN}–${GREEN_WEEK_MIN - 1}` },
  red: { name: 'Red', range: `under ${AMBER_WEEK_MIN}` },
};

/** Text and fill for a week's number on the Bells sheet (Last Week, a
 *  goal), in the same family of colours as a day cell (utils/dayBands). */
export function weekBandLook(signUps: number, dark: boolean): { fg: string; bg: string } {
  switch (weekBand(signUps)) {
    case 'super_green': return dark ? { fg: '#ffffff', bg: '#15803d' } : { fg: '#ffffff', bg: '#166534' };
    case 'green': return dark ? { fg: '#bbf7d0', bg: 'rgba(74,222,128,0.22)' } : { fg: '#15803d', bg: 'rgba(74,222,128,0.24)' };
    case 'amber': return dark ? { fg: '#fcd34d', bg: 'rgba(245,158,11,0.20)' } : { fg: '#b45309', bg: 'rgba(245,158,11,0.20)' };
    default: return dark ? { fg: '#fca5a5', bg: 'rgba(239,68,68,0.18)' } : { fg: '#b91c1c', bg: 'rgba(239,68,68,0.14)' };
  }
}
