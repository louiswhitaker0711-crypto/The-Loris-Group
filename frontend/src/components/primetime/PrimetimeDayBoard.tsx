/**
 * PrimetimeDayBoard: one day's Primetime board (the triangles) wherever it's
 * planned or shown, so it looks the same everywhere (the Owner, 2 Nov 2026):
 * the Primetime page, the sector breakdown (tomorrow's), Plan sectors in the
 * morning (today's) and Home during Primetime (11:00–11:45, everyone).
 *
 * A Coach or Admin edits it (their own people, plus anyone free to work with);
 * a BA sees it read-only with their own place in it called out.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useColors, fonts } from '../../theme/ThemeContext';
import PrimetimeBoard from './PrimetimeBoard';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export function usePlansFor() {
  const { user } = useAuth();
  const role = ((user as any)?.role || '').toLowerCase();
  return { me: String((user as any)?.id || ''), coach: (role === 'leader' || role === 'admin') && !(user as any)?.is_viewer };
}

export default function PrimetimeDayBoard({ week, dayIndex, editable = true, showMine = true }: {
  week: string;
  dayIndex: number;
  /** False to show it read-only even to a Coach. */
  editable?: boolean;
  /** Call out where the viewer is ("You're learning Closing with Sam"). */
  showMine?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { me, coach } = usePlansFor();
  const q = useQuery({
    queryKey: ['primetime-week', week, 'mine'],
    queryFn: () => apiService.primetimeWeek(week).then((r) => r.data),
    enabled: !!week && dayIndex >= 0,
  });
  if (q.isLoading) return <ActivityIndicator color={c.primary} />;
  if (q.isError || !q.data) return <Text style={s.muted}>Couldn't load the Primetime plan.</Text>;
  const data = q.data;

  const mine = (() => {
    const e = (data.entries || []).find((x) => x.day_index === dayIndex && x.subject_user_id === me);
    if (!e?.mode) return 'You’re not on Primetime yet.';
    const host = (data.sessions || []).find((x) => x.session_id === e.session_id);
    const topic = e.topic || host?.topic || '';
    if (e.mode === 'teaching') {
      const n = host?.attendees.length || 0;
      return `You’re running ${topic || 'a topic'}${n ? ` · ${n} with you` : ''}`;
    }
    if (e.mode === 'free') return 'You’re free to work with: a Coach can put you into something.';
    const withWho = host ? ` with ${first(host.host_name)}` : (e.with_names || []).length ? ` with ${first(e.with_names[0])}` : '';
    return `You’re ${e.mode}${topic ? ` ${topic}` : ''}${withWho}`;
  })();

  return (
    <View style={{ gap: 10 }}>
      {showMine && (
        <View style={s.mine}>
          <Ionicons name="person-circle-outline" size={16} color={c.primary} />
          <Text style={s.mineText}>{mine}</Text>
        </View>
      )}
      <PrimetimeBoard data={data} week={week} dayIndex={dayIndex} canEdit={editable && coach && !!data.can_edit_any} />
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: c.surface },
  mineText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
});
