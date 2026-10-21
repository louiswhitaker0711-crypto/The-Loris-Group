// Top of Home during field time. A sector leader sees "Start your sector
// set-up" (or how far through it they are); at the end of the day, "Do your
// sector's breakdown", then "Post your sector's breakdown", then that it's
// posted. A BA sees their set-up, and at the end of the day their breakdown.
// In the morning the sector planner sees "Plan today's sectors".
// Hidden outside those windows. (GET /sector/status)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';

export default function SectorPromptCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['sector-status'],
    queryFn: () => apiService.getSectorStatus().then((r) => r.data),
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  if (!data) return null;

  let icon: any = null, title = '', sub = '', url = '';
  // Planning shows until set-up time; from then (13:00, Saturday 09:30), once
  // the sectors are out, the set-up prompt comes first.
  if (data.planning && !(data.phase === 'setup' && data.plan_sent)) {
    const sat = new Date(`${data.date}T12:00:00Z`).getUTCDay() === 6;
    const n = data.plan_sectors || 0;
    icon = 'compass';
    if (data.plan_sent) {
      title = `Today's sectors are out · ${n} planned`;
      sub = 'Tap to change a postcode or move people before the field.';
    } else if (data.plan_confirmed) {
      title = `Sectors confirmed · going out at ${sat ? '09:30' : '10:30'}`;
      sub = 'You can still change them until then.';
    } else {
      title = n ? `Plan today's sectors · ${n} planned` : "Plan today's sectors";
      sub = 'Pick each leader, the postcode and who goes with them, then confirm.';
    }
    url = '/sector-plan';
  } else if (data.is_leader && data.phase === 'setup') {
    if (!data.has_sector && data.is_coach) {
      icon = 'rocket'; title = 'Start your sector set-up';
      sub = "Tick who's in, add the postcode and sector goal, then each person's set-up."; url = '/sector?start=1';
    } else if (data.has_sector && data.setups < data.members) {
      icon = 'create'; title = `Finish set-up · ${data.setups}/${data.members}`;
      sub = 'A few people still need their goal, KPI and focus.'; url = '/sector';
    }
  } else if (data.is_leader && data.phase === 'breakdown' && data.has_sector) {
    if (data.breakdowns < data.members) {
      icon = 'clipboard'; title = `Do your sector's breakdown · ${data.breakdowns}/${data.members}`;
      sub = 'Numbers, goal against hit, proud of and change, the map, then post it.'; url = '/sector?mode=breakdown';
    } else if (!data.breakdown_posted_at) {
      icon = 'checkmark-done'; title = 'Post your sector’s breakdown';
      sub = 'Everyone’s in. Save the map and post it for the Coaches.'; url = '/sector?mode=breakdown';
    }
  } else if (data.phase === 'breakdown' && data.in_sector && !data.my_breakdown_done) {
    icon = 'clipboard'; title = 'Your breakdown';
    sub = 'What you’re proud of today and what you’ll change tomorrow.'; url = '/sector?mode=breakdown';
  }

  if (url) {
    return (
      <Pressable onPress={() => router.push(url as never)} style={s.card} accessibilityRole="button" testID="home-sector-prompt">
        <View style={s.icon}><Ionicons name={icon} size={20} color={c.onPrimary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.sub}>{sub}</Text>
        </View>
        <Ionicons name="arrow-forward" size={18} color={c.onPrimary} />
      </Pressable>
    );
  }

  if (data.phase === 'breakdown' && data.breakdown_posted_at && data.is_leader) {
    return (
      <Pressable onPress={() => router.push('/sector?mode=breakdown' as never)} style={s.plain} accessibilityRole="button" testID="home-breakdown-posted">
        <Text style={s.plainTitle}>✅ Sector breakdown posted</Text>
        <Text style={s.plainSub}>It’s on the Coaches’ Home with today’s set-ups. Tap to change it.</Text>
      </Pressable>
    );
  }

  const m = data.my_setup;
  const mapLink = data.in_sector && data.phase ? (
    <Pressable onPress={() => router.push('/sector-map' as never)} style={s.mapLink} accessibilityRole="button" testID="home-sector-map">
      <Ionicons name="map-outline" size={16} color={c.primary} />
      <Text style={s.mapLinkText}>Your sector map</Text>
    </Pressable>
  ) : null;
  if (m && data.phase) {
    const bits = [m.goal != null ? `Goal ${m.goal}` : '', m.kpi ? `KPI ${m.kpi}` : '', m.focus ? `Focus: ${m.focus}` : '', m.positive ? `💪 ${m.positive}` : ''].filter(Boolean);
    if (!bits.length) return mapLink;
    return (
      <View style={s.plain} testID="home-my-setup">
        <Text style={s.plainTitle}>🎯 Your set-up today</Text>
        <Text style={s.plainSub}>{bits.join(' · ')}</Text>
        {mapLink}
      </View>
    );
  }
  return mapLink;
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: c.primary, marginBottom: 12 },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.onPrimary, opacity: 0.9 },
  plain: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, gap: 4, marginBottom: 12 },
  plainTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 6 },
  mapLinkText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  plainSub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
});
