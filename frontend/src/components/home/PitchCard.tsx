/**
 * "Your pitch" on Home (the Owner, 26 Oct 2026). Everyone has it at the
 * bottom of Home. A new start gets it near the top from 18:00 on their first
 * day ("Learn your pitch for tomorrow") until their shadow day; before that
 * it isn't shown to them at all. (GET /pitch)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { todayISO } from '../../utils/calendarDates';
import { ukNow } from '../../utils/fieldTime';

export default function PitchCard({ place }: { place: 'top' | 'bottom' }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useQuery({ queryKey: ['pitch'], queryFn: async () => (await api.get('/pitch')).data, retry: false });
  if (!data) return null;
  const start: string | null = data.start_date || null;
  const today = todayISO();
  const started = !!start && (today > start.slice(0, 10) || (today === start.slice(0, 10) && ukNow().mins >= 18 * 60));
  const newStart = !!data.new_start;
  if (newStart && !started) return null;               // not until 18:00 on their first day
  if (place === 'top' && !newStart) return null;
  if (place === 'bottom' && newStart) return null;
  const top = place === 'top';
  return (
    <Pressable onPress={() => router.push('/pitch' as never)} style={[s.card, top && s.cardTop]} accessibilityRole="button" testID={`home-pitch-${place}`}>
      <View style={[s.icon, top && { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
        <Ionicons name="mic-outline" size={22} color={top ? c.onPrimary : c.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.title, top && { color: c.onPrimary }]}>{top ? (data.unlocked ? 'Learn your pitch' : 'Learn your pitch for tomorrow') : 'Your pitch'}</Text>
        <Text style={[s.sub, top && { color: c.onPrimary, opacity: 0.9 }]}>
          {top ? (data.unlocked ? 'Say it 30 times: out loud, in the mirror, recorded. Then test yourself.' : 'Read it through tonight, with the notes on why and how.')
            : 'Read it, practise it and test yourself any time.'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={top ? c.onPrimary : c.textMuted} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 16, marginBottom: 12 },
  cardTop: { backgroundColor: c.primary, borderColor: c.primary },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.primary + '14', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 17, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted, marginTop: 2 },
});
