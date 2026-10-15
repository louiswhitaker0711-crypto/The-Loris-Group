// Plan today's sectors, at the morning sector leaders meeting (from 09:30,
// Saturday 08:30). The Owner, or whoever the Owner has made today's sector
// planner, adds each sector (leader, postcode, who's in it, goal), then
// Confirms: everyone's told at 10:30 (Saturday 09:30), or straight away if
// it's later. After that the planner can still change postcodes, and who's in
// which sector until the field starts; the people in changed sectors are
// told. (backend routes/sector_plan.py)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { todayISO } from '../src/utils/calendarDates';
import { APP_LOCALE, APP_TZ } from '../src/utils/appTime';
import { showAlert } from '../src/utils/showAlert';
import { toast } from '../src/utils/toast';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import SectorRecap from '../src/components/sector/SectorRecap';
import PostcodeMiniMap from '../src/components/sector/PostcodeMiniMap';

type Person = { user_id: string; name: string; role: string; sector_leader_id?: string | null; in_today?: boolean; no_show?: boolean };
type Sector = { leader_id: string; leader_name: string; postcode: string; goal: number | null; member_ids: string[]; can_delete: boolean };
type Draft = { leader_id: string; postcode: string; goal: string; member_ids: string[] };

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';
const err = (e: any, f = 'Try again.') => e?.response?.data?.detail || f;

