/**
 * Pay — the pure formulas behind the Earnings Calculator. No React, no
 * imports, so it can be checked with plain `node`. (The file keeps its
 * original name so nothing that imports it needs to change; the rules are
 * the Modern Milkman campaign's.)
 *
 * A Brand Ambassador (BA) is paid per sign-up, by the customer's repeat
 * weekly order value (the repeat items, before any delivery fee):
 *   Silver — £5.00 to £9.99 → fee_standard (£12) up front
 *   Gold   — £10.00 or more → fee_target   (£20) up front
 * + fee_membership (£8) when the sign-up also takes The Round (either tier)
 * + a retention payment when the customer is still ordering in their 4th
 *   week: retention_standard (£5) for a Silver, retention_target (£8) for a
 *   Gold.
 *
 * A sign-up that FAILS pays nothing: cancelled before the first delivery,
 * first delivery more than 8 days away, an order under £5, or no repeat
 * items on it.
 *
 * When it is paid (see payDates):
 *   sign-up fees    — the Wednesday 11 days after the working week ends
 *                     (the week is Monday to Saturday)
 *   membership fees — a week after that (a 14-day cooling-off period)
 *   retention       — about 8 weeks after the week ends (the customer needs
 *                     4 weeks of deliveries within 6 weeks, then processing)
 *
 * Mirrors backend/core/vertex_pay.py (defaults + tolerance of fee documents
 * from an earlier pay model) — change both together.
 */

export type VertexFees = {
  /** Up-front fee for a Silver sign-up. */
  fee_standard: number;
  /** Up-front fee for a Gold sign-up. */
  fee_target: number;
  /** Added when a sign-up takes The Round, on either tier. */
  fee_membership: number;
  /** Paid when a Silver customer is still ordering in their 4th week. */
  retention_standard: number;
  /** Paid when a Gold customer is still ordering in their 4th week. */
  retention_target: number;
  /** The office's (MC's) own fee for a Silver sign-up. Admins only: the server
   *  leaves it out for everyone else, and the screen never shows it to them. */
  fee_mc_standard: number;
  /** The office's (MC's) own fee for a Gold sign-up. Admins only, as above. */
  fee_mc_target: number;
};

export const DEFAULT_FEES: VertexFees = {
  fee_standard: 12,
  fee_target: 20,
  fee_membership: 8,
  retention_standard: 5,
  retention_target: 8,
  fee_mc_standard: 16,
  fee_mc_target: 20,
};

export const FEE_KEYS = Object.keys(DEFAULT_FEES) as Array<keyof VertexFees>;

/** Inclusive bounds per knob — the same ranges the server enforces. */
export const FEE_BOUNDS: Record<keyof VertexFees, [number, number]> = {
  fee_standard: [0, 1000],
  fee_target: [0, 1000],
  fee_membership: [0, 1000],
  retention_standard: [0, 1000],
  retention_target: [0, 1000],
  fee_mc_standard: [0, 1000],
  fee_mc_target: [0, 1000],
};

/** What the campaign asks for. Shown beside a person's own numbers. */
export const TARGETS = {
  /** Average repeat weekly order value, £ (at or above). */
  orderValue: 13,
  /** Average delivery days a week per customer (at or above). */
  dropDays: 2.5,
  /** Fails as a share of sign-ups, % (below). */
  failPct: 10,
  /** Sign-ups that take The Round, % (at or above). */
  memberPct: 75,
  /** Customers still ordering in their 4th week, % (at or above). */
  fourthWeekPct: 75,
} as const;

/** The order values that set the tier (repeat items, before any delivery fee). */
export const TIER_RULES = {
  silverFrom: 5,
  goldFrom: 10,
  /** A first delivery more than this many days away is a fail. */
  maxDaysToFirstDelivery: 8,
} as const;

/** Defaults where the server's document lacks a valid knob (other-shape docs included). */
export function normalizeFees(raw: unknown): VertexFees {
  const out: VertexFees = { ...DEFAULT_FEES };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of FEE_KEYS) {
    const v = src[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    const [lo, hi] = FEE_BOUNDS[key];
    if (Number.isFinite(n) && n >= lo && n <= hi) out[key] = n;
  }
  return out;
}

