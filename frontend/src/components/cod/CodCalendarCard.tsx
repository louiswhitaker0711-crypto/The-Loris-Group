// The COD 2 calendar (the Owner, 23 Nov 2026): straight after the evaluation,
// Stage 2 is taught one topic (or a pair) a field day, so a good BA is ready
// for Stage 3 about three weeks from their first day. A day counts as taught
// once its items are at Know. Shown to the BA on Home and on their COD screen.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService, CodCalendar, CodCalendarDay } from '../../api/client';

export function ukDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const itemName = (it: { topic: string; part?: number | null }) => (it.part ? `${it.topic} (part ${it.part})` : it.topic);

export default function CodCalendarCard({ compact = false }: { compact?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['cod-calendar', 'me'], queryFn: () => apiService.codCalendarMe().then((r) => r.data.calendar), retry: false });
  const cal: CodCalendar | null | undefined = q.data;
  if (!cal || !cal.total) return null;
  if (compact && cal.finished) return null;
  const next: CodCalendarDay | undefined = cal.days.find((d) => d.is_today) || cal.days.find((d) => !d.taught && d.date > (cal.days.find((x) => x.is_today)?.date || ''));
  const todayDay = cal.days.find((d) => d.is_today);
  return (
    <View style={s.card} testID="cod-calendar-card">
      <View style={s.head}>
        <Text style={s.title}>📅 COD 2 calendar</Text>
        <Text style={s.count}>{cal.done}/{cal.total} days taught</Text>
      </View>
      {todayDay ? (
        <>
          <Text style={s.label}>Today · day {todayDay.day} of {cal.total}</Text>
          {todayDay.items.map((it) => (
            <Pressable key={`${it.module_id}-${it.part || 0}`} onPress={() => router.push(`/module/${it.module_id}` as never)} style={s.row} accessibilityRole="button">
              <Ionicons name={(it.ladder || 0) >= 1 ? 'checkmark-circle' : 'book-outline'} size={16} color={(it.ladder || 0) >= 1 ? c.green : c.primary} />
              <Text style={[s.item, { flex: 1 }]}>{itemName(it)}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </Pressable>
          ))}
        </>
      ) : cal.finished ? (
        <Text style={s.muted}>All of COD 2 taught. Keep building it on the doors with your Coach.</Text>
      ) : next ? (
        <Text style={s.muted}>Next: {next.items.map(itemName).join(' + ')} · {ukDay(next.date)}</Text>
      ) : (
        <Text style={s.muted}>Starts {ukDay(cal.start_date)}.</Text>
      )}
      {cal.behind > 0 && (
        <Text style={s.behind}>{cal.behind} earlier {cal.behind === 1 ? 'day' : 'days'} still to get to Know. Ask your Coach to go over {cal.behind === 1 ? 'it' : 'them'} with you.</Text>
      )}
      {!compact && (
        <>
          <Pressable onPress={() => setOpen(!open)} style={s.toggle} accessibilityRole="button">
            <Text style={s.link}>{open ? 'Hide the plan' : 'See the whole plan'}</Text>
          </Pressable>
          {open && cal.days.map((d) => (
            <View key={d.date} style={s.dayRow}>
              <Text style={[s.dayDate, d.is_today && { color: c.primary }]}>{ukDay(d.date)}</Text>
              <Text style={[s.dayItems, d.behind && { color: c.red }]} numberOfLines={2}>{d.items.map(itemName).join(' + ')}</Text>
              <Ionicons name={d.taught ? 'checkmark-circle' : d.behind ? 'alert-circle' : 'ellipse-outline'} size={15}
                color={d.taught ? c.green : d.behind ? c.red : c.textMuted} />
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 4, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  count: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.textMuted },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  item: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  behind: { fontFamily: fonts.body, fontSize: 12.5, color: c.red, marginTop: 4 },
  toggle: { paddingTop: 8 },
  link: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border },
  dayDate: { width: 86, fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  dayItems: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: c.text },
});
