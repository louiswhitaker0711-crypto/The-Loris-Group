// Sector: everyone's way into their sector for the day (the side menu's
// "Sector"). Your set-up, your sector's map, your breakdown and the 6pm
// reset; and for whoever leads the sector (a Coach or a BA), managing it:
// who's in, everyone's set-up and breakdown, sharing the map.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { APP_LOCALE } from '../src/utils/appTime';

type Tile = { icon: any; title: string; sub: string; to: string; testID: string; strong?: boolean };

export default function MySectorScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const q = useQuery({ queryKey: ['sector-status'], queryFn: () => apiService.getSectorStatus().then((r) => r.data) });
  useFocusEffect(React.useCallback(() => { q.refetch(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const d = q.data || {};
  const sec = d.sector;
  const leads = !!sec?.leads;
  const m = d.my_setup;
  const today = new Date().toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

  const tiles: Tile[] = [];
  if (leads) {
    tiles.push({ icon: 'people-circle-outline', title: 'Set-up', sub: `Who's in, postcode, goal, and each person's set-up · ${d.setups}/${d.members} done`, to: '/sector', testID: 'ms-setup', strong: d.phase !== 'breakdown' });
    tiles.push({ icon: 'map-outline', title: 'Sector map', sub: 'Share it with the sector and mark off streets', to: '/sector-map', testID: 'ms-map' });
    tiles.push({ icon: 'clipboard-outline', title: 'Breakdown', sub: `Numbers, proud of and change, then confirm the map · ${d.breakdowns}/${d.members} done`, to: '/sector?mode=breakdown', testID: 'ms-breakdown', strong: d.phase === 'breakdown' });
  } else if (sec) {
    tiles.push({ icon: 'map-outline', title: 'Sector map', sub: 'Mark off streets as you finish them', to: '/sector-map', testID: 'ms-map', strong: true });
    tiles.push({ icon: 'clipboard-outline', title: 'My breakdown', sub: 'What you did, proud of and what you’ll change', to: '/sector?mode=breakdown', testID: 'ms-breakdown' });
  }
  tiles.push({ icon: 'refresh-circle-outline', title: '6pm reset', sub: 'How many more, your number and your focus', to: '/field-reset', testID: 'ms-reset' });
  tiles.push({ icon: 'grid-outline', title: 'All sectors today', sub: 'Every sector’s set-ups, breakdowns and goals', to: '/sectors', testID: 'ms-board' });

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={s.date}>{today}</Text>

      {sec ? (
        <View style={s.hero}>
          <Text style={s.heroTitle}>{leads ? 'You’re leading a sector' : `You’re in ${sec.leader_name || 'a'}’s sector`}</Text>
          <Text style={s.heroSub}>
            {[sec.postcode ? `📍 ${sec.postcode}` : 'No postcode yet', sec.goal != null ? `Sector goal ${sec.goal}` : '', `${sec.members.length} in the sector`].filter(Boolean).join(' · ')}
          </Text>
          {!!sec.members.length && <Text style={s.heroSub} numberOfLines={2}>{sec.members.join(', ')}</Text>}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.h}>Not in a sector yet today</Text>
          <Text style={s.muted}>When your sector leader adds you, your sector and its map show here. Leading one yourself? Start it here.</Text>
          <Pressable onPress={() => router.push('/sector?start=1' as never)} style={s.btn} accessibilityRole="button" testID="ms-start">
            <Ionicons name="rocket-outline" size={16} color={c.onPrimary} />
            <Text style={s.btnText}>Start a sector</Text>
          </Pressable>
        </View>
      )}

      {!!m && (m.goal != null || m.kpi || m.focus || m.positive) && (
        <View style={s.card}>
          <Text style={s.h}>🎯 Your set-up today</Text>
          <Text style={s.muted}>
            {[m.goal != null ? `Goal ${m.goal}` : '', m.kpi ? `KPI ${m.kpi}` : '', m.focus ? `Focus: ${m.focus}` : '', m.positive ? `💪 ${m.positive}` : ''].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}

      {tiles.map((t) => (
        <Pressable key={t.testID} onPress={() => router.push(t.to as never)} style={[s.tile, t.strong && s.tileStrong]} accessibilityRole="button" testID={t.testID}>
          <View style={[s.icon, t.strong && { backgroundColor: c.primary }]}>
            <Ionicons name={t.icon} size={20} color={t.strong ? c.onPrimary : c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.tileTitle}>{t.title}</Text>
            <Text style={s.muted}>{t.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' },
  date: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.textMuted },
  hero: { backgroundColor: c.primary, borderRadius: 16, padding: 16, gap: 4 },
  heroTitle: { fontFamily: fonts.display, fontSize: 20, color: c.onPrimary },
  heroSub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.onPrimary, opacity: 0.92 },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 12 },
  tileStrong: { borderColor: c.primary, borderWidth: 1.5 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  tileTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
});
