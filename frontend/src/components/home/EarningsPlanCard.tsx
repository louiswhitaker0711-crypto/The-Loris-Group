/**
 * "Plan your earnings" on Home (the Owner, 26 Oct 2026): shown when someone
 * has no earnings plan yet (a new start from their shadow day onwards) or
 * it's over a month old, so everyone knows their weekly breakeven.
 * Hidden on BA Academy days. (GET /earnings-plan)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export default function EarningsPlanCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useQuery({
    queryKey: ['earnings-plan', 'me'],
    queryFn: async () => (await api.get('/earnings-plan')).data,
    retry: false,
  });
  if (!data) return null;
  const updated = data.updated_at ? Date.parse(data.updated_at) : NaN;
  const missing = data.breakeven == null;
  const stale = !missing && Number.isFinite(updated) && Date.now() - updated > MONTH_MS;
  if (!missing && !stale) return null;
  return (
    <Pressable onPress={() => router.push('/earnings-plan' as never)} style={s.card} accessibilityRole="button" testID="home-earnings-plan">
      <View style={s.icon}><Ionicons name="calculator-outline" size={22} color={c.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title}>{missing ? 'Plan your earnings' : 'Update your earnings plan'}</Text>
        <Text style={s.sub}>{missing ? 'Work out your weekly breakeven: the sign-ups that cover your needs.'
          : `Your breakeven is ${data.breakeven} a week. It’s over a month old, so check it still adds up.`}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.primaryLight, borderRadius: 18, padding: 16, marginBottom: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.primary + '14', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 17, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted, marginTop: 2 },
});
