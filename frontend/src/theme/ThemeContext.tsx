/**
 * Theme system — light/dark palettes + a context provider so screens can
 * react live to theme changes.
 *
 * Usage in a screen:
 *
 *   import { useColors } from '../src/theme/ThemeContext';
 *
 *   function MyScreen() {
 *     const colors = useColors();
 *     const styles = useMemo(() => createStyles(colors), [colors]);
 *     return <View style={styles.box}>...</View>;
 *   }
 *
 *   const createStyles = (c: typeof lightColors) => StyleSheet.create({
 *     box: { backgroundColor: c.background, color: c.text },
 *   });
 *
 * Mode is one of 'system' | 'light' | 'dark'. When 'system' (default), the
 * active palette follows the OS color scheme via Appearance.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { brand } from './brand';
export { fonts, GRADIENT, GRADIENT_FULL, GRADIENT_SOFT, GRADIENT_PANEL, GRADIENT_TEXT, GRADIENT_HERO, GRADIENT_INK, GRADIENT_INK_DARK, GRADIENT_XP, GRADIENT_GOLD, GRADIENT_STEEL, GRADIENT_BRONZE, GRADIENT_HOLO, brand, APP_NAME, APP_SHORT_NAME, ORG_NAME } from './brand';

// ── Palettes ──────────────────────────────────────────────────────────────────
// Vertex brand system. Light = paper surfaces, forest ink, mid-green primary;
// dark = deep forest surfaces with the lime accent. Values derive from
// ./brand so there's one place to tune the brand.
//
// The one compromise (as in any light-accent dark theme): dark `primary` is a
// lime-olive that has to read as TEXT on the forest card (4.9:1) and still
// carry the white labels hard-coded on primary fills (3.0:1, bold only).
// Pure lime can't carry white text, so it is `primaryLight` / `accent` /
// titles / glows in dark mode instead.
export const lightColors = {
  // Primary — the brand green; white text on it 9.7:1, 8.7:1 on the paper page
  primary: brand.mid,           // #1d4fa8
  primaryLight: '#245dca',      // 4.5:1+ on every light surface
  primaryDark: brand.forest,    // #0c2340
  // Text/icons ON a solid `primary` / `accent` fill. White in light; in dark
  // the fills are light greens, so the type flips to deep forest.
  onPrimary: '#FFFFFF',         // 9.7:1 on primary
  onAccent: '#FFFFFF',          // 5.3:1 on accent

  // Page field — the ONE owner of the page colour (painted by PageField,
  // mounted once in app/_layout.tsx). "Ink on paper."
  page: brand.paper,            // #eef4fa
  // background = CARD face, surface = secondary/inset panel + sheets + sticky
  // chrome (near-white so surface-filled cards still float on the field),
  // surfaceAlt = tracks / chips / tiles. All three MUST stay 6-digit hex —
  // 64 sites concatenate a hex alpha onto them (`colors.surface + 'CC'`).
  background: brand.card,       // #f8fbfe
  surface: '#f0f5fa',
  surfaceAlt: '#dbe6f0',

  // Text — forest ink (contrast measured on the page field, not on the card)
  text: brand.ink,              // #12294a 11.8:1
  textSecondary: '#2a425e',     // 8.7:1
  textMuted: brand.muted,       // #51657f 5.5:1 on page, 5.8:1 on card
  textLight: '#FFFFFF',

  // Ink — the printed dark block (hero blocks, tab bar, segment rails).
  // Deliberately the same idea in both themes; the field/cards flip.
  ink: brand.forest,            // #0c2340
  inkText: brand.paper,         // 13.2:1 on ink
  inkMuted: brand.sage,         // 8.3:1 on ink
  // Glass — chips/rows sitting ON ink or pop blocks only (never on the page).
  // House rule on light glass: `text` / `textSecondary` only — never
  // textMuted or primary as body type.
  glass: 'rgba(238,244,250,0.80)',
  glassBorder: 'rgba(255,255,255,0.85)',
  // Glow — text glow, focus rings, XP tip halo
  glow: 'rgba(10,155,203,0.45)',
  trackBg: '#d1deeb',
  // Depth — layered forest shadow (boxShadow string: rnw → CSS, RN 0.81 new-arch → native)
  depthShadow: '0 14px 30px -10px rgba(12,35,64,0.28), 0 2px 6px rgba(12,35,64,0.10), inset 0 1px 0 rgba(255,255,255,0.7)',
  // The Vertex X / loader dots: forest on light surfaces; markOnInk on dark blocks.
  markColor: '#1d4fa8',
  markOnInk: '#22d0ec',
  // Title / section-head type on light surfaces: solid brand green (8.7:1 on
  // the page). Three identical stops so every GradientText call site keeps working.
  titleGradient: [brand.mid, brand.mid, brand.mid] as readonly string[],

  // Status colors
  sgreen: '#059669',
  // Green TYPE on a light surface. `sgreen` is a badge/graphic colour — at
  // 3.8:1 on white it fails the 4.5:1 this project holds type to; two stops
  // darker clears every light surface (6.3:1 on the card, 5.9:1 on the page).
  sgreenInk: '#046A4B',
  sgreenBg: '#D1FAE5',
  green: brand.green,           // #10B981
  greenBg: '#DCFCE7',
  yellow: '#D97706',
  yellowBg: '#FEF3C7',
  red: '#DC2626',
  redBg: '#FEE2E2',

  // Neutrals — hairlines that read on the card AND on the field
  border: brand.rule,           // #cbd8e6
  borderDark: '#9eb4ce',
  shadow: 'rgba(12, 35, 64, 0.22)',

  // Accent
  accent: '#086381',            // olive lime — text-safe on light (4.5:1+)
  info: '#2563A8',
};

// Dark — deep forest surfaces, lime accent. Avoids true #000.
export const darkColors: typeof lightColors = {
  primary: '#0c8eb9',           // 4.9:1 on the card, 6.3:1 on the page
  primaryLight: brand.lime,     // #22d0ec 9.6:1 on the card
  primaryDark: '#225bc3',       // fills with white text (6.4:1)
  onPrimary: brand.deep,        // 5.6:1 on the dark primary (white would be 3.0:1)
  onAccent: brand.deep,         // 11:1 on lime

  // Abyss page + RAISED forest cards (cards lift above the field like in light mode).
  // Still 6-digit hex: ~64 sites concatenate an alpha onto them.
  page: '#060e1a',
  background: brand.forest,     // #0c2340 card, raised
  surface: '#0b1c30',           // secondary panel / sheet / sticky chrome
  surfaceAlt: '#11325f',

  // Text — paper + sage
  text: brand.paper,            // 13.2:1 on card
  textSecondary: '#c0cfdd',     // 9.7:1 on card
  textMuted: '#9cabbe',         // 6.4:1 on card
  textLight: '#FFFFFF',

  // Ink block sits BELOW the raised card and a hair above the abyss page; the
  // lime rim DepthCard draws on a dark ink face keeps it reading as a block.
  ink: brand.deep,              // #081a30
  inkText: brand.paper,
  inkMuted: brand.sage,         // 9.6:1 on dark ink
  glass: 'rgba(255,255,255,0.06)',
  glassBorder: 'rgba(255,255,255,0.14)',
  glow: 'rgba(34,208,236,0.55)',
  trackBg: '#091727',
  depthShadow: '0 18px 40px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(34,208,236,0.16)',
  markColor: '#22d0ec',
  markOnInk: '#22d0ec',
  // Titles take the lime itself at night: 9.6:1 on a card, 11:1+ on the page.
  titleGradient: [brand.lime, brand.lime, brand.lime] as readonly string[],

  // Status — translucent dark backgrounds so badges read on forest cards
  sgreen: brand.green,
  sgreenInk: brand.green,
  sgreenBg: 'rgba(16, 185, 129, 0.15)',
  green: brand.green,
  greenBg: 'rgba(16, 185, 129, 0.15)',
  yellow: brand.yellow,
  yellowBg: 'rgba(245, 158, 11, 0.15)',
  red: brand.red,
  redBg: 'rgba(239, 68, 68, 0.15)',

  // Neutrals — forest lines
  border: '#1a4a96',
  borderDark: '#375880',
  shadow: 'rgba(0, 0, 0, 0.6)',

  // Accent
  accent: brand.lime,
  info: '#7FB2E5',
};

export type ColorPalette = typeof lightColors;
export type ThemeMode = 'system' | 'light' | 'dark';

// ── Status badge colors (re-exported for backwards compat) ────────────────────
export const buildStatusColors = (c: ColorPalette) => ({
  'S-GREEN': { bg: c.sgreenBg, text: c.sgreen },
  'Green': { bg: c.greenBg, text: c.green },
  'Yellow': { bg: c.yellowBg, text: c.yellow },
  'Red': { bg: c.redBg, text: c.red },
});

export const buildGetStatusColor = (c: ColorPalette) => (status: string) => {
  const s = (status || '').trim();
  if (s.toLowerCase().includes('s-green') || s.toLowerCase() === 'sgreen') return { bg: c.sgreenBg, text: c.sgreen };
  if (s.toLowerCase().includes('green')) return { bg: c.greenBg, text: c.green };
  if (s.toLowerCase().includes('yellow')) return { bg: c.yellowBg, text: c.yellow };
  if (s.toLowerCase().includes('red')) return { bg: c.redBg, text: c.red };
  return { bg: c.surfaceAlt, text: c.textSecondary };
};

// ── Context ──────────────────────────────────────────────────────────────────
type ThemeCtx = {
  colors: ColorPalette;
  mode: ThemeMode;
  effective: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeCtx>({
  colors: lightColors,
  mode: 'system',
  effective: 'light',
  setMode: () => {},
});

const STORAGE_KEY = 'cg1.theme.mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

  // Load persisted mode on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
    }).catch(() => {});
  }, []);

  // Watch system scheme changes (only relevant when mode === 'system')
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const effective: 'light' | 'dark' = mode === 'system'
    ? (systemScheme === 'dark' ? 'dark' : 'light')
    : mode;

  const colors = effective === 'dark' ? darkColors : lightColors;

  // Web: reflect the app theme onto the document so the browser renders native
  // form controls — date/time pickers especially — in the matching scheme.
  // color-scheme inherits, so setting it on the root fixes every input at once.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = effective;
    }
  }, [effective]);

  const value = useMemo<ThemeCtx>(() => ({
    colors,
    mode,
    effective,
    setMode,
  }), [colors, mode, effective, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;
