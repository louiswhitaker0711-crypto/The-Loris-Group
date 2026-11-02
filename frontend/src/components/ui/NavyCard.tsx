/**
 * NavyCard — the navy hero card of the Nov 2026 look: a navy gradient with a
 * cyan glow in the top-right corner and soft 24px corners. Screens put their
 * headline numbers and main buttons in one at the top (Bells' office week,
 * Sector's "Start a sector").
 *
 * Text does not inherit in RN, so children use the ON_NAVY colours below.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSurface } from '../../theme/teamTheme';

/** Colours for anything placed on a NavyCard (or the Home hero). */
export const ON_NAVY = {
  text: '#ffffff',
  soft: '#d6e3f1',     // secondary lines
  muted: '#b3c5da',    // labels and kickers
  cyan: '#22d0ec',     // the one accent
  gold: '#ffd60a',
  green: '#6ee794',
  amber: '#ffc35c',
  red: '#ff8178',
  glass: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.14)',
  track: 'rgba(255,255,255,0.14)',
} as const;

export const NAVY_TOP = '#081a30';
export const NAVY_LOW = '#12305c';
/** The progress-bar gradient used on navy (blue into cyan). */
export const NAVY_BAR = ['#2864d9', '#22d0ec'] as const;

export function NavyCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  // Loris navy, or a team leader's own colours (src/theme/teamTheme.tsx).
  const surface = useSurface();
  return (
    <View style={[styles.card, { backgroundColor: surface.deep }, surface.light && { borderWidth: 1, borderColor: surface.edge }, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
        <LinearGradient colors={[surface.deep, surface.mid]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[surface.glow, surface.glowClear]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.35, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: 16, gap: 12, backgroundColor: NAVY_TOP },
  clip: { borderRadius: 24, overflow: 'hidden' },
});

export default NavyCard;
