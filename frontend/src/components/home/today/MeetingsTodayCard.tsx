// Today's meetings from your weekly plan, on Home when they're needed
// (the Owner, 26 Oct 2026):
//   • mornings (until 11:00): the Coaches Meeting and the Morning Meeting
//     topic, each with its COD pick — plan or change them in one tap;
//   • the morning meeting (11:45–12:30): every Morning Meeting box, and for an
//     Admin the Bells read-out.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { planDayNow } from '../../../utils/fieldTime';

const PLAN_BOXES: Array<[string, string]> = [['leaders_meeting', 'Coaches Meeting'], ['morning_topic', 'Morning Meeting · Topic']];
const MEETING_BOXES: Array<[string, string]> = [
  ['morning_news', 'News'], ['morning_topic', 'Topic'], ['morning_cs', 'Customer Service'], ['morning_bells', 'Bells'],
];

export default function MeetingsTodayCard({ mode }: { mode: 'plan' | 'meeting' }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { weekEnding, dayIndex } = planDayNow();
  const planQ = useQuery({
    queryKey: ['weekly-planner', weekEnding, 'me'],
    queryFn: () => apiService.getWeeklyPlanner(weekEnding).then((r) => r.data),
    enabled: dayIndex >= 0,
    staleTime: 60 * 1000,
  });
  const readoutQ = useQuery({
    queryKey: ['bells-readout', weekEnding, dayIndex],
    queryFn: () => apiService.bellsReadout(weekEnding, dayIndex).then((r) => r.data),
    enabled: mode === 'meeting' && isAdmin && dayIndex >= 0,
    staleTime: 60 * 1000,
    retry: false,
  });
  const codQ = useQuery({
    queryKey: ['cod-items-for-meetings'],
    queryFn: () => apiService.getCodFocusMe().then((r) => (r.data?.options || []) as Array<{ id: string; topic: string; stage: number }>),
    staleTime: 30 * 60 * 1000,
  });
  if (dayIndex < 0) return null;
  const day = (planQ.data?.planner?.days || {})[String(dayIndex)] || {};
  const topicOf = (id?: string) => (id ? (codQ.data || []).find((x) => x.id === id)?.topic : undefined);
  const openPlan = () => router.push(`/weekly-planner?week=${weekEnding}&day=${dayIndex}` as never);
  const boxes = mode === 'plan' ? PLAN_BOXES : MEETING_BOXES;
  const readout = readoutQ.data;

  return (
    <View style={s.card} testID={`home-meetings-${mode}`}>
      <Pressable onPress={openPlan} style={s.head} accessibilityRole="button">
        <Ionicons name={mode === 'plan' ? 'people-outline' : 'megaphone-outline'} size={18} color={c.primary} />
        <Text style={s.title}>{mode === 'plan' ? "Today's meetings" : 'Morning meeting'}</Text>
        <Text style={s.link}>{mode === 'plan' ? 'Plan' : 'Open'}</Text>
        <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
      </Pressable>
      {boxes.map(([key, label]) => {
        const text = String(day[key] || '').trim();
        const cod = day[`${key}_cod`];
        return (
          <View key={key} style={s.box}>
            <Text style={s.label}>{label}</Text>
            {!!cod && (
              <Pressable onPress={() => router.push(`/module/${cod}` as never)} style={s.chip} accessibilityRole="button">
                <Ionicons name="school-outline" size={13} color={c.onPrimary} />
                <Text style={s.chipTxt} numberOfLines={1}>{topicOf(cod) || 'COD item'}</Text>
              </Pressable>
            )}
            <Text style={[s.text, !text && s.empty]} numberOfLines={mode === 'meeting' ? 6 : 3}>
              {text || (mode === 'plan' && key === 'leaders_meeting' ? 'Not planned yet. Tap Plan to pick from the COD.' : 'Nothing planned.')}
            </Text>
          </View>
        );
      })}
      {mode === 'meeting' && isAdmin && readout && (
        <View style={s.box}>
          <Text style={s.label}>🔔 Bells read-out</Text>
          {(readout.readout || []).length
            ? (readout.readout as any[]).map((r, i) => <Text key={i} style={s.text}>{`${r.sales} — ${r.name}`}</Text>)
            : <Text style={[s.text, s.empty]}>No qualifiers (BAs 2+, Coaches 3+).</Text>}
          {(readout.sunday || []).length > 0 && (
            <>
              <Text style={[s.label, { marginTop: 6 }]}>Sunday sign-ups</Text>
              {(readout.sunday as any[]).map((r, i) => <Text key={i} style={s.text}>{`${r.sales} — ${r.name}`}</Text>)}
            </>
          )}
          {(readout.top5 || []).length > 0 && (
            <>
              <Text style={[s.label, { marginTop: 6 }]}>📈 Top 5 this week</Text>
              {(readout.top5 as any[]).map((r, i) => <Text key={i} style={s.text}>{`${i + 1}. ${r.name} — ${r.sales}`}</Text>)}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 16, color: c.text },
  link: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  box: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  label: { fontFamily: fonts.bodySemibold, fontSize: 11, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  text: { fontFamily: fonts.body, fontSize: 14, color: c.text, lineHeight: 20 },
  empty: { color: c.textMuted },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4, maxWidth: '100%' },
  chipTxt: { flexShrink: 1, fontFamily: fonts.bodySemibold, fontSize: 12, color: c.onPrimary },
});