export default function SectorPlanScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayISO();
  const q = useQuery({ queryKey: ['sector-plan', date], queryFn: () => apiService.getSectorPlan(date).then((r) => r.data) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickingPlanner, setPickingPlanner] = useState(false);

  const d = q.data;
  const people: Person[] = d?.people || [];
  const nameOf = (id: string) => people.find((p) => p.user_id === id)?.name || '';
  const sectors: Sector[] = d?.sectors || [];
  const refresh = (data?: any) => {
    if (data) qc.setQueryData(['sector-plan', date], data); else q.refetch();
    ['sector-days', 'sector-board', 'sector-status'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  if (!d?.can_plan) {
    return <View style={[s.page, s.center]}><Text style={s.muted}>Only the Owner or today's sector planner plans the sectors.</Text></View>;
  }
  const sent = !!d.sent_at;
  const confirmed = !!d.confirmed_at;
  const locked = !!d.people_locked;

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.leader_id) return showAlert('Sector leader', 'Pick who’s leading it.');
    setBusy('save');
    try {
      const r = await apiService.saveSectorPlan(date, {
        leader_id: draft.leader_id, postcode: draft.postcode, goal: draft.goal.trim() === '' ? null : Number(draft.goal),
        member_ids: draft.member_ids,
      });
      refresh(r.data);
      setDraft(null);
      toast.success(sent ? 'Saved: the people in it have been told' : 'Sector saved');
    } catch (e) { showAlert('Could not save', err(e)); }
    finally { setBusy(null); }
  };
  const remove = (sec: Sector) => showAlert(`Delete ${sec.postcode || first(sec.leader_name) + '’s sector'}?`, 'It comes off today’s plan.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { refresh((await apiService.deleteSectorPlan(date, sec.leader_id)).data); }
      catch (e) { showAlert('Could not delete', err(e)); }
    } },
  ]);
  const confirm = async () => {
    setBusy('confirm');
    try {
      const r = await apiService.confirmSectorPlan(date);
      refresh(r.data);
      toast.success(r.data?.sent_now != null ? `Sent to ${r.data.sent_now}` : `Confirmed: everyone's told at ${d.send_at}`);
    } catch (e) { showAlert('Could not confirm', err(e)); }
    finally { setBusy(null); }
  };
  const setPlanner = async (uid: string | null) => {
    setPickingPlanner(false);
    try { refresh((await apiService.setSectorPlanner(date, uid)).data); toast.success(uid ? `${first(nameOf(uid))} is planning today` : 'You’re planning today'); }
    catch (e) { showAlert('Could not change', err(e)); }
  };

  const noShow = async (uid: string) => {
    setBusy(`ns:${uid}`);
    try { refresh((await apiService.markSectorNoShow(date, uid)).data); toast.success('Marked no show'); }
    catch (e) { showAlert('Could not mark', err(e)); }
    finally { setBusy(null); }
  };
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: APP_TZ }) : '');
  const where = (uid: string) => people.find((p) => p.user_id === uid)?.sector_leader_id || null;

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + kb + 60 }]} keyboardShouldPersistTaps="handled">
      {/* Break down the last field day's sectors first, then build today's. */}
      <SectorRecap collapsible defaultOpen={false} />
      <View>
        <Text style={s.title}>Today’s sectors</Text>
        <Text style={s.muted}>{d.label} · {sent ? `sent at ${when(d.sent_at)}` : confirmed ? `confirmed, going out at ${d.send_at}` : `not confirmed yet · goes out at ${d.send_at} once confirmed`}</Text>
      </View>

      {d.is_admin && (
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.h}>Sector planner today</Text>
            <Pressable onPress={() => setPickingPlanner(!pickingPlanner)} hitSlop={8}><Text style={s.link}>{pickingPlanner ? 'Close' : 'Change'}</Text></Pressable>
          </View>
          <Text style={s.muted}>{d.planner ? `${d.planner.name} (you can still plan too)` : 'You'}</Text>
          {pickingPlanner && (
            <View style={s.chips}>
              <Pressable onPress={() => setPlanner(null)} style={s.chip}><Text style={s.chipText}>Just me</Text></Pressable>
              {people.filter((p) => p.role !== 'admin').map((p) => (
                <Pressable key={p.user_id} onPress={() => setPlanner(p.user_id)} style={[s.chip, d.planner?.user_id === p.user_id && s.chipOn]}>
                  <Text style={[s.chipText, d.planner?.user_id === p.user_id && { color: c.onPrimary }]}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {(() => {
        const roster = people.filter((p) => p.in_today || p.no_show);
        if (!roster.length) return null;
        return (
          <View style={s.card} testID="plan-in-today">
            <Text style={s.h}>In today · {roster.filter((p) => !p.no_show).length}</Text>
            {roster.map((p) => {
              const sec = sectors.find((x) => x.leader_id === p.sector_leader_id);
              return (
                <View key={p.user_id} style={s.rosterRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rosterName, p.no_show && s.rosterNo]}>{p.name}</Text>
                    <Text style={s.small}>
                      {p.no_show ? 'Not shown up' : p.sector_leader_id ? `In ${first(nameOf(p.sector_leader_id))}'s${sec?.postcode ? ` · ${sec.postcode}` : ''}` : 'Not placed yet'}
                    </Text>
                  </View>
                  {p.no_show
                    ? <View style={s.nsTag}><Text style={s.nsTagText}>No show</Text></View>
                    : <Pressable onPress={() => noShow(p.user_id)} disabled={busy === `ns:${p.user_id}`} style={s.nsBtn} accessibilityRole="button" testID={`plan-ns-${p.user_id}`}>
                        <Text style={s.nsBtnText}>{busy === `ns:${p.user_id}` ? '…' : 'Not shown up'}</Text>
                      </Pressable>}
                </View>
              );
            })}
          </View>
        );
      })()}

      {sectors.map((sec) => (
        <View key={sec.leader_id} style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.code}>{sec.postcode || 'No postcode'}</Text>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <Pressable onPress={() => setDraft({ leader_id: sec.leader_id, postcode: sec.postcode, goal: sec.goal != null ? String(sec.goal) : '', member_ids: sec.member_ids })} hitSlop={8}>
                <Text style={s.link}>Edit</Text>
              </Pressable>
              {sec.can_delete && <Pressable onPress={() => remove(sec)} hitSlop={8}><Text style={[s.link, { color: c.red }]}>Delete</Text></Pressable>}
            </View>
          </View>
          <Text style={s.line}><Text style={s.bold}>{sec.leader_name}</Text> leading{sec.goal != null ? ` · goal ${sec.goal}` : ''}</Text>
          <Text style={s.muted}>{sec.member_ids.filter((m) => m !== sec.leader_id).map((m) => first(nameOf(m))).join(', ') || 'Nobody else yet'}</Text>
        </View>
      ))}

      {draft ? (
        <View style={[s.card, { borderColor: c.primary }]}>
          <Text style={s.h}>{sectors.some((x) => x.leader_id === draft.leader_id) ? 'Edit sector' : 'New sector'}</Text>
          <Text style={s.label}>Sector leader</Text>
          <View style={s.chips}>
            {people.filter((p) => (p.in_today || p.user_id === draft.leader_id) && (!where(p.user_id) || where(p.user_id) === draft.leader_id || p.user_id === draft.leader_id)).map((p) => (
              <Pressable key={p.user_id} onPress={() => setDraft({ ...draft, leader_id: p.user_id, member_ids: draft.member_ids.filter((m) => m !== p.user_id) })}
                style={[s.chip, draft.leader_id === p.user_id && s.chipOn]} disabled={sent && sectors.some((x) => x.leader_id === draft.leader_id)}>
                <Text style={[s.chipText, draft.leader_id === p.user_id && { color: c.onPrimary }]}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.twoCol}>
            <View style={{ flex: 2 }}>
              <Text style={s.label}>Postcode</Text>
              <TextInput value={draft.postcode} onChangeText={(v) => setDraft({ ...draft, postcode: v.toUpperCase() })} placeholder="e.g. WF4 2"
                autoCapitalize="characters" maxLength={10} placeholderTextColor={c.textMuted} style={s.input} />
              <PostcodeMiniMap postcode={draft.postcode} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Goal (optional)</Text>
              <TextInput value={draft.goal} onChangeText={(v) => setDraft({ ...draft, goal: v.replace(/\D/g, '') })} placeholder="–"
                inputMode="numeric" maxLength={3} placeholderTextColor={c.textMuted} style={s.input} />
            </View>
          </View>
          <Text style={s.label}>Who’s in it{locked ? ' (fixed now the field’s started)' : ''}</Text>
          <View style={s.chips}>
            {people.filter((p) => p.user_id !== draft.leader_id && p.in_today).map((p) => {
              const on = draft.member_ids.includes(p.user_id);
              const elsewhere = where(p.user_id) && where(p.user_id) !== draft.leader_id;
              return (
                <Pressable key={p.user_id} disabled={locked}
                  onPress={() => setDraft({ ...draft, member_ids: on ? draft.member_ids.filter((m) => m !== p.user_id) : [...draft.member_ids, p.user_id] })}
                  style={[s.chip, on && s.chipOn, !!elsewhere && !on && s.chipElsewhere]}>
                  <Text style={[s.chipText, on && { color: c.onPrimary }]}>
                    {p.name}{elsewhere && !on ? ` · ${first(nameOf(where(p.user_id) as string))}’s` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.small}>Someone already in another sector moves to this one when you tick them.</Text>
          <View style={s.actions}>
            <Pressable onPress={() => setDraft(null)} style={s.ghost}><Text style={s.ghostText}>Cancel</Text></Pressable>
            <Pressable onPress={saveDraft} disabled={busy === 'save'} style={s.btn}>
              {busy === 'save' ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnText}>Save sector</Text>}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setDraft({ leader_id: '', postcode: '', goal: '', member_ids: [] })} style={s.add} accessibilityRole="button" testID="plan-add">
          <Ionicons name="add" size={20} color={c.primary} />
          <Text style={s.addText}>Add a sector</Text>
        </Pressable>
      )}

      {sectors.length > 0 && !sent && (
        <Pressable onPress={confirm} disabled={busy === 'confirm'} style={[s.btn, s.big]} accessibilityRole="button" testID="plan-confirm">
          {busy === 'confirm' ? <ActivityIndicator color={c.onPrimary} /> : <Ionicons name="checkmark-done" size={18} color={c.onPrimary} />}
          <Text style={s.btnText}>{confirmed ? `Confirmed · going out at ${d.send_at}` : `Confirm sectors (they go out at ${d.send_at})`}</Text>
        </Pressable>
      )}
      {(() => {
        const unplaced = people.filter((p) => p.in_today && !p.no_show && p.role !== 'admin' && !p.sector_leader_id);
        return unplaced.length > 0 && sectors.length > 0 ? (
          <Text style={s.muted}>Not in a sector: {unplaced.map((p) => first(p.name)).join(', ')}</Text>
        ) : null;
      })()}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { fontFamily: fonts.bodyBold, fontSize: 20, color: c.text },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  code: { fontFamily: fonts.display, fontSize: 24, color: c.text },
  line: { fontFamily: fonts.body, fontSize: 14, color: c.text },
  bold: { fontFamily: fonts.bodyBold },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: c.border },
  rosterName: { fontFamily: fonts.bodySemibold, fontSize: 14.5, color: c.text },
  rosterNo: { color: '#000', textDecorationLine: 'line-through' },
  nsBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.red },
  nsBtnText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.red },
  nsTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#000' },
  nsTagText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipElsewhere: { opacity: 0.6 },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  twoCol: { flexDirection: 'row', gap: 10 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.background },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: c.primary },
  big: { paddingVertical: 15 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.onPrimary },
  ghost: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary },
  addText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary },
});
