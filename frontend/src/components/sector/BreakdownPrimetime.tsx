// The Primetime plan, planned at the sector breakdown (tomorrow's, for the
// sector) and when the sectors are planned in the morning (today's, for
// everyone in). At the top: what's running and who's in it. Then one line per
// person with two dropdowns (29 Oct 2026): what they're doing (run an impact,
// join one someone's running, learning, watching, or "free to work with") and,
// for running or learning, the topic. The lists open over the page so nothing
// moves under your finger; each pick saves straight away.
// (GET/PUT /primetime/sector?scope=breakdown|morning; the rows are the office
// Primetime plan's own, so Home and the weekly planner show the same thing)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService, PrimetimeMode } from '../../api/client';
import { showAlert } from '../../utils/showAlert';

type Choice = 'run' | 'join' | 'learning' | 'watching' | 'free';

type Session = { session_id: string; host_name: string; host_user_id: string; topic: string;
  attendees: { user_id: string; name: string; mode: string }[]; mine?: boolean };

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

function choiceOf(p: any): Choice | null {
  if (!p.mode) return null;
  if (p.mode === 'teaching') return 'run';
  if (p.mode === 'learning' && p.session_id) return 'join';
  return p.mode as Choice;
}

export default function BreakdownPrimetime({ date, scope = 'breakdown' }: { date: string; scope?: 'breakdown' | 'morning' }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sector-primetime', date, scope],
    queryFn: () => apiService.getSectorPrimetime(date, scope).then((r) => r.data),
    retry: false,
  });
  // The office's impact topics (the COD list), to tap instead of typing.
  const topics = useQuery({
    queryKey: ['coaching-impacts'],
    queryFn: () => apiService.coachingImpacts().then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const topicTitles: string[] = useMemo(() => {
    const g: Record<string, any[]> = topics.data?.grouped || {};
    const all = Object.values(g).flat().map((t: any) => String(t?.title || '').trim()).filter(Boolean);
    return Array.from(new Set(all));
  }, [topics.data]);

  const d = q.data;
  if (q.isLoading) return <View style={s.card}><ActivityIndicator color={c.primary} /></View>;
  if (!d?.people?.length) return null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sector-primetime'] });
    qc.invalidateQueries({ queryKey: ['primetime-home'] });
    qc.invalidateQueries({ queryKey: ['sector-day'] });   // the WhatsApp breakdown carries the plan
  };
  const sessions: Session[] = d.sessions || [];
  const people: any[] = d.people;
  const mine = sessions.filter((x) => x.mine);
  const inSession = new Set<string>(mine.flatMap((x) => [x.host_user_id, ...x.attendees.map((a) => a.user_id)]));
  const solo = people.filter((p) => p.mode && p.mode !== 'free' && !inSession.has(p.user_id));
  const free = people.filter((p) => p.mode === 'free');
  const unplanned = people.filter((p) => !p.mode);
  const when = d.is_today ? 'today' : d.day_name;
  const who = (p: any) => (p.is_self ? 'You' : first(p.name));

  return (
    <View style={s.card} testID="breakdown-primetime">
      <Text style={s.h}>⚡ Primetime plan · {d.day_name}{d.is_today ? ' (today)' : ''}</Text>
      <Text style={s.muted}>
        {d.leads
          ? scope === 'morning' ? `Plan ${when}'s Primetime for everyone in.` : `Plan ${when}'s Primetime for everyone in the sector.`
          : `Plan your Primetime for ${when}.`}
      </Text>

      {/* The plan so far, by impact. */}
      <View style={s.summary}>
        {mine.map((x) => (
          <View key={x.session_id} style={s.sumRow}>
            <Ionicons name="megaphone" size={14} color={c.primary} />
            <Text style={s.sumText}>
              <Text style={s.bold}>{first(x.host_name)}</Text> running {x.topic || 'an impact'}
              {x.attendees.length ? ` · ${x.attendees.map((a) => first(a.name)).join(', ')}` : ' · nobody in yet'}
            </Text>
          </View>
        ))}
        {solo.map((p) => (
          <View key={p.user_id} style={s.sumRow}>
            <Ionicons name={p.mode === 'watching' ? 'eye' : 'school'} size={14} color={c.textMuted} />
            <Text style={s.sumText}>
              <Text style={s.bold}>{who(p)}</Text> {p.mode}{p.topic ? ` ${p.topic}` : ''}
              {p.with_label ? ` · with ${p.with_label}` : ''}
            </Text>
          </View>
        ))}
        {free.length > 0 && (
          <View style={s.sumRow}>
            <Ionicons name="hand-left" size={14} color={c.textMuted} />
            <Text style={s.sumText}><Text style={s.bold}>Free to work with:</Text> {free.map(who).join(', ')}</Text>
          </View>
        )}
        {unplanned.length > 0 && <Text style={s.unsetLine}>Not planned yet: {unplanned.map(who).join(', ')}</Text>}
      </View>

      {people.map((p: any) => (
        <PersonRow key={p.user_id} p={p} date={date} scope={scope}
          sessions={sessions} topicTitles={topicTitles} onSaved={refresh} s={s} c={c} />
      ))}
    </View>
  );
}

