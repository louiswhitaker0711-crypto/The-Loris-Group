// One sector on one day, opened from the Sector tab: its map first, then
// Set-up, Breakdown and the 6pm reset (today). Your own sector opens them to
// do; anyone else's (a Coach looking) shows everyone's set-up and breakdown.
// The map is for the people in the sector and Admins.
import React, { useMemo } from 'react';
import PostcodePair from '../src/components/sector/PostcodePair';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showAlert } from '../src/utils/showAlert';
import { toast } from '../src/utils/toast';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { todayISO } from '../src/utils/calendarDates';
import { APP_LOCALE } from '../src/utils/appTime';
import { SectorMap } from '../src/components/sector/SectorMap';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export default function SectorDayScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ date?: string; leader?: string }>();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayISO();
  const leader = params.leader || '';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sector-board', date], queryFn: () => apiService.getSectorBoard(date).then((r) => r.data) });
  // The Owner (or the day's sector planner) can move today's sector to a new postcode.
  const st = useQuery({ queryKey: ['sector-status'], queryFn: () => apiService.getSectorStatus().then((r) => r.data), retry: false });
  const [pcEdit, setPcEdit] = React.useState<string | null>(null);
  const [pcBusy, setPcBusy] = React.useState(false);
  const [asking, setAsking] = React.useState<string | null>(null);
  const askMark = async (uid: string) => {
    setAsking(uid);
    try {
      await apiService.askToMarkOff(date, uid);
      toast.success('Asked: they’ll be reminded until it’s done');
      qc.invalidateQueries({ queryKey: ['sector-board'] });
    } catch (e: any) { showAlert('Could not ask', e?.response?.data?.detail || 'Try again.'); }
    setAsking(null);
  };
  const savePostcode = async () => {
    if (pcEdit == null) return;
    setPcBusy(true);
    try {
      await apiService.changeSectorPostcode(date, leader, pcEdit);
      toast.success('Postcode changed');
      setPcEdit(null);
      ['sector-days', 'sector-board', 'sector-status', 'sector-plan', 'home-area-map', 'my-day'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) { showAlert('Could not change it', e?.response?.data?.detail || 'Try again.'); }
    setPcBusy(false);
  };
  // Delete a sector that isn't finished (a test, or started by mistake).
  const del = () => showAlert('Delete this sector?', 'The sector, everyone’s set-ups and breakdowns for it and anything drawn on its map that day are deleted. This can’t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        await apiService.deleteSector(date, leader);
        toast.success('Sector deleted');
        ['sector-days', 'sector-board', 'sector-status', 'sector-day', 'home-area-map', 'my-day'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        router.replace('/my-sector' as never);
      } catch (e: any) { showAlert('Could not delete', e?.response?.data?.detail || 'Try again.'); }
    } },
  ]);
  const delBtn = (
    <Pressable onPress={del} style={s.del} accessibilityRole="button" testID="sector-delete">
      <Ionicons name="trash-outline" size={16} color={c.red} />
      <Text style={s.delText}>Delete this sector</Text>
    </Pressable>
  );
  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const sec = (q.data?.sectors || []).find((x: any) => x.leader_id === leader);
  if (!sec) {
    // A sector nobody was added to doesn't show on the board, but can still go.
    const own = leader === String(user?.id || '') || user?.role === 'admin';
    return (
      <View style={[s.page, s.center, { gap: 12 }]}>
        <Text style={s.muted}>No one’s in this sector yet.</Text>
        {own && delBtn}
      </View>
    );
  }

  const me = String(user?.id || '');
  const isAdmin = user?.role === 'admin';
  const people: any[] = sec.people || [];
  const mine = sec.leader_id === me || people.some((p) => p.user_id === me);
  const leads = sec.leader_id === me;
  const isToday = date === todayISO();
  const label = new Date(date + 'T12:00:00').toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

  const actions = [
    { icon: 'people-circle-outline', title: 'Set-up', to: `/sector?date=${date}`, show: mine },
    { icon: 'clipboard-outline', title: 'Breakdown', to: `/sector?date=${date}&mode=breakdown`, show: mine },
    { icon: 'refresh-circle-outline', title: '6pm reset', to: '/field-reset', show: mine && isToday },
  ].filter((a) => a.show);

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <View>
        <Text style={s.code}>{sec.postcode || 'No postcode'}</Text>
        <Text style={s.muted}>
          {label} · {leads ? 'your sector' : `${first(sec.leader_name)}'s sector`}{sec.goal != null ? ` · ${sec.hit} of ${sec.goal}` : ''}
        </Text>
        {sec.breakdown_posted_at ? <Text style={s.posted}>✅ Breakdown posted</Text> : null}
        {isToday && !!st.data?.can_plan && (pcEdit == null ? (
          <Pressable onPress={() => setPcEdit(sec.postcode || '')} style={s.pcBtn} accessibilityRole="button" testID="sector-change-postcode">
            <Ionicons name="location-outline" size={15} color={c.primary} />
            <Text style={s.pcBtnText}>Change postcode</Text>
          </Pressable>
        ) : (
          <View style={s.pcRow}>
            <PostcodePair value={pcEdit} onChange={setPcEdit} autoFocus placeholder="e.g. LS6 2" inputStyle={s.pcInput}
              style={{ flex: 1 }} testID="sector-postcode-input" />
            <Pressable onPress={savePostcode} disabled={pcBusy} style={s.pcSave} accessibilityRole="button" testID="sector-postcode-save">
              <Text style={s.pcSaveText}>{pcBusy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable onPress={() => setPcEdit(null)} style={s.pcCancel} accessibilityRole="button">
              <Text style={s.pcBtnText}>Cancel</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {(mine || isAdmin) && <SectorMap date={date} leaderId={!mine && isAdmin ? sec.leader_id : undefined} height={380} />}

      {actions.length > 0 && (
        <View style={s.actions}>
          {actions.map((a) => (
            <Pressable key={a.title} onPress={() => router.push(a.to as never)} style={s.action} accessibilityRole="button" testID={`sector-day-${a.title}`}>
              <Ionicons name={a.icon as any} size={20} color={c.primary} />
              <Text style={s.actionText}>{a.title}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.h}>{sec.breakdown_posted_at ? 'Breakdowns' : 'Set-ups'}</Text>
        {people.map((p) => {
          const su = p.setup;
          const b = p.breakdown;
          const bits = sec.breakdown_posted_at && b
            ? [[b.doors, b.spoken, b.pitched, b.closed].map((v: any) => (v == null ? '-' : v)).join('/'),
               `${b.hit ?? 0} of ${b.goal ?? '-'}`, b.proud ? `Proud: ${b.proud}` : '', b.change ? `Change: ${b.change}` : ''].filter(Boolean)
            : su ? [su.goal != null ? `Goal ${su.goal}` : '', su.kpi ? `KPI ${su.kpi}` : '', su.focus ? `Focus: ${su.focus}` : ''].filter(Boolean) : [];
          return (
            <View key={p.user_id} style={s.person}>
              <Text style={[s.name, p.user_id === me && { color: c.primary }]}>{first(p.user_name)}</Text>
              <Text style={s.line}>{bits.length ? bits.join(' · ') : sec.breakdown_posted_at ? 'No breakdown' : 'No set-up yet'}</Text>
              {leads && isToday && !sec.map_saved_at && p.user_id !== me && (
                (sec.mark_requests || []).includes(p.user_id)
                  ? <Text style={s.asked}>🗺️ Asked to mark off</Text>
                  : <Pressable onPress={() => askMark(p.user_id)} disabled={asking === p.user_id} style={s.askBtn} accessibilityRole="button" testID={`ask-mark-${p.user_id}`}>
                      <Ionicons name="map-outline" size={14} color={c.primary} />
                      <Text style={s.askText}>{asking === p.user_id ? 'Asking…' : 'Ask to mark their streets off'}</Text>
                    </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {!!sec.can_delete && delBtn}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 760, alignSelf: 'center' },
  code: { fontFamily: fonts.display, fontSize: 30, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  posted: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.green, marginTop: 2 },
  asked: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.green, marginTop: 2 },
  askBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4, marginTop: 2 },
  askText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  pcBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 6, marginTop: 4 },
  pcBtnText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  pcRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  pcInput: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.background },
  pcSave: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: c.primary },
  pcSaveText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  pcCancel: { paddingHorizontal: 6, paddingVertical: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.background },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: c.primary },
  del: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: c.red, alignSelf: 'stretch' },
  delText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.red },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  person: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', paddingTop: 6, borderTopWidth: 1, borderTopColor: c.border },
  name: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text, width: 80 },
  line: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
});
