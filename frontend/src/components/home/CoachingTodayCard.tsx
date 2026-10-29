/**
 * Coaching today — top of a Coach's Home, all day (the Owner's call, 22 Oct 2026;
 * the guide, 29 Oct 2026).
 *
 * For each new start (Days 1-8) in your bunny hop today (or your sector if
 * you're not in a hop): who, which day, and the day in four steps (before the
 * doors, on the doors, the sector break, grade after the field), with one
 * button into today's guide (app/coaching-guide.tsx). The guide holds what to
 * teach: only today's new topics in full, what carries on from yesterday, and
 * anything Behind or Ahead. Same for every Coach, new or experienced.
 * Hidden when you're not with a new start. (GET /coaching/today)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { inFieldHours, fieldStarted, ukNow } from '../../utils/fieldTime';

export type CoachItem = { id: string; topic: string; category: string; confidence_expected: string; taught: boolean;
  what_good_looks_like?: string | null; expected_outcome?: string | null;
  status?: 'new' | 'keep'; changed_from?: string | null; ahead?: boolean };
export type CoachPerson = { hire_id: string; name: string; day_number: number; day_label: string; objective: string;
  assessment_id: string | null; done: boolean; can_grade: boolean; checklist: CoachItem[];
  behind?: { topic: string; grade: string; expected?: string | null; day?: number }[];
  /** From field day 2 (Day 4): their breakeven, or null when not worked out yet. */
  trainee_user_id?: string; breakeven_due?: boolean; breakeven?: number | null };

export const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || n;

