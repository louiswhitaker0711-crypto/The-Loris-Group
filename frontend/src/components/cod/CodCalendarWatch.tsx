// Watching everyone's COD 2 calendar (the Owner, 23 Nov 2026): who's on which
// day, what's on today, how many days are taught and who's behind (a past
// day not yet at Know). Starts by itself the day after a passed evaluation;
// a Coach can start it by hand, restart it from tomorrow if someone needs to
// go again, or stop it. Coaches see their people, Admins the office.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { showAlert } from '../../utils/showAlert';
import { toast } from '../../utils/toast';
import { ukDay } from './CodCalendarCard';

export default function CodCalendarWatch() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['cod-calendar', 'office'], queryFn: () => apiService.codCalendarOffice().then((r) => r.data), retry: false });
  if (q.isLoading) return <View style={s.card}><ActivityIndicator color={c.primary} /></View>;
  if (q.isError || !q.data) return null;
  const { people, others } = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['cod-calendar'] });

  const start = async (userId: string, name: string) => {
    setBusy(userId);
    try {
      await apiService.startCodCalendar(userId);
      toast.success(`COD 2 calendar started for ${name.split(' ')[0]}`);
      setPicking(false);
      refresh();
    } catch (e: any) {
      showAlert('Could not start it', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(null); }
  };
  const manage = (userId: string, name: string) => showAlert(name, 'Restart their COD 2 calendar from the next field day, or stop it?', [
    { text: 'Restart', onPress: () => start(userId, name) },
    { text: 'Stop it', style: 'destructive', onPress: async () => {
      try { await apiService.stopCodCalendar(userId); refresh(); } catch (e: any) { showAlert('Could not stop it', e?.response?.data?.detail || 'Try again.'); }
    } },
    { text: 'Cancel', style: 'cancel' },
  ]);

  if (!people.length && !others.length) return null;
  return (
    <View style={s.card} testID="cod-calendar-watch">
      <Text style={s.title}>📅 COD 2 calendars</Text>
      <Text style={s.muted}>One topic (or a pair) a field day from the day after the evaluation. A day is taught once its items are at Know.</Text>
      {people.length === 0 && <Text style={s.muted}>Nobody's on one right now.</Text>}
      {people.map((p) => (
        <Pressable key={p.user_id} onPress={() => manage(p.user_id, p.name)} style={s.row} accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{p.name}</Text>
            <Text style={s.sub} numberOfLines={2}>
              {p.finished ? 'All taught' : p.today.length ? `Day ${p.current_day}: ${p.today.join(' + ')}`
                : p.current_day === 1 ? `Starts ${ukDay(p.start_date)}` : `Day ${p.current_day} next`}
              {' · '}{p.done}/{p.total} taught{p.ends ? ` · ends ${ukDay(p.ends)}` : ''}
            </Text>
          </View>
          {p.behind > 0
            ? <View style={s.behindTag}><Text style={s.behindText}>{p.behind} behind</Text></View>
            : <Ionicons name="checkmark-circle" size={18} color={c.green} />}
        </Pressable>
      ))}
      {others.length > 0 && (
        <Pressable onPress={() => setPicking(!picking)} style={s.toggle} accessibilityRole="button">
          <Text style={s.link}>{picking ? 'Close' : '+ Start one for a BA'}</Text>
        </Pressable>
      )}
      {picking && (
        <View style={s.chips}>
          {others.map((o) => (
            <Pressable key={o.user_id} onPress={() => start(o.user_id, o.name)} disabled={busy === o.user_id} style={s.chip} accessibilityRole="button">
              <Text style={s.chipText}>{busy === o.user_id ? '…' : o.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 4, marginBottom: 12 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
  name: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  behindTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: c.red },
  behindText: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: c.red },
  toggle: { paddingTop: 8 },
  link: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
});
