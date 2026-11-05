/**
 * The AI's chat replies, easy to read on a phone (the Owner, 5 Nov 2026): a
 * line that is only **bold** becomes a heading, "- " / "• " / "1. " lines
 * become bullets, **bold** inside a line is bold, and any stray markdown
 * (#, *, `) is dropped rather than shown.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors, fonts } from '../../theme/ThemeContext';

function inline(text: string, boldStyle: any, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4
    ? <Text key={`${key}-${i}`} style={boldStyle}>{p.slice(2, -2)}</Text>
    : p.replace(/\*+/g, '').replace(/`/g, '')));
}

export default function AiText({ text, color }: { text: string; color?: string }) {
  const c = useColors();
  const s = styles(c, color);
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { out.push(<View key={i} style={s.gap} />); return; }
    const heading = line.replace(/^#+\s*/, '').match(/^\*\*([^*]+)\*\*:?$/) || (line.startsWith('#') ? [line, line.replace(/^#+\s*/, '').replace(/\*+/g, '')] : null);
    if (heading) { out.push(<Text key={i} style={s.heading} selectable>{heading[1]}</Text>); return; }
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const num = line.match(/^(\d+)[.)]/);
      out.push(
        <View key={i} style={s.bulletRow}>
          <Text style={s.dot}>{num ? `${num[1]}.` : '•'}</Text>
          <Text style={[s.body, { flex: 1 }]} selectable>{inline(bullet[1], s.bold, String(i))}</Text>
        </View>,
      );
      return;
    }
    out.push(<Text key={i} style={s.body} selectable>{inline(line, s.bold, String(i))}</Text>);
  });
  return <View style={s.wrap}>{out}</View>;
}

const styles = (c: any, color?: string) => StyleSheet.create({
  wrap: { gap: 3 },
  gap: { height: 6 },
  heading: { fontFamily: fonts.bodyBold, fontSize: 15.5, lineHeight: 22, color: color || c.text, marginTop: 4 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: color || c.text },
  bold: { fontFamily: fonts.bodySemibold },
  bulletRow: { flexDirection: 'row', gap: 8, paddingLeft: 2 },
  dot: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 22, color: c.primary, minWidth: 14 },
});