export function useCoachingToday() {
  return useQuery({
    queryKey: ['coaching-today'],
    queryFn: async () => (await api.get('/coaching/today')).data as { date: string; people: CoachPerson[] },
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
}

/** Where the day is: 0 before the doors, 1 on the doors, 2 sector break, 3 after the field. */
export function dayStep(): number {
  if (fieldStarted() && !inFieldHours()) return 3;
  if (!fieldStarted()) return 0;
  const { day, mins } = ukNow();
  if (day >= 1 && day <= 5 && mins >= 16 * 60 + 30 && mins < 17 * 60) return 2;
  return 1;
}

export default function CoachingTodayCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useCoachingToday();
  const people = data?.people || [];
  if (!people.length) return null;
  return <>{people.map((p) => <PersonCard key={p.hire_id} p={p} s={s} c={c} />)}</>;
}

function PersonCard({ p, s, c }: { p: CoachPerson; s: any; c: any }) {
  const router = useRouter();
  const step = dayStep();
  const fresh = p.checklist.filter((i) => i.status !== 'keep');
  const kept = p.checklist.filter((i) => i.status === 'keep');
  const taughtNew = fresh.filter((i) => i.taught).length;
  const changed = kept.filter((i) => i.changed_from).length;
  const behind = p.behind?.length || 0;
  const who = firstName(p.name);
  const steps = [
    { when: 'Before the doors', what: `Set ${who}’s goal and what they’re learning`, sub: 'In their sector set-up' },
    { when: 'On the doors', what: fresh.length ? `${fresh.length} new to teach${kept.length ? `, build on ${kept.length}` : ''}` : kept.length ? `Build on ${kept.length} from yesterday` : 'Their day plan',
      sub: [fresh.length ? `${taughtNew} of ${fresh.length} taught` : '', behind ? `${behind} behind` : '', changed ? `${changed} changed since yesterday` : ''].filter(Boolean).join(' · ') || ' ' },
    { when: 'Sector break · 16:30', what: 'Check in with the sector', sub: 'Doors, pitches, one focus for the second half' },
    { when: 'After the field', what: p.done ? 'Graded' : `Grade ${who}’s day`, sub: p.done ? 'Done' : 'Opens at the end of the field' },
  ];
  const guide = () => router.push(`/coaching-guide?hire=${encodeURIComponent(p.hire_id)}` as never);

  return (
    <View style={s.card} testID={`home-coaching-${p.hire_id}`}>
      <View style={s.head}>
        <View style={s.badge}><Text style={s.badgeText}>{who.charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>Your coaching day</Text>
          <Text style={s.title}>{who} · {p.day_label}</Text>
        </View>
      </View>
      {!!p.objective && <Text style={s.body}>{p.objective}</Text>}

      <View style={{ marginTop: 4 }}>
        {steps.map((st, i) => {
          const done = i < step || (i === 3 && p.done);
          const now = i === step && !done;
          return (
            <View key={st.when} style={s.step}>
              <View style={s.rail}>
                <View style={[s.dot, done && s.dotDone, now && s.dotNow]}>
                  {done ? <Ionicons name="checkmark" size={14} color={c.onPrimary} /> : <Text style={[s.dotText, now && { color: c.onPrimary }]}>{i + 1}</Text>}
                </View>
                {i < steps.length - 1 && <View style={s.line} />}
              </View>
              <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 12 : 0 }}>
                <Text style={[s.when, now && { color: c.primary }]}>{st.when}{now ? ' · now' : ''}</Text>
                <Text style={s.what}>{st.what}</Text>
                {!!st.sub.trim() && <Text style={[s.sub, i === 1 && behind ? { color: c.red } : null]}>{st.sub}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {step === 3 && p.can_grade && !!p.assessment_id && !p.done ? (
        <Pressable onPress={() => router.push(`/assessment/${p.assessment_id}` as never)} style={s.cta} accessibilityRole="button" testID={`coaching-grade-${p.hire_id}`}>
          <Text style={s.ctaText}>{`Grade ${who}’s day`}</Text>
          <Ionicons name="arrow-forward" size={17} color={c.onPrimary} />
        </Pressable>
      ) : (
        <Pressable onPress={guide} style={s.cta} accessibilityRole="button" testID={`coaching-guide-${p.hire_id}`}>
          <Text style={s.ctaText}>Open today&apos;s guide</Text>
          <Ionicons name="arrow-forward" size={17} color={c.onPrimary} />
        </Pressable>
      )}

      {/* Field day 2 (Day 4) onwards: work out their breakeven with them. */}
      {!!p.breakeven_due && !!p.trainee_user_id && (
        <Pressable onPress={() => router.push(`/earnings-plan?user=${encodeURIComponent(p.trainee_user_id!)}` as never)}
          style={s.link} accessibilityRole="button" testID={`coaching-breakeven-${p.hire_id}`}>
          <Ionicons name={p.breakeven ? 'checkmark-circle' : 'calculator-outline'} size={15} color={c.primary} />
          <Text style={s.linkText}>{p.breakeven ? `Breakeven ${p.breakeven} a week · change` : `Calculate ${who}’s breakeven`}</Text>
          <Ionicons name="chevron-forward" size={14} color={c.primary} />
        </Pressable>
      )}
      {p.done && !!p.assessment_id && (
        <Pressable onPress={() => router.push(`/assessment/${p.assessment_id}` as never)} style={s.link} accessibilityRole="button">
          <Text style={s.linkText}>Graded · see their day</Text>
          <Ionicons name="chevron-forward" size={14} color={c.primary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { padding: 16, borderRadius: 18, borderWidth: 2, borderColor: c.primary, backgroundColor: c.background, gap: 8, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.onPrimary },
  kicker: { fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: c.primary },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, color: c.text },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 26, alignItems: 'center' },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: c.green, borderColor: c.green },
  dotNow: { backgroundColor: c.primary, borderColor: c.primary },
  dotText: { fontFamily: fonts.bodyBold, fontSize: 12, color: c.textMuted },
  line: { width: 2, flex: 1, backgroundColor: c.border, marginVertical: 3 },
  when: { fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  what: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text, marginTop: 1 },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, marginTop: 1 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: c.primary, marginTop: 4 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingTop: 4 },
  linkText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
