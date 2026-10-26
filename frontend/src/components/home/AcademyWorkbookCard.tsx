/**
 * A new start's BA Academy workbook on their Home (Days 1-2): one tap opens
 * today's workbook (Day 1 on their first day, Day 2 from the next), with how
 * far through it they are. (GET /academy/workbook/{day}; academy_day says
 * which day they're on.)
 */
import React, { useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { day1Progress } from '../../academy/day1';
import { day2Progress } from '../../academy/day2';
import { useAuth } from '../../auth/AuthContext';

export default function AcademyWorkbookCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const d1 = useQuery({
    queryKey: ['academy-workbook', 1, 'me'],
    queryFn: async () => (await api.get('/academy/workbook/1')).data,
    retry: false,
  });
  const day = d1.data?.academy_day === 2 ? 2 : 1;
  const d2 = useQuery({
    queryKey: ['academy-workbook', 2, 'me'],
    queryFn: async () => (await api.get('/academy/workbook/2')).data,
    enabled: day === 2,
    retry: false,
  });
  const data = day === 2 ? d2.data : d1.data;
  // The welcome (what we look for, our core values) opens once by itself,
  // the first time a new start reaches Home (the Owner, 26 Oct 2026).
  const { user } = useAuth();
  const uid = (user as any)?.id;
  useEffect(() => {
    if (!uid) return;
    const key = `welcome-seen-${uid}`;
    let gone = false;
    (async () => {
      try {
        if (await AsyncStorage.getItem(key)) return;
        await AsyncStorage.setItem(key, '1');
      } catch { return; }
      if (!gone) router.push('/welcome' as never);
    })();
    return () => { gone = true; };
  }, [uid]);
  const p = day === 2 ? day2Progress(data) : day1Progress(data);
  const started = p.done > 0 || Object.keys(data?.fields || {}).length > 0;
  return (
    <Pressable onPress={() => router.push(`/academy/${day}` as never)} style={s.card} accessibilityRole="button" testID="home-academy-workbook">
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={s.kicker}>BA Academy · Day {day}</Text>
        <Text style={s.title}>{started ? 'Your workbook' : 'Open your workbook'}</Text>
        <Text style={s.sub}>{started ? `${p.done} of ${p.total} done` : day === 2 ? 'Sign-ups, rehash and quality, then your final quiz' : 'Notes, gaps to fill in and quick quizzes for today'}</Text>
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
