/**
 * Brand tokens — the single source of truth for the app's identity.
 *
 * Palette taken from the TLG logo: deep navy surfaces, the logo's cyan as the
 * accent and its blue as the primary, with a warm amber as the secondary
 * accent. Mirrors backend/core/brand.py (emails, /launch).
 *
 * The token names (forest, lime, leaf, …) are the original ones, kept so no
 * screen needs editing; read them by role: forest/deep = dark surfaces,
 * mid/leaf = brand blue, lime = the cyan accent.
 *
 * Contrast rules the whole app follows:
 *   • the accent is an ACCENT — anything written ON it is dark (ink/forest);
 *   • accent TEXT only ever sits on forest/ink; on light surfaces text uses
 *     forest/mid (the accent fails 4.5:1 on paper);
 *   • every brand GRADIENT below is dark enough to carry white text.
 *
 * Both light/dark palettes in ThemeContext derive their values from here so
 * there is exactly one place to tune the brand. Theme-neutral things that
 * don't change between light/dark (fonts, the brand gradient, glows) live
 * directly on this module.
 */

// ── Names ────────────────────────────────────────────────────────────────────
// Every user-visible product/organisation name reads from here. Mirrors the
// backend's APP_NAME / ORG_NAME defaults (backend/core/brand.py).
// The app (the portal) is The Loris Hub; the team it belongs to is The Loris
// Group. APP_SHORT_NAME and ORG_NAME are where screens name the TEAM ("… New
// Starts" on Home, the "Mini …" team on Bells, the loading screen, posters).
// The trading name printed on ID badges is separate: BADGE_ORG_NAME on the host.
export const APP_NAME = 'The Loris Hub';
export const APP_SHORT_NAME = 'The Loris Group';
export const ORG_NAME = 'The Loris Group';
// ID badges are made in the campaign's own badge maker, which prints the
// approved Modern Milkman design. Badge buttons open it in a new tab. Set to ''
// to use the app's built-in badge maker (Badge Studio) instead. Badge NUMBERS
// still live in the app either way: they link people to OwnerIQ.
export const BADGE_MAKER_URL = 'https://tmm-badge-maker.replit.app';

// ── Raw brand palette ────────────────────────────────────────────────────────
export const brand = {
  // Core palette
  forest: '#0c2340',   // primary dark surface (ink blocks, dark cards)
  deep: '#081a30',     // deepest navy
  mid: '#1d4fa8',      // brand blue that carries white text / reads on paper (7.7:1)
  lime: '#22d0ec',     // the accent (cyan) — dark text on it, accent text only on forest
  limeDark: '#0a9bcb', // accent for graphics on light surfaces (not for text)
  paper: '#eef4fa',    // light page
  card: '#f8fbfe',     // light card face
  ink: '#12294a',      // body text on light surfaces
  muted: '#51657f',    // secondary text on light surfaces
  rule: '#cbd8e6',     // hairlines on light surfaces
  amber: '#e7b65c',    // warm secondary accent

  // Derived
  sage: '#b3c5da',     // muted text on forest/ink (9.0:1)
  leaf: '#2864d9',     // the logo's blue: lightest brand shade that still carries white text (5.4:1)

  // Status (shared across the app — deliberately not brand colours)
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#EF4444',
  grey: '#6B7280',
  cyan: '#22d3ee',
  rose: '#e0607e',

  // Accent washes
  accentDim: 'rgba(34,208,236,0.14)',
  accentGlow: 'rgba(10,155,203,0.30)',
  amberGlow: 'rgba(231,182,92,0.22)',
};

// ── Brand gradient (leaf → mid → forest) ─────────────────────────────────────
// Use with expo-linear-gradient: <LinearGradient colors={GRADIENT} .../>
// White text/icons sit on it everywhere (≥5.1:1 on the lightest stop).
export const GRADIENT = ['#2864d9', '#2259c0', '#12356f'] as const;
// Full-spectrum poster gradient (lime → leaf → forest) — cube faces, orbit rings
export const GRADIENT_FULL = ['#9beaf7', '#22d0ec', '#0a9bcb', '#2864d9', '#1d4fa8'] as const;
// Soft translucent gradient for backdrops / glass cards
export const GRADIENT_SOFT = ['rgba(34,208,236,0.16)', 'rgba(29,79,168,0.16)'] as const;
// Deep panel gradient — hero cards / headers on dark surfaces
export const GRADIENT_PANEL = ['#163e7a', '#0f2d57', '#081a30'] as const;

// ── Visual system v2 ("Ink & Cube") ─────────────────────────────────────────
// Title text on INK blocks, in both themes: solid lime (9.6:1 on forest).
// Three identical stops keep every GradientText call site unchanged.
export const GRADIENT_TEXT = ['#22d0ec', '#22d0ec', '#22d0ec'] as const;
// Pop heroes — white text ≥4.5:1 on the lightest stop
export const GRADIENT_HERO = ['#2864d9', '#1d4fa8', '#0c2340'] as const;
// Ink block base — light theme / dark theme (dark ink must stay below the card)
export const GRADIENT_INK = ['#17407f', '#0f2c55', '#081a30'] as const;
// Dark theme: the ink block runs BELOW the raised forest card (DepthCard adds
// a lime rim on dark ink faces so the pair still reads as two surfaces).
export const GRADIENT_INK_DARK = ['#0b1e38', '#08172b', '#040b15'] as const;
// XP bars, neon ring arcs, lit skill-tree rails
export const GRADIENT_XP = ['#2864d9', '#0a9bcb', '#22d0ec'] as const;
// Coin metals
export const GRADIENT_GOLD = ['#fff1a8', '#f0c53d', '#b8860b'] as const;
export const GRADIENT_STEEL = ['#e8e8f0', '#a9a9bd', '#6b6b80'] as const;
export const GRADIENT_BRONZE = ['#f1c9a3', '#cd7f32', '#8a4b1a'] as const;
// Holographic sheen that slides across depth cards on scroll (dark theme).
export const GRADIENT_HOLO = ['rgba(255,255,255,0)', 'rgba(34,208,236,0.07)', 'rgba(231,182,92,0.05)', 'rgba(255,255,255,0)'] as const;
// The same sheen for LIGHT cards — roughly a third of the alpha, so it reads
// as a highlight raking the face rather than a colour cast.
export const GRADIENT_HOLO_LIGHT = ['rgba(255,255,255,0)', 'rgba(34,208,236,0.06)', 'rgba(231,182,92,0.04)', 'rgba(255,255,255,0)'] as const;

// ── Fonts ────────────────────────────────────────────────────────────────────
// Family names here MUST match the keys registered in useFonts() in _layout.tsx.
// Space Grotesk = display/headings, Inter = body/UI, JetBrains Mono = data.
export const fonts = {
  display: 'SpaceGrotesk-Bold',
  displayMedium: 'SpaceGrotesk-Medium',
  displayRegular: 'SpaceGrotesk',
  body: 'Inter',
  bodyMedium: 'Inter-Medium',
  bodySemibold: 'Inter-SemiBold',
  bodyBold: 'Inter-Bold',
  mono: 'JetBrainsMono',
  monoSemibold: 'JetBrainsMono-SemiBold',
  // Unbounded — the editorial voice. NEVER stack fontWeight on these: expo-font's
  // web @font-face has no weight descriptor, so a fontWeight triggers faux-bold.
  displayWide: 'Unbounded-SemiBold',   // section heads, ribbons, segment labels, kickers ≥11px uppercase
  displayBlack: 'Unbounded-Black',     // mastheads, hero titles, stat numerals ≥20px
} as const;
