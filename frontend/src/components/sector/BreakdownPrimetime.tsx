// The Primetime plan, planned at the sector breakdown (tomorrow's, for the
// sector) and when the sectors are planned in the morning (today's, for
// everyone in). At the top: what's running and who's in it. Then each person:
// run an impact, join one someone's running, learning, watching, or "free to
// work with", which puts them on Home's Primetime card for any Coach to put
// into something. Saves as each choice is made.
// (GET/PUT /primetime/sector?scope=breakdown|morning; the rows are the office
// Primetime plan's own, so Home and the weekly planner show the same thing)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService, PrimetimeMode } from '../../api/client';
import { showAlert } from '../../utils/showAlert';

type Choice = 'run' | 'join' | 'learning' | 'watching' | 'free';
const CHOICES: { key: Choice; label: string; icon: any }[] = [
  { key: 'run', label: 'Run an impact', icon: 'megaphone-outline' },
  { key: 'join', label: 'Join an impact', icon: 'people-outline' },
  { key: 'learning', label: 'Learning', icon: 'school-outline' },
  { key: 'watching', label: 'Watching', icon: 'eye-outline' },
  { key: 'free', label: 'Free to work with', icon: 'hand-left-outline' },
];

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
        <PersonRow key={p.user_id + (p.mode || '') + p.topic + p.session_id} p={p} date={date} scope={scope}
          sessions={sessions} topicTitles={topicTitles} onSaved={refresh} s={s} c={c} />
      ))}
    </View>
  );
}

function PersonRow({ p, date, scope, sessions, topicTitles, onSaved, s, c }: any) {
  const [choice, setChoice] = useState<Choice | null>(choiceOf(p));
  const [topic, setTopic] = useState<string>(p.mode === 'teaching' || (p.mode === 'learning' && !p.session_id) ? p.topic || '' : '');
  const [showTopics, setShowTopics] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (m: PrimetimeMode | null, t: string, sessionId?: string) => {
    setBusy(true);
    try {
      await apiService.saveSectorPrimetime({ date, scope, user_id: p.user_id, mode: m, topic: t, session_id: sessionId });
      onSaved();
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(false); }
  };
  const pick = (k: Choice) => {
    const next = choice === k ? null : k;
    setChoice(next);
    setShowTopics(false);
    // Watching and free save straight away; running and learning wait for a
    // topic; joining waits for which impact.
    if (next === null) save(null, '');
    else if (next === 'watching' || next === 'free') save(next, '');
    else if ((next === 'run' || next === 'learning') && topic.trim()) save(next === 'run' ? 'teaching' : 'learning', topic.trim());
  };
  const saveTopic = (t: string) => {
    const v = t.trim();
    if (!v) return showAlert('Topic', 'Pick or type what it’s on first.');
    setTopic(v);
    setShowTopics(false);
    save(choice === 'run' ? 'teaching' : 'learning', v);
  };
  const joinable = (sessions as Session[]).filter((x) => x.host_user_id !== p.user_id);
  const state = p.mode === 'free' ? 'Free to work with'
    : p.mode === 'teaching' ? `Running ${p.topic || 'an impact'}`
    : p.mode === 'learning' && p.session_id ? `In ${p.with_label ? first(p.with_label) + '’s ' : ''}${p.topic || 'impact'}`
    : p.mode ? `${p.mode[0].toUpperCase()}${p.mode.slice(1)}${p.topic ? `: ${p.topic}` : ''}` : '';
  return (
    <View style={s.person}>
      <View style={s.headRow}>
        <Text style={s.name}>{p.is_self ? 'You' : first(p.name)}</Text>
        {busy ? <ActivityIndicator size="small" color={c.primary} />
          : state ? <Text style={s.state} numberOfLines={1}>{state}</Text>
          : <Text style={s.unset}>Not planned</Text>}
      </View>
      <View style={s.chips}>
        {CHOICES.map((m) => {
          if (m.key === 'join' && joinable.length === 0) return null;
          const on = choice === m.key;
          return (
            <Pressable key={m.key} onPress={() => pick(m.key)} disabled={busy}
              style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Ionicons name={m.icon} size={13} color={on ? c.onPrimary : c.text} />
              <Text style={[s.chipText, on && { color: c.onPrimary }]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {choice === 'join' && (
        <View style={s.chips}>
          {joinable.map((x: Session) => {
            const on = p.session_id === x.session_id;
            return (
              <Pressable key={x.session_id} onPress={() => save('learning', '', x.session_id)} disabled={busy}
                style={[s.join, on && s.joinOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[s.joinText, on && { color: c.onPrimary }]} numberOfLines={1}>
                  {x.topic || 'Impact'} · {first(x.host_name)}{x.attendees.length ? ` (${x.attendees.length})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {(choice === 'run' || choice === 'learning') && (
        <>
          <View style={s.topicRow}>
            <TextInput value={topic} onChangeText={setTopic} placeholder={choice === 'run' ? 'Running what? e.g. Closing' : 'Learning what? e.g. Order value'}
              placeholderTextColor={c.textMuted} style={s.input} onSubmitEditing={() => saveTopic(topic)} returnKeyType="done" />
            <Pressable onPress={() => saveTopic(topic)} style={s.btn} accessibilityRole="button">
              <Text style={s.btnText}>Save</Text>
            </Pressable>
          </View>
          {topicTitles.length > 0 && (
            <Pressable onPress={() => setShowTopics(!showTopics)} style={s.more} accessibilityRole="button">
              <Ionicons name={showTopics ? 'chevron-up' : 'list-outline'} size={14} color={c.primary} />
              <Text style={s.moreText}>{showTopics ? 'Hide topics' : 'Pick a COD topic'}</Text>
            </Pressable>
          )}
          {showTopics && (
            <View style={s.chips}>
              {topicTitles.map((t: string) => (
                <Pressable key={t} onPress={() => saveTopic(t)} disabled={busy} style={s.topicChip} accessibilityRole="button">
                  <Text style={s.topicChipText} numberOfLines={1}>{t}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
      {!!p.set_by && <Text style={s.small}>Set by {p.set_by}</Text>}
    </View>
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
});
