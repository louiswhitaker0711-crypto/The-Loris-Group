/**
 * A sector can cover up to two joined postcodes (the Owner's call, 22 Oct
 * 2026). They travel as one string, "DN4 1 + DN4 2", so every place that
 * shows the postcode (WhatsApp text, pushes, lists) reads both. The server
 * splits them the same way (`postcode_parts` in backend/routes/sector.py).
 */
export const MAX_SECTOR_POSTCODES = 2;

export function splitPostcodes(v: string | null | undefined): string[] {
  return String(v || '')
    .toUpperCase()
    .split(/[+,&/]/)
    .map((p) => p.replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_SECTOR_POSTCODES);
}

export function joinPostcodes(parts: (string | null | undefined)[]): string {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).slice(0, MAX_SECTOR_POSTCODES).join(' + ');
}
