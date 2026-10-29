/**
 * Bells day statuses (the Owner, 29 Oct 2026): five to choose from, worded
 * for self-employed BAs and coloured like the Roll Call sheet.
 *   • in = Scheduled in — out in the field (their sign-ups go on the day).
 *   • ab = Scheduled off — they planned the day off (grey). Their own call:
 *     nobody approves it, and it never counts against them.
 *   • ns = No show — scheduled in but didn't come in (black).
 *   • pc = In office — Academy, product coaching or office work (yellow).
 *     Never an absence; left out of reliability and scoring.
 *   • Exited (red) — not a day status: Admin → Exit, or Exited on a Bells
 *     day, which exits them from that day.
 * Older codes stay readable on past weeks (rt Retrain, nc Not counted, sd
 * Shadow day, which the bunny hop still sets and Bells shows as In office)
 * but can't be picked any more. Codes stay as they are in the data.
 */
/** The four a day can be set to; Exited is the fifth, set by exiting. */
export const DAY_STATUS_PICK = ['in', 'ab', 'ns', 'pc'] as const;

export const DAY_STATUS_LABEL: Record<string, string> = {
  in: 'Scheduled in',
  off: 'Not filled in',
  ab: 'Scheduled off',
  ns: 'No show',
  rt: 'Retrain',
  nc: 'Not counted',
  pc: 'In office',
  sd: 'In office (shadow day)',
  ex: 'Exited',
};

export const DAY_STATUS_SHORT: Record<string, string> = {
  in: 'IN',
  off: 'OFF',
  ab: 'OFF',
  ns: 'X',
  rt: 'RT',
  nc: 'NC',
  pc: 'IO',
  sd: 'IO',
  ex: 'EX',
};

/** The grey and black squares (fill + text), in both themes. */
export function statusSquare(status: string, dark: boolean): { bg: string; fg: string; border: string } | null {
  if (status === 'ab') return dark
    ? { bg: 'rgba(148,163,184,0.22)', fg: '#cbd5e1', border: 'rgba(148,163,184,0.35)' }
    : { bg: '#d9dee5', fg: '#475569', border: '#c3cad4' };
  if (status === 'ns') return dark
    ? { bg: '#000000', fg: '#ffffff', border: 'rgba(255,255,255,0.35)' }
    : { bg: '#111111', fg: '#ffffff', border: '#111111' };
  return null;
}

/** Statuses that clear a day's numbers. */
export const NO_NUMBER_STATUSES = ['off', 'nc', 'ab', 'pc', 'ns', 'sd'];
