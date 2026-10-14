// Sector (the side menu's "Sector"): every sector by day, newest first
// (Today, Yesterday, …), each one just its postcode. Tap one for its map,
// set-up, breakdown and the 6pm reset (app/sector-day.tsx). Coaches and
// Admins see every sector in the office; a BA the ones they were in.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export default function MySectorScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const q = useQuery({ queryKey: ['sector-days'], queryFn: () => apiService.getSectorDays(7).then((r) => r.data) });
  const st = useQuery({ queryKey: ['sector-status'], queryFn: () => apiService.getSectorStatus().then((r) => r.data), retry: false });
  useFocusEffect(React.useCallback(() => { q.refetch(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const days: any[] = q.data?.days || [];
  const today = days.find((d) => d.today);
  const inOneToday = !!today?.sectors?.some((x: any) => x.mine);

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      {!!st.data?.can_plan && (
        <Pressable onPress={() => router.push('/sector-plan' as never)} style={s.start} accessibilityRole="button" testID="ms-plan">
          <Ionicons name="compass-outline" size={18} color={c.onPrimary} />
          <Text style={s.startText}>Plan today's sectors</Text>
        </Pressable>
      )}
      {!inOneToday && (
        <Pressable onPress={() => router.push('/sector?start=1' as never)} style={s.start} accessibilityRole="button" testID="ms-start">
          <Ionicons name="rocket-outline" size={18} color={c.onPrimary} />
          <Text style={s.startText}>Start a sector</Text>
        </Pressable>
      )}
      {!today && <Text style={s.heading}>Today</Text>}
      {!today && <Text style={s.muted}>No sectors yet today.</Text>}
      {days.map((day) => (
        <View key={day.date} style={{ gap: 8 }}>
          <Text style={s.heading}>{day.today ? 'Today' : day.yesterday ? 'Yesterday' : day.label}</Text>
          {day.sectors.map((x: any) => (
            <Pressable key={x.leader_id} onPress={() => router.push(`/sector-day?date=${day.date}&leader=${x.leader_id}` as never)}
              style={[s.tile, x.mine && s.tileMine]} accessibilityRole="button" testID={`sector-${day.date}-${x.postcode || x.leader_id}`}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.code}>{x.postcode || 'No postcode'}</Text>
                <Text style={s.muted} numberOfLines={1}>
                  {x.leads ? 'Your sector' : `${first(x.leader_name)}'s sector`} · {x.people.length} {x.people.length === 1 ? 'person' : 'people'}
                  {x.goal != null ? ` · ${x.hit} of ${x.goal}` : ''}
                </Text>
                {x.breakdown_posted_at ? <Text style={s.posted}>✅ Breakdown posted</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 680, alignSelf: 'center' },
  heading: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: c.textMuted, marginTop: 4 },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  posted: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.green },
  start: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: c.primary },
  startText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingVertical: 14, paddingHorizontal: 16 },
  tileMine: { borderColor: c.primary, borderWidth: 1.5 },
  code: { fontFamily: fonts.display, fontSize: 24, color: c.text },
});
