/**
 * Meet-up on Home (the Owner, 5 Nov 2026): for the people going, from a week
 * before until their debrief is done. Opens their meet-up planner.
 * (GET /meetups/mine)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { fmtDay } from '../../utils/meetups';

export default function MeetupCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useQuery({ queryKey: ['meetups-mine'], queryFn: async () => (await api.get('/meetups/mine')).data, retry: false });
  const list: any[] = data?.meetups || [];
  if (!list.length) return null;
  return (
    <>
      {list.map((m) => {
        const when = m.days_to_go > 1 ? `${m.days_to_go} days to go` : m.days_to_go === 1 ? 'Tomorrow' : m.days_to_go === 0 ? 'Today' : m.debrief_open ? 'Bring it back: your debrief' : 'On now';
        return (
          <Pressable key={m.id} onPress={() => router.push(`/meetup?id=${m.id}` as never)} style={s.card} accessibilityRole="button" testID="home-meetup">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.k}>Meet-up · {fmtDay(m.start_date)}{m.end_date !== m.start_date ? ` – ${fmtDay(m.end_date)}` : ''}</Text>
                <Text style={s.t}>{m.name}</Text>
              </View>
              <Ionicons name="airplane-outline" size={24} color={c.primary} />
            </View>
            <View style={s.track}><View style={[s.fill, { width: `${Math.round(100 * m.done / Math.max(1, m.of))}%` }]} /></View>
            <Text style={s.sub}>{when} · planner {m.done} of {m.of} done{m.contacts ? ` · ${m.contacts} met` : ''}</Text>
            <View style={s.btn}><Text style={s.btnT}>{m.debrief_open ? 'Do my debrief' : 'Open my planner'}</Text></View>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderWidth: 1.5, borderColor: c.primary, borderRadius: 18, padding: 16, marginBottom: 12, gap: 8 },
  k: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: c.textMuted },
  t: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  track: { height: 6, borderRadius: 3, backgroundColor: c.trackBg || c.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: c.primary },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  btn: { minHeight: 42, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  btnT: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.onPrimary },
});
