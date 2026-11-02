/**
 * Follow-ups (the Owner, 2 Nov 2026). Writing in the weekly planner, "Set
 * follow-up" at the bottom: what to follow up, when (Tomorrow / Next week /
 * In 2 weeks or a date, a time if you want one), and whether it's just for
 * you or for someone else as well. On the day it shows on that day's page of
 * the planner and on Home until it's ticked, with a notification at the time
 * (09:00 when no time is set).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService, FollowUp } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useColors, fonts } from '../../theme/ThemeContext';
import { todayISO } from '../../utils/calendarDates';
import { APP_LOCALE } from '../../utils/appTime';
import { showAlert } from '../../utils/showAlert';
import { toast } from '../../utils/toast';
import DateField from '../ui/DateField';
import { DayTimeInput } from './DayLayout';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';
function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function prettyDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}
const invalidate = (qc: any) => qc.invalidateQueries({ queryKey: ['followups'] });

type Source = { week_ending?: string; day_index?: number; key?: string; title?: string };

/** The "Set follow-up" button and its sheet. `withUserId` is whose planner
 * this is when it isn't yours (they're offered first). */
export function SetFollowUpButton({ source, withUserId, withName }: { source: Source; withUserId?: string; withName?: string }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={s.setBtn} accessibilityRole="button" testID="set-followup">
        <Ionicons name="alarm-outline" size={18} color={c.primary} />
        <Text style={s.setBtnText}>Set follow-up</Text>
      </Pressable>
      {open && <FollowUpSheet source={source} withUserId={withUserId} withName={withName} onClose={() => setOpen(false)} />}
    </>
  );
}

