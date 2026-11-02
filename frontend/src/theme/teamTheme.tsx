/**
 * Team look (the Owner, 2 Nov 2026): someone who leads a team and has set a
 * team logo or team colours sees the app in their team's colours, "powered by
 * The Loris Group". Only the look changes: every feature, and every number
 * they can see, stays exactly the same. The people on their team keep the
 * Loris look.
 *
 * What changes: the navy surfaces (the top bar, the screen header bands, the
 * Home hero, NavyCards) become a deep shade of the team's main colour, the
 * cyan accent becomes the team's accent, and the primary colour (buttons,
 * selected tabs) becomes the team's main colour. Status colours never change
 * (traffic lights, Bells statuses, Gold/Silver, each team's band on Bells).
 *
 * Colours come from users.team_colors (set by hand) or users.team_colors_auto
 * (picked from the logo when it's uploaded). Every shade is worked out here so
 * white text always reads on the dark surfaces.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ThemeContext, type ColorPalette } from './ThemeContext';

export type Surface = {
  /** Top of the dark band (and the top bar). */
  deep: string;
  /** Bottom of the dark band. */
  mid: string;
  /** The accent on dark surfaces (icons, highlights, progress). */
  accent: string;
  /** The accent's glow in the band's corner. */
  glow: string;
  glowClear: string;
  /** Text that sits ON the accent. */
  onAccent: string;
  /** Soft text on the dark surfaces. */
  soft: string;
  muted: string;
  /** Set only in the team look. */
  team: null | { name: string; logo: string | null };
  /** The white team look (a logo on its own white background). */
  light: boolean;
  /** The top bar and side menu: always dark, with its own accent. */
  bar: string;
  barAccent: string;
  /** Text and fills on the band. */
  text: string;
  kicker: string;
  glass: string;
  glassBorder: string;
  track: string;
  /** Status colours that read on the band (the same colours, shaded for it). */
  gold: string;
  green: string;
  amber: string;
  red: string;
  /** The band's edge on the page (white look only). */
  edge: string;
};

export const LORIS_SURFACE: Surface = {
  deep: '#081a30',
  mid: '#12305c',
  accent: '#22d0ec',
  glow: 'rgba(34,208,236,0.30)',
  glowClear: 'rgba(34,208,236,0)',
  onAccent: '#0c2340',
  soft: '#d6e3f1',
  muted: '#b3c5da',
  team: null,
  light: false,
  bar: '#081a30',
  barAccent: '#22d0ec',
  text: '#ffffff',
  kicker: '#9fd8ea',
  glass: 'rgba(255,255,255,0.07)',
  glassBorder: 'rgba(255,255,255,0.12)',
  track: 'rgba(255,255,255,0.12)',
  gold: '#ffd60a',
  green: '#6ee794',
  amber: '#ffc35c',
  red: '#ff8178',
  edge: 'transparent',
};

/** Status colours on a white band. */
const ON_WHITE = { gold: '#a87400', green: '#1f8f4e', amber: '#b86a00', red: '#d0342c' };

// ── Colour maths ─────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const HEX = /^#?([0-9a-f]{6})$/i;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v.trim());
const toRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** Move a colour toward black or white until its luminance is near `target`. */
function toLum(c: RGB, target: number): RGB {
  const towards = lum(c) > target ? BLACK : WHITE;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    const l = lum(mix(c, towards, m));
    if ((towards === BLACK) === (l > target)) lo = m; else hi = m;
  }
  return mix(c, towards, hi);
}

/** Darken until white text reads on it (4.5:1). */
function readableUnderWhite(c: RGB): RGB {
  let out = c;
  for (let i = 0; i < 30 && contrast(out, WHITE) < 4.5; i++) out = mix(out, BLACK, 0.06);
  return out;
}

/** Lighten until it reads on a dark surface (4.5:1). */
function readableOn(c: RGB, bg: RGB): RGB {
  let out = c;
  for (let i = 0; i < 30 && contrast(out, bg) < 4.5; i++) out = mix(out, WHITE, 0.08);
  return out;
}

export type TeamColors = { primary?: string | null; accent?: string | null; light_bg?: boolean | null };

