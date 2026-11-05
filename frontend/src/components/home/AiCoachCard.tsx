/**
 * "Your AI coach" on Home (the Owner, 2 + 5 Nov 2026): one bar across the top
 * of Home, above the quick actions. Tapping it opens app/ai.tsx (Analyse me,
 * My plan, Ask). Once today's analysis is done, the bar shows its headline.
 * Hidden until the Owner adds the AI key, and on read-only accounts.
 * (GET /ai/status, GET /ai/analyse)
 */
import React, { useMemo } from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';

export type AiStatus = { enabled: boolean; limits: Record<string, number>; left: Record<string, number> };

export default function AiCoachCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const status = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: async () => (await api.get('/ai/status')).data as AiStatus,
    retry: false,
    staleTime: 60_000,
  });
  const today = useQuery({
    queryKey: ['ai', 'analysis'],
    queryFn: async () => (await api.get('/ai/analyse')).data?.analysis ?? null,
    retry: false,
    enabled: !!status.data?.enabled,
  });
  if (!status.data?.enabled) return null;
  const headline: string = today.data?.result?.headline || '';
  const sub = headline || (status.data.left?.analyse ? 'Tap to analyse your day, plan, or ask' : 'Plan your day, or ask a question');
  return (
    <Pressable onPress={() => router.push(`/ai?part=${today.data ? 'chat' : 'analyse'}` as never)} style={s.bar}
      accessibilityRole="button" accessibilityLabel="Your AI coach" testID="home-ai-coach">
      <Ionicons name="sparkles" size={16} color={c.onPrimary} />
      <Text style={s.title} numberOfLines={1}>Your AI coach</Text>
      <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      <Ionicons name="chevron-forward" size={16} color={c.onPrimary} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12 },
  title: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.onPrimary },
  sub: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12.5, color: c.onPrimary, opacity: 0.85 },
});
