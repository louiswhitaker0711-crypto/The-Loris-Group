// "My week" on Home: this week's sign-ups against the traffic light (and
// your weekly goal when you've set one), from your own Bells row (tap for your numbers, Field KPIs); under it
// the latest quality report (QualityStrip).
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import QualityStrip from './QualityStrip';
import { weekBand, WEEK_BAND_LABELS, AMBER_WEEK_MIN, GREEN_WEEK_MIN, SUPER_GREEN_WEEK_MIN } from '../../../utils/weekBands';

export default function MyWeekCard({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({ queryKey: ['my-bells-summary', 1], queryFn: () => apiService.getMyBellsSummary(1).then((r) => r.data), retry: false });
  const w = q.data?.this_week;
  // No week on the sheet yet: still show the quality, on its own.
  if (!q.data || (hideWhenEmpty && !q.data.has_entry && !(w?.sign_ups))) {
    return q.isLoading ? null : <QualityCardAlone />;
  }
  const n = Number(w?.sign_ups || 0);
  const band = weekBand(n);
  const next = n < AMBER_WEEK_MIN ? { at: AMBER_WEEK_MIN, name: 'Amber' } : n < GREEN_WEEK_MIN ? { at: GREEN_WEEK_MIN, name: 'Green' }
    : n < SUPER_GREEN_WEEK_MIN ? { at: SUPER_GREEN_WEEK_MIN, name: 'Super Green' } : null;
  const goal = Number(w?.weekly_goal || 0) || null;
  const scale = goal || next?.at || SUPER_GREEN_WEEK_MIN;
  const tone = band === 'red' ? c.red : band === 'amber' ? c.yellow : c.green;
  const pa = w?.days_worked ? (n / w.days_worked).toFixed(1) : null;
  return (
    <View style={s.card}>
    <Pressable onPress={() => router.push('/field-kpis' as never)} style={{ gap: 6 }} accessibilityRole="button" testID="home-my-week">
      <View style={s.head}>
        <Text style={s.title}>My week</Text>
        <Text style={[s.band, { color: tone, borderColor: tone }]}>{WEEK_BAND_LABELS[band].name}</Text>
      </View>
      <Text style={s.line}>
        {n} sign-up{n === 1 ? '' : 's'}{goal ? ` of ${goal}` : ''}
        {next ? ` · ${next.at - n} more for ${next.name}` : ' · top of the lights'}
        {pa ? ` · PA ${pa}` : ''}
      </Text>
      <View style={s.track}><View style={[s.fill, { width: `${Math.min(100, Math.round((n / scale) * 100))}%` as any, backgroundColor: tone }]} /></View>
    </Pressable>
    <QualityStrip />
    </View>
  );
}

function QualityCardAlone() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  return <View style={s.cardQ}><QualityStrip bare /></View>;
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 6, marginBottom: 12 },
  cardQ: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  band: { fontFamily: fonts.bodyBold, fontSize: 12, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, overflow: 'hidden' },
  line: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  track: { height: 7, borderRadius: 4, backgroundColor: c.surface, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
