/**
 * A day's sign-ups on Bells, coloured the Owner's way (the Law of Averages
 * is 4+ a day):
 *   0–1  red · 2  amber · 3  light green · 4+  dark green
 * Every screen that colours a day reads this, so the bands live here.
 */
export type DayBand = 'red' | 'amber' | 'light_green' | 'dark_green';

export const DAY_TARGET = 4;

export function dayBand(signUps: number): DayBand {
  if (signUps >= DAY_TARGET) return 'dark_green';
  if (signUps === 3) return 'light_green';
  if (signUps === 2) return 'amber';
  return 'red';
}

/** Text and fill for a day cell, light or dark theme. */
export function dayBandLook(signUps: number, dark: boolean): { fg: string; bg: string } {
  switch (dayBand(signUps)) {
    case 'dark_green': return dark ? { fg: '#ffffff', bg: '#15803d' } : { fg: '#ffffff', bg: '#166534' };
    case 'light_green': return dark ? { fg: '#bbf7d0', bg: 'rgba(74,222,128,0.22)' } : { fg: '#15803d', bg: 'rgba(74,222,128,0.24)' };
    case 'amber': return dark ? { fg: '#fcd34d', bg: 'rgba(245,158,11,0.20)' } : { fg: '#b45309', bg: 'rgba(245,158,11,0.20)' };
    default: return dark ? { fg: '#fca5a5', bg: 'rgba(239,68,68,0.18)' } : { fg: '#b91c1c', bg: 'rgba(239,68,68,0.14)' };
  }
}

/** Just a text colour, for screens that colour the number only. */
export function dayBandText(signUps: number): string {
  return { red: '#dc2626', amber: '#d97706', light_green: '#22c55e', dark_green: '#15803d' }[dayBand(signUps)];
}
