// Helpers for area history (screens app/areas.tsx and app/area.tsx).
import { APP_LOCALE } from './appTime';

export type AreaRow = { key: string; doors: number; spoken: number; pitched?: number; sales: number; days: number; ba_days: number;
  last_worked: string | null; days_since: number | null; per_100: number | null; pa: number | null };

export function shortDate(iso?: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function sinceText(n: number | null | undefined) {
  if (n == null) return '';
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

/** Does a typed postcode (any spacing) belong to a district, or start one? */
export function matchesDistrict(district: string, typed: string) {
  const f = typed.trim().toUpperCase().replace(/\s+/g, '');
  const k = district.toUpperCase().replace(/\s+/g, '');
  return !f || k.startsWith(f) || f.startsWith(k);
}