/** One line per person (the Owner, 29 Oct 2026: no boxes opening under your
 * finger): their name, "What are they doing?" and, for running or learning,
 * the topic. Each is a dropdown that opens over the page; picking saves
 * straight away and the line updates at once. */
function PersonRow({ p, date, scope, sessions, topicTitles, onSaved, s, c }: any) {
  const [choice, setChoice] = useState<Choice | null>(choiceOf(p));
  const [sessionId, setSessionId] = useState<string>(p.session_id || '');
  const [topic, setTopic] = useState<string>(p.mode === 'teaching' || (p.mode === 'learning' && !p.session_id) ? p.topic || '' : '');
  const [open, setOpen] = useState<null | 'mode' | 'topic'>(null);
  const [busy, setBusy] = useState(false);
  const save = async (m: PrimetimeMode | null, t: string, sid?: string) => {
    setBusy(true);
    try {
      await apiService.saveSectorPrimetime({ date, scope, user_id: p.user_id, mode: m, topic: t, session_id: sid });
      onSaved();
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(false); }
  };
  const joinable = (sessions as Session[]).filter((x) => x.host_user_id !== p.user_id);
  const modeOptions: { key: string; label: string; icon: any }[] = [
    { key: 'none', label: 'Not planned', icon: 'remove-circle-outline' },
    { key: 'run', label: 'Running an impact', icon: 'megaphone-outline' },
    ...joinable.map((x) => ({ key: `join:${x.session_id}`, label: `Joining ${first(x.host_name)}’s ${x.topic || 'impact'}${x.attendees.length ? ` (${x.attendees.length})` : ''}`, icon: 'people-outline' })),
    { key: 'learning', label: 'Learning', icon: 'school-outline' },
    { key: 'watching', label: 'Watching', icon: 'eye-outline' },
    { key: 'free', label: 'Free to work with', icon: 'hand-left-outline' },
  ];
  const modeKey = choice === 'join' ? `join:${sessionId}` : choice || 'none';
  const modeLabel = modeOptions.find((o) => o.key === modeKey)?.label || (choice === 'join' ? 'Joining an impact' : 'Not planned');
  const pickMode = (key: string) => {
    setOpen(null);
    if (key === 'none') { setChoice(null); save(null, ''); return; }
    if (key.startsWith('join:')) { const sid = key.slice(5); setChoice('join'); setSessionId(sid); save('learning', '', sid); return; }
    const k = key as Choice;
    setChoice(k);
    if (k === 'watching' || k === 'free') save(k, '');
    else if (topic.trim()) save(k === 'run' ? 'teaching' : 'learning', topic.trim());
    else setOpen('topic');          // running or learning: straight on to the topic
  };
  const pickTopic = (t: string) => {
    const v = t.trim();
    setOpen(null);
    if (!v) return;
    setTopic(v);
    save(choice === 'run' ? 'teaching' : 'learning', v);
  };
  const needsTopic = choice === 'run' || choice === 'learning';
  return (
    <View style={s.person}>
      <Text style={s.name} numberOfLines={1}>{p.is_self ? 'You' : first(p.name)}</Text>
      <View style={s.pickRow}>
        <Pressable onPress={() => setOpen('mode')} style={[s.drop, !choice && s.dropEmpty]} accessibilityRole="button" testID={`pt-mode-${p.user_id}`}>
          <Text style={[s.dropText, !choice && { color: c.yellow }]} numberOfLines={1}>{modeLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={c.textMuted} />
        </Pressable>
        {needsTopic && (
          <Pressable onPress={() => setOpen('topic')} style={[s.drop, !topic && s.dropEmpty]} accessibilityRole="button" testID={`pt-topic-${p.user_id}`}>
            <Text style={[s.dropText, !topic && { color: c.yellow }]} numberOfLines={1}>{topic || 'Pick a topic'}</Text>
            <Ionicons name="chevron-down" size={14} color={c.textMuted} />
          </Pressable>
        )}
        <View style={{ width: 18, alignItems: 'center' }}>{busy ? <ActivityIndicator size="small" color={c.primary} /> : null}</View>
      </View>
      {!!p.set_by && <Text style={s.small}>Set by {p.set_by}</Text>}
      <Sheet visible={open === 'mode'} title={`${p.is_self ? 'You' : first(p.name)}: what are they doing?`} onClose={() => setOpen(null)} s={s} c={c}>
        {modeOptions.map((o) => (
          <Pressable key={o.key} onPress={() => pickMode(o.key)} style={[s.opt, o.key === modeKey && s.optOn]} accessibilityRole="button">
            <Ionicons name={o.icon} size={17} color={o.key === modeKey ? c.primary : c.textMuted} />
            <Text style={[s.optText, o.key === modeKey && { color: c.primary }]}>{o.label}</Text>
            {o.key === modeKey && <Ionicons name="checkmark" size={17} color={c.primary} />}
          </Pressable>
        ))}
      </Sheet>
      <TopicSheet visible={open === 'topic'} title={choice === 'run' ? 'Running what?' : 'Learning what?'} current={topic}
        topics={topicTitles} onPick={pickTopic} onClose={() => setOpen(null)} s={s} c={c} />
    </View>
  );
}

/** A list that opens over the page, so nothing underneath moves. */
function Sheet({ visible, title, onClose, children, s, c }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle} numberOfLines={2}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={c.textMuted} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TopicSheet({ visible, title, current, topics, onPick, onClose, s, c }: any) {
  const [q, setQ] = useState('');
  const shown = (topics as string[]).filter((t) => t.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80);
  return (
    <Sheet visible={visible} title={title} onClose={() => { setQ(''); onClose(); }} s={s} c={c}>
      <TextInput value={q} onChangeText={setQ} placeholder="Search, or type your own" placeholderTextColor={c.textMuted}
        style={s.input} autoFocus={false} returnKeyType="done" onSubmitEditing={() => { if (q.trim()) { onPick(q); setQ(''); } }} />
      {!!q.trim() && !topics.some((t: string) => t.toLowerCase() === q.trim().toLowerCase()) && (
        <Pressable onPress={() => { onPick(q); setQ(''); }} style={s.opt} accessibilityRole="button">
          <Ionicons name="create-outline" size={17} color={c.primary} />
          <Text style={[s.optText, { color: c.primary }]}>Use “{q.trim()}”</Text>
        </Pressable>
      )}
      {shown.map((t: string) => (
        <Pressable key={t} onPress={() => { onPick(t); setQ(''); }} style={[s.opt, t === current && s.optOn]} accessibilityRole="button">
          <Ionicons name="book-outline" size={17} color={t === current ? c.primary : c.textMuted} />
          <Text style={[s.optText, t === current && { color: c.primary }]}>{t}</Text>
          {t === current && <Ionicons name="checkmark" size={17} color={c.primary} />}
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 12 },
  h: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  bold: { fontFamily: fonts.bodyBold, color: c.text },
  summary: { gap: 6, padding: 10, borderRadius: 12, backgroundColor: c.surface },
  sumRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  sumText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.text },
  unsetLine: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.yellow },
  person: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.text },
  state: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary, textAlign: 'right' },
  unset: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: c.yellow, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  topicRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.background },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: c.onPrimary },
  join: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.primary, maxWidth: 240 },
  joinOn: { backgroundColor: c.primary },
  joinText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  more: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 2 },
  moreText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  topicChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, maxWidth: 260 },
  topicChipText: { fontFamily: fonts.body, fontSize: 12.5, color: c.text },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drop: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: c.surface },
  dropEmpty: { borderColor: c.yellow, borderStyle: 'dashed' },
  dropText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 560, backgroundColor: c.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28, gap: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  sheetTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  optOn: { backgroundColor: c.primary + '10' },
  optText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
});
