/**
 * This week's COD focus with what to do on it (the Owner, 27 Oct 2026: make
 * the COD prevalent for Stage 2 and 3 in the plan, set-up and breakdown).
 * Shows the next rung of the item's proof ladder: you tick Know yourself; Do
 * and above are your Coach's sign-off. No focus yet → a prompt to pick one.
 * (GET /cod-focus/me → focus, next)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

type Next = { ladder: number; rung: string | null; text: string; good: string[] } | null;

export default function CodWeekCard({ week }: { week?: string }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const isBA = ((user as any)?.role || '') === 'trainee';
  const q = useQuery({ queryKey: ['cod-focus-me', week || ''], queryFn: () => apiService.getCodFocusMe(week).then((r) => r.data), retry: false });
  if (!q.data) return null;
  const focus = q.data.focus as { module_id: string; topic: string; stage: number } | null;
  const next = q.data.next as Next;
  const pick = () => router.push((isBA ? '/ba-week' : '/(tabs)/progress') as never);

  if (!focus) {
    return (
      <Pressable onPress={pick} style={[s.card, s.cardPick]} accessibilityRole="button" testID="cod-week-pick">
        <Ionicons name="flag-outline" size={22} color={c.yellow} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kicker}>Your COD this week</Text>
          <Text style={s.title}>Pick your COD focus</Text>
          <Text style={s.sub}>One thing to work on all week. It fills your set-up, and you look back on it at the breakdown.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => router.push(`/module/${focus.module_id}` as never)} style={s.card} accessibilityRole="button" testID="cod-week-focus">
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text style={s.kicker}>Your COD this week</Text>
        <Text style={s.title}>{focus.topic}</Text>
        {!!next && (
          <View style={s.next}>
            {!!next.rung && <Text style={s.rung}>{next.rung}</Text>}
            <Text style={s.nextText}>{next.text}</Text>
          </View>
        )}
        {!!next?.good?.length && (
          <View style={{ gap: 3 }}>
            <Text style={s.kicker}>What good looks like</Text>
            {next.good.map((g) => <Text key={g} style={s.sub}>• {g}</Text>)}
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.primaryLight, borderLeftWidth: 4, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardPick: { borderColor: c.yellow },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  title: { fontFamily: fonts.display, fontSize: 18, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  next: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: c.primary + '10', borderRadius: 10, padding: 10 },
  rung: { fontFamily: fonts.monoSemibold, fontSize: 11, color: c.onPrimary, backgroundColor: c.primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  nextText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, color: c.text },
});
