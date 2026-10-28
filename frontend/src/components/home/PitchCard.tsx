/**
 * "Your pitch" on Home (the Owner, 26–27 Oct 2026):
 *   bottom  everyone, always
 *   top     everyone during Primetime (11:00–11:45, Mon–Fri); a new start
 *           also from 18:00 on their first day until their shadow day
 *   bar     a thin bar at the very top for everyone in the field, so the
 *           pitch is one tap away at the door
 * A new start doesn't see it at all before 18:00 on their first day, because
 * the Owner hasn't gone over it yet. (GET /pitch)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { todayISO } from '../../utils/calendarDates';
import { ukNow, inFieldHours, inPrimetime } from '../../utils/fieldTime';

/** Re-render once a minute so the card follows the time of day. */
function useMinute() {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((n) => n + 1), 60 * 1000);
    return () => clearInterval(id);
  }, []);
}

export default function PitchCard({ place }: { place: 'top' | 'bottom' | 'bar' }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  useMinute();
  const { data } = useQuery({ queryKey: ['pitch'], queryFn: async () => (await api.get('/pitch')).data, retry: false });
  if (!data) return null;
  const start: string | null = data.start_date || null;
  const today = todayISO();
  const started = !!start && (today > start.slice(0, 10) || (today === start.slice(0, 10) && ukNow().mins >= 18 * 60));
  const newStart = !!data.new_start;
  if (newStart && start && !started) return null;      // not until 18:00 on their first day
  const field = inFieldHours();
  const prime = inPrimetime();
  const open = () => router.push('/pitch' as never);

  if (place === 'bar') {
    if (!field) return null;
    return (
      <Pressable onPress={open} style={s.bar} accessibilityRole="button" testID="home-pitch-bar">
        <Ionicons name="mic-outline" size={16} color={c.onPrimary} />
        <Text style={s.barT} numberOfLines={1}>Your pitch</Text>
        <Text style={s.barSub} numberOfLines={1}>Tap to read it before the next door</Text>
        <Ionicons name="chevron-forward" size={16} color={c.onPrimary} />
      </Pressable>
    );
  }
  // At the top: everyone in Primetime; a new start outside the field (the bar covers the field).
  if (place === 'top' && !(prime || (newStart && !field))) return null;
  const top = place === 'top';
  const title = top ? (prime ? 'Primetime: your pitch' : data.unlocked ? 'Learn your pitch' : 'Learn your pitch for tomorrow') : 'Your pitch';
  const sub = top
    ? (prime ? 'Run it out loud before the morning meeting: every line, with a smile.'
      : data.unlocked ? 'Say it 30 times: out loud, in the mirror, recorded. Then test yourself.' : 'Read it through tonight, with the notes on why and how.')
    : 'Read it, practise it and test yourself any time.';
  return (
    <Pressable onPress={open} style={[s.card, top && s.cardTop]} accessibilityRole="button" testID={`home-pitch-${place}`}>
      <View style={[s.icon, top && { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
        <Ionicons name="mic-outline" size={22} color={top ? c.onPrimary : c.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.title, top && { color: c.onPrimary }]}>{title}</Text>
        <Text style={[s.sub, top && { color: c.onPrimary, opacity: 0.9 }]}>{sub}</Text>
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
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10 },
  barT: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.onPrimary },
  barSub: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12.5, color: c.onPrimary, opacity: 0.85 },
});
