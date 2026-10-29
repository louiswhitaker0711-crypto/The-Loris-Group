// Today's coaching guide (the Owner, 29 Oct 2026): what a Coach does with a
// new start today, from the Manual, without the noise. Only today's topics:
//   Behind      — graded below what was expected on an earlier day: go back over it first
//   New today   — not on yesterday's Manual page: how to teach it, what good looks like by the end
//   Keep building — carried over from yesterday, one line each, with a notice when what's expected changed
//   Ahead       — a flag on a topic already graded above today's expectation
// Then the sector break check-in (16:30–17:00) and grading after the field.
// The same screen for every Coach. (GET /coaching/today, PUT /coaching/today/taught)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { toast } from '../src/utils/toast';
import { useCoachingToday, dayStep, firstName, aimOf, CoachItem, CoachPerson } from '../src/components/home/CoachingTodayCard';

export default function CoachingGuideScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const router = useRouter();
  const qc = useQueryClient();
  const { hire } = useLocalSearchParams<{ hire?: string }>();
  const q = useCoachingToday();
  const p: CoachPerson | undefined = (q.data?.people || []).find((x) => x.hire_id === hire) || q.data?.people?.[0];
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  if (!p) {
    return (
      <View style={[s.page, s.center, { padding: 24 }]}>
        <Text style={s.muted}>You&apos;re not with a new start today.</Text>
      </View>
    );
  }
  const who = firstName(p.name);
  const fresh = p.checklist.filter((i) => i.status !== 'keep');
  const kept = p.checklist.filter((i) => i.status === 'keep');
  const behind = p.behind || [];
  const taughtNew = fresh.filter((i) => i.taught).length;
  const step = dayStep();

  const tick = async (it: CoachItem) => {
    if (busy) return;
    setBusy(it.id);
    const flip = (v: boolean) => qc.setQueryData(['coaching-today'], (old: any) => old && ({
      ...old, people: old.people.map((x: CoachPerson) => x.hire_id !== p.hire_id ? x : {
        ...x, checklist: x.checklist.map((y) => (y.id === it.id ? { ...y, taught: v } : y)) }) }));
    flip(!it.taught);
    try {
      await api.put('/coaching/today/taught', { item_id: it.id, taught: !it.taught });
    } catch (e: any) {
      flip(it.taught);
      toast.error('Couldn’t save that', e?.response?.data?.detail || undefined);
    } finally { setBusy(null); }
  };

  const topicCard = (it: CoachItem, i: number) => {
    const isOpen = open === it.id;
    return (
      <View key={it.id} style={s.topic}>
        <Pressable onPress={() => setOpen(isOpen ? null : it.id)} style={s.topicHead} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
          <View style={[s.num, it.taught && s.numDone]}>
            {it.taught ? <Ionicons name="checkmark" size={14} color={c.onPrimary} /> : <Text style={s.numText}>{i + 1}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={s.topicTitle}>{it.topic}</Text>
              {!!aimOf(it.confidence_expected, c) && (
                <View style={[s.aim, { backgroundColor: aimOf(it.confidence_expected, c)!.bg }]}>
                  <Text style={[s.aimText, { color: aimOf(it.confidence_expected, c)!.fg }]}>{aimOf(it.confidence_expected, c)!.label}</Text>
                </View>
              )}
            </View>
            <Text style={s.small}>{[aimOf(it.confidence_expected, c)?.todo, it.taught ? 'taught' : ''].filter(Boolean).join(' · ')}</Text>
          </View>
          {it.ahead && <View style={s.ahead}><Text style={s.aheadText}>Ahead</Text></View>}
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
        </Pressable>
        {isOpen && (
          <View style={s.topicBody}>
            {!!it.what_good_looks_like && <><Text style={s.label}>How to teach it</Text><Text style={s.text}>{it.what_good_looks_like}</Text></>}
            {!!it.expected_outcome && <><Text style={s.label}>By the end of the day</Text><Text style={s.text}>{it.expected_outcome}</Text></>}
            {it.ahead && <Text style={[s.small, { color: c.green }]}>{who} is already past today&apos;s aim here: stretch them.</Text>}
            <Pressable onPress={() => tick(it)} style={[s.taughtBtn, it.taught && s.taughtOn]} accessibilityRole="button" disabled={busy === it.id}>
              <Text style={[s.taughtText, it.taught && { color: c.green }]}>{it.taught ? 'Taught (tap to undo)' : 'Mark as taught'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.shell}>
        <View>
          <Text style={s.h1}>{p.day_label} · {who}</Text>
          <Text style={s.muted}>Today&apos;s guide, from the Manual{fresh.length ? ` · ${taughtNew} of ${fresh.length} new taught` : ''}</Text>
          {fresh.length > 0 && (
            <View style={s.bar}><View style={[s.barFill, { width: `${Math.round((taughtNew / fresh.length) * 100)}%` as any }]} /></View>
          )}
        </View>
        {!!p.objective && <Text style={s.text}>{p.objective}</Text>}

        {behind.length > 0 && (
          <>
            <Text style={[s.kicker, { color: c.red }]}>Behind · didn&apos;t land yet</Text>
            <View style={[s.box, { borderColor: c.red }]}>
              {behind.map((b, i) => (
                <View key={b.topic} style={[s.line, i > 0 && s.lineTop]}>
                  <Text style={s.topicTitle}>{b.topic}</Text>
                  <Text style={[s.small, { color: c.red }]}>{`Graded ${b.grade}${b.expected ? ` (aim was ${b.expected})` : ''}${b.day ? ` on Day ${b.day}` : ''} · go back over it first`}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {fresh.length > 0 && (
          <>
            <Text style={s.kicker}>New today</Text>
            <View style={{ gap: 8 }}>{fresh.map(topicCard)}</View>
          </>
        )}

        {kept.length > 0 && (
          <>
            <Text style={s.kicker}>Keep building (from yesterday)</Text>
            <View style={s.box}>
              {kept.map((it, i) => (
                <Pressable key={it.id} onPress={() => setOpen(open === it.id ? null : it.id)} style={[s.line, i > 0 && s.lineTop]} accessibilityRole="button">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[s.topicTitle, { flex: 1 }]}>{it.topic}</Text>
                    {it.ahead && <View style={s.ahead}><Text style={s.aheadText}>Ahead</Text></View>}
                  </View>
                  <Text style={[s.small, it.changed_from ? { color: c.yellow, fontFamily: fonts.bodySemibold } : null]}>
                    {it.changed_from ? `Changed: yesterday ${it.changed_from}, today ${it.confidence_expected}` : 'Same as yesterday'}
                  </Text>
                  {open === it.id && (
                    <View style={{ gap: 4, marginTop: 6 }}>
                      {!!it.what_good_looks_like && <Text style={s.text}>{it.what_good_looks_like}</Text>}
                      <Pressable onPress={() => tick(it)} style={[s.taughtBtn, it.taught && s.taughtOn]} accessibilityRole="button">
                        <Text style={[s.taughtText, it.taught && { color: c.green }]}>{it.taught ? 'Covered today (tap to undo)' : 'Mark as covered today'}</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={[s.kicker, step === 2 && { color: c.primary }]}>Sector break · 16:30–17:00{step === 2 ? ' · now' : ''}</Text>
        <View style={s.box}>
          <View style={s.line}>
            <Text style={s.text}>{`Check in with the sector. Ask ${who}: how many doors so far, and what’s one thing that’s working? Set one focus for the second half.`}</Text>
          </View>
        </View>

        <Text style={s.kicker}>After the field</Text>
        {p.can_grade && !!p.assessment_id ? (
          <Pressable onPress={() => router.push(`/assessment/${p.assessment_id}` as never)} disabled={step !== 3 && !p.done}
            style={[s.grade, (step === 3 || p.done) ? s.gradeOn : null]} accessibilityRole="button">
            <Text style={[s.gradeText, (step === 3 || p.done) && { color: c.onPrimary }]}>
              {p.done ? 'Graded · see their day' : step === 3 ? `Grade ${who}’s day` : `Grade ${who}’s day (opens at the end of the field)`}
            </Text>
          </Pressable>
        ) : (
          <Text style={s.muted}>{`${who}’s Coach grades the day.`}</Text>
        )}

        <Pressable onPress={() => router.push(`/(tabs)/manual?day=${p.day_number}` as never)} style={s.manual} accessibilityRole="link">
          <Ionicons name="book-outline" size={15} color={c.primary} />
          <Text style={s.manualText}>{`The full ${p.day_label} page in the Manual`}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 48 },
  shell: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 10 },
  h1: { fontFamily: fonts.display, fontSize: 24, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  bar: { height: 6, borderRadius: 3, backgroundColor: c.border, marginTop: 8, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: c.primary },
  kicker: { fontFamily: fonts.bodySemibold, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase', color: c.primary, marginTop: 8 },
  box: { borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.background, overflow: 'hidden' },
  line: { paddingHorizontal: 12, paddingVertical: 11, gap: 2 },
  lineTop: { borderTopWidth: 1, borderTopColor: c.border },
  topic: { borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.background, overflow: 'hidden' },
  topicHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 56 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  numDone: { backgroundColor: c.green, borderColor: c.green },
  numText: { fontFamily: fonts.bodyBold, fontSize: 12, color: c.text },
  topicTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  topicBody: { paddingHorizontal: 12, paddingBottom: 12, paddingLeft: 48, gap: 6 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  aim: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  aimText: { fontFamily: fonts.bodyBold, fontSize: 11 },
  ahead: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: c.greenBg },
  aheadText: { fontFamily: fonts.bodyBold, fontSize: 11, color: c.green },
  taughtBtn: { minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, marginTop: 4 },
  taughtOn: { backgroundColor: c.greenBg },
  taughtText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  grade: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.primary, paddingHorizontal: 12 },
  gradeOn: { backgroundColor: c.primary, borderStyle: 'solid' },
  gradeText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary, textAlign: 'center' },
  manual: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 12 },
  manualText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
