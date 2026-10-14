// Top of Home from 18:00 to 20:00 on weekdays: the 6pm reset. Until you've
// done yours it's a big button; after that, everyone in the office who's
// done theirs and what they're going for, and who's still to do it.
// (GET /field-reset/board)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export default function ResetBoardCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['reset-board'],
    queryFn: () => apiService.getResetBoard().then((r) => r.data),
    refetchInterval: 60 * 1000,
    retry: false,
  });
  if (!data?.window) return null;
  const done: any[] = data.done || [];
  const todo: any[] = data.todo || [];
  const open = () => router.push('/field-reset' as never);

  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      {!data.mine_done && (
        <Pressable onPress={open} style={s.cta} accessibilityRole="button" testID="home-reset-cta">
          <View style={s.icon}><Ionicons name="refresh" size={20} color={c.onPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.ctaTitle}>Do your 6pm reset</Text>
            <Text style={s.ctaSub}>How many more, your number and your focus for the last stretch.</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={c.onPrimary} />
        </Pressable>
      )}
      {(done.length > 0 || todo.length > 0) && (
        <View style={s.card} testID="home-reset-board">
          <Text style={s.h}>🔄 6pm reset{done.length ? ` · going for ${data.total_more} more` : ''}</Text>
          {done.map((r) => (
            <Text key={r.user_id} style={s.line}>
              ✅ <Text style={s.name}>{first(r.name)}</Text> {r.more ? `is going for ${r.more} more` : 'is holding the standard'}{r.kpi ? ` · ${r.kpi}` : ''}
            </Text>
          ))}
          {todo.length > 0 && (
            <Text style={s.todo}>Still to do: {todo.map((t) => first(t.name)).join(', ')}</Text>
          )}
          {data.mine_done && (
            <Pressable onPress={open} style={s.link} accessibilityRole="button">
              <Text style={s.linkText}>Change or share yours</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: c.primary },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  ctaSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.onPrimary, opacity: 0.9 },
  card: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, gap: 5 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text, marginBottom: 2 },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  name: { fontFamily: fonts.bodyBold },
  todo: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 4 },
  link: { alignSelf: 'flex-start', paddingVertical: 4, marginTop: 2 },
  linkText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
});
