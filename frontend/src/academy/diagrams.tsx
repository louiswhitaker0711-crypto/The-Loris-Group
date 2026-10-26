/**
 * BA Academy diagrams, redrawn from the product coaching slides so they read
 * cleanly on a phone in both themes: Our model (the four links, the
 * BA → customer link highlighted) and the progression ladder.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Rect, Path, Text as SvgText, G } from 'react-native-svg';
import { useColors, fonts } from '../theme/ThemeContext';

function Arrow({ d, head, color, width }: { d: string; head: string; color: string; width: number }) {
  return (
    <G>
      <Path d={d} stroke={color} strokeWidth={width} fill="none" />
      <Path d={head} fill={color} />
    </G>
  );
}

export function ModelDiagram({ company }: { company: string }) {
  const c = useColors();
  const node = (x: number, y: number, title: string, sub: string, key = false) => (
    <G key={title}>
      <Rect x={x} y={y} width={140} height={56} rx={10} fill={c.background} stroke={key ? c.primaryLight : c.border} strokeWidth={key ? 2.5 : 1.5} />
      <SvgText x={x + 70} y={y + 25} fontSize={13} fontFamily={fonts.bodySemibold} fill={c.text} textAnchor="middle">{title}</SvgText>
      <SvgText x={x + 70} y={y + 42} fontSize={10} fontFamily={fonts.mono} fill={c.textMuted} textAnchor="middle" letterSpacing={0.6}>{sub.toUpperCase()}</SvgText>
    </G>
  );
  return (
    <View style={{ width: '100%', aspectRatio: 520 / 284, maxWidth: 560, alignSelf: 'center' }}>
      <Svg width="100%" height="100%" viewBox="0 0 520 284" accessibilityLabel="Our model: Client to Marketing company to Brand Ambassador to Customer and back to Client. The Brand Ambassador to Customer link is where the revenue is made.">
        <Arrow d="M162,46 L350,46" head="M358,46 L348,41 L348,51 Z" color={c.textMuted} width={1.5} />
        <Arrow d="M430,76 L430,198" head="M430,206 L425,196 L435,196 Z" color={c.textMuted} width={1.5} />
        <Arrow d="M358,236 L172,236" head="M162,236 L174,229 L174,243 Z" color={c.primaryLight} width={3} />
        <Arrow d="M90,206 L90,84" head="M90,76 L85,86 L95,86 Z" color={c.textMuted} width={1.5} />
        {node(20, 18, 'Client', 'Modern Milkman')}
        {node(360, 18, 'Marketing company', company)}
        {node(360, 208, 'Brand Ambassador', 'You', true)}
        {node(20, 208, 'Customer', 'On the doorstep')}
        <SvgText x={260} y={224} fontSize={10.5} fontFamily={fonts.monoSemibold} fill={c.primary} textAnchor="middle" letterSpacing={0.6}>REVENUE MADE HERE</SvgText>
      </Svg>
    </View>
  );
}

const STEPS = ['6–9 Day|Evaluation', 'BA', 'Leader', 'Team Leader', 'Assistant|Director', 'Company|Director'];

export function LadderDiagram() {
  const c = useColors();
  return (
    <View style={{ width: '100%', aspectRatio: 480 / 214, maxWidth: 560, alignSelf: 'center' }}>
      <Svg width="100%" height="100%" viewBox="0 0 480 214" accessibilityLabel="Progression: 1 six to nine day evaluation, 2 BA, 3 Leader, 4 Team Leader, 5 Assistant Director, 6 Company Director">
        {STEPS.map((label, i) => {
          const x = 10 + i * 78;
          const h = 30 + i * 25;
          const y = 204 - h;
          const lines = label.split('|');
          return (
            <G key={label}>
              <Rect x={x} y={y} width={70} height={h} rx={4} fill={c.primary + '1f'} stroke={c.primaryLight} strokeWidth={1} />
              <SvgText x={x + 35} y={194} fontSize={12} fontFamily={fonts.monoSemibold} fill={c.primary} textAnchor="middle">{String(i + 1)}</SvgText>
              {lines.map((ln, k) => (
                <SvgText key={k} x={x + 35} y={y - 8 - (lines.length - 1 - k) * 13} fontSize={11} fontFamily={fonts.bodySemibold} fill={c.text} textAnchor="middle">{ln}</SvgText>
              ))}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
