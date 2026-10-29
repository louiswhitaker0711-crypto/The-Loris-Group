/**
 * Coaching today — top of a Coach's Home, all day (the Owner's call, 22 Oct 2026;
 * the guide, 29 Oct 2026).
 *
 * For each new start (Days 1-8) in your bunny hop today (or your sector if
 * you're not in a hop): who, which day, and what to teach today (Behind first,
 * then today's new topics, and what changed since yesterday), with one
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

// The Manual's aim for a topic, coloured as the Manual colours it, with one
// line on what the Coach does (the Owner, 29 Oct 2026).
export function aimOf(conf: string | undefined | null, c: any) {
  const k = String(conf || '').trim().toLowerCase();
  if (k === 'understand' || k === 'know') return { label: 'Understand', bg: `${c.info}22`, fg: c.info, todo: 'Explain it and check they get it' };
  if (k === 'assisted' || k === 'do') return { label: 'Assisted', bg: c.yellowBg, fg: c.yellow, todo: 'Do it with them: you show, they try, you step in' };
  if (k === 'independent' || k === 'deliver') return { label: 'Independent', bg: c.greenBg, fg: c.green, todo: 'They do it on their own: watch and give one tip' };
  return conf ? { label: String(conf), bg: c.surface, fg: c.textMuted, todo: '' } : null;
}

// One line of detail under a topic (the Owner, 29 Oct 2026): what exactly they
// should know, from the Manual (By the end of the day, else What good looks like).
export function detailOf(it: { expected_outcome?: string | null; what_good_looks_like?: string | null }): string {
  const raw = String(it.expected_outcome || it.what_good_looks_like || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const first = raw.split(/(?<=[.!?])\s/)[0];
  return first.length > 140 ? `${first.slice(0, 137)}\u2026` : first;
}

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
  const changedItems = kept.filter((i) => i.changed_from);
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

      {/* What to teach today (the Owner, 29 Oct 2026): no ladder, just today. */}
      {behind > 0 && (
        <View style={s.behind}>
          <Text style={s.behindTitle}>Behind · go back over first</Text>
          {(p.behind || []).slice(0, 5).map((b) => <Text key={b.topic} style={s.behindItem}>{`${b.topic} · ${b.grade}`}</Text>)}
          {behind > 5 && <Text style={s.behindItem}>{`+ ${behind - 5} more on the guide`}</Text>}
        </View>
      )}
      <Text style={s.section}>{fresh.length ? `What to teach today · ${taughtNew} of ${fresh.length}` : 'What to teach today'}</Text>
      {fresh.length ? fresh.map((it) => {
        const aim = aimOf(it.confidence_expected, c);
        return (
          <Pressable key={it.id} onPress={guide} style={s.teach} accessibilityRole="button">
            <Ionicons name={it.taught ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={it.taught ? c.green : c.textMuted} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[s.teachText, it.taught && s.teachDone]} numberOfLines={1}>{it.topic}</Text>
                {!!aim && <View style={[s.aim, { backgroundColor: aim.bg }]}><Text style={[s.aimText, { color: aim.fg }]}>{aim.label}</Text></View>}
                {it.ahead && <Text style={s.aheadText}>Ahead</Text>}
              </View>
              {!!detailOf(it) && <Text style={s.aimDo} numberOfLines={1}>{detailOf(it)}</Text>}
            </View>
          </Pressable>
        );
      }) : <Text style={s.sub}>{kept.length ? `Nothing new: build on ${kept.length} from yesterday` : 'Their day plan is on the guide.'}</Text>}
      {changedItems.length > 0 && (
        <Text style={s.changed}>{`Changed since yesterday: ${changedItems.map((i) => `${i.topic} (${i.changed_from} \u2192 ${i.confidence_expected})`).join(', ')}`}</Text>
      )}
      {fresh.length > 0 && kept.length > 0 && <Text style={s.sub}>{`Plus ${kept.length} to keep building from yesterday`}</Text>}

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
  section: { fontFamily: fonts.bodySemibold, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase', color: c.primary, marginTop: 6 },
  teach: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.border },
  aim: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  aimText: { fontFamily: fonts.bodyBold, fontSize: 11 },
  aimDo: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, marginTop: 2 },
  teachText: { flexShrink: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  teachDone: { color: c.textMuted, textDecorationLine: 'line-through' },
  aheadText: { fontFamily: fonts.bodyBold, fontSize: 11, color: c.green },
  behind: { borderRadius: 12, padding: 10, backgroundColor: c.redBg, gap: 2 },
  behindTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.red },
  behindItem: { fontFamily: fonts.body, fontSize: 13.5, color: c.text },
  changed: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.yellow, marginTop: 4 },
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
