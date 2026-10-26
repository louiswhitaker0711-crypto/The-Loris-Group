/**
 * BA Academy workbook (route: /academy/1, /academy/2; ?user=<id> to read
 * someone else's). The Owner's call (26 Oct 2026): at the start of product
 * coaching each new start opens this on their own phone and fills it in as
 * the Owner teaches: gaps, notes, quick quizzes. Everything saves to their
 * account as they type (GET/PUT /academy/workbook/{day}); the Owner sees the
 * class's progress on Home and can open anyone's workbook read-only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../src/theme/ThemeContext';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useTabBarClearance } from '../../src/customization/CustomTabBar';
import { BrandLoader } from '../../src/components/ui/BrandLoader';
import { WorkbookContext } from '../../src/academy/Workbook';
import Day1Page from '../../src/academy/Day1Page';
import Day2Page from '../../src/academy/Day2Page';
import { DAY1_SECTIONS, day1Progress, emptyState, WorkbookState } from '../../src/academy/day1';
import { DAY2_SECTIONS, day2Progress } from '../../src/academy/day2';

type Loaded = WorkbookState & { name: string; read_only: boolean; updated_at?: string | null };

export default function AcademyWorkbook() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ day?: string; user?: string }>();
  const day = Number(params.day) === 2 ? 2 : 1;
  const other = typeof params.user === 'string' && params.user && params.user !== (user as any)?.id ? params.user : '';
  const tabClear = useTabBarClearance();

  const q = useQuery({
    queryKey: ['academy-workbook', day, other || 'me'],
    queryFn: async () => (await api.get(`/academy/workbook/${day}${other ? `?user_id=${encodeURIComponent(other)}` : ''}`)).data as Loaded,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const readOnly = !!q.data?.read_only;

  const [state, setState] = useState<WorkbookState>(emptyState());
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const loadedRef = useRef(false);
  // Switching between Day 1 and Day 2 (or person) loads that workbook afresh.
  const keyRef = useRef(`${day}:${other}`);
  if (keyRef.current !== `${day}:${other}`) { keyRef.current = `${day}:${other}`; loadedRef.current = false; }
  useEffect(() => {
    if (q.data && !loadedRef.current) {
      loadedRef.current = true;
      setState({ fields: q.data.fields || {}, done: q.data.done || {}, quiz: q.data.quiz || {} });
    }
  }, [q.data]);

  // Save as they go: a short pause after the last change, and on leaving.
  const pending = useRef<WorkbookState | null>(null);
  const timer = useRef<any>(null);
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current;
    if (!body || readOnly) return;
    pending.current = null;
    setSaved('saving');
    try {
      await api.put(`/academy/workbook/${day}`, body);
      setSaved('saved');
      qc.invalidateQueries({ queryKey: ['academy-class'] });
    } catch {
      pending.current = pending.current || body;
      setSaved('error');
    }
  }, [day, readOnly, qc]);
  useEffect(() => () => { void flush(); }, [flush]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flush]);

  const update = useCallback((fn: (s: WorkbookState) => WorkbookState) => {
    if (readOnly) return;
    setState((prev) => {
      const next = fn(prev);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 700);
      return next;
    });
  }, [readOnly, flush]);

  const ctx = useMemo(() => ({
    state, readOnly,
    setField: (id: string, v: string) => update((p) => ({ ...p, fields: { ...p.fields, [id]: v } })),
    toggleDone: (id: string) => update((p) => {
      const done = { ...p.done };
      if (done[id]) delete done[id]; else done[id] = true;
      return { ...p, done };
    }),
    answer: (quiz: string, i: number, j: number) => update((p) => ({ ...p, quiz: { ...p.quiz, [quiz]: { ...(p.quiz[quiz] || {}), [String(i)]: j } } })),
    retry: (quiz: string) => update((p) => { const qz = { ...p.quiz }; delete qz[quiz]; return { ...p, quiz: qz }; }),
  }), [state, readOnly, update]);

  const prog = day === 2 ? day2Progress(state) : day1Progress(state);
  const sections = day === 2 ? DAY2_SECTIONS : DAY1_SECTIONS;
  const name = q.data?.name || (user as any)?.name || '';
  const first = (name || '').trim().split(/\s+/)[0];

  const jump = (id: string) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (q.isLoading) return <View style={[s.page, s.center]}><BrandLoader /></View>;
  if (q.isError) {
    return (
      <View style={[s.page, s.center, { padding: 24 }]}>
        <Text style={s.body}>{typeof (q.error as any)?.response?.data?.detail === 'string'
          ? (q.error as any).response.data.detail
          : 'Couldn’t open this workbook. Check your connection and try again.'}</Text>
        <Pressable onPress={() => q.refetch()} style={s.btn}><Text style={s.btnText}>Try again</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: `BA Academy · Day ${day}` }} />
      <View style={s.bar}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.barTitle} numberOfLines={1}>{readOnly ? name : `Day ${day} workbook`}</Text>
          <Text style={s.barSub} numberOfLines={1}>
            {readOnly ? 'Read-only' : saved === 'saving' ? 'Saving…' : saved === 'error' ? 'Not saved yet — check your connection' : saved === 'saved' ? 'Saved' : 'Saves as you type'}
          </Text>
        </View>
        {!!prog.total && (
          <View style={{ width: 110, alignItems: 'flex-end' }}>
            <Text style={s.label}>{prog.done} of {prog.total} done</Text>
            <View style={s.track}><View style={[s.fill, { width: `${Math.round((prog.done / prog.total) * 100)}%` as any }]} /></View>
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear }]} keyboardShouldPersistTaps="handled">
        <View style={s.shell}>
          <WorkbookContext.Provider value={ctx}>
            <View style={s.intro}>
              <Text style={s.label}>{day === 2 ? 'Tuesday' : 'Monday'} · Product coaching</Text>
              <Text style={s.h1}>{readOnly ? `${first}’s Day ${day} workbook`
                : day === 2 ? <>Let’s get you <Text style={{ color: c.primary }}>signing up{first ? `, ${first}` : ''}.</Text></>
                : <>Let’s get you <Text style={{ color: c.primary }}>set up{first ? `, ${first}` : ''}.</Text></>}</Text>
              {!readOnly && (
                <Text style={[s.body, { color: c.textMuted }]}>{day === 2
                  ? 'Today is how we sign customers up and what makes it work. '
                  : 'This is your workbook for today. '}Fill in the gaps and take notes as we go. Tap <Text style={s.bold}>Show answers</Text> on any section to check yourself, and do the quick quizzes when we get to them.{day === 2 ? ' Finish with your final quiz at the bottom.' : ''} It saves as you type.</Text>
              )}
              {readOnly && other && (
                <View style={s.toc}>
                  {[1, 2].map((d) => (
                    <Pressable key={d} onPress={() => router.replace(`/academy/${d}?user=${encodeURIComponent(other)}` as never)}
                      style={[s.chip, d === day && { borderColor: c.primary, backgroundColor: c.primary + '12' }]}>
                      <Text style={[s.chipT, d === day && { color: c.primary }]}>Day {d}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={s.toc}>
                {sections.map((x, i) => {
                  const on = !!state.done[x.id];
                  return (
                    <Pressable key={x.id} onPress={() => jump(x.id)} style={[s.chip, on && { borderColor: c.sgreen }]}>
                      <Text style={[s.chipN, on && { color: c.sgreenInk }]}>{String(i + 1).padStart(2, '0')}</Text>
                      <Text style={[s.chipT, on && { color: c.sgreenInk }]}>{x.short}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {day === 2 ? <Day2Page /> : <Day1Page />}
            {day === 1 && (
              <View style={s.end}>
                <Text style={s.label}>Day 1</Text>
                <Text style={[s.h1, { fontSize: 24, textAlign: 'center' }]}>See you tomorrow</Text>
                <Text style={[s.body, { color: c.textMuted, textAlign: 'center', maxWidth: 460 }]}>Day 2 covers the sign-up process, the rehash, Modern Milkman’s products and quality, and finishes with your final quiz.</Text>
              </View>
            )}
          </WorkbookContext.Provider>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.background, borderBottomWidth: 1, borderBottomColor: c.border },
  barTitle: { fontFamily: fonts.display, fontSize: 15, color: c.text },
  barSub: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  track: { height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden', marginTop: 5, width: '100%' },
  fill: { height: '100%', backgroundColor: c.primaryLight },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  shell: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  intro: { paddingTop: 20, paddingBottom: 18, gap: 14 },
  h1: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: c.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: c.text },
  bold: { fontFamily: fonts.bodySemibold },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  toc: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.background },
  chipN: { fontFamily: fonts.mono, fontSize: 12, color: c.textMuted },
  chipT: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: c.text },
  end: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
});
