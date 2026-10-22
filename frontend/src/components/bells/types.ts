// Shared types + helpers used across the Bells screen and its sub-components.
// Extracted from the original monolithic bells.tsx.
import { APP_TZ } from '../../utils/appTime';

/**
 * What a day row counts. The stored field names are legacy (`over30` /
 * `under30` / `memberships`) and the payload shape is unchanged — only the
 * meaning is:
 *   over30      → Gold   = a sign-up with a repeat weekly order of £10 or more
 *   under30     → Silver = a sign-up with an order of £5.00 to £9.99
 *   memberships → of those sign-ups, how many took The Round (the
 *                 membership). An add-on: never a sign-up of its own.
 * Every label on the Bells screen reads from here so the wording stays in
 * one place.
 */
export const TIER = {
  over30: { short: 'Gold', long: 'Gold (£10+ order)' },
  under30: { short: 'Silver', long: 'Silver (£5 to £9.99)' },
  memberships: { short: 'Round', long: 'Took The Round' },
} as const;

/** "sign-up" / "sign-ups" for a count. */
export function signUps(n: number): string {
  return `${n} sign-up${n === 1 ? '' : 's'}`;
}

/** Today's date in app (UK) time as YYYY-MM-DD, optionally shifted by whole days. */
export function appTodayISO(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  if (!offsetDays) return iso;
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Today's weekday in app (UK) time: 0=Mon … 6=Sun. */
export function appDayIdx(): number {
  return (new Date(appTodayISO() + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

/** The Sunday that ends the current bells week, in app (UK) time. */
export function appWeekEndingISO(): string {
  return appTodayISO(6 - appDayIdx());
}

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type Day = {
  over30: number | null;
  under30: number | null;
  memberships: number | null;
  status: string;
};

/** Why an approved absence was granted, and who signed it off. */
export type AbsenceDetail = {
  reason: string;
  decided_at?: string | null;
  decided_by_name?: string;
  requested_by?: string;
  decision_note?: string;
};

export type Entry = {
  id: string | null;
  office_id: string;
  user_id: string | null;
  user_name: string;
  role?: string;
  break_even: number | null;
  weekly_goal: number | null;
  // Crew goal — only meaningful on a section leader's own row; the whole
  // team's weekly target (synced with the Weekly Planner's team-goal box).
  team_weekly_goal?: number | null;
  /**
   * This person's sign-ups plus their whole downline's. Sections on the sheet are
   * exclusive — a member only lands under their NEAREST section-leader
   * ancestor — so a leader whose reports are themselves section leaders sits
   * alone in their section. Their crew goal still covers everyone beneath
   * them, so it's compared against this (matches how the Weekly Planner
   * counts a team total).
   */
  team_subtree_sales?: number | null;
  last_week_total: number | null;
  last_week_total_source?: 'manual' | 'auto' | null;
  prev_prev_week_total?: number | null;
  week_ending: string;
  days: Day[];
  /**
   * Approved-absence context keyed by day index ('0'=Mon … '5'=Sat). An `ab`
   * on the row records only THAT someone was absent; the why and who approved
   * it live on the absence request, and the server folds them in here so the
   * table / public sheet can explain an AB on tap or hover.
   */
  absence_details?: Record<string, AbsenceDetail>;
  total_sales: number;
  total_over30: number;
  total_under30: number;
  total_memberships: number;
  days_worked: number;
  piece_average: number;
  reliability_pct?: number | null;
  scoring_pct?: number | null;
  earnings: number;
  average_earnings_per_day: number;
  daily_totals?: number[];
  /**
   * Estimated BA up-front fees (the server's maths): fee_standard × Silver
   * sign-ups + fee_target × Gold sign-ups + fee_membership × The Round
   * members, BEFORE the week-4 payments and any fails. Keys are optional so
   * an older cached response (different shape) simply falls back to showing
   * the total.
   */
  earnings_breakdown?: {
    fee_standard?: number;
    fee_target?: number;
    fee_membership?: number;
    standard_count?: number;
    target_count?: number;
    membership_count?: number;
    standard_earnings?: number;
    target_earnings?: number;
    membership_earnings?: number;
    sign_up_fees?: number;
  };
  /** Who they report to, and the stage they hold as OwnerIQ words it ("3", "3+"). */
  coach_name?: string | null;
  stage_label?: string | null;
  /** The office's (MC's) fees for this person's sign-ups. Sent to Admins only. */
  mc_fees?: number;
  primary_team?: { leader_id: string; leader_name: string; team_name: string } | null;
  teams?: Array<{ leader_id: string; leader_name: string; team_name: string }>;
  public_hidden?: boolean;
  /** A view-only row from the roll call sheet: someone the app has no
   *  account for (they've left). History only — never editable. */
  archived?: boolean;
  /** Imported from the roll call sheet: the team it sat under that week and
   *  its place on the sheet (an imported week reads in the sheet's order). */
  sheet_team?: string | null;
  sheet_order?: number | null;
  /** The day they exited (removed by an Admin), YYYY-MM-DD. From that day
   *  their days read red; from the next week they're off the sheet. */
  left_on?: string | null;
  user_active?: boolean;
  /** 'PR' personal recruit (by the Owner or a BA/Coach), 'OR' office recruitment. */
  recruit_badge?: 'PR' | 'OR' | null;
  /** Inside the app only: 'office' or the recruiter's user id, and their name. */
  recruited_by?: string | null;
  recruited_by_name?: string;
};

/** Has this person exited by day `dayIdx` (0 = Mon) of the week ending `weekEnding`? */
export function exitedBy(e: { left_on?: string | null }, weekEnding: string, dayIdx: number): boolean {
  if (!e.left_on || !weekEnding) return false;
  const d = new Date(weekEnding + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime())) return false;
  d.setUTCDate(d.getUTCDate() - 6 + dayIdx);
  return d.toISOString().slice(0, 10) >= e.left_on.slice(0, 10);
}

export function emptyDay(): Day {
  return { over30: null, under30: null, memberships: null, status: 'off' };
}

/**
 * Status helpers — only 'in' counts as a working day. 'off', 'rt', 'nc', 'sd' (shadow day) and
 * legacy 'normal' are all excluded from piece_average / scoring denominators.
 * A day counts toward piece_average / scoring ONLY when it's 'in'. RT / NC / Off are excluded.
 */
export function isInDay(d: Day | null | undefined): boolean {
  return !!d && d.status === 'in';
}

/**
 * A day's working numeric total. Only 'in' days contribute.
 */
export function dayTotal(d: Day | null | undefined): number {
  if (!isInDay(d)) return 0;
  return (d!.over30 || 0) + (d!.under30 || 0);
}

/**
 * Absence requests must carry a reason — the office owner approves or denies
 * off the back of it, so a blank request isn't actionable. Shared by every
 * place an AB can be requested (card row, table cell, day view).
 */
export const MIN_AB_REASON = 3;
