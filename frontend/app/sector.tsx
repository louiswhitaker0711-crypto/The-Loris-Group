// Sector set-up and breakdown, in the office's WhatsApp layout. Breakdown
// numbers are typed in here (sign-ups pre-fill from Bells); tomorrow's set-up is prompted from
// today's "Change". Share either to the group in one tap, and send each person
// their own set-up as a notification. (backend routes/sector.py)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { todayISO } from '../src/utils/calendarDates';
import { APP_LOCALE, APP_TZ } from '../src/utils/appTime';
import { openInWhatsApp, copyText } from '../src/utils/whatsapp';
import { SectorPicker } from '../src/components/sector/SectorPicker';
import { SectorMap } from '../src/components/sector/SectorMap';
import BreakdownPrimetime from '../src/components/sector/BreakdownPrimetime';

type Setup = { goal: number | null; kpi_metric: string | null; kpi_target: number | null; focus: string; positive?: string; cod_module_id?: string | null };
type CodItem = { id: string; stage: number; topic: string; category?: string };
type CodDay = { stages: number[]; pick: CodItem | null; observed: { by_name: string; date: string } | null };
type Breakdown = { doors: number | null; spoken: number | null; pitched: number | null; closed: number | null;
  note: string; goal: number | null; hit: number | null; proud: string; change: string;
  silver?: number | null; gold?: number | null; round?: number | null };
type Person = { user_id: string; user_name: string; setup: Setup | null; breakdown: Breakdown | null;
  prefill: Partial<Record<'doors' | 'spoken' | 'pitched' | 'closed' | 'hit' | 'silver' | 'gold' | 'round', number>>;
  yesterday: { change: string; proud: string; goal: number | null; kpi: { kpi_metric: string; kpi_target: number } | null };
  cod?: CodDay };
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
// The office does no breakdown on a Saturday (field 10:00–17:00, no Primetime after).
function isSaturday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}
const num = (v: string) => (v.trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0));

export default function SectorScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const params = useLocalSearchParams<{ mode?: string; start?: string; date?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'breakdown' ? 'breakdown' : 'setup');
  const today = todayISO();
  // Opened from a sector on the Sector tab: that day.
  const [date, setDate] = useState(params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['sector-day', date], queryFn: () => apiService.getSectorDay(date).then((r) => r.data) });
  const people: Person[] = q.data?.people || [];
  const opts = q.data?.options;
  const satNoBreakdown = mode === 'breakdown' && isSaturday(date);
  const text: string = satNoBreakdown ? '' : q.data?.whatsapp?.[mode] || '';
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
          ? 'Goal, KPI, focus and a positive for each person. Yesterday’s "Change" shows as a suggestion for the focus.'
          : 'Type in doors / spoken / pitched / closed (sign-ups fill in from Bells), then what they’re proud of and what they’ll change. These numbers feed the KPIs and Bells.'}
      </Text>

      {!!q.data?.sector?.planned_by && mode === 'setup' && (
        <View style={s.card}>
          <Text style={s.h}>🧭 Planned this morning</Text>
          <Text style={s.muted}>{q.data.sector.planned_by.split(' ')[0]} planned your sector{q.data.sector.postcode ? ` in ${q.data.sector.postcode}` : ''}. You can set the sector goal; ask the sector planner to change the postcode or who's in it.</Text>
        </View>
      )}

      {(!!q.data?.can_manage || params.start === '1') && !q.data?.sector?.planned_by && (
        <SectorPicker key={date + String(q.data?.sector?.member_ids?.length || 0)} date={date}
          current={q.data?.sector?.member_ids || null}
          startOpen={params.start === '1' || (!q.isLoading && !q.data?.sector && mode === 'setup')}
          onSaved={() => q.refetch()} />
      )}

      {!!q.data?.can_manage && !!q.data?.sector && mode === 'setup' && (
        <SectorGoal key={date + String(q.data.sector.goal ?? '') + (q.data.sector.postcode || '')} date={date}
          current={q.data.sector.goal ?? null} currentPostcode={q.data.sector.postcode || ''} planned={!!q.data.sector.planned_by}
          suggested={people.reduce((a, p) => a + (p.setup?.goal || 0), 0)} onSaved={() => q.refetch()} s={s} c={c} />
      )}

      {satNoBreakdown && (
        <View style={s.card}>
          <Text style={s.h}>No breakdown on a Saturday</Text>
          <Text style={s.muted}>Saturday's numbers still come in from Bells. Use the arrows for Friday's or Monday's breakdown.</Text>
        </View>
      )}

      {!!q.data?.can_manage && !!q.data?.sector && mode === 'breakdown' && !satNoBreakdown && (
        <View style={s.card}>
          <Text style={s.h}>🗺️ Today's map</Text>
          <Text style={s.muted}>Press Mark done and draw over the streets worked today in black, on top of the coloured areas. Remove anything that wasn't done, then Save the map: the black lines are kept and the coloured plan comes off.</Text>
          <SectorMap date={date} endOfDay />
        </View>
      )}

      {satNoBreakdown ? null : q.isLoading ? <ActivityIndicator color={c.primary} /> : people.map((p) => (
        mode === 'setup'
          ? <SetupCard key={p.user_id + date} p={p} date={date} opts={opts} codOptions={q.data?.cod_options || []} open={open === p.user_id}
              onToggle={() => setOpen(open === p.user_id ? null : p.user_id)} onSaved={() => q.refetch()} s={s} c={c} />
          : <BreakdownCard key={p.user_id + date} p={p} date={date} opts={opts} canMarkCod={!!q.data?.can_mark_cod} open={open === p.user_id}
              onToggle={() => setOpen(open === p.user_id ? null : p.user_id)} onSaved={() => q.refetch()} s={s} c={c} />
      ))}

      {mode === 'breakdown' && !satNoBreakdown && !!q.data?.sector && <BreakdownPrimetime date={date} />}

      {mode === 'breakdown' && !satNoBreakdown && !!q.data?.sector && (
        <PostBreakdown date={date} postedAt={q.data.sector.breakdown_posted_at || null}
          missing={people.filter((p) => !p.breakdown).map((p) => p.user_name.split(' ')[0])}
          onPosted={() => q.refetch()} s={s} c={c} />
      )}

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

