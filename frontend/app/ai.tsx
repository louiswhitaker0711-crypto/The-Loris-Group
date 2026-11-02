/**
 * The Hub's AI (route: /ai?part=analyse|plan|chat). The Owner, 2 Nov 2026:
 *   - Analyse me: once a day, a full look at your breakdowns, results, trends
 *     and plans against the office (and your team's, if you have one).
 *   - Suggest my plan: tomorrow's set-up, this week's goal and planner boxes.
 *   - Ask the AI: a chat that knows what you can see in the app.
 * Nothing changes until you tap "Use this" (POST /ai/apply), which fills it
 * in as you, with the same permissions as the rest of the app.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { toast } from '../src/utils/toast';
import { APP_LOCALE, APP_TZ } from '../src/utils/appTime';
import type { AiStatus } from '../src/components/home/AiCoachCard';

type Part = 'analyse' | 'plan' | 'chat';
type Msg = { role: 'user' | 'assistant'; text: string };
type Tomorrow = { focus?: string; kpi_metric?: string; kpi_target?: number; goal?: number };
type Analysis = {
  id: string; date: string; next_field_day?: string;
  result: {
    headline?: string; strengths?: string[];
    biggest_gap?: { step?: string; numbers?: string; why?: string };
    trend?: string; tomorrow?: Tomorrow; this_week?: { weekly_goal?: number; why?: string };
    team?: string; quality?: string;
  };
};
type PlanItem = { date: string; box: string; box_label?: string; text: string };
type NoteItem = { date: string; title: string; body: string };
type Suggestion = {
  summary?: string;
  weekly_goal?: { goal?: number; why?: string } | null;
  setup?: (Tomorrow & { date?: string; positive?: string }) | null;
  planner?: PlanItem[];
  notes?: NoteItem[];
};

const KPI_WORDS: Record<string, string> = { doors: 'doors', spoken: 'spoken to', pitched: 'pitched', closes: 'closes', callbacks: 'call backs' };

function dayLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'short', timeZone: APP_TZ });
}

function errText(e: any, fallback: string): string {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
}

export default function AiScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const tabClear = useTabBarClearance();
  const kb = useKeyboardInset();
  const params = useLocalSearchParams<{ part?: string }>();
  const startPart: Part = params.part === 'plan' || params.part === 'chat' ? params.part : 'analyse';
  const [part, setPart] = useState<Part>(startPart);
  const scroll = useRef<ScrollView>(null);

  const status = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: async () => (await api.get('/ai/status')).data as AiStatus,
    retry: false,
  });
  const left = status.data?.left || {};

  // ── Use this ──
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState<string>('');
  const fillIn = async (key: string, kind: string, data: Record<string, unknown>, done: string) => {
    setApplying(key);
    try {
      await api.post('/ai/apply', { kind, data });
      setApplied((a) => ({ ...a, [key]: true }));
      qc.invalidateQueries({ queryKey: ['bells'] });
      qc.invalidateQueries({ queryKey: ['sector'] });
      qc.invalidateQueries({ queryKey: ['weekly-planner'] });
      toast.success('Done', done);
    } catch (e) {
      toast.error('Couldn’t fill that in', errText(e, 'Check your connection and try again.'));
    } finally {
      setApplying('');
    }
  };
  const UseThis = ({ k, kind, data, done }: { k: string; kind: string; data: Record<string, unknown>; done: string }) => (
    applied[k] ? (
      <View style={s.usedPill}><Ionicons name="checkmark" size={14} color={c.primary} /><Text style={s.usedText}>Filled in</Text></View>
    ) : (
      <Pressable onPress={() => fillIn(k, kind, data, done)} disabled={!!applying} style={[s.usePill, !!applying && { opacity: 0.6 }]}
        accessibilityRole="button" testID={`ai-use-${k}`}>
        {applying === k ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Text style={s.useText}>Use this</Text>}
      </Pressable>
    )
  );

  // ── Analyse me ──
  const analysisQ = useQuery({
    queryKey: ['ai', 'analysis'],
    queryFn: async () => (await api.get('/ai/analyse')).data?.analysis as Analysis | null,
    retry: false,
  });
  const [analysing, setAnalysing] = useState(false);
  const analyse = async () => {
    setAnalysing(true);
    try {
      const r = (await api.post('/ai/analyse')).data?.analysis as Analysis;
      qc.setQueryData(['ai', 'analysis'], r);
      qc.invalidateQueries({ queryKey: ['ai', 'status'] });
    } catch (e) {
      toast.error('No analysis', errText(e, 'The AI didn’t answer. Try again in a moment.'));
    } finally {
      setAnalysing(false);
    }
  };

  // ── Suggest my plan ──
  const [ask, setAsk] = useState('');
  const [plan, setPlan] = useState<Suggestion | null>(null);
  const [planning, setPlanning] = useState(false);
  const suggest = async () => {
    setPlanning(true);
    try {
      const r = (await api.post('/ai/suggest-plan', { ask })).data?.suggestion as Suggestion;
      setPlan(r);
      setApplied({});
      qc.invalidateQueries({ queryKey: ['ai', 'status'] });
    } catch (e) {
      toast.error('No plan', errText(e, 'The AI didn’t answer. Try again in a moment.'));
    } finally {
      setPlanning(false);
    }
  };

  // ── Chat ──
  const chatQ = useQuery({
    queryKey: ['ai', 'chat'],
    queryFn: async () => (await api.get('/ai/chat')).data?.conversation ?? null,
    retry: false,
  });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const m = (chatQ.data?.messages || []) as Msg[];
    setMsgs(m.map((x) => ({ role: x.role, text: x.text })));
  }, [chatQ.data]);
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setSending(true);
    try {
      const r = (await api.post('/ai/chat', { message: text })).data;
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply }]);
      qc.invalidateQueries({ queryKey: ['ai', 'status'] });
    } catch (e) {
      setMsgs((m) => m.slice(0, -1));
      setDraft(text);
      toast.error('Not sent', errText(e, 'The AI didn’t answer. Try again in a moment.'));
    } finally {
      setSending(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };
  const newChat = async () => {
    try {
      await api.post('/ai/chat/new');
    } catch { /* nothing to close */ }
    setMsgs([]);
    qc.setQueryData(['ai', 'chat'], null);
  };

  if (status.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  if (!status.data?.enabled) {
    return (
      <View style={[s.page, s.center, { padding: 24 }]}>
        <Ionicons name="sparkles-outline" size={32} color={c.textMuted} />
        <Text style={[s.hint, { textAlign: 'center', marginTop: 8 }]}>The AI isn’t switched on yet. The Owner needs to add the AI key.</Text>
      </View>
    );
  }

  const a = analysisQ.data?.result;
  const tomorrowDate = analysisQ.data?.next_field_day;
  const kpiText = (t?: Tomorrow) => (t?.kpi_metric ? `${t.kpi_target ?? ''} ${KPI_WORDS[t.kpi_metric] || t.kpi_metric}`.trim() : '');

  return (
    <ScrollView ref={scroll} style={s.page} contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        <View style={s.tabs}>
          {([['analyse', 'Analyse me'], ['plan', 'My plan'], ['chat', 'Ask']] as [Part, string][]).map(([k, label]) => (
            <Pressable key={k} onPress={() => setPart(k)} style={[s.tab, part === k && s.tabOn]} accessibilityRole="tab"
              accessibilityState={{ selected: part === k }} testID={`ai-tab-${k}`}>
              <Text style={[s.tabText, part === k && s.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {part === 'analyse' && (
          <>
            {!a ? (
              <View style={s.card}>
                <Text style={s.h2}>Your analysis for today</Text>
                <Text style={s.hint}>The AI reads your breakdowns, results, trends and plans, compares them with the office, and tells you the one thing to work on. You get one a day, so it’s worth doing after your breakdown or before you plan tomorrow.</Text>
                <Pressable onPress={analyse} disabled={analysing || !left.analyse} style={[s.primary, (analysing || !left.analyse) && { opacity: 0.6 }]}
                  accessibilityRole="button" testID="ai-analyse">
                  {analysing ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.primaryText}>Analyse me</Text>}
                </Pressable>
                {analysing && <Text style={s.small}>Reading your numbers… this takes about 20 seconds.</Text>}
              </View>
            ) : (
              <>
                {!!a.headline && <View style={s.hero}><Text style={s.heroText}>{a.headline}</Text></View>}
                {!!a.strengths?.length && (
                  <View style={s.card}>
                    <Text style={s.label}>Going well</Text>
                    {a.strengths.map((x, i) => <Text key={i} style={s.bullet}>• {x}</Text>)}
                  </View>
                )}
                {!!a.biggest_gap?.step && (
                  <View style={s.card}>
                    <Text style={s.label}>Biggest gap</Text>
                    <Text style={s.body}><Text style={s.bold}>{a.biggest_gap.step}</Text>{a.biggest_gap.numbers ? `: ${a.biggest_gap.numbers}` : ''}</Text>
                    {!!a.biggest_gap.why && <Text style={s.hint}>Why: {a.biggest_gap.why}</Text>}
                  </View>
                )}
                {!!a.trend && <View style={s.card}><Text style={s.label}>Trend</Text><Text style={s.body}>{a.trend}</Text></View>}
                {!!a.tomorrow?.focus && (
                  <View style={s.card}>
                    <Text style={s.label}>{tomorrowDate ? `${dayLabel(tomorrowDate)}’s set-up` : 'Tomorrow'}</Text>
                    <Text style={s.body}><Text style={s.bold}>Focus: </Text>{a.tomorrow.focus}</Text>
                    {!!kpiText(a.tomorrow) && <Text style={s.body}><Text style={s.bold}>KPI: </Text>{kpiText(a.tomorrow)}</Text>}
                    {a.tomorrow.goal != null && <Text style={s.body}><Text style={s.bold}>Goal: </Text>{a.tomorrow.goal} sign-ups</Text>}
                    <UseThis k="an-setup" kind="setup" done="It’s in your sector set-up."
                      data={{ date: tomorrowDate, focus: a.tomorrow.focus, kpi_metric: a.tomorrow.kpi_metric, kpi_target: a.tomorrow.kpi_target, goal: a.tomorrow.goal }} />
                  </View>
                )}
                {a.this_week?.weekly_goal != null && (
                  <View style={s.card}>
                    <Text style={s.label}>This week’s goal</Text>
                    <Text style={s.body}><Text style={s.bold}>{a.this_week.weekly_goal} sign-ups</Text>{a.this_week.why ? `: ${a.this_week.why}` : ''}</Text>
                    <UseThis k="an-goal" kind="weekly_goal" data={{ goal: a.this_week.weekly_goal }} done="Your weekly goal is set on Bells." />
                  </View>
                )}
                {!!a.team && <View style={s.card}><Text style={s.label}>Your team</Text><Text style={s.body}>{a.team}</Text></View>}
                {!!a.quality && <View style={s.card}><Text style={s.label}>Quality</Text><Text style={s.body}>{a.quality}</Text></View>}
                <Text style={[s.small, { textAlign: 'center' }]}>One analysis a day. Got a question about it? Tap Ask.</Text>
              </>
            )}
          </>
        )}

        {part === 'plan' && (
          <>
            <View style={s.card}>
              <Text style={s.h2}>Suggest my plan</Text>
              <Text style={s.hint}>Tomorrow’s set-up, this week’s goal and what to put in your planner, from your numbers and what you said you’d change. Nothing changes until you tap Use this.</Text>
              <TextInput value={ask} onChangeText={setAsk} placeholder="Anything to add? e.g. I’m leading a sector tomorrow" placeholderTextColor={c.textMuted}
                style={s.input} multiline maxLength={600} testID="ai-plan-ask" />
              <Pressable onPress={suggest} disabled={planning || !left.suggest} style={[s.primary, (planning || !left.suggest) && { opacity: 0.6 }]}
                accessibilityRole="button" testID="ai-suggest">
                {planning ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.primaryText}>{plan ? 'Suggest again' : 'Suggest my plan'}</Text>}
              </Pressable>
              <Text style={s.small}>{left.suggest ?? 0} left today</Text>
            </View>
            {plan && (
              <>
                {!!plan.summary && <View style={s.hero}><Text style={s.heroText}>{plan.summary}</Text></View>}
                {!!plan.setup && (
                  <View style={s.card}>
                    <Text style={s.label}>{plan.setup.date ? `${dayLabel(plan.setup.date)}’s set-up` : 'Set-up'}</Text>
                    {plan.setup.goal != null && <Text style={s.body}><Text style={s.bold}>Goal: </Text>{plan.setup.goal} sign-ups</Text>}
                    {!!plan.setup.focus && <Text style={s.body}><Text style={s.bold}>Focus: </Text>{plan.setup.focus}</Text>}
                    {!!kpiText(plan.setup) && <Text style={s.body}><Text style={s.bold}>KPI: </Text>{kpiText(plan.setup)}</Text>}
                    {!!plan.setup.positive && <Text style={s.body}><Text style={s.bold}>Keep doing: </Text>{plan.setup.positive}</Text>}
                    <UseThis k="pl-setup" kind="setup" data={{ ...plan.setup }} done="It’s in your sector set-up." />
                  </View>
                )}
                {plan.weekly_goal?.goal != null && (
                  <View style={s.card}>
                    <Text style={s.label}>This week’s goal</Text>
                    <Text style={s.body}><Text style={s.bold}>{plan.weekly_goal.goal} sign-ups</Text>{plan.weekly_goal.why ? `: ${plan.weekly_goal.why}` : ''}</Text>
                    <UseThis k="pl-goal" kind="weekly_goal" data={{ goal: plan.weekly_goal.goal }} done="Your weekly goal is set on Bells." />
                  </View>
                )}
                {(plan.planner || []).map((p, i) => (
                  <View key={`p${i}`} style={s.card}>
                    <Text style={s.label}>Planner · {dayLabel(p.date)} · {p.box_label || p.box}</Text>
                    <Text style={s.body}>{p.text}</Text>
                    <UseThis k={`pl-p${i}`} kind="planner" data={{ date: p.date, box: p.box, text: p.text }} done="Added to your planner." />
                  </View>
                ))}
                {(plan.notes || []).map((n, i) => (
                  <View key={`n${i}`} style={s.card}>
                    <Text style={s.label}>Note · {dayLabel(n.date)}</Text>
                    <Text style={[s.body, s.bold]}>{n.title}</Text>
                    <Text style={s.body}>{n.body}</Text>
                    <UseThis k={`pl-n${i}`} kind="note" data={{ date: n.date, title: n.title, body: n.body }} done="Saved in your planner’s notes." />
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {part === 'chat' && (
          <>
            {!msgs.length && (
              <View style={s.card}>
                <Text style={s.h2}>Ask the AI</Text>
                <Text style={s.hint}>It can see what you can see in the app: your numbers, trends, breakdowns and plans, the office’s numbers, and your team’s if you have one. Try “Why is my close rate down?” or “What should I work on tomorrow?”</Text>
              </View>
            )}
            {msgs.map((m, i) => (
              <View key={i} style={[s.bubble, m.role === 'user' ? s.mine : s.theirs]}>
                <Text style={[s.body, m.role === 'user' && { color: c.onPrimary }]} selectable>{m.text}</Text>
              </View>
            ))}
            {sending && <View style={[s.bubble, s.theirs]}><ActivityIndicator color={c.primary} /></View>}
            <View style={s.composer}>
              <TextInput value={draft} onChangeText={setDraft} placeholder="Ask anything about your numbers or plan" placeholderTextColor={c.textMuted}
                style={[s.input, { flex: 1, minHeight: 44 }]} multiline maxLength={2000} testID="ai-chat-input" />
              <Pressable onPress={send} disabled={sending || !draft.trim() || !left.chat} style={[s.send, (sending || !draft.trim() || !left.chat) && { opacity: 0.5 }]}
                accessibilityRole="button" accessibilityLabel="Send" testID="ai-chat-send">
                <Ionicons name="arrow-up" size={20} color={c.onPrimary} />
              </Pressable>
            </View>
            <View style={s.chatFoot}>
              <Text style={s.small}>{left.chat ?? 0} messages left today</Text>
              {!!msgs.length && <Pressable onPress={newChat} accessibilityRole="button"><Text style={s.link}>New chat</Text></Pressable>}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12 },
  tabs: { flexDirection: 'row', backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 999, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999 },
  tabOn: { backgroundColor: c.primary },
  tabText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.textMuted },
  tabTextOn: { color: c.onPrimary },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 8 },
  hero: { backgroundColor: c.ink, borderRadius: 18, padding: 18 },
  heroText: { fontFamily: fonts.display, fontSize: 20, lineHeight: 27, color: c.inkText },
  h2: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.text },
  bold: { fontFamily: fonts.bodySemibold },
  bullet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.text },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: c.textMuted },
  link: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  input: { fontFamily: fonts.body, fontSize: 15, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.surface, minHeight: 44 },
  primary: { backgroundColor: c.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  usePill: { alignSelf: 'flex-start', backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4, minWidth: 92, alignItems: 'center' },
  useText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  usedPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginTop: 4 },
  usedText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: c.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  chatFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
