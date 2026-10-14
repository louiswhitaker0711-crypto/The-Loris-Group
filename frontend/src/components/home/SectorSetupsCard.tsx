// Home, under Sectors: today's sector set-ups (and each breakdown once the
// sector leader posts it), so they're one tap from
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

export default function SectorSetupsCard({ mode = 'setups' }: { mode?: 'setups' | 'breakdowns' }) {
  const breakdowns = mode === 'breakdowns';
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
        <Text style={[s.title, breakdowns && s.titleBig]}>{breakdowns ? 'Breakdowns' : "Today's sectors"}</Text>
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
        const showBreakdown = !!(sec.breakdown_posted_at || breakdowns);
        return (
          <View key={sec.leader_id} style={s.sector}>
            <View style={s.secHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.code}>{sec.postcode || 'No postcode'}</Text>
                <Text style={s.secMeta}>{sec.leader_id === me ? 'Your sector' : `${first(sec.leader_name)}'s sector`} · {people.length} {people.length === 1 ? 'person' : 'people'}</Text>
              </View>
              {sec.goal != null && (
                <View style={s.goalPill}>
                  <Text style={s.goalNum}>{sec.breakdown_posted_at ? `${sec.hit ?? 0}/${sec.goal}` : sec.goal}</Text>
                  <Text style={s.goalLbl}>{sec.breakdown_posted_at ? 'hit' : 'goal'}</Text>
                </View>
              )}
            </View>
            {sec.breakdown_posted_at ? <Text style={s.posted}>✅ Breakdown posted</Text>
              : breakdowns ? <Text style={s.waiting}>{people.filter((p) => p.breakdown).length} of {people.length} breakdowns in · not posted yet</Text> : null}
            {people.map((p) => {
              const su = p.setup;
              const b = p.breakdown;
              const mine = p.user_id === me;
              // Once the breakdown's posted (or on the Breakdowns card), show it;
              // until then, the set-up.
              const pills: string[] = showBreakdown
                ? (b ? [b.goal != null || b.hit != null ? `${b.hit ?? 0} of ${b.goal ?? '-'}` : '',
                    [b.doors, b.spoken, b.pitched, b.closed].some((v: any) => v != null)
                      ? [b.doors, b.spoken, b.pitched, b.closed].map((v: any) => (v == null ? '-' : v)).join('/') : ''].filter(Boolean) : [])
                : (su ? [su.goal != null ? `🎯 ${su.goal}` : '', su.kpi ? `📊 ${su.kpi}` : ''].filter(Boolean) : []);
              const sub = showBreakdown
                ? (b ? [b.proud ? `Proud: ${b.proud}` : '', b.change ? `Change: ${b.change}` : ''].filter(Boolean).join(' · ') : 'No breakdown yet')
                : (su ? (su.focus || '') : 'No set-up yet');
              return (
                <View key={p.user_id} style={[s.person, mine && s.personMine]}>
                  <View style={s.personTop}>
                    <Text style={[s.name, mine && { color: c.primary }]} numberOfLines={1}>{first(p.user_name)}</Text>
                    <View style={s.pills}>
                      {pills.map((t) => <View key={t} style={s.pill}><Text style={s.pillText}>{t}</Text></View>)}
                    </View>
                  </View>
                  {!!sub && <Text style={[s.focus, (!su && !showBreakdown) || (showBreakdown && !b) ? s.missing : null]}>{sub}</Text>}
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
  sector: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  code: { fontFamily: fonts.bodyBold, fontSize: 18, color: c.text },
  secMeta: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted },
  goalPill: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: c.primary + '14' },
  goalNum: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.primary },
  goalLbl: { fontFamily: fonts.body, fontSize: 11, color: c.textMuted },
  titleBig: { fontSize: 21 },
  waiting: { fontFamily: fonts.body, fontSize: 12.5, color: c.yellow },
  posted: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.green },
  person: { gap: 3, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: c.surface },
  personMine: { borderWidth: 1, borderColor: c.primary + '55' },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.text, flexShrink: 1 },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  pillText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  focus: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  missing: { fontStyle: 'italic' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
});
