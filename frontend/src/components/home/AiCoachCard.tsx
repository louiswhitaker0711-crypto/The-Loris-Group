/**
 * "Your AI coach" on Home (the Owner, 2 Nov 2026): Analyse me (once a day),
 * Suggest my plan, and Ask the AI. Each opens app/ai.tsx on that part.
 * Hidden until the Owner adds the AI key, and on read-only accounts.
 * (GET /ai/status, GET /ai/analyse)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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
  const done = !!today.data;
  const headline: string = today.data?.result?.headline || '';
  const open = (part: 'analyse' | 'plan' | 'chat') => router.push(`/ai?part=${part}` as never);

  return (
    <View style={s.card} testID="home-ai-coach">
      <View style={s.head}>
        <View style={s.icon}><Ionicons name="sparkles-outline" size={20} color={c.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>Your AI coach</Text>
          <Text style={s.sub} numberOfLines={2}>
            {done && headline ? headline : 'Looks at your breakdowns, results and plans, and the office’s, and tells you what to work on.'}
          </Text>
        </View>
      </View>
      <Pressable onPress={() => open('analyse')} style={s.primary} accessibilityRole="button" testID="home-ai-analyse">
        <Ionicons name={done ? 'document-text-outline' : 'analytics-outline'} size={17} color={c.onPrimary} />
        <Text style={s.primaryText}>{done ? 'Read today’s analysis' : 'Analyse me'}</Text>
      </Pressable>
      <View style={s.row}>
        <Pressable onPress={() => open('plan')} style={s.secondary} accessibilityRole="button" testID="home-ai-plan">
          <Ionicons name="calendar-outline" size={16} color={c.primary} />
          <Text style={s.secondaryText}>Suggest my plan</Text>
        </Pressable>
        <Pressable onPress={() => open('chat')} style={s.secondary} accessibilityRole="button" testID="home-ai-chat">
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={c.primary} />
          <Text style={s.secondaryText}>Ask the AI</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.primaryLight, borderRadius: 18, padding: 16, marginBottom: 12, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.primary + '14', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 17, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted, marginTop: 2 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 999, paddingVertical: 12 },
  primaryText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  row: { flexDirection: 'row', gap: 8 },
  secondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: c.primaryLight, borderRadius: 999, paddingVertical: 10 },
  secondaryText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