/** The team's surface and primary from its two colours. */
export function deriveTeamLook(colors: TeamColors) {
  const p = toRgb(isHex(colors.primary) ? colors.primary : '#1d4fa8');
  const deep = toLum(p, 0.012);
  const mid = toLum(p, 0.04);
  // One colour only (a single-colour logo): a light tint of it is the accent.
  const accentRaw = isHex(colors.accent) ? toRgb(colors.accent) : toLum(p, 0.45);
  const accent = readableOn(accentRaw, mid);
  const primary = readableUnderWhite(p);
  const [ar, ag, ab] = accent.map(Math.round);
  return {
    primary: toHex(primary),
    deep: toHex(deep),
    mid: toHex(mid),
    accent: toHex(accent),
    glow: `rgba(${ar},${ag},${ab},0.32)`,
    glowClear: `rgba(${ar},${ag},${ab},0)`,
    onAccent: contrast(accent, BLACK) >= contrast(accent, WHITE) ? toHex(toLum(p, 0.012)) : '#ffffff',
    soft: toHex(mix(toLum(p, 0.04), WHITE, 0.82)),
    muted: toHex(mix(toLum(p, 0.04), WHITE, 0.68)),
    // The white look: white bands, team-coloured text and accents.
    whiteLook: (() => {
      const ink = toLum(p, 0.018);
      const tone = primary; // already dark enough for white text, so it reads on white too
      const [tr, tg, tb] = tone.map(Math.round);
      const glowRgb = isHex(colors.accent) ? toRgb(colors.accent) : p;
      const [gr, gg, gb] = glowRgb.map(Math.round);
      return {
        deep: '#ffffff',
        mid: toHex(mix(p, WHITE, 0.93)),
        accent: toHex(tone),
        glow: `rgba(${gr},${gg},${gb},0.20)`,
        glowClear: `rgba(${gr},${gg},${gb},0)`,
        onAccent: '#ffffff',
        text: toHex(ink),
        soft: toHex(mix(ink, WHITE, 0.22)),
        muted: toHex(mix(ink, WHITE, 0.38)),
        kicker: toHex(tone),
        glass: `rgba(${tr},${tg},${tb},0.05)`,
        glassBorder: `rgba(${tr},${tg},${tb},0.14)`,
        track: `rgba(${tr},${tg},${tb},0.12)`,
        edge: `rgba(${tr},${tg},${tb},0.14)`,
      };
    })(),
  };
}

// ── Context ──────────────────────────────────────────────────────────────────
const SurfaceContext = createContext<Surface>(LORIS_SURFACE);

/** The dark-surface colours for this person: theirs if they lead a branded team, else Loris. */
export const useSurface = () => useContext(SurfaceContext);

/**
 * Mount inside AuthProvider. Overrides the theme's primary colours and the
 * dark surfaces for a team leader with a logo or colours; passes the Loris
 * look through for everyone else.
 */
export function TeamThemeProvider({ children }: { children: React.ReactNode }) {
  const parent = useContext(ThemeContext);
  const { user } = useAuth();
  const u: any = user || {};
  const colors: TeamColors | null = u.team_colors || u.team_colors_auto || null;
  // The Owner (an Admin) always keeps the Loris look and logo.
  const active = u.role !== 'admin' && !!u.has_team && (!!u.team_logo || !!colors);
  // A logo on its own white background gets the white look (no white box
  // round it on a dark band). Picked from the logo on upload.
  const lightBg = !!u.team_logo && !!u.team_colors_auto?.light_bg;

  const look = useMemo(() => (active ? deriveTeamLook(colors || {}) : null),
    [active, colors?.primary, colors?.accent]); // eslint-disable-line react-hooks/exhaustive-deps

  const surface = useMemo<Surface>(() => {
    if (!look) return LORIS_SURFACE;
    const first = (u.name || '').trim().split(' ')[0];
    const team = { name: (u.team_name || '').trim() || (first ? `${first}'s team` : 'Your team'), logo: u.team_logo || null };
    const bar = { bar: look.deep, barAccent: look.accent };
    if (lightBg) {
      return { ...LORIS_SURFACE, ...look.whiteLook, ...ON_WHITE, ...bar, team, light: true };
    }
    return {
      ...LORIS_SURFACE, ...bar,
      deep: look.deep, mid: look.mid, accent: look.accent, glow: look.glow, glowClear: look.glowClear,
      onAccent: look.onAccent, soft: look.soft, muted: look.muted, kicker: look.soft,
      team,
    };
  }, [look, lightBg, u.team_name, u.team_logo, u.name]);

  const themeValue = useMemo(() => {
    if (!look) return parent;
    const c: ColorPalette = parent.effective === 'dark'
      ? { ...parent.colors, ink: look.deep, markOnInk: look.accent }
      : { ...parent.colors, primary: look.primary, primaryLight: look.primary, primaryDark: look.deep, ink: look.deep, markColor: look.primary, markOnInk: look.accent };
    return { ...parent, colors: c };
  }, [parent, look]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>
    </ThemeContext.Provider>
  );
}

/** The line under a team's header: the Loris Group still runs the show. */
export const poweredBy = (org: string) => `Powered by ${org}`;
