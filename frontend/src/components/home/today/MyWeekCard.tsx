// "My week" on Home: this week's sign-ups against the traffic light (and
// your weekly goal when you've set one), from your own Bells row (tap for your numbers, Field KPIs).
// Quality has its own card at the top of Home the week a report lands (QualityNewCard).
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { ukNow } from '../../../utils/fieldTime';
import { weekBand, WEEK_BAND_LABELS, AMBER_WEEK_MIN, GREEN_WEEK_MIN, SUPER_GREEN_WEEK_MIN } from '../../../utils/weekBands';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function MyWeekCard({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({ queryKey: ['my-bells-summary', 1], queryFn: () => apiService.getMyBellsSummary(1).then((r) => r.data), retry: false });
  const w = q.data?.this_week;
  if (!q.data || (hideWhenEmpty && !q.data.has_entry && !(w?.sign_ups))) return null;
  const n = Number(w?.sign_ups || 0);
  const band = weekBand(n);
  const next = n < AMBER_WEEK_MIN ? { at: AMBER_WEEK_MIN, name: 'Amber' } : n < GREEN_WEEK_MIN ? { at: GREEN_WEEK_MIN, name: 'Green' }
    : n < SUPER_GREEN_WEEK_MIN ? { at: SUPER_GREEN_WEEK_MIN, name: 'Super Green' } : null;
  const goal = Number(w?.weekly_goal || 0) || null;
  const scale = goal || next?.at || SUPER_GREEN_WEEK_MIN;
  const tone = band === 'red' ? c.red : band === 'amber' ? c.yellow : c.green;
  const pa = w?.days_worked ? (n / w.days_worked).toFixed(1) : null;
  // Monday to Saturday from your Bells row; what you need a day for the rest.
  const days: any[] = w?.days || [];
  const todayIdx = (ukNow().day + 6) % 7;   // Monday 0, in UK time
  const AWAY = ['ab', 'ns', 'rt', 'pc', 'nc'];
  const count = (d: any) => Number(d?.silver || 0) + Number(d?.gold || 0);
  const left = days.filter((d, i) => i > todayIdx || (i === todayIdx && count(d) === 0 && d?.status !== 'in'))
    .filter((d) => !AWAY.includes(d?.status)).length;
  const target = goal || next?.at || null;
  const perDay = target && left > 0 && target > n ? Math.ceil(((target - n) / left) * 10) / 10 : null;
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
      {days.length > 0 && (
        <View style={s.days}>
          {DAY_SHORT.map((lbl, i) => {
            const d = days[i] || {};
            const away = AWAY.includes(d.status);
            const v = count(d);
            const isIn = d.status === 'in' || v > 0;
            return (
              <View key={lbl} style={[s.day, i === todayIdx && s.dayToday, away && s.dayAway]}>
                <Text style={s.dayLbl}>{lbl}</Text>
                <Text style={[s.dayNum, isIn && { color: c.text }]}>{away ? 'off' : isIn ? v : i < todayIdx ? '–' : '·'}</Text>
              </View>
            );
          })}
        </View>
      )}
      {perDay != null && (
        <Text style={s.need}>Need {perDay} a day for the {left} day{left === 1 ? '' : 's'} left to hit {goal ? `your goal of ${goal}` : next?.name}</Text>
      )}
    </Pressable>
    </View>
  );
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
  days: { flexDirection: 'row', gap: 5, marginTop: 4 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 9, backgroundColor: c.surface },
  dayToday: { borderWidth: 1.5, borderColor: c.primary },
  dayAway: { opacity: 0.5 },
  dayLbl: { fontFamily: fonts.body, fontSize: 11, color: c.textMuted },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.textMuted },
  need: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text, marginTop: 2 },
});
