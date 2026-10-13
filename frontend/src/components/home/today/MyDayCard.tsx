// "My day" on Home, under the map: what you're doing today, not a score that
// Field IQ will always beat. Today's set-up (goal, KPI, focus), this week's
// focus, your average day over your recent field days, what one sign-up takes
// you, and so what today's goal takes. Live Operations is one tap away for
// where you're at right now. (GET /sector/my-day)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';

const STEPS = [['doors', 'doors'], ['spoken', 'spoken'], ['pitched', 'pitched'], ['closed', 'closes']] as const;
const r0 = (n: number) => Math.round(n);

export default function MyDayCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({
    queryKey: ['my-day'],
    queryFn: () => apiService.getMyDay().then((r) => r.data),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const d = q.data;
  if (!d || d.sunday) return null;
  const su = d.setup;
  const goal = su?.goal != null ? Number(su.goal) : 4;
  const av = d.averages || {};
  const per = av.per_sale || { doors: 30, spoken: 17.5, pitched: 6.25, closed: 3.75 };
  const day = av.per_day;
  return (
    <View style={s.card} testID="home-my-day">
      <Pressable onPress={() => router.push('/my-sector' as never)} style={s.head} accessibilityRole="button">
        <Text style={s.title}>My day · {d.label}</Text>
        <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
      </Pressable>
      {su ? (
        <Text style={s.setup}>
          <Text style={s.bold}>Goal {su.goal ?? '–'}</Text>
          {su.kpi ? ` · KPI ${su.kpi}` : ''}{su.focus ? ` · Focus: ${su.focus}` : ''}
        </Text>
      ) : (
        <Pressable onPress={() => router.push('/my-sector' as never)}><Text style={s.muted}>No set-up yet today. Tap to do yours.</Text></Pressable>
      )}
      {d.week_focus?.length > 0 && (
        <Text style={s.line}><Text style={s.bold}>This week’s focus:</Text> {d.week_focus.join(' · ')}</Text>
      )}

      <View style={s.box}>
        <Text style={s.boxTitle}>One sign-up takes you</Text>
        <Text style={s.big}>
          {STEPS.map(([k, label]) => `${r0(per[k])} ${label}`).join(' · ')}
        </Text>
        <Text style={s.small}>{av.per_sale_source === 'yours' ? `From your last ${av.days} field days.` : 'Law of Averages, until you have sign-ups on Field IQ.'}</Text>
      </View>

      <View style={s.box}>
        <Text style={s.boxTitle}>Today’s goal of {goal} takes</Text>
        <Text style={s.big}>{STEPS.map(([k, label]) => `${r0(per[k] * goal)} ${label}`).join(' · ')}</Text>
      </View>

      {day && (
        <Text style={s.line}>
          <Text style={s.bold}>Your average day:</Text> {r0(day.doors)} doors · {r0(day.spoken)} spoken · {r0(day.pitched)} pitched · {r0(day.closed)} closed · {day.sales} sign-ups
        </Text>
      )}

      <View style={s.row}>
        <Pressable onPress={() => router.push('/live-ops' as never)} style={s.btn} accessibilityRole="button" testID="my-day-live">
          <Ionicons name="radio-outline" size={15} color={c.onPrimary} />
          <Text style={s.btnText}>Where I'm at now</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/field-kpis' as never)} style={s.ghost} accessibilityRole="button">
          <Ionicons name="speedometer-outline" size={15} color={c.primary} />
          <Text style={s.ghostText}>My numbers</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 9, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  setup: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.text },
  bold: { fontFamily: fonts.bodyBold },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  line: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.text },
  box: { backgroundColor: c.surface, borderRadius: 12, padding: 10, gap: 2 },
  boxTitle: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textMuted },
  big: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.text },
  small: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.primary },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
