/**
 * The scorecard on the weekly review (the Owner, 10 Nov 2026): a short AI
 * paragraph, who's ready to lead a sector, who to give a new start to, and
 * everyone's numbers against what good looks like over the last 4 weeks.
 * Admins and Coaches only (the server decides: GET /scorecard).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../api/client';
import { useColors, fonts } from '../../theme/ThemeContext';

type Pick = { name: string; reason: string };
type Person = {
  name: string; score: number | null;
  measures: { days: number; piece_average: number; gold_pct: number | null; round_pct: number | null;
    reliability_pct: number | null; fails_pct: number | null; aov: number | null; drops: number | null };
};
type Card = {
  weeks: string[]; people: Person[];
  ready_to_lead_a_sector: Pick[]; best_to_give_a_new_start_to: Pick[];
  too_early: string[]; not_enough_days: string[];
};
type Resp = { week_ending: string; scorecard: Card; summary: string | null; ai: boolean };

const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);

export default function ScorecardCard({ week }: { week?: string }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [writing, setWriting] = useState(false);
  const asked = useRef<string>('');
  const q = useQuery({
    queryKey: ['scorecard', week || 'now'],
    queryFn: async () => (await api.get('/scorecard', { params: week ? { week } : {} })).data as Resp,
    retry: false,
  });
  const d = q.data;
  const write = async (refresh = false) => {
    if (!d) return;
    setWriting(true);
    try {
      const r = (await api.post('/scorecard/summary', { week: d.week_ending, refresh })).data;
      qc.setQueryData(['scorecard', week || 'now'], { ...d, summary: r.summary });
    } catch { /* the lists still show without the paragraph */ }
    finally { setWriting(false); }
  };
  // Write the paragraph once a week, the first time the review is opened.
  useEffect(() => {
    if (d && d.ai && !d.summary && d.scorecard.people.length && asked.current !== d.week_ending) {
      asked.current = d.week_ending;
      write();
    }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <View style={s.card}><ActivityIndicator color={c.primary} /></View>;
  if (!d) return null;
  const card = d.scorecard;
  if (!card.people.length) {
    return (
      <View style={s.card}>
        <Text style={s.title}>Your best people</Text>
        <Text style={s.hint}>Nobody has 6 field days in the last 4 weeks yet, so there's no one to score.</Text>
      </View>
    );
  }
  const List = ({ title, icon, items }: { title: string; icon: any; items: Pick[] }) => (
    <View style={{ gap: 6 }}>
      <View style={s.row}><Ionicons name={icon} size={14} color={c.primary} /><Text style={s.label}>{title}</Text></View>
      {items.length ? items.map((p) => (
        <View key={p.name} style={{ gap: 1 }}>
          <Text style={s.name}>{p.name}</Text>
          <Text style={s.hint}>{p.reason}</Text>
        </View>
      )) : <Text style={s.hint}>Nobody fits yet.</Text>}
    </View>
  );
  return (
    <View style={s.card} testID="weekly-review-scorecard">
      <Text style={s.title}>Your best people</Text>
      <Text style={s.small}>Last 4 weeks, against what good looks like. Only you and Coaches see this.</Text>
      {writing ? <ActivityIndicator color={c.primary} style={{ alignSelf: 'flex-start' }} />
        : d.summary ? <Text style={s.body}>{d.summary}</Text> : null}
      <List title="Ready to lead a sector" icon="flag-outline" items={card.ready_to_lead_a_sector} />
      <List title="Best to give a new start to" icon="person-add-outline" items={card.best_to_give_a_new_start_to} />
      <Pressable onPress={() => setShowAll((v) => !v)} style={s.row} accessibilityRole="button">
        <Text style={s.link}>{showAll ? 'Hide everyone' : `Everyone (${card.people.length})`}</Text>
        <Ionicons name={showAll ? 'chevron-up' : 'chevron-down'} size={14} color={c.primary} />
      </Pressable>
      {showAll && (
        <View>
          <View style={[s.tr, s.th]}>
            <Text style={[s.td, s.tdName, s.thText]}>Name</Text>
            {['Score', 'P/A', 'Gold', 'Round', 'Fails', 'Rel.'].map((h) => <Text key={h} style={[s.td, s.thText]}>{h}</Text>)}
          </View>
          {card.people.map((p) => (
            <View key={p.name} style={s.tr}>
              <Text style={[s.td, s.tdName]} numberOfLines={1}>{p.name}</Text>
              <Text style={[s.td, s.bold]}>{p.score ?? '–'}</Text>
              <Text style={s.td}>{p.measures.piece_average}</Text>
              <Text style={s.td}>{pct(p.measures.gold_pct)}</Text>
              <Text style={s.td}>{pct(p.measures.round_pct)}</Text>
              <Text style={s.td}>{pct(p.measures.fails_pct)}</Text>
              <Text style={s.td}>{pct(p.measures.reliability_pct)}</Text>
            </View>
          ))}
          {!!card.too_early.length && <Text style={[s.small, { marginTop: 6 }]}>Too early to score: {card.too_early.join(', ')}</Text>}
          {!!card.not_enough_days.length && <Text style={s.small}>Under 6 field days: {card.not_enough_days.join(', ')}</Text>}
        </View>
      )}
      {d.ai && !!d.summary && !writing && (
        <Pressable onPress={() => write(true)} accessibilityRole="button"><Text style={s.small}>Rewrite the paragraph</Text></Pressable>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 10, marginBottom: 14 },
  title: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.text },
  name: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  hint: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: c.textMuted },
  link: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  bold: { fontFamily: fonts.bodyBold, color: c.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border },
  th: { borderTopWidth: 0 },
  thText: { fontFamily: fonts.mono, fontSize: 10.5, color: c.textMuted },
  td: { width: 46, textAlign: 'right', fontFamily: fonts.body, fontSize: 13, color: c.text },
  tdName: { flex: 1, width: undefined, textAlign: 'left' },
});
