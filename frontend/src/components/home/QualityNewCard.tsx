// Quality on Home: pops up at the top for a week after the Owner adds that
// week's quality report, then goes away until the next one (the Owner,
// 29 Oct 2026). It shows your own numbers (or your team's / the office's when
// you aren't on the report); tap it for the Quality hub, which also has your
// team's if you've got one. (GET /quality, the same data as the Quality screen)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import QualityStrip from './today/QualityStrip';

const SHOW_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export default function QualityNewCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({
    queryKey: ['quality', 'week', '', ''],
    queryFn: () => apiService.getQuality({ view: 'week' }).then((r) => r.data),
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const added = (q.data as any)?.imported_at ? Date.parse(String((q.data as any).imported_at)) : NaN;
  if (!q.data?.week_ending || !(Date.now() - added < SHOW_FOR_MS)) return null;
  return (
    <View style={s.card}>
      <Pressable onPress={() => router.push('/quality' as never)} style={s.head} accessibilityRole="button" testID="home-quality-new">
        <Ionicons name="shield-checkmark-outline" size={18} color={c.primary} />
        <Text style={s.title}>This week's quality is in</Text>
        <Text style={s.open}>Open</Text>
        <Ionicons name="chevron-forward" size={15} color={c.primary} />
      </Pressable>
      <QualityStrip bare />
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.primary, padding: 14, gap: 10, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15.5, color: c.text },
  open: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