function FollowUpSheet({ source, withUserId, withName, onClose }: { source: Source; withUserId?: string; withName?: string; onClose: () => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = ((user as any)?.role || '').toLowerCase();
  const today = todayISO();
  const [text, setText] = useState('');
  const [when, setWhen] = useState<string>(addDays(today, 1));
  const [time, setTime] = useState('');
  const [also, setAlso] = useState<string | null>(withUserId || null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = useQuery({
    queryKey: ['followup-people'],
    queryFn: () => apiService.followUpPeople().then((r) => r.data.people),
    enabled: role === 'leader' || role === 'admin',
    staleTime: 5 * 60_000,
  });
  const list = people.data || [];
  const nameOf = (id: string) => list.find((p) => p.user_id === id)?.name || (id === withUserId ? withName || '' : '');
  const quick = [
    { label: 'Tomorrow', iso: addDays(today, 1) },
    { label: 'Next week', iso: addDays(today, 7) },
    { label: 'In 2 weeks', iso: addDays(today, 14) },
  ];
  const save = async () => {
    if (!text.trim()) return showAlert('Follow-up', 'Write what to follow up first.');
    setBusy(true);
    try {
      await apiService.createFollowUp({ text: text.trim(), due_date: when, due_time: time, also_user_id: also, source });
      invalidate(qc);
      toast.success(`Follow-up set for ${prettyDay(when)}${time ? ` at ${time}` : ''}`);
      onClose();
    } catch (e: any) {
      showAlert('Could not set it', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={s.rowBetween}>
            <Text style={s.h}>Set follow-up</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={c.textMuted} /></Pressable>
          </View>
          <TextInput value={text} onChangeText={setText} placeholder="What do you need to follow up? e.g. Review Ayo's closing from our 1-to-1"
            placeholderTextColor={c.textMuted} style={s.input} multiline autoFocus maxLength={500} testID="followup-text" />

          <Text style={s.label}>When</Text>
          <View style={s.chips}>
            {quick.map((q) => (
              <Pressable key={q.label} onPress={() => setWhen(q.iso)} style={[s.chip, when === q.iso && s.chipOn]} accessibilityRole="button">
                <Text style={[s.chipText, when === q.iso && { color: c.onPrimary }]}>{q.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.whenRow}>
            <DateField value={when} onChange={(v) => setWhen(v || today)} minDate={today} />
            <Text style={s.small}>at</Text>
            <DayTimeInput value={time} onChange={setTime} label="Follow-up" />
            <Text style={s.small}>{time ? '' : 'no time: reminded at 9:00'}</Text>
          </View>

          <Text style={s.label}>Who for</Text>
          <View style={s.chips}>
            <Pressable onPress={() => { setAlso(null); setPicking(false); }} style={[s.chip, !also && s.chipOn]} accessibilityRole="button">
              <Text style={[s.chipText, !also && { color: c.onPrimary }]}>Just me</Text>
            </Pressable>
            {!!also && (
              <Pressable onPress={() => setPicking(!picking)} style={[s.chip, s.chipOn]} accessibilityRole="button">
                <Text style={[s.chipText, { color: c.onPrimary }]}>Me and {first(nameOf(also))}</Text>
              </Pressable>
            )}
            {(role === 'leader' || role === 'admin' || !!withUserId) && (
              <Pressable onPress={() => setPicking(!picking)} style={s.chip} accessibilityRole="button">
                <Text style={s.chipText}>{also ? 'Someone else…' : 'Me and someone else…'}</Text>
              </Pressable>
            )}
          </View>
          {picking && (
            people.isLoading ? <ActivityIndicator color={c.primary} /> : (
              <View style={s.chips}>
                {list.map((p) => (
                  <Pressable key={p.user_id} onPress={() => { setAlso(p.user_id); setPicking(false); }} style={[s.chip, also === p.user_id && s.chipOn]} accessibilityRole="button">
                    <Text style={[s.chipText, also === p.user_id && { color: c.onPrimary }]}>{p.name}</Text>
                  </Pressable>
                ))}
                {list.length === 0 && <Text style={s.small}>Nobody on your team to add.</Text>}
              </View>
            )
          )}
          {!!also && <Text style={s.small}>{first(nameOf(also))} gets it in their planner and on Home too, with a notification.</Text>}

          <Pressable onPress={save} disabled={busy} style={s.save} accessibilityRole="button" testID="followup-save">
            {busy ? <ActivityIndicator color={c.onPrimary} /> : <Ionicons name="alarm" size={18} color={c.onPrimary} />}
            <Text style={s.saveText}>Set for {prettyDay(when)}{time ? ` at ${time}` : ''}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** One follow-up: tick it, see who it's from / with, delete your own. */
function Row({ f, s, c, onTick, onDelete, onOpen, showDay }: { f: FollowUp; s: any; c: any; onTick: () => void; onDelete: () => void; onOpen?: () => void; showDay?: boolean }) {
  const meta = [
    showDay ? prettyDay(f.due_date) : '',
    f.due_time,
    f.from_name ? `from ${first(f.from_name)}` : '',
    f.with_names.length ? `with ${f.with_names.map(first).join(', ')}` : '',
    f.source?.title ? `· ${f.source.title}` : '',
  ].filter(Boolean).join(' ');
  return (
    <View style={s.row}>
      <Pressable onPress={onTick} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: f.done }}>
        <Ionicons name={f.done ? 'checkbox' : 'square-outline'} size={22} color={f.done ? c.primary : c.textMuted} />
      </Pressable>
      <Pressable style={{ flex: 1 }} onPress={onOpen} disabled={!onOpen} accessibilityRole={onOpen ? 'link' : undefined}>
        <Text style={[s.rowText, f.done && s.doneText]}>{f.text}</Text>
        {!!meta && <Text style={s.small}>{meta}</Text>}
      </Pressable>
      {f.mine && (
        <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete follow-up">
          <Ionicons name="trash-outline" size={16} color={c.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function useActions() {
  const qc = useQueryClient();
  return {
    tick: async (f: FollowUp) => {
      try { await apiService.tickFollowUp(f.id, !f.done); invalidate(qc); } catch { showAlert('Could not save', 'Try again.'); }
    },
    remove: (f: FollowUp) => showAlert('Delete follow-up?', f.text, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await apiService.deleteFollowUp(f.id); invalidate(qc); } catch { showAlert('Could not delete', 'Try again.'); }
      } },
    ]),
  };
}

/** At the top of a day's page in the planner: that day's follow-ups. */
export function FollowUpsForDay({ date }: { date: string }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { tick, remove } = useActions();
  const q = useQuery({ queryKey: ['followups', 'day', date], queryFn: () => apiService.followUps({ date }).then((r) => r.data.followups) });
  const rows = q.data || [];
  if (!rows.length) return null;
  return (
    <View style={s.card} testID="day-followups">
      <View style={s.headRow}>
        <Ionicons name="alarm" size={16} color={c.primary} />
        <Text style={s.cardH}>Follow-ups</Text>
      </View>
      {rows.map((f) => <Row key={f.id} f={f} s={s} c={c} onTick={() => tick(f)} onDelete={() => remove(f)} />)}
    </View>
  );
}

/** Home: today's follow-ups and any earlier ones not ticked yet. */
export function FollowUpsDueCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { tick, remove } = useActions();
  const q = useQuery({ queryKey: ['followups', 'due'], queryFn: () => apiService.followUps({ due: true }).then((r) => r.data), refetchInterval: 5 * 60_000 });
  const rows = q.data?.followups || [];
  if (!rows.length) return null;
  const today = q.data?.today || todayISO();
  return (
    <View style={s.card} testID="home-followups">
      <View style={s.headRow}>
        <Ionicons name="alarm" size={16} color={c.primary} />
        <Text style={s.cardH}>Follow-ups · {rows.length}</Text>
      </View>
      {rows.map((f) => (
        <Row key={f.id} f={f} s={s} c={c} showDay={f.due_date !== today} onTick={() => tick(f)} onDelete={() => remove(f)}
          onOpen={() => router.push(f.url as never)} />
      ))}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  setBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary, margin: 16, marginTop: 8 },
  setBtnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '88%' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h: { fontFamily: fonts.bodyBold, fontSize: 18, color: c.text },
  label: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: c.text },
  input: { minHeight: 80, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.background, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 12, backgroundColor: c.primary },
  saveText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardH: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowText: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: c.text },
  doneText: { textDecorationLine: 'line-through', color: c.textMuted },
});
