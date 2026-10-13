// Home, under Sectors: today's sector set-ups, so they're one tap from
// opening the app in the field. Coaches and Admins see every sector's
// set-up; a BA sees their own sector's. Not in a sector yet? "Start a
// sector". (GET /sector/board, /sector/status)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { todayISO } from '../../utils/calendarDates';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export default function SectorSetupsCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const today = todayISO();
  const isCoach = user?.role === 'leader' || user?.role === 'admin';
  const board = useQuery({
    queryKey: ['sector-board', today],
    queryFn: () => apiService.getSectorBoard(today).then((r) => r.data),
    refetchInterval: 2 * 60 * 1000,
    retry: false,
  });
  const status = useQuery({
    queryKey: ['sector-status'],
    queryFn: () => apiService.getSectorStatus().then((r) => r.data),
    retry: false,
  });
  const me = String(user?.id || '');
  const all: any[] = board.data?.sectors || [];
  const sectors = isCoach ? all : all.filter((sec) => (sec.people || []).some((p: any) => p.user_id === me));
  const inSector = !!status.data?.in_sector;
  if (board.isLoading || (new Date().getDay() === 0 && !sectors.length)) return null;

  return (
    <View style={s.card} testID="home-sector-setups">
      <View style={s.head}>
        <Text style={s.title}>Today's set-ups</Text>
        {inSector ? (
          <Pressable onPress={() => router.push('/my-sector' as never)} style={s.link} accessibilityRole="button" hitSlop={6}>
            <Text style={s.linkText}>My sector</Text>
            <Ionicons name="chevron-forward" size={14} color={c.primary} />
          </Pressable>
        ) : null}
      </View>

      {sectors.length === 0 ? (
        <Text style={s.muted}>{isCoach ? 'No sectors set up yet today.' : 'You’re not in a sector yet today.'}</Text>
      ) : sectors.map((sec) => {
        const people: any[] = sec.people || [];
        return (
          <View key={sec.leader_id} style={s.sector}>
            <Text style={s.secName} numberOfLines={1}>
              {first(sec.leader_name)}'s sector{sec.postcode ? ` · ${sec.postcode}` : ''}
              <Text style={s.secMeta}>{sec.goal ? `  ·  goal ${sec.goal}` : ''}</Text>
            </Text>
            {people.map((p) => {
              const su = p.setup;
              const bits = su ? [su.goal != null ? `Goal ${su.goal}` : '', su.kpi ? `KPI ${su.kpi}` : '', su.focus ? `Focus: ${su.focus}` : ''].filter(Boolean) : [];
              return (
                <View key={p.user_id} style={s.person}>
                  <Text style={[s.name, p.user_id === me && { color: c.primary }]}>{first(p.user_name)}</Text>
                  <Text style={s.line} numberOfLines={2}>{bits.length ? bits.join(' · ') : 'No set-up yet'}</Text>
                </View>
              );
            })}
          </View>
        );
      })}

      {!inSector && (
        <Pressable onPress={() => router.push('/sector?start=1' as never)} style={s.btn} accessibilityRole="button" testID="home-start-sector">
          <Ionicons name="rocket-outline" size={16} color={c.onPrimary} />
          <Text style={s.btnText}>Start a sector</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  sector: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border },
  secName: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.text },
  secMeta: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted },
  person: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  name: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text, width: 72 },
  line: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
});