/** A non-negative whole count from anything a text input can hold. */
export function toCount(v: unknown, max = 999): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(max, Math.floor(n));
}

/** A percentage clamped to 0–100 (decimals allowed). */
export function toPct(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ── This week: up-front fees ───────────────────────────────────────────────

export type WeekInput = {
  /** Silver sign-ups (Bells `under30`). */
  silver: number;
  /** Gold sign-ups (Bells `over30`). */
  gold: number;
  /** Of those sign-ups, how many took The Round (Bells `memberships`). */
  memberships: number;
};

export type WeekPay = {
  signUps: number;
  /** Memberships actually paid: never more than the sign-ups. */
  memberships: number;
  silverFees: number;
  goldFees: number;
  /** Silver + Gold up-front fees. */
  signUpFees: number;
  membershipFees: number;
  /** Everything paid up front: sign-up fees + membership fees. */
  upFront: number;
};

export function weekPay(input: WeekInput, fees: VertexFees = DEFAULT_FEES): WeekPay {
  const silver = toCount(input.silver);
  const gold = toCount(input.gold);
  const signUps = silver + gold;
  const memberships = Math.min(toCount(input.memberships), signUps);
  const silverFees = silver * fees.fee_standard;
  const goldFees = gold * fees.fee_target;
  const signUpFees = silverFees + goldFees;
  const membershipFees = memberships * fees.fee_membership;
  return { signUps, memberships, silverFees, goldFees, signUpFees, membershipFees, upFront: signUpFees + membershipFees };
}

// ── Week 4: retention ──────────────────────────────────────────────────────

/** Customers expected to still be ordering in week 4: floor(sign-ups × rate / 100). */
export function keptCustomers(signUps: number, ratePct: number): number {
  // The epsilon keeps 7 × 70 / 100 = 4.8999… style float noise from dropping one.
  return Math.floor((toCount(signUps) * toPct(ratePct)) / 100 + 1e-9);
}

export type RetentionPay = {
  silverKept: number;
  goldKept: number;
  silverFees: number;
  goldFees: number;
  total: number;
};

/** The retention a week's sign-ups earn if `ratePct` of each tier reach week 4. */
export function retentionPay(silver: number, gold: number, ratePct: number, fees: VertexFees = DEFAULT_FEES): RetentionPay {
  const silverKept = keptCustomers(silver, ratePct);
  const goldKept = keptCustomers(gold, ratePct);
  const silverFees = silverKept * fees.retention_standard;
  const goldFees = goldKept * fees.retention_target;
  return { silverKept, goldKept, silverFees, goldFees, total: silverFees + goldFees };
}

// ── When it is paid ────────────────────────────────────────────────────────

/** Days from the Bells week ending (a Sunday) to each payment. The working
 *  week is Monday to Saturday, so these land on the Wednesday 11 days after
 *  the Saturday, the week after that, and about 8 weeks on. */
export const PAY_TIMING = {
  /** Sign-up fees: the Wednesday after one full week has passed. */
  signUpDays: 10,
  /** Membership fees: a week later (14-day cooling-off period). */
  membershipDays: 17,
  /** Retention: about 8 weeks on, on the Wednesday. */
  retentionDays: 8 * 7 + 3,
} as const;

/** 'YYYY-MM-DD' plus `days`, as 'YYYY-MM-DD' (UTC maths, so no clock drift). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PayDates = { signUps: string; memberships: string; retention: string };

/** The pay dates for a week ending on `weekEnding` ('YYYY-MM-DD', a Sunday). */
export function payDates(weekEnding: string): PayDates {
  return {
    signUps: addDays(weekEnding, PAY_TIMING.signUpDays),
    memberships: addDays(weekEnding, PAY_TIMING.membershipDays),
    retention: addDays(weekEnding, PAY_TIMING.retentionDays),
  };
}

/** "Wed 21 Oct" in the given locale (en-GB by default); '' for a bad date. */
export function formatPayDate(iso: string, locale = 'en-GB'): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
