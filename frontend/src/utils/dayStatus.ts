/**
 * Bells day statuses, worded for self-employed BAs and coloured like
 * OwnerIQ's day squares:
 *   • ab = Not scheduled — they planned the day off (grey square). Their own
 *     call: nobody approves it, and it never counts against them.
 *   • ns = No show — planned in but didn't go out (black square).
 *   • pc = In office — product coaching or office work, not in the field.
 *     Never an absence; left out of reliability and scoring.
 * Codes stay as they are in the data (`ab`, `ns`, …).
 */
export const DAY_STATUS_LABEL: Record<string, string> = {
  in: 'In',
  off: 'Off',
  ab: 'Not scheduled',
  ns: 'No show',
  rt: 'Retrain',
  nc: 'Not counted',
  pc: 'In office',
};

export const DAY_STATUS_SHORT: Record<string, string> = {
  in: 'IN',
  off: 'OFF',
  ab: 'NS',
  ns: 'X',
  rt: 'RT',
  nc: 'NC',
  pc: 'IO',
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
export const NO_NUMBER_STATUSES = ['off', 'nc', 'ab', 'pc', 'ns'];
