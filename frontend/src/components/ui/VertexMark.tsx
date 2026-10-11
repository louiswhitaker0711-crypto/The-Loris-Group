/**
 * VertexMark — the app's live brand object (masthead, heroes, login, sidebar).
 * The component keeps its original name so no screen needs editing; it now
 * draws the TLG monogram from brandMarkGeometry.ts with react-native-svg.
 *
 *   <VertexMark size={44} kick={pageMarkKick} />      one colour, follows the theme
 *   <VertexMark size={150} color="rgba(29,79,168,0.62)" />
 *   <VertexMark size={200} gradient glow />           the logo's own cyan-to-blue gradient
 *
 * The mark sits centred in a size × size box, about 72 % of the box wide, so
 * it stays inside the footprint the previous mark used.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useColors, useTheme } from '../../theme/ThemeContext';
import { APP_NAME } from '../../theme/brand';
import { GlowOrb } from './Decor';
import { MARK_BOX, MARK_GRADIENT, MARK_PATH } from './brandMarkGeometry';

export interface VertexMarkProps {
  /** Box width and height in px. */
  size: number;
  /** Mark colour (default `colors.markColor`). Ignored when `gradient` is set. */
  color?: string;
  /** Fill with the logo's own gradient instead of one colour. */
  gradient?: boolean;
  /** Soft brand glow behind the mark. */
  glow?: boolean;
  /** Whole-mark opacity. */
  opacity?: number;
  /** Kept for existing call sites; this mark has no ripple animation. */
  ripple?: number;
  /** Tab-change counter — every change gives the mark a small pop. */
  kick?: SharedValue<number>;
}

const MARK_WIDTH = 0.72; // of the box

/** The monogram itself, `size` px square. */
function MarkSvg({ size, fill, gradient }: { size: number; fill: string; gradient: boolean }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}>
      {gradient ? (
        <Defs>
          <LinearGradient id={`mark${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={MARK_GRADIENT[0]} />
            <Stop offset="0.5" stopColor={MARK_GRADIENT[1]} />
            <Stop offset="1" stopColor={MARK_GRADIENT[2]} />
          </LinearGradient>
        </Defs>
      ) : null}
      <Path d={MARK_PATH} fill={gradient ? `url(#mark${id})` : fill} fillRule="evenodd" />
    </Svg>
  );
}

export function VertexMark({ size, color, gradient = false, glow = false, opacity = 1, kick }: VertexMarkProps) {
  const colors = useColors();
  const { effective } = useTheme();
  const fill = color ?? colors.markColor;
  const side = size * MARK_WIDTH;

  // ── Tab kick: a quick scale pop ────────────────────────────────────────────
  const pop = useSharedValue(1);
  useAnimatedReaction(
    () => (kick ? kick.value : 0),
    (v, prev) => {
      if (prev !== null && v !== prev) {
        pop.value = withSequence(withTiming(1.08, { duration: 140 }), withTiming(1, { duration: 260 }));
      }
    },
  );
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <View pointerEvents="none" style={{ width: size, height: size, opacity }}>
      {glow ? (
        <GlowOrb
          size={size * 1.6}
          color={colors.primary}
          opacity={effective === 'dark' ? 0.5 : 0.36}
          style={{ top: -size * 0.3, left: -size * 0.3 }}
        />
      ) : null}
      <Animated.View
        style={[{
          position: 'absolute', width: side, height: side,
          left: (size - side) / 2, top: (size - side) / 2,
        }, popStyle]}
      >
        <MarkSvg size={side} fill={fill} gradient={gradient} />
      </Animated.View>
    </View>
  );
}

export default VertexMark;

/**
 * The logo for the splash screen: the monogram centred in a box `width` px
 * wide and half as tall. With no `color` it uses the logo's own gradient.
 */
export function VertexLogo({ width, color }: { width: number; color?: string }) {
  const side = width * 0.5;
  return (
    <View
      accessibilityLabel={APP_NAME}
      style={{ width, height: side, alignItems: 'center', justifyContent: 'center' }}
    >
      <MarkSvg size={side} fill={color ?? MARK_GRADIENT[1]} gradient={!color} />
    </View>
  );
}
