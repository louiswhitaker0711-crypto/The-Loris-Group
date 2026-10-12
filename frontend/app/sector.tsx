// Sector set-up and breakdown, in the office's WhatsApp layout. Breakdown
// numbers come in from OwnerIQ and Bells; tomorrow's set-up is prompted from
// today's "Change". Share either to the group in one tap, and send each person
// their own set-up as a notification. (backend routes/sector.py)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { todayISO } from '../src/utils/calendarDates';
import { APP_LOCALE } from '../src/utils/appTime';
import { openInWhatsApp, copyText } from '../src/utils/whatsapp';
import { SectorPicker } from '../src/components/sector/SectorPicker';

type Setup = { goal: number | null; kpi_metric: string | null; kpi_target: number | null; focus: string; positive?: string };
type Breakdown = { doors: number | null; spoken: number | null; pitched: number | null; closed: number | null;
  note: string; goal: number | null; hit: number | null; proud: string; change: string };
type Person = { user_id: string; user_name: string; setup: Setup | null; breakdown: Breakdown | null;
  prefill: Partial<Record<'doors' | 'spoken' | 'pitched' | 'closed' | 'hit', number>>;
  yesterday: { change: string; proud: string; goal: number | null; kpi: { kpi_metric: string; kpi_target: number } | null } };
type Mode = 'setup' | 'breakdown';
const errText = (e: any, f: string) => (typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : f);

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function label(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'short' });
}
const num = (v: string) => (v.trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0));

