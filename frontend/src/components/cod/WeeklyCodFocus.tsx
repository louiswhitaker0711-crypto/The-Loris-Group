/**
 * This week's COD focus — one COD item each person works on for the week.
 *
 * A Coach picks their own; Coaches pick for their BAs (an Admin for anyone in
 * the office). A BA sees what their Coach picked. The focus also fills the
 * sector set-up (Learning from the COD, or What I'm being an example of).
 * (backend routes/cod_focus.py)
 *
 *   <WeeklyCodFocus />          — your own focus (the COD screen)
 *   <WeeklyCodFocus team />     — yours, then everyone you pick for (Coaching)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';

type Item = { id: string; stage: number; topic: string; category?: string };
type Focus = { module_id: string; topic: string; stage: number; set_by_name?: string } | null;
type Person = { user_id: string; user_name: string; role?: string; focus: Focus };

const errText = (e: any, f: string) => (typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : f);
// Stored stage 5 is the Sector Leader stage (SL), shown between 3 and 4.
const stageName = (n: number) => (n === 5 ? 'SL' : `Stage ${n}`);

function Picker({ options, value, onPick, s, c }: { options: Item[]; value: string; onPick: (id: string | null) => void; s: any; c: any }) {
  const [search, setSearch] = useState('');
  const shown = options.filter((o) => o.topic.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 60);
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search the COD" placeholderTextColor={c.textMuted} style={s.input} />
      {!!value && (
        <Pressable onPress={() => onPick(null)} style={{ paddingVertical: 6 }} accessibilityRole="button">
          <Text style={[s.muted, { color: c.red }]}>Clear this week's focus</Text>
        </Pressable>
      )}
      {shown.map((o) => (
        <Pressable key={o.id} onPress={() => onPick(o.id)} style={s.option} accessibilityRole="button">
          <Ionicons name={o.id === value ? 'radio-button-on' : 'radio-button-off'} size={16} color={o.id === value ? c.primary : c.textMuted} />
          <Text style={[s.optionText, { flex: 1 }]}>{`${stageName(o.stage)} · ${o.topic}`}</Text>
        </Pressable>
      ))}
      {shown.length === 0 && <Text style={s.muted}>Nothing matches.</Text>}
    </View>
  );
}

function Row({ title, sub, focus, canSet, options, onSave, s, c, testID }: {
  title: string; sub?: string; focus: Focus; canSet: boolean; options: Item[];
  onSave: (id: string | null) => Promise<void>; s: any; c: any; testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (id: string | null) => {
    setBusy(true);
    try { await onSave(id); setOpen(false); } finally { setBusy(false); }
  };
  return (
    <View style={s.row}>
      <Pressable onPress={() => canSet && setOpen(!open)} disabled={!canSet} style={s.rowHead} accessibilityRole="button" testID={testID}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={[s.rowFocus, !focus && { color: c.textMuted }]} numberOfLines={2}>
            {focus ? `${stageName(focus.stage)} · ${focus.topic}` : canSet ? 'Not picked yet. Tap to pick.' : 'Not picked yet.'}
          </Text>
          {!!sub && <Text style={s.muted}>{sub}</Text>}
        </View>
        {busy ? <ActivityIndicator size="small" color={c.primary} />
          : canSet ? <Ionicons name={open ? 'chevron-up' : 'create-outline'} size={17} color={c.primary} /> : null}
      </Pressable>
      {open && <Picker options={options} value={focus?.module_id || ''} onPick={pick} s={s} c={c} />}
    </View>
  );
}

export default function WeeklyCodFocus({ team = false }: { team?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['cod-focus', 'me'], queryFn: () => apiService.getCodFocusMe().then((r) => r.data) });
  const canTeam = team && !!me.data?.can_set;
  const tq = useQuery({ queryKey: ['cod-focus', 'team'], queryFn: () => apiService.getCodFocusTeam().then((r) => r.data), enabled: canTeam });
  const myId: string | undefined = me.data?.user_id;
  const [teamOpen, setTeamOpen] = useState(false);

  const save = (userId: string | null) => async (moduleId: string | null) => {
    try {
      if (userId) await apiService.setCodFocus(userId, moduleId);
      toast.success(moduleId ? 'Focus set for the week' : 'Focus cleared');
      qc.invalidateQueries({ queryKey: ['cod-focus'] });
      qc.invalidateQueries({ queryKey: ['sector-day'] });
    } catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
  };

  if (me.isLoading) return null;
  if (!me.data) return null;
  const options: Item[] = me.data.options || tq.data?.options || [];
  const people: Person[] = tq.data?.people || [];
  const picked = people.filter((p) => !!p.focus).length;
  const sorted = [...people.filter((p) => !p.focus), ...people.filter((p) => !!p.focus)];

  return (
    <View style={s.card} testID="weekly-cod-focus">
      <View style={s.head}>
        <Ionicons name="flag-outline" size={17} color={c.primary} />
        <Text style={s.h}>This week's COD focus</Text>
      </View>
      <Text style={s.muted}>
        {me.data.can_set
          ? 'One COD item to work on all week. It fills your sector set-up.'
          : 'Your Coach picks one COD item for you to work on all week. It fills your sector set-up.'}
      </Text>
      <Row title="You" focus={me.data.focus} canSet={!!me.data.can_set && !!myId} options={options}
        sub={me.data.focus?.set_by_name && !me.data.can_set ? `Picked by ${me.data.focus.set_by_name.split(' ')[0]}` : undefined}
        onSave={save(myId || null)} s={s} c={c} testID="cod-focus-me" />
      {canTeam && (
        // The team folds into one line (the Owner, 29 Oct 2026): how many are
        // picked, tap to open; not-picked-yet people come first.
        <View style={s.row}>
          <Pressable onPress={() => setTeamOpen(!teamOpen)} style={s.rowHead} accessibilityRole="button" testID="cod-focus-team-toggle">
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.rowTitle}>Your team</Text>
              <Text style={s.rowFocus}>
                {tq.isLoading ? 'Loading…' : people.length === 0 ? 'Nobody under you yet.'
                  : `${picked} of ${people.length} picked${people.length - picked ? ` · ${people.length - picked} to pick` : ''}`}
              </Text>
            </View>
            <Ionicons name={teamOpen ? 'chevron-up' : 'chevron-down'} size={17} color={c.primary} />
          </Pressable>
          {teamOpen && sorted.map((p) => (
            <Row key={p.user_id} title={p.user_name} focus={p.focus} canSet options={options}
              onSave={save(p.user_id)} s={s} c={c} testID={`cod-focus-${p.user_id}`} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, lineHeight: 17 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  rowFocus: { fontFamily: fonts.body, fontSize: 13, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.body, fontSize: 14, color: c.text, backgroundColor: c.background },
  option: { paddingVertical: 6, flexDirection: 'row', gap: 8, alignItems: 'center' },
  optionText: { fontFamily: fonts.body, fontSize: 13, color: c.text },
});