// The end of the breakdown: post it. That marks it done and puts it on every
// Coach's Home under Today's sectors, the same as the set-up.
function PostBreakdown({ date, postedAt, missing, onPosted, s, c }: { date: string; postedAt: string | null; missing: string[]; onPosted: () => void; s: any; c: any }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const post = async () => {
    setBusy(true);
    try {
      await apiService.postBreakdown(date);
      toast.success('Breakdown posted');
      qc.invalidateQueries({ queryKey: ['sector-board'] });
      onPosted();
    } catch (e) { showAlert('Could not post', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };
  const go = () => missing.length
    ? showAlert('Post the breakdown?', `No breakdown yet for ${missing.join(', ')}. Post it anyway?`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Post', onPress: post }])
    : post();
  const when = postedAt ? new Date(postedAt).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: APP_TZ }) : null;
  return (
    <View style={s.card}>
      {when ? <Text style={s.muted}>✅ Posted at {when}. Changed something? Post it again.</Text>
        : <Text style={s.muted}>Done? Post it: it goes on every Coach's Home with today's set-ups.</Text>}
      <Pressable onPress={go} disabled={busy} style={[s.btn, { alignSelf: 'stretch', justifyContent: 'center' }]} accessibilityRole="button" testID="breakdown-post">
        {busy ? <ActivityIndicator color={c.onPrimary} /> : <Ionicons name="checkmark-done" size={17} color={c.onPrimary} />}
        <Text style={s.btnText}>{when ? 'Post again' : 'Post breakdown'}</Text>
      </Pressable>
    </View>
  );
}

function SectorGoal({ date, current, currentPostcode, planned, suggested, onSaved, s, c }: { date: string; current: number | null; currentPostcode: string; planned?: boolean; suggested: number; onSaved: () => void; s: any; c: any }) {
  const [goal, setGoal] = useState(current != null ? String(current) : '');
  const [postcode, setPostcode] = useState(currentPostcode);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await apiService.saveSectorGoal(date, num(goal), postcode);
      toast.success('Sector saved'); onSaved();
    } catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={s.card}>
      <Text style={s.h}>📍 Your sector today</Text>
      <Text style={s.label}>Postcode</Text>
      {planned
        ? <Text style={s.h}>{currentPostcode || 'No postcode yet'}</Text>
        : <TextInput value={postcode} onChangeText={(v) => setPostcode(v.toUpperCase())} autoCapitalize="characters" maxLength={10}
            placeholder="LS6 1AB" placeholderTextColor={c.textMuted} style={[s.input, { width: 160 }]} accessibilityLabel="Postcode" />}
      {!planned && <AreaCheck postcode={postcode} s={s} c={c} />}
      {currentPostcode
        ? <SectorMap key={currentPostcode} date={date} />
        : <Text style={s.muted}>Save the postcode to open the sector map.</Text>}
      <Text style={s.label}>Sector goal</Text>
      <Text style={s.muted}>Sign-ups for the whole sector. You get updates against it through the field.</Text>
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

// What the office's door logs say about the postcode being typed: when it
// was last worked and how it went, or that it's new ground.
function AreaCheck({ postcode, s, c }: { postcode: string; s: any; c: any }) {
  const router = useRouter();
  const [pc, setPc] = useState(postcode.trim());
  useEffect(() => { const t = setTimeout(() => setPc(postcode.trim()), 500); return () => clearTimeout(t); }, [postcode]);
  const q = useQuery({
    queryKey: ['area-lookup', pc], enabled: pc.replace(/\s+/g, '').length >= 2, retry: false,
    queryFn: () => apiService.lookupArea(pc).then((r) => r.data),
  });
  const tq = useQuery({
    queryKey: ['territory-check', pc], enabled: pc.replace(/\s+/g, '').length >= 5, retry: false,
    queryFn: () => apiService.territoryCheck(pc).then((r) => r.data),
  });
  const t0 = tq.data;
  const terr = !t0?.loaded ? null : t0.found ? (
    <Text style={[s.muted, t0.kind === 'not_active' && { color: c.red }]}>
      📍 {t0.code} · {t0.label}{t0.households ? ` · ${Number(t0.households).toLocaleString(APP_LOCALE)} households` : ''}{t0.weeks_since != null ? ` · Acwyre: last worked ${t0.weeks_since} weeks ago` : ''}
    </Text>
  ) : <Text style={[s.muted, { color: c.red }]}>📍 {t0.code} isn't on the territory map.</Text>;
  const d = q.data;
  if (!d?.district) return terr;
  const t = d.district_total;
  if (!t) return <>{terr}<Text style={s.muted}>🌱 New ground: nobody from the office has knocked {d.district} in the last 6 months.</Text></>;
  const since = (n: number | null) => (n == null ? '' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
  return (
    <>
    {terr}
    <Pressable onPress={() => router.push(`/area?d=${encodeURIComponent(d.district)}` as never)} style={s.hint} accessibilityRole="button">
      <Ionicons name="map-outline" size={15} color={c.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.ghostText}>
          {d.district} last worked {since(t.days_since)} · {t.per_100 ?? '–'} sign-ups per 100 doors · PA {t.pa ?? '–'}
        </Text>
        {!!d.sector && (
          <Text style={s.muted}>{d.sector.key}: {since(d.sector.days_since)} · {d.sector.doors} doors · {d.sector.sales} sign-ups</Text>
        )}
        <Text style={s.muted}>See the streets and past visits</Text>
      </View>
    </Pressable>
    </>
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

/** "16 Oct" for a YYYY-MM-DD date. */
const shortDate = (iso?: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
};

/** Today's COD item: one item from their own stage or below (Stage 1-2 only). */
function CodPicker({ stages, options, value, onPick, s, c }: { stages: number[]; options: CodItem[]; value: string; onPick: (id: string) => void; s: any; c: any }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const mine = options.filter((o) => stages.includes(o.stage));
  const picked = mine.find((o) => o.id === value);
  const shown = mine.filter((o) => o.topic.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOpen(!open)} style={[s.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]} accessibilityRole="button" testID="setup-cod-pick">
        <Ionicons name="school-outline" size={16} color={c.primary} />
        <Text style={[s.ghostText, { flex: 1, color: picked ? c.text : c.textMuted }]} numberOfLines={2}>
          {picked ? `Stage ${picked.stage} · ${picked.topic}` : 'Pick one thing to learn today'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
      </Pressable>
      {open && (
        <View style={{ gap: 4 }}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search the COD" placeholderTextColor={c.textMuted} style={s.input} />
          {!!value && (
            <Pressable onPress={() => { onPick(''); setOpen(false); }} style={{ paddingVertical: 6 }} accessibilityRole="button">
              <Text style={[s.muted, { color: c.red }]}>Clear (nothing from the COD today)</Text>
            </Pressable>
          )}
          {shown.map((o) => (
            <Pressable key={o.id} onPress={() => { onPick(o.id); setOpen(false); }} style={{ paddingVertical: 6, flexDirection: 'row', gap: 8, alignItems: 'center' }} accessibilityRole="button">
              <Ionicons name={o.id === value ? 'radio-button-on' : 'radio-button-off'} size={16} color={o.id === value ? c.primary : c.textMuted} />
              <Text style={[s.ghostText, { flex: 1, color: c.text }]}>{`${o.stage} · ${o.topic}`}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function SetupCard({ p, date, opts, codOptions, open, onToggle, onSaved, s, c }: any) {
  const cur: Setup = p.setup || { goal: null, kpi_metric: null, kpi_target: null, focus: '' };
  const [cod, setCod] = useState<string>(cur.cod_module_id || '');
  const canPickCod = (p.cod?.stages || []).length > 0;
  const [goal, setGoal] = useState(cur.goal != null ? String(cur.goal) : '');
  const [metric, setMetric] = useState<string>(cur.kpi_metric || '');
  const [target, setTarget] = useState(cur.kpi_target != null ? String(cur.kpi_target) : '');
  const [focus, setFocus] = useState(cur.focus || '');
  const [positive, setPositive] = useState(cur.positive || '');
  const [busy, setBusy] = useState(false);
  const y = p.yesterday || {};
  const metrics: Array<{ key: string; label: string; loa: number | null }> = opts?.kpi_metrics || [];
  const summary = p.setup ? [cur.goal != null ? `Goal ${cur.goal}` : '', cur.kpi_metric ? `${cur.kpi_target ?? ''} ${metrics.find((m) => m.key === cur.kpi_metric)?.label || ''}`.trim() : '', cur.focus,
    p.cod?.pick ? `COD: ${p.cod.pick.topic}` : ''].filter(Boolean).join(' · ') : 'Not set';

  // Yesterday's goal and suggested KPI. Yesterday's "Change" is only offered
  // as a suggestion for the focus, never filled in for them.
  const useYesterday = () => {
    if (y.goal != null) setGoal(String(y.goal));
    if (y.kpi) { setMetric(y.kpi.kpi_metric); setTarget(String(y.kpi.kpi_target)); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await apiService.saveSectorDay(p.user_id, date, { setup: { goal: num(goal), kpi_metric: metric || null, kpi_target: num(target), focus, positive,
        cod_module_id: canPickCod ? (cod || null) : (cur.cod_module_id || null) } });
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
          {(y.goal != null || y.kpi) && (
            <Pressable onPress={useYesterday} style={s.hint} accessibilityRole="button">
              <Ionicons name="arrow-undo-outline" size={15} color={c.primary} />
              <Text style={[s.ghostText, { flex: 1 }]}>
                {[y.goal != null && `Yesterday's goal ${y.goal}`, y.kpi && `suggested KPI ${y.kpi.kpi_target} ${metrics.find((m) => m.key === y.kpi.kpi_metric)?.label}`].filter(Boolean).join(' · ')} — tap to use
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
          {!!y.change && y.change !== focus && (
            <Pressable onPress={() => setFocus(y.change)} style={s.hint} accessibilityRole="button">
              <Ionicons name="bulb-outline" size={15} color={c.primary} />
              <Text style={[s.ghostText, { flex: 1 }]}>Suggestion: yesterday they said they'd change "{y.change}". Tap to make it today's focus, or pick something else.</Text>
            </Pressable>
          )}
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
          {canPickCod && (
            <>
              <Text style={s.label}>Learning from the COD</Text>
              <Text style={s.muted}>One thing to learn today, from their stage or below. At the breakdown the sector leader or a Coach can mark that they saw it done.</Text>
              <CodPicker stages={p.cod.stages} options={codOptions || []} value={cod} onPick={setCod} s={s} c={c} />
            </>
          )}
          <Pressable onPress={save} disabled={busy} style={s.btn} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
            <Text style={s.btnText}>Save</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** At the breakdown: was today's COD item seen in the field? */
function CodObserved({ p, date, canMark, onSaved, s, c }: any) {
  const [busy, setBusy] = useState(false);
  const pick: CodItem | null = p.cod?.pick || null;
  if (!pick) return null;
  const seen = p.cod?.observed;
  const toggle = async () => {
    setBusy(true);
    try { await apiService.markCodObserved(p.user_id, date, !seen); onSaved(); }
    catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={[s.hint, { alignItems: 'flex-start' }]}>
      <Ionicons name={seen ? 'checkmark-circle' : 'school-outline'} size={16} color={seen ? c.green : c.primary} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[s.ghostText, { color: c.text }]}>Today's COD: {pick.topic}</Text>
        <Text style={s.muted}>{seen ? `Seen in the field by ${seen.by_name} · ${shortDate(seen.date)}` : canMark ? 'Did you see them do it?' : 'The sector leader or a Coach marks this.'}</Text>
        {canMark && (
          <Pressable onPress={toggle} disabled={busy} style={[s.chip, seen ? null : s.chipOn, { alignSelf: 'flex-start' }]} accessibilityRole="button" testID="bd-cod-observed">
            {busy ? <ActivityIndicator size="small" color={seen ? c.primary : c.onPrimary} />
              : <Text style={[s.chipText, !seen && { color: c.onPrimary }]}>{seen ? 'Undo' : 'Seen doing it'}</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function BreakdownCard({ p, date, opts, canMarkCod, open, onToggle, onSaved, s, c }: any) {
  const cur: Partial<Breakdown> = p.breakdown || {};
  const pre = p.prefill || {};
  type K = 'doors' | 'spoken' | 'pitched' | 'closed' | 'hit' | 'silver' | 'gold' | 'round';
  const init = (k: K) => (cur[k] != null ? String(cur[k]) : pre[k] != null ? String(pre[k]) : '');
  const fresh = () => ({ doors: init('doors'), spoken: init('spoken'), pitched: init('pitched'), closed: init('closed'), hit: init('hit'),
    silver: init('silver'), gold: init('gold'), round: init('round') });
  const [vals, setVals] = useState(fresh);
  const [goal, setGoal] = useState(cur.goal != null ? String(cur.goal) : p.setup?.goal != null ? String(p.setup.goal) : '');
  const [note, setNote] = useState(cur.note || '');
  const [proud, setProud] = useState(cur.proud || '');
  const [change, setChange] = useState(cur.change || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!p.breakdown) setVals(fresh()); }, [p.prefill]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sign-ups are Silver + Gold once either is typed.
  const split = vals.silver !== '' || vals.gold !== '';
  const signups = split ? (num(vals.silver) || 0) + (num(vals.gold) || 0) : num(vals.hit);

  const nums = p.breakdown ? [cur.doors, cur.spoken, cur.pitched, cur.closed].map((v) => (v == null ? '-' : v)).join('/') : '';
  const tiers = p.breakdown && (cur.silver != null || cur.gold != null) ? ` (🥈${cur.silver ?? 0} 🥇${cur.gold ?? 0} ⭕️${cur.round ?? 0})` : '';
  const summary = p.breakdown ? `${nums} · goal ${cur.goal ?? '-'} hit ${cur.hit ?? '-'}${tiers}` : (pre.doors != null ? `Field IQ: ${[pre.doors, pre.spoken, pre.pitched, pre.closed].join('/')} · ${pre.hit ?? 0} sign-ups` : 'Not done');

  const save = async () => {
    setBusy(true);
    try {
      await apiService.saveSectorDay(p.user_id, date, { breakdown: {
        doors: num(vals.doors), spoken: num(vals.spoken), pitched: num(vals.pitched), closed: num(vals.closed),
        hit: signups, silver: num(vals.silver), gold: num(vals.gold), round: num(vals.round), goal: num(goal), note, proud, change } });
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
          <CodObserved p={p} date={date} canMark={canMarkCod} onSaved={onSaved} s={s} c={c} />
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
            {([['silver', '🥈 Silver'], ['gold', '🥇 Gold'], ['round', '⭕️ Round']] as const).map(([k, label]) => (
              <View key={k} style={s.numBox}>
                <Text style={s.tiny}>{label}</Text>
                <TextInput value={vals[k]} onChangeText={(v) => setVals({ ...vals, [k]: v })} keyboardType="number-pad" style={[s.input, s.numInput]}
                  accessibilityLabel={label} testID={`bd-${k}`} />
              </View>
            ))}
          </View>
          <Text style={s.muted}>
            {split ? `Hit ${signups ?? 0} (Silver + Gold). ` : ''}Copy your numbers from Field IQ: Silver £5–£9.99, Gold £10+, and how many took The Round.
          </Text>
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