export default function SectorScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const params = useLocalSearchParams<{ mode?: string; start?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'breakdown' ? 'breakdown' : 'setup');
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['sector-day', date], queryFn: () => apiService.getSectorDay(date).then((r) => r.data) });
  const people: Person[] = q.data?.people || [];
  const opts = q.data?.options;
  const text: string = q.data?.whatsapp?.[mode] || '';
  const hasText = text.split('\n').length > 1;
  // A BA only sees themselves: open their card straight away.
  useEffect(() => { if (people.length === 1 && open === null) setOpen(people[0].user_id); }, [people.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const notify = async () => {
    try {
      const r = await apiService.notifySectorSetups(date);
      toast.success(r.data?.sent ? `Sent to ${r.data.sent}` : 'Nobody has a set-up yet');
    } catch (e) { showAlert('Could not send', errText(e, 'Try again.')); }
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.tabs}>
        {(['setup', 'breakdown'] as Mode[]).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[s.tab, mode === m && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
            <Text style={[s.tabText, mode === m && { color: c.onPrimary }]}>{m === 'setup' ? 'Set-up' : 'Breakdown'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.dateRow}>
        <Pressable onPress={() => setDate(addDays(date, -1))} style={s.iconBtn} accessibilityLabel="Day before" hitSlop={6}>
          <Ionicons name="chevron-back" size={16} color={c.text} />
        </Pressable>
        <Text style={s.dateText}>{date === today ? 'Today · ' : date === addDays(today, 1) ? 'Tomorrow · ' : ''}{label(date)}</Text>
        <Pressable onPress={() => setDate(addDays(date, 1))} style={s.iconBtn} accessibilityLabel="Day after" hitSlop={6}>
          <Ionicons name="chevron-forward" size={16} color={c.text} />
        </Pressable>
      </View>
      <Text style={s.muted}>
        {mode === 'setup'
          ? 'Goal, KPI and focus for each person. Yesterday’s "Change" is ready to use as today’s focus.'
          : 'Doors / spoken / pitched / closed and sign-ups come in from OwnerIQ and Bells. Add what they’re proud of and what they’ll change.'}
      </Text>

      {!!q.data?.can_manage && (
        <SectorPicker key={date + String(q.data?.sector?.member_ids?.length || 0)} date={date}
          current={q.data?.sector?.member_ids || null}
          startOpen={params.start === '1' || (!q.isLoading && !q.data?.sector && mode === 'setup')}
          onSaved={() => q.refetch()} />
      )}

      {!!q.data?.can_manage && !!q.data?.sector && mode === 'setup' && (
        <SectorGoal key={date + String(q.data.sector.goal ?? '')} date={date} current={q.data.sector.goal ?? null}
          suggested={people.reduce((a, p) => a + (p.setup?.goal || 0), 0)} onSaved={() => q.refetch()} s={s} c={c} />
      )}

      {q.isLoading ? <ActivityIndicator color={c.primary} /> : people.map((p) => (
        mode === 'setup'
          ? <SetupCard key={p.user_id + date} p={p} date={date} opts={opts} open={open === p.user_id}
              onToggle={() => setOpen(open === p.user_id ? null : p.user_id)} onSaved={() => q.refetch()} s={s} c={c} />
          : <BreakdownCard key={p.user_id + date} p={p} date={date} opts={opts} open={open === p.user_id}
              onToggle={() => setOpen(open === p.user_id ? null : p.user_id)} onSaved={() => q.refetch()} s={s} c={c} />
      ))}

      {hasText && (
        <View style={s.card}>
          <Text style={s.h}>WhatsApp</Text>
          <Text style={s.preview}>{text}</Text>
          <View style={s.row}>
            <Pressable onPress={() => openInWhatsApp(text).catch(() => showAlert('WhatsApp', text))} style={s.btn} accessibilityRole="button">
              <Ionicons name="logo-whatsapp" size={16} color={c.onPrimary} />
              <Text style={s.btnText}>Share to WhatsApp</Text>
            </Pressable>
            <Pressable onPress={() => copyText(text).then(() => toast.success('Copied'))} style={s.ghost} accessibilityRole="button">
              <Ionicons name="copy-outline" size={15} color={c.primary} />
              <Text style={s.ghostText}>Copy</Text>
            </Pressable>
            {mode === 'setup' && q.data?.can_manage && (
              <Pressable onPress={notify} style={s.ghost} accessibilityRole="button">
                <Ionicons name="notifications-outline" size={15} color={c.primary} />
                <Text style={s.ghostText}>Send each person theirs</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function SectorGoal({ date, current, suggested, onSaved, s, c }: { date: string; current: number | null; suggested: number; onSaved: () => void; s: any; c: any }) {
  const [goal, setGoal] = useState(current != null ? String(current) : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await apiService.saveSectorGoal(date, num(goal));
      toast.success('Sector goal saved'); onSaved();
    } catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={s.card}>
      <Text style={s.h}>🎯 Sector goal</Text>
      <Text style={s.muted}>Sign-ups for the whole sector today. You get updates against it through the field.</Text>
      <View style={s.row}>
        <TextInput value={goal} onChangeText={setGoal} keyboardType="number-pad" placeholder={suggested ? String(suggested) : '12'}
          placeholderTextColor={c.textMuted} style={[s.input, s.small]} accessibilityLabel="Sector goal" />
        {suggested > 0 && !goal && (
          <Pressable onPress={() => setGoal(String(suggested))} style={s.ghost} accessibilityRole="button">
            <Text style={s.ghostText}>Use {suggested} (everyone's goals)</Text>
          </Pressable>
        )}
        <Pressable onPress={save} disabled={busy} style={s.btn} accessibilityRole="button" testID="sector-goal-save">
          {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
          <Text style={s.btnText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chips({ items, value, onPick, s, c, highlight }: { items: string[]; value: string; onPick: (v: string) => void; s: any; c: any; highlight?: string }) {
  return (
    <View style={s.chips}>
      {items.map((o) => {
        const on = value === o;
        const hi = highlight && o === highlight;
        return (
          <Pressable key={o} onPress={() => onPick(on ? '' : o)} style={[s.chip, hi && s.chipHi, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && { color: c.onPrimary }]}>{hi ? `↺ ${o}` : o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SetupCard({ p, date, opts, open, onToggle, onSaved, s, c }: any) {
  const cur: Setup = p.setup || { goal: null, kpi_metric: null, kpi_target: null, focus: '' };
  const [goal, setGoal] = useState(cur.goal != null ? String(cur.goal) : '');
  const [metric, setMetric] = useState<string>(cur.kpi_metric || '');
  const [target, setTarget] = useState(cur.kpi_target != null ? String(cur.kpi_target) : '');
  const [focus, setFocus] = useState(cur.focus || '');
  const [positive, setPositive] = useState(cur.positive || '');
  const [busy, setBusy] = useState(false);
  const y = p.yesterday || {};
  const metrics: Array<{ key: string; label: string; loa: number | null }> = opts?.kpi_metrics || [];
  const summary = p.setup ? [cur.goal != null ? `Goal ${cur.goal}` : '', cur.kpi_metric ? `${cur.kpi_target ?? ''} ${metrics.find((m) => m.key === cur.kpi_metric)?.label || ''}`.trim() : '', cur.focus].filter(Boolean).join(' · ') : 'Not set';

  const useYesterday = () => {
    if (y.goal != null) setGoal(String(y.goal));
    if (y.kpi) { setMetric(y.kpi.kpi_metric); setTarget(String(y.kpi.kpi_target)); }
    if (y.change) setFocus(y.change);
    if (y.proud && !positive) setPositive(y.proud);
  };
  const save = async () => {
    setBusy(true);
    try {
      await apiService.saveSectorDay(p.user_id, date, { setup: { goal: num(goal), kpi_metric: metric || null, kpi_target: num(target), focus, positive } });
      toast.success('Saved'); onSaved(); onToggle();
    } catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.card}>
      <Pressable onPress={onToggle} style={s.cardHead} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{p.user_name}</Text>
          <Text style={s.muted} numberOfLines={1}>{summary}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
      </Pressable>
      {open && (
        <View style={{ gap: 10 }}>
          {(y.change || y.kpi) && (
            <Pressable onPress={useYesterday} style={s.hint} accessibilityRole="button">
              <Ionicons name="arrow-undo-outline" size={15} color={c.primary} />
              <Text style={[s.ghostText, { flex: 1 }]}>
                From yesterday: {[y.change && `change "${y.change}"`, y.kpi && `${y.kpi.kpi_target} ${metrics.find((m) => m.key === y.kpi.kpi_metric)?.label}`].filter(Boolean).join(' · ')} — tap to use
              </Text>
            </Pressable>
          )}
          <Text style={s.label}>Goal (sign-ups)</Text>
          <TextInput value={goal} onChangeText={setGoal} keyboardType="number-pad" placeholder="4" placeholderTextColor={c.textMuted} style={[s.input, s.small]} />
          <Text style={s.label}>KPI</Text>
          <View style={s.chips}>
            {metrics.map((m) => (
              <Pressable key={m.key} onPress={() => { setMetric(m.key); if (!target && m.loa) setTarget(String(m.loa)); }}
                style={[s.chip, metric === m.key && s.chipOn]} accessibilityRole="button">
                <Text style={[s.chipText, metric === m.key && { color: c.onPrimary }]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
          {!!metric && <TextInput value={target} onChangeText={setTarget} keyboardType="number-pad" placeholder="Target" placeholderTextColor={c.textMuted} style={[s.input, s.small]} />}
          <Text style={s.label}>Focus</Text>
          <Chips items={opts?.change || []} value={focus} onPick={setFocus} s={s} c={c} highlight={y.change} />
          <TextInput value={focus} onChangeText={setFocus} placeholder="Or type it" placeholderTextColor={c.textMuted} style={s.input} />
          <Text style={s.label}>Positive</Text>
          <Text style={s.muted}>Something they're doing well. It goes in their notifications through the field.</Text>
          {!!y.proud && y.proud !== positive && (
            <Pressable onPress={() => setPositive(y.proud)} style={s.hint} accessibilityRole="button">
              <Ionicons name="arrow-undo-outline" size={15} color={c.primary} />
              <Text style={[s.ghostText, { flex: 1 }]}>Yesterday they were proud of "{y.proud}" — tap to use</Text>
            </Pressable>
          )}
          <TextInput value={positive} onChangeText={setPositive} placeholder="e.g. great tone of voice on the doors" placeholderTextColor={c.textMuted} style={s.input} maxLength={120} />
          <Pressable onPress={save} disabled={busy} style={s.btn} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
            <Text style={s.btnText}>Save</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function BreakdownCard({ p, date, opts, open, onToggle, onSaved, s, c }: any) {
  const cur: Partial<Breakdown> = p.breakdown || {};
  const pre = p.prefill || {};
  const init = (k: 'doors' | 'spoken' | 'pitched' | 'closed' | 'hit') => (cur[k] != null ? String(cur[k]) : pre[k] != null ? String(pre[k]) : '');
  const [vals, setVals] = useState({ doors: init('doors'), spoken: init('spoken'), pitched: init('pitched'), closed: init('closed'), hit: init('hit') });
  const [goal, setGoal] = useState(cur.goal != null ? String(cur.goal) : p.setup?.goal != null ? String(p.setup.goal) : '');
  const [note, setNote] = useState(cur.note || '');
  const [proud, setProud] = useState(cur.proud || '');
  const [change, setChange] = useState(cur.change || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!p.breakdown) setVals({ doors: init('doors'), spoken: init('spoken'), pitched: init('pitched'), closed: init('closed'), hit: init('hit') }); }, [p.prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const nums = p.breakdown ? [cur.doors, cur.spoken, cur.pitched, cur.closed].map((v) => (v == null ? '-' : v)).join('/') : '';
  const summary = p.breakdown ? `${nums} · goal ${cur.goal ?? '-'} hit ${cur.hit ?? '-'}` : (pre.doors != null ? `OwnerIQ: ${[pre.doors, pre.spoken, pre.pitched, pre.closed].join('/')} · ${pre.hit ?? 0} sign-ups` : 'Not done');

  const save = async () => {
    setBusy(true);
    try {
      await apiService.saveSectorDay(p.user_id, date, { breakdown: {
        doors: num(vals.doors), spoken: num(vals.spoken), pitched: num(vals.pitched), closed: num(vals.closed),
        hit: num(vals.hit), goal: num(goal), note, proud, change } });
      toast.success('Saved'); onSaved(); onToggle();
    } catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.card}>
      <Pressable onPress={onToggle} style={s.cardHead} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{p.user_name}</Text>
          <Text style={s.muted} numberOfLines={1}>{summary}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
      </Pressable>
      {open && (
        <View style={{ gap: 10 }}>
          <View style={s.numRow}>
            {(['doors', 'spoken', 'pitched', 'closed'] as const).map((k) => (
              <View key={k} style={s.numBox}>
                <Text style={s.tiny}>{k[0].toUpperCase() + k.slice(1)}</Text>
                <TextInput value={vals[k]} onChangeText={(v) => setVals({ ...vals, [k]: v })} keyboardType="number-pad" style={[s.input, s.numInput]} />
              </View>
            ))}
          </View>
          <TextInput value={note} onChangeText={setNote} placeholder="Note, e.g. phone died" placeholderTextColor={c.textMuted} style={s.input} />
          <View style={s.numRow}>
            <View style={s.numBox}>
              <Text style={s.tiny}>Goal</Text>
              <TextInput value={goal} onChangeText={setGoal} keyboardType="number-pad" style={[s.input, s.numInput]} />
            </View>
            <View style={s.numBox}>
              <Text style={s.tiny}>Hit</Text>
              <TextInput value={vals.hit} onChangeText={(v) => setVals({ ...vals, hit: v })} keyboardType="number-pad" style={[s.input, s.numInput]} />
            </View>
          </View>
          <Text style={s.label}>Proud of</Text>
          <Chips items={opts?.proud || []} value={proud} onPick={setProud} s={s} c={c} />
          <TextInput value={proud} onChangeText={setProud} placeholder="Or type it" placeholderTextColor={c.textMuted} style={s.input} />
          <Text style={s.label}>Change (becomes tomorrow's focus)</Text>
          <Chips items={opts?.change || []} value={change} onPick={setChange} s={s} c={c} />
          <TextInput value={change} onChangeText={setChange} placeholder="Or type it" placeholderTextColor={c.textMuted} style={s.input} />
          <Pressable onPress={save} disabled={busy} style={s.btn} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
            <Text style={s.btnText}>Save</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 10, width: '100%', maxWidth: 680, alignSelf: 'center' },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  tabOn: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.text },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  dateText: { fontFamily: fonts.bodySemibold, fontSize: 14.5, color: c.text },
  iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  card: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  tiny: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
  small: { width: 110 },
  numRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  numBox: { gap: 3, width: 72 },
  numInput: { textAlign: 'center', paddingHorizontal: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipHi: { borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.primary, backgroundColor: c.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary, alignSelf: 'flex-start' },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  preview: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: c.text },
});
