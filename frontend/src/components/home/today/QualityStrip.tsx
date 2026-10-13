// The week's quality on Home, under "My week": your order value, drop days,
// fails (with the count), The Round and 4th week from the latest quality
// report, coloured against the Owner's targets. Someone not on the report
// (e.g. the Owner) sees their team's or the office's. Tap for Quality.
// (GET /quality, the same data as the Quality screen)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { fmtQuality } from '../../../utils/qualityBulletin';

type Cell = { value: number | null; rag: 'green' | 'amber' | 'red' | null };
const SHOW = [['aov', 'Order'], ['drops', 'Drops'], ['fail_rate', 'Fails'], ['the_round', 'Round'], ['fourth_week', '4th wk']] as const;

export default function QualityStrip({ bare = false }: { bare?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({
    queryKey: ['quality', 'week', '', ''],
    queryFn: () => apiService.getQuality({ view: 'week' }).then((r) => r.data),
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const d = q.data;
  const row = d?.me || d?.box;
  if (!d?.week_ending || !row?.metrics) return null;
  const m: Record<string, Cell> = row.metrics;
  const tone = (rag: Cell['rag']) =>
    rag === 'green' ? { bg: c.greenBg, fg: c.green } : rag === 'amber' ? { bg: c.yellowBg, fg: c.yellow } : rag === 'red' ? { bg: c.redBg, fg: c.red } : { bg: c.surface, fg: c.textMuted };
  const who = d.me ? 'Your quality' : d.box?.kind === 'office' ? 'Office quality' : 'Team quality';
  const fails = (m as any).fails?.value;
  const signups = (m as any).signups?.value;
  return (
    <Pressable onPress={() => router.push('/quality' as never)} style={[s.wrap, bare && s.bare]} accessibilityRole="button" testID="home-quality">
      <View style={s.head}>
        <Text style={s.title}>{who} · {d.label}</Text>
        <Ionicons name="chevron-forward" size={14} color={c.textMuted} />
      </View>
      <View style={s.chips}>
        {SHOW.filter(([k]) => m[k]?.value != null).map(([k, label]) => {
          const t = tone(m[k].rag);
          return (
            <View key={k} style={[s.chip, { backgroundColor: t.bg }]}>
              <Text style={s.chipLabel}>{label}</Text>
              <Text style={[s.chipValue, { color: t.fg }]}>{fmtQuality(k, m[k].value)}</Text>
              {k === 'fail_rate' && fails != null ? <Text style={s.chipSub}>{fails} of {signups}</Text> : null}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  wrap: { gap: 6, paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: c.border },
  bare: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, minWidth: 62, alignItems: 'center' },
  chipLabel: { fontFamily: fonts.body, fontSize: 11, color: c.text },
  chipValue: { fontFamily: fonts.bodyBold, fontSize: 15 },
  chipSub: { fontFamily: fonts.body, fontSize: 10.5, color: c.textMuted },
});
