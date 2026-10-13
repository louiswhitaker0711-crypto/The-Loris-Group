// "My day" on Home, straight under the map: today's set-up (goal, KPI,
// focus) and your live numbers so far against the Law of Averages, so you
// can check your own performance the moment the app opens. Numbers come from
// Field IQ (synced through the day); Bells sign-ups win when they're in.
// (GET /sector/my-day)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { dayBandText } from '../../../utils/dayBands';
import { APP_LOCALE, APP_TZ } from '../../../utils/appTime';

// The Owner's Law of Averages for a day.
const LOA = [['doors', 'Doors', 120], ['spoken', 'Spoken', 70], ['pitched', 'Pitched', 25], ['closed', 'Closed', 15]] as const;

export default function MyDayCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({
    queryKey: ['my-day'],
    queryFn: () => apiService.getMyDay().then((r) => r.data),
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  const d = q.data;
  if (!d || d.sunday) return null;
  const su = d.setup;
  const live = d.live || {};
  const goal = su?.goal != null ? Number(su.goal) : 4;
  const hit = Number(live.hit || 0);
  const synced = d.synced_at
    ? new Date(d.synced_at).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: APP_TZ })
    : null;
  return (
    <Pressable onPress={() => router.push('/field-kpis' as never)} style={s.card} accessibilityRole="button" testID="home-my-day">
      <View style={s.head}>
        <Text style={s.title}>My day · {d.label}</Text>
        <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
      </View>
      {su ? (
        <Text style={s.setup} numberOfLines={3}>
          <Text style={s.bold}>Goal {su.goal ?? '–'}</Text>
          {su.kpi ? ` · KPI ${su.kpi}` : ''}{su.focus ? ` · Focus: ${su.focus}` : ''}
        </Text>
      ) : (
        <Text style={s.muted}>No set-up yet today. Tap to do yours.</Text>
      )}
      <View style={s.row}>
        <View style={[s.big, { borderColor: dayBandText(hit) }]}>
          <Text style={[s.bigNum, { color: dayBandText(hit) }]}>{hit}</Text>
          <Text style={s.bigLabel}>of {goal} sign-ups</Text>
        </View>
        {LOA.map(([k, label, target]) => {
          const v = Number(live[k] || 0);
          return (
            <View key={k} style={s.stat}>
              <Text style={[s.statNum, v >= target && { color: c.green }]}>{v}</Text>
              <Text style={s.statLabel}>{label}</Text>
              <Text style={s.statTarget}>/{target}</Text>
            </View>
          );
        })}
      </View>
      {(() => {
        // What one sale takes: your doors per sign-up today, else the Law of
        // Averages (120 doors for 4 = 30 a sale).
        const doors = Number(live.doors || 0);
        const perSale = hit > 0 && doors > 0 ? Math.round(doors / hit) : 30;
        const left = Math.max(0, goal - hit);
        return (
          <Text style={s.line}>
            <Text style={s.bold}>1 sale ≈ {perSale} doors</Text>{hit > 0 && doors > 0 ? ' today' : ' (Law of Averages)'}
            {left > 0 ? ` · ${left} more for your goal ≈ ${left * perSale} doors` : ' · goal hit 🎉'}
          </Text>
        );
      })()}
      {d.week_focus?.length > 0 && (
        <Text style={s.line} numberOfLines={2}><Text style={s.bold}>This week’s focus:</Text> {d.week_focus.join(' · ')}</Text>
      )}
      <Text style={s.small}>
        {d.has_live ? `Field IQ${synced ? `, updated ${synced}` : ''}. It updates every 20 minutes.` : 'Your numbers show here once Field IQ has today’s doors (it updates every 20 minutes).'}
      </Text>
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  setup: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.text },
  bold: { fontFamily: fonts.bodyBold },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  big: { borderWidth: 2, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', minWidth: 74 },
  bigNum: { fontFamily: fonts.bodyBold, fontSize: 24 },
  bigLabel: { fontFamily: fonts.body, fontSize: 10.5, color: c.textMuted },
  stat: { flex: 1, backgroundColor: c.surface, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  statNum: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.text },
  statLabel: { fontFamily: fonts.body, fontSize: 10.5, color: c.textMuted },
  statTarget: { fontFamily: fonts.body, fontSize: 10, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted },
  line: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.text },
});
