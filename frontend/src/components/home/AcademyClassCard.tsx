/**
 * The BA Academy class on the Owner's Home (Admin, Days 1-2): each new
 * start's progress through the Day 1 workbook, their quiz scores, and any
 * questions they've written for their Coach, so the Owner knows who needs a
 * recap before the break. Tap a name to read their workbook.
 * Hidden when nobody is on an Academy day. (GET /academy/class)
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { day1Progress, quizScores } from '../../academy/day1';

type Wb = { done: Record<string, boolean>; quiz: Record<string, Record<string, number>>; questions: string };
type Person = { hire_id: string; user_id: string; name: string; day_number: number; workbooks: Record<string, Wb> };

export default function AcademyClassCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { data } = useQuery({
    queryKey: ['academy-class'],
    queryFn: async () => (await api.get('/academy/class')).data as { people: Person[] },
    refetchInterval: 60 * 1000,
    retry: false,
  });
  const people = data?.people || [];
  if (!people.length) return null;
  return (
    <View style={s.card} testID="home-academy-class">
      <Text style={s.kicker}>BA Academy · Day 1 workbooks</Text>
      <Text style={s.title}>{people.length} new start{people.length === 1 ? '' : 's'}</Text>
      {people.map((p) => {
        const wb = p.workbooks?.['1'];
        const prog = day1Progress(wb);
        const scores = quizScores(wb?.quiz);
        return (
          <Pressable key={p.hire_id} onPress={() => router.push(`/academy/1?user=${encodeURIComponent(p.user_id)}` as never)} style={s.row} accessibilityRole="button">
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <View style={s.rowTop}>
                <Text style={s.name} numberOfLines={1}>{p.name}</Text>
                <Text style={s.count}>{prog.done}/{prog.total}</Text>
              </View>
              <View style={s.track}><View style={[s.fill, { width: `${Math.round((prog.done / prog.total) * 100)}%` as any }]} /></View>
              <View style={s.scores}>
                {scores.map((q, i) => {
                  const tone = q.score == null ? 'none' : q.score === q.of ? 'good' : q.score >= q.of - 1 ? 'ok' : 'low';
                  return (
                    <Text key={q.id} style={[s.score, tone === 'good' && s.good, tone === 'ok' && s.ok, tone === 'low' && s.low]}>
                      Quiz {i + 1}: {q.score == null ? '–' : `${q.score}/${q.of}`}
                    </Text>
                  );
                })}
              </View>
              {!!wb?.questions && (
                <View style={s.q}>
                  <Ionicons name="help-circle" size={15} color={c.yellow} />
                  <Text style={s.qText} numberOfLines={3}>{wb.questions}</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 16, marginBottom: 12, gap: 4 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  title: { fontFamily: fonts.display, fontSize: 20, color: c.text, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text, flexShrink: 1 },
  count: { fontFamily: fonts.monoSemibold, fontSize: 13, color: c.textMuted },
  track: { height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: c.primaryLight },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  score: { fontFamily: fonts.mono, fontSize: 11.5, color: c.textMuted, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  good: { color: c.sgreenInk, borderColor: c.sgreen, backgroundColor: c.sgreenBg },
  ok: { color: c.yellow, borderColor: c.yellow, backgroundColor: c.yellowBg },
  low: { color: c.red, borderColor: c.red, backgroundColor: c.redBg },
  q: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  qText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: c.text },
});
