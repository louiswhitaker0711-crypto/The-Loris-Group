/**
 * A new start's BA Academy workbook on their Home (Days 1-2): one tap opens
 * it, with how far through Day 1 they are. (GET /academy/workbook/1)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { day1Progress } from '../../academy/day1';

export default function AcademyWorkbookCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useQuery({
    queryKey: ['academy-workbook', 1, 'me'],
    queryFn: async () => (await api.get('/academy/workbook/1')).data,
    retry: false,
  });
  const p = day1Progress(data);
  const started = p.done > 0 || Object.keys(data?.fields || {}).length > 0;
  return (
    <Pressable onPress={() => router.push('/academy/1' as never)} style={s.card} accessibilityRole="button" testID="home-academy-workbook">
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={s.kicker}>BA Academy · Day 1</Text>
        <Text style={s.title}>{started ? 'Your workbook' : 'Open your workbook'}</Text>
        <Text style={s.sub}>{started ? `${p.done} of ${p.total} done` : 'Notes, gaps to fill in and quick quizzes for today'}</Text>
        {started && <View style={s.track}><View style={[s.fill, { width: `${Math.round((p.done / p.total) * 100)}%` as any }]} /></View>}
      </View>
      <Ionicons name="chevron-forward" size={20} color={c.inkText} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.ink, borderRadius: 18, padding: 16, marginBottom: 12 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.inkMuted },
  title: { fontFamily: fonts.display, fontSize: 20, color: c.inkText },
  sub: { fontFamily: fonts.body, fontSize: 13.5, color: c.inkMuted },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', backgroundColor: '#22d0ec' },
});
