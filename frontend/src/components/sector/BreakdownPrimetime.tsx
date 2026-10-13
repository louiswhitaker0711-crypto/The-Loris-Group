// Tomorrow's Primetime, planned at the sector breakdown. The sector leader
// goes round everyone in the sector (a BA sees just themselves): learning or
// teaching a topic, joining a session someone's already running, watching,
// or "free to work with", which puts them on Home's Primetime card for any
// Coach to put into something. Saves as each choice is made.
// (GET/PUT /primetime/sector; the rows are the office Primetime plan's own)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService, PrimetimeMode } from '../../api/client';
import { showAlert } from '../../utils/showAlert';

const MODES: { key: PrimetimeMode; label: string; icon: any }[] = [
  { key: 'learning', label: 'Learning', icon: 'school-outline' },
  { key: 'teaching', label: 'Teaching', icon: 'megaphone-outline' },
  { key: 'watching', label: 'Watching', icon: 'eye-outline' },
  { key: 'free', label: 'Free to work with', icon: 'hand-left-outline' },
];

export default function BreakdownPrimetime({ date }: { date: string }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sector-primetime', date],
    queryFn: () => apiService.getSectorPrimetime(date).then((r) => r.data),
    retry: false,
  });
  const d = q.data;
  if (q.isLoading) return <View style={s.card}><ActivityIndicator color={c.primary} /></View>;
  if (!d?.people?.length) return null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sector-primetime', date] });
    qc.invalidateQueries({ queryKey: ['primetime-home'] });
  };
  return (
    <View style={s.card} testID="breakdown-primetime">
      <Text style={s.h}>⚡ Primetime {d.day_name}</Text>
      <Text style={s.muted}>
        {d.leads ? 'Plan tomorrow’s Primetime for everyone in the sector.' : 'Plan your Primetime for tomorrow.'}
        {' '}Free to work with means a Coach can put them into something.
      </Text>
      {d.people.map((p: any) => (
        <PersonRow key={p.user_id + (p.mode || '') + p.topic + p.session_id} p={p} date={date} sessions={d.sessions || []} onSaved={refresh} s={s} c={c} />
      ))}
    </View>
  );
}

function PersonRow({ p, date, sessions, onSaved, s, c }: any) {
  const [mode, setMode] = useState<PrimetimeMode | null>(p.mode || null);
  const [topic, setTopic] = useState<string>(p.topic || '');
  const [busy, setBusy] = useState(false);
  const save = async (m: PrimetimeMode | null, t: string, sessionId?: string) => {
    setBusy(true);
    try {
      await apiService.saveSectorPrimetime({ date, user_id: p.user_id, mode: m, topic: t, session_id: sessionId });
      onSaved();
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(false); }
  };
  const pick = (m: PrimetimeMode) => {
    const next = mode === m ? null : m;
    setMode(next);
    // Watching and free save straight away; learning and teaching wait for a topic.
    if (next === null || next === 'watching' || next === 'free' || topic.trim()) save(next, topic.trim());
  };
  const others = sessions.filter((x: any) => x.session_id !== p.session_id && x.host_name !== p.name);
  const first = (p.name || '').split(' ')[0];
  return (
    <View style={s.person}>
      <View style={s.headRow}>
        <Text style={s.name}>{p.is_self ? 'You' : first}</Text>
        {busy ? <ActivityIndicator size="small" color={c.primary} /> : p.mode ? (
          <Text style={s.state} numberOfLines={1}>
            {p.mode === 'free' ? 'Free to work with' : `${p.mode[0].toUpperCase()}${p.mode.slice(1)}${p.topic ? `: ${p.topic}` : ''}`}
            {p.with_label ? ` · ${p.mode === 'teaching' ? 'to' : 'with'} ${p.with_label}` : ''}
          </Text>
        ) : <Text style={s.unset}>Not planned</Text>}
      </View>
      <View style={s.chips}>
        {MODES.map((m) => (
          <Pressable key={m.key} onPress={() => pick(m.key)} disabled={busy}
            style={[s.chip, mode === m.key && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: mode === m.key }}>
            <Ionicons name={m.icon} size={13} color={mode === m.key ? c.onPrimary : c.text} />
            <Text style={[s.chipText, mode === m.key && { color: c.onPrimary }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      {(mode === 'learning' || mode === 'teaching') && (
        <View style={s.topicRow}>
          <TextInput value={topic} onChangeText={setTopic} placeholder={mode === 'teaching' ? 'Teaching what? e.g. Closing' : 'Learning what? e.g. Order value'}
            placeholderTextColor={c.textMuted} style={s.input} onSubmitEditing={() => topic.trim() && save(mode, topic.trim())} returnKeyType="done" />
          <Pressable onPress={() => topic.trim() ? save(mode, topic.trim()) : showAlert('Topic', 'Type what they’re working on first.')} style={s.btn} accessibilityRole="button">
            <Text style={s.btnText}>Save</Text>
          </Pressable>
        </View>
      )}
      {mode === 'learning' && others.length > 0 && (
        <View style={s.chips}>
          <Text style={s.small}>Or join:</Text>
          {others.map((x: any) => (
            <Pressable key={x.session_id} onPress={() => save('learning', '', x.session_id)} style={s.join} accessibilityRole="button">
              <Text style={s.joinText} numberOfLines={1}>{x.topic || 'Session'} · {(x.host_name || '').split(' ')[0]}</Text>
            </Pressable>
          ))}
        </View>
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
  join: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: c.primary, maxWidth: 220 },
  joinText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.primary },
});
