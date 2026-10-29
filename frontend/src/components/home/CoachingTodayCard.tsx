/**
 * Coaching today — top of a Coach's Home, all day (the Owner's call, 22 Oct 2026).
 *
 * For each new start (Days 1-8) in your bunny hop today (or your sector if
 * you're not in a hop): their day plan (which day, the day's objective) and
 * what you need to do with them (the day's checklist, tick each one as you
 * teach it; tap a topic for what to teach and what good looks like).
 * Hidden when you're not with a new start. (GET /coaching/today)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { toast } from '../../utils/toast';

type Item = { id: string; topic: string; category: string; confidence_expected: string; taught: boolean;
  what_good_looks_like?: string | null; expected_outcome?: string | null };
type Person = { hire_id: string; name: string; day_number: number; day_label: string; objective: string;
  assessment_id: string | null; done: boolean; can_grade: boolean; checklist: Item[];
  /** From field day 2 (Day 4): their breakeven, or null when not worked out yet. */
  trainee_user_id?: string; breakeven_due?: boolean; breakeven?: number | null };

const first = (n: string) => (n || '').trim().split(/\s+/)[0] || n;

export default function CoachingTodayCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useQuery({
    queryKey: ['coaching-today'],
    queryFn: async () => (await api.get('/coaching/today')).data as { date: string; people: Person[] },
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  const people = data?.people || [];
  if (!people.length) return null;
  return <>{people.map((p) => <PersonCard key={p.hire_id} p={p} s={s} c={c} />)}</>;
}

function PersonCard({ p, s, c }: { p: Person; s: any; c: any }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const taught = p.checklist.filter((i) => i.taught).length;

  const tick = async (it: Item) => {
    if (busy) return;
    setBusy(it.id);
    // Show it straight away; put it back if the save fails.
    const flip = (v: boolean) => qc.setQueryData(['coaching-today'], (old: any) => old && ({
      ...old, people: old.people.map((x: Person) => x.hire_id !== p.hire_id ? x : {
        ...x, checklist: x.checklist.map((y) => (y.id === it.id ? { ...y, taught: v } : y)) }) }));
    flip(!it.taught);
    try {
      await api.put('/coaching/today/taught', { item_id: it.id, taught: !it.taught });
    } catch (e: any) {
      flip(it.taught);
      toast.error('Couldn’t save that', e?.response?.data?.detail || undefined);
    } finally { setBusy(null); }
  };

  return (
    <View style={s.card} testID={`home-coaching-${p.hire_id}`}>
      <View style={s.head}>
        <View style={s.badge}><Ionicons name="school" size={18} color={c.onPrimary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>Coaching today</Text>
          <Text style={s.title}>{first(p.name)} · {p.day_label}</Text>
        </View>
        {p.checklist.length > 0 && <Text style={s.count}>{taught}/{p.checklist.length}</Text>}
      </View>

      <Text style={s.label}>Their day</Text>
      <Text style={s.body}>{p.objective || 'Today’s plan is on their day page.'}</Text>

      {p.checklist.length > 0 && (
        <>
          <Text style={s.label}>What you need to do</Text>
          {p.checklist.map((it) => {
            const more = !!(it.what_good_looks_like || it.expected_outcome);
            const isOpen = open === it.id;
            return (
              <View key={it.id}>
                <View style={s.row}>
                  <Pressable onPress={() => tick(it)} hitSlop={8} accessibilityRole="checkbox"
                    accessibilityState={{ checked: it.taught }} accessibilityLabel={`${it.topic}: ${it.taught ? 'taught' : 'not taught yet'}`}>
                    <Ionicons name={it.taught ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={it.taught ? c.primary : c.textMuted} />
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onPress={() => more && setOpen(isOpen ? null : it.id)} disabled={!more}>
                    <Text style={[s.topic, it.taught && s.topicDone]}>{it.topic}</Text>
                    {!!it.confidence_expected && <Text style={s.meta}>{it.confidence_expected}{more ? (isOpen ? ' · hide' : ' · what to teach') : ''}</Text>}
                  </Pressable>
                </View>
                {isOpen && (
                  <View style={s.more}>
                    {!!it.what_good_looks_like && <><Text style={s.moreLabel}>What good looks like</Text><Text style={s.moreText}>{it.what_good_looks_like}</Text></>}
                    {!!it.expected_outcome && <><Text style={s.moreLabel}>By the end of the day</Text><Text style={s.moreText}>{it.expected_outcome}</Text></>}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      {/* Field day 2 (Day 4) onwards: work out their breakeven with them
          (the Owner, 29 Oct 2026). It fills Bells and their weekly goal. */}
      {!!p.breakeven_due && !!p.trainee_user_id && (
        <Pressable onPress={() => router.push(`/earnings-plan?user=${encodeURIComponent(p.trainee_user_id!)}` as never)}
          style={s.link} accessibilityRole="button" testID={`coaching-breakeven-${p.hire_id}`}>
          <Ionicons name={p.breakeven ? 'checkmark-circle' : 'calculator-outline'} size={15} color={c.primary} />
          <Text style={s.linkText}>{p.breakeven ? `Breakeven ${p.breakeven} a week · change` : `Calculate ${first(p.name)}\u2019s breakeven`}</Text>
          <Ionicons name="chevron-forward" size={14} color={c.primary} />
        </Pressable>
      )}

      {p.can_grade && !!p.assessment_id && (
        <Pressable onPress={() => router.push(`/assessment/${p.assessment_id}` as never)} style={s.link} accessibilityRole="button">
          <Text style={s.linkText}>{p.done ? 'Graded · see their day' : 'Open their day'}</Text>
          <Ionicons name="chevron-forward" size={14} color={c.primary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { padding: 14, borderRadius: 16, borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.background, gap: 6, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  badge: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: c.primary },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  count: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.primary },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textMuted, marginTop: 6 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  topic: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: c.text },
  topicDone: { color: c.textMuted, textDecorationLine: 'line-through' },
  meta: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted, marginTop: 1 },
  more: { marginLeft: 32, marginBottom: 6, padding: 10, borderRadius: 10, backgroundColor: c.surface, gap: 3 },
  moreLabel: { fontFamily: fonts.bodySemibold, fontSize: 11.5, color: c.textMuted },
  moreText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.text },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingTop: 6 },
  linkText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
