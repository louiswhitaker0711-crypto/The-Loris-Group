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
import { useAuth } from '../src/auth/AuthContext';
import { NavyCard, ON_NAVY } from '../src/components/ui/NavyCard';
import { useSurface } from '../src/theme/teamTheme';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export default function MySectorScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const surface = useSurface();
  const router = useRouter();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['sector-days'], queryFn: () => apiService.getSectorDays(7).then((r) => r.data) });
  const st = useQuery({ queryKey: ['sector-status'], queryFn: () => apiService.getSectorStatus().then((r) => r.data), retry: false });
  useFocusEffect(React.useCallback(() => { q.refetch(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const days: any[] = q.data?.days || [];
  const today = days.find((d) => d.today);
  const inOneToday = !!today?.sectors?.some((x: any) => x.mine);

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      {/* Navy hero card (Nov 2026 look): where today stands and the two main buttons. */}
      <NavyCard>
        <Text style={s.heroKicker}>TODAY</Text>
        <Text style={s.heroLine}>
          {inOneToday ? "You're in a sector today" : today ? `${today.sectors.length} sector${today.sectors.length === 1 ? '' : 's'} out today` : 'No sectors yet today'}
        </Text>
        {(!inOneToday || !!st.data?.can_plan) && (
          <View style={s.heroBtns}>
            {!inOneToday && (
              <Pressable onPress={() => router.push('/sector?start=1' as never)} style={[s.heroPrimary, { backgroundColor: surface.accent }]} accessibilityRole="button" testID="ms-start">
                <Ionicons name="add" size={18} color={surface.onAccent} />
                <Text style={[s.heroPrimaryText, { color: surface.onAccent }]}>Start a sector</Text>
              </Pressable>
            )}
            {!!st.data?.can_plan && (
              <Pressable onPress={() => router.push('/sector-plan' as never)} style={s.heroGhost} accessibilityRole="button" testID="ms-plan">
                <Ionicons name="compass-outline" size={17} color={ON_NAVY.text} />
                <Text style={s.heroGhostText}>Plan today's</Text>
              </Pressable>
            )}
          </View>
        )}
      </NavyCard>
      {(user?.role === 'leader' || user?.role === 'admin' || !!st.data?.can_plan) && (
        <Pressable onPress={() => router.push('/sector-recap' as never)} style={s.recap} accessibilityRole="button" testID="ms-recap">
          <View style={s.recapIcon}><Ionicons name="reader-outline" size={19} color="#0a8fb0" /></View>
          <Text style={s.recapText}>Last field day's recap: map, hops and breakdowns</Text>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Pressable>
      )}
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
                {x.breakdown_posted_at ? (
                  <View style={s.postedChip}>
                    <Ionicons name="checkmark" size={13} color="#17693a" />
                    <Text style={s.posted}>Breakdown posted</Text>
                  </View>
                ) : null}
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
  heading: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: c.textMuted, marginTop: 6, paddingHorizontal: 4 },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  posted: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#17693a' },
  postedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: '#e0f5e7' },
  heroKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: ON_NAVY.muted },
  heroLine: { fontFamily: fonts.displayBlack, fontSize: 22, letterSpacing: -0.4, color: ON_NAVY.text },
  heroBtns: { flexDirection: 'row', gap: 8 },
  heroPrimary: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: ON_NAVY.cyan, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  heroPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#0c2340' },
  heroGhost: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: ON_NAVY.glass, borderWidth: 1, borderColor: ON_NAVY.glassBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  heroGhostText: { fontFamily: fonts.bodyBold, fontSize: 15, color: ON_NAVY.text },
  recap: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  recapIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#dcf6fb', alignItems: 'center', justifyContent: 'center' },
  recapText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 14.5, color: c.text },
  start: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: c.primary },
  startText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderRadius: 20, borderWidth: 1, borderColor: c.border, paddingVertical: 14, paddingHorizontal: 16 },
  tileMine: { borderColor: c.primary, borderWidth: 1.5 },
  code: { fontFamily: fonts.displayBlack, fontSize: 24, letterSpacing: -0.8, color: c.text },
});
