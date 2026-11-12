/**
 * The Hub's AI (route: /ai?part=analyse|chat). The Owner, 2 Nov 2026:
 *   - Analyse me: once a day, a full look at your breakdowns, results, trends
 *     and plans against the office (and your team's, if you have one).
 *   - Ask the AI: a chat that knows what you can see in the app.
 *   - Past chats: your own earlier chats, nobody else's (the Owner, 5 Nov 2026).
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
import AiText from '../src/components/ai/AiText';

type Part = 'analyse' | 'chat' | 'past';
type PastChat = { id: string; date?: string; title: string; messages: number; current?: boolean };
type Msg = { role: 'user' | 'assistant'; text: string };
type TrendDay = { date: string; doors?: number | null; spoken?: number | null; pitched?: number | null;
  closed?: number | null; hit?: number | null; goal?: number | null };
type Tomorrow = { focus?: string; kpi_metric?: string; kpi_target?: number; goal?: number };
type Analysis = {
  id: string; date: string; next_field_day?: string;
  numbers?: { days: number; per_day: { label: string; you: number; good: number }[];
    steps: { label: string; you: number | null; good: number }[] } | null;
  trend?: { recent_days?: TrendDay[] } | null;
  result: {
    headline?: string;
    target?: { now?: string; next?: string; week?: string };
    change?: { what?: string; now?: string; need?: string; why?: string };
    how?: { step?: string; why?: string }[];
    result?: string; track?: string;
    last_day?: string; better?: string; slipping?: string; week?: string; follow_through?: string;
    keep_doing?: string | string[]; stop_doing?: string[]; start_doing?: string[];
    tomorrow?: Tomorrow; this_week?: { weekly_goal?: number; why?: string };
    team?: string;
    best_people?: string;
  };
};

const KPI_WORDS: Record<string, string> = { doors: 'doors', spoken: 'spoken to', pitched: 'pitched', closes: 'closes', callbacks: 'call backs' };

const asList = (v?: string | string[]) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => !!x && !!String(x).trim());

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', timeZone: APP_TZ });
}

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
  const startPart: Part = params.part === 'chat' ? 'chat' : params.part === 'past' ? 'past' : 'analyse';
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
    qc.invalidateQueries({ queryKey: ['ai', 'chats'] });
  };

  // ── Past chats ──
  const pastQ = useQuery({
    queryKey: ['ai', 'chats'],
    queryFn: async () => ((await api.get('/ai/chats')).data?.chats || []) as PastChat[],
    enabled: part === 'past',
    retry: false,
  });
  const [openId, setOpenId] = useState<string>('');
  const openQ = useQuery({
    queryKey: ['ai', 'chats', openId],
    queryFn: async () => (await api.get(`/ai/chats/${openId}`)).data?.conversation ?? null,
    enabled: !!openId,
    retry: false,
  });
  const [reopening, setReopening] = useState(false);
  const carryOn = async (id: string) => {
    setReopening(true);
    try {
      const conv = (await api.post(`/ai/chats/${id}/open`)).data?.conversation ?? null;
      qc.setQueryData(['ai', 'chat'], conv);
      qc.invalidateQueries({ queryKey: ['ai', 'chats'] });
      setOpenId('');
      setPart('chat');
      setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 80);
    } catch (e) {
      toast.error('Couldn’t open it', errText(e, 'Try again in a moment.'));
    } finally {
      setReopening(false);
    }
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
          {([['analyse', 'Analyse me'], ['chat', 'Ask'], ['past', 'Past chats']] as [Part, string][]).map(([k, label]) => (
            <Pressable key={k} onPress={() => { setPart(k); if (k === 'past') setOpenId(''); }} style={[s.tab, part === k && s.tabOn]} accessibilityRole="tab"
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
                <Text style={s.hint}>How yesterday and your week are going, where you are, where you want to be, the one thing to change, how to do it on the doors, and what it’ll do for you. One a day: best after your breakdown or before you plan tomorrow.</Text>
                <Pressable onPress={analyse} disabled={analysing || !left.analyse} style={[s.primary, (analysing || !left.analyse) && { opacity: 0.6 }]}
                  accessibilityRole="button" testID="ai-analyse">
                  {analysing ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.primaryText}>Analyse me</Text>}
                </Pressable>
                {analysing && <Text style={s.small}>Reading your numbers… this takes about 20 seconds.</Text>}
              </View>
            ) : (
              <>
                {!!a.headline && <View style={s.hero}><Text style={s.heroText}>{a.headline}</Text></View>}

                {/* How it's going: yesterday, the trend, the week, and whether breakdowns were followed through (the Owner, 12 Nov 2026). */}
                {(!!a.last_day || !!a.better || !!a.slipping || !!a.week || !!a.follow_through || !!analysisQ.data?.trend?.recent_days?.length) && (
                  <View style={s.card} testID="ai-trend">
                    <Text style={s.label}>How it’s going</Text>
                    {!!a.last_day && <Text style={s.body}><Text style={s.bold}>Last day: </Text>{a.last_day}</Text>}
                    {!!a.better && (
                      <View style={s.trackRow}><Ionicons name="trending-up" size={16} color={c.green} />
                        <Text style={[s.body, { flex: 1 }]}><Text style={s.bold}>Going better: </Text>{a.better}</Text></View>
                    )}
                    {!!a.slipping && (
                      <View style={s.trackRow}><Ionicons name="trending-down" size={16} color={c.red} />
                        <Text style={[s.body, { flex: 1 }]}><Text style={s.bold}>Needs to change: </Text>{a.slipping}</Text></View>
                    )}
                    {!!a.week && <Text style={s.body}><Text style={s.bold}>This week: </Text>{a.week}</Text>}
                    {!!a.follow_through && <Text style={s.body}><Text style={s.bold}>Your breakdowns: </Text>{a.follow_through}</Text>}
                    {!!analysisQ.data?.trend?.recent_days?.length && (
                      <View style={{ marginTop: 6 }}>
                        <View style={s.numHead}>
                          <Text style={[s.trendCell, s.trendDay, s.small]} />
                          {['Doors', 'Spoke', 'Pitch', 'Close', 'Signed'].map((h) => <Text key={h} style={[s.trendCell, s.small]}>{h}</Text>)}
                        </View>
                        {analysisQ.data!.trend!.recent_days!.map((d) => (
                          <View key={d.date} style={s.numRow}>
                            <Text style={[s.trendCell, s.trendDay, s.small]}>{shortDay(d.date)}</Text>
                            {[d.doors, d.spoken, d.pitched, d.closed].map((v, i) => <Text key={i} style={[s.trendCell, s.body]}>{v ?? '–'}</Text>)}
                            <Text style={[s.trendCell, s.body, s.bold]}>{d.hit ?? '–'}{d.goal != null ? <Text style={s.small}>/{d.goal}</Text> : null}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* 1 · Where you are: the app's own figures against what good looks like. */}
                {!!analysisQ.data?.numbers && (() => {
                  const n = analysisQ.data!.numbers!;
                  const tone = (you: number | null, good: number) => (you == null ? c.textMuted : you >= good ? c.green : you >= good * 0.85 ? c.yellow : c.red);
                  return (
                    <View style={s.card} testID="ai-numbers">
                      <Text style={s.label}><Text style={s.stepNo}>1 </Text>Where you are · last {n.days} days</Text>
                      <View style={s.numHead}><Text style={[s.numCell, s.numName]} /><Text style={[s.numCell, s.small]}>You</Text><Text style={[s.numCell, s.small]}>Good</Text></View>
                      {n.per_day.map((r) => (
                        <View key={r.label} style={s.numRow}>
                          <Text style={[s.numCell, s.numName, s.body]}>{r.label} a day</Text>
                          <Text style={[s.numCell, s.numVal, { color: tone(r.you, r.good) }]}>{r.you}</Text>
                          <Text style={[s.numCell, s.small]}>{r.label === 'Sign-ups' ? `${r.good}+` : r.good}</Text>
                        </View>
                      ))}
                      {n.steps.map((r) => (
                        <View key={r.label} style={s.numRow}>
                          <Text style={[s.numCell, s.numName, s.body]}>{r.label}</Text>
                          <Text style={[s.numCell, s.numVal, { color: tone(r.you, r.good) }]}>{r.you == null ? '–' : `${r.you}%`}</Text>
                          <Text style={[s.numCell, s.small]}>{r.good}%</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}

                {/* 2 · Where you want to be: a realistic next step up. */}
                {!!a.target?.next && (
                  <View style={s.card}>
                    <Text style={s.label}><Text style={s.stepNo}>2 </Text>Where you want to be</Text>
                    <View style={s.targetRow}>
                      {!!a.target.now && <Text style={s.targetFrom}>{a.target.now}</Text>}
                      <Ionicons name="arrow-forward" size={20} color={c.primary} />
                      <Text style={s.targetTo}>{a.target.next}</Text>
                    </View>
                    {!!a.target.week && <Text style={s.hint}>{a.target.week}</Text>}
                  </View>
                )}

                {/* 3 · What to change: the one thing. */}
                {!!a.change?.what && (
                  <View style={s.card}>
                    <Text style={s.label}><Text style={s.stepNo}>3 </Text>What to change</Text>
                    <Text style={s.gapTitle}>{a.change.what}</Text>
                    {(!!a.change.now || !!a.change.need) && (
                      <Text style={s.body}>
                        {!!a.change.now && <><Text style={s.bold}>Now </Text>{a.change.now}</>}
                        {!!a.change.now && !!a.change.need && '  ·  '}
                        {!!a.change.need && <><Text style={s.bold}>Good </Text>{a.change.need}</>}
                      </Text>
                    )}
                    {!!a.change.why && <Text style={s.hint}>{a.change.why}</Text>}
                  </View>
                )}

                {/* 4 · How to do it: three steps to try on the doors, in order. */}
                {!!a.how?.length && (
                  <View style={s.card}>
                    <Text style={s.label}><Text style={s.stepNo}>4 </Text>How to do it</Text>
                    {a.how.filter((t) => t?.step).map((t, i) => (
                      <View key={i} style={s.tipRow}>
                        <View style={s.tipNum}><Text style={s.tipNumText}>{i + 1}</Text></View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.body}>{t.step}</Text>
                          {!!t.why && <Text style={s.small}>{t.why}</Text>}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* 5 · What will change if they do it. */}
                {(!!a.result || !!a.track) && (
                  <View style={[s.card, s.resultCard]}>
                    <Text style={s.label}><Text style={s.stepNo}>5 </Text>What will change</Text>
                    {!!a.result && <Text style={s.resultText}>{a.result}</Text>}
                    {!!a.track && (
                      <View style={s.trackRow}>
                        <Ionicons name="pulse-outline" size={16} color={c.primary} />
                        <Text style={[s.body, { flex: 1 }]}><Text style={s.bold}>You’ll know it’s working: </Text>{a.track}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 6 · Lock it in: into tomorrow's set-up and this week's goal. */}
                {(!!a.tomorrow?.focus || a.this_week?.weekly_goal != null) && (
                  <View style={s.card}>
                    <Text style={s.label}><Text style={s.stepNo}>6 </Text>Lock it in</Text>
                    {!!a.tomorrow?.focus && (
                      <View style={{ gap: 2 }}>
                        <Text style={s.body}><Text style={s.bold}>{tomorrowDate ? `${dayLabel(tomorrowDate)}: ` : 'Tomorrow: '}</Text>{a.tomorrow.focus}</Text>
                        <Text style={s.hint}>{[kpiText(a.tomorrow) && `KPI ${kpiText(a.tomorrow)}`, a.tomorrow.goal != null && `Goal ${a.tomorrow.goal}`].filter(Boolean).join(' · ')}</Text>
                        <UseThis k="an-setup" kind="setup" done="It’s in your sector set-up."
                          data={{ date: tomorrowDate, focus: a.tomorrow.focus, kpi_metric: a.tomorrow.kpi_metric, kpi_target: a.tomorrow.kpi_target, goal: a.tomorrow.goal }} />
                      </View>
                    )}
                    {a.this_week?.weekly_goal != null && (
                      <View style={{ gap: 2, marginTop: 8 }}>
                        <Text style={s.body}><Text style={s.bold}>This week: </Text>{a.this_week.weekly_goal} sign-ups{a.this_week.why ? `. ${a.this_week.why}` : ''}</Text>
                        <UseThis k="an-goal" kind="weekly_goal" data={{ goal: a.this_week.weekly_goal }} done="Your weekly goal is set on Bells." />
                      </View>
                    )}
                  </View>
                )}

                {/* Keep, stop, start (the Owner, 12 Nov 2026). */}
                {(asList(a.keep_doing).length > 0 || asList(a.stop_doing).length > 0 || asList(a.start_doing).length > 0) && (
                  <View style={s.card} testID="ai-kss">
                    {([['Keep doing', a.keep_doing, 'checkmark-circle', c.green], ['Stop doing', a.stop_doing, 'close-circle', c.red],
                      ['Start doing', a.start_doing, 'add-circle', c.primary]] as [string, string | string[] | undefined, any, string][])
                      .filter(([, v]) => asList(v).length > 0).map(([title, v, icon, colour]) => (
                        <View key={title} style={{ gap: 4 }}>
                          <Text style={s.label}>{title}</Text>
                          {asList(v).map((line, i) => (
                            <View key={i} style={s.trackRow}><Ionicons name={icon} size={16} color={colour} />
                              <Text style={[s.body, { flex: 1 }]}>{line}</Text></View>
                          ))}
                        </View>
                      ))}
                  </View>
                )}
                {!!a.team && <View style={s.card}><Text style={s.label}>Your team</Text><Text style={s.body}>{a.team}</Text></View>}
                {!!a.best_people && <View style={s.card} testID="ai-best-people"><Text style={s.label}>Your best people</Text><Text style={s.body}>{a.best_people}</Text></View>}
                <Text style={[s.small, { textAlign: 'center' }]}>One analysis a day. Got a question about it? Tap Ask.</Text>
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
                {m.role === 'user'
                  ? <Text style={[s.body, { color: c.onPrimary }]} selectable>{m.text}</Text>
                  : <AiText text={m.text} />}
              </View>
            ))}
            {sending && <View style={[s.bubble, s.theirs]}><ActivityIndicator color={c.primary} /></View>}
            <View style={s.composer}>
              <TextInput value={draft} onChangeText={setDraft} placeholder="Ask anything about your numbers or how to improve" placeholderTextColor={c.textMuted}
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

        {part === 'past' && !openId && (
          <>
            {pastQ.isLoading ? (
              <ActivityIndicator color={c.primary} style={{ marginTop: 20 }} />
            ) : !(pastQ.data || []).length ? (
              <View style={s.card}>
                <Text style={s.h2}>No past chats yet</Text>
                <Text style={s.hint}>Your chats with the AI are kept here. Only you can see them.</Text>
              </View>
            ) : (
              <>
                <Text style={s.small}>Only you can see your chats.</Text>
                {(pastQ.data || []).map((p) => (
                  <Pressable key={p.id} onPress={() => setOpenId(p.id)} style={s.pastRow} accessibilityRole="button" testID={`ai-past-${p.id}`}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.pastTitle} numberOfLines={2}>{p.title}</Text>
                      <Text style={s.small}>{dayLabel(p.date)} · {Math.ceil(p.messages / 2)} {Math.ceil(p.messages / 2) === 1 ? 'question' : 'questions'}{p.current ? ' · current chat' : ''}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}

        {part === 'past' && !!openId && (
          <>
            <Pressable onPress={() => setOpenId('')} style={s.backRow} accessibilityRole="button">
              <Ionicons name="chevron-back" size={18} color={c.primary} />
              <Text style={s.link}>Past chats</Text>
            </Pressable>
            {openQ.isLoading ? (
              <ActivityIndicator color={c.primary} style={{ marginTop: 20 }} />
            ) : openQ.data ? (
              <>
                <Text style={s.small}>{dayLabel(openQ.data.date)}</Text>
                {((openQ.data.messages || []) as Msg[]).map((m, i) => (
                  <View key={i} style={[s.bubble, m.role === 'user' ? s.mine : s.theirs]}>
                    {m.role === 'user'
                      ? <Text style={[s.body, { color: c.onPrimary }]} selectable>{m.text}</Text>
                      : <AiText text={m.text} />}
                  </View>
                ))}
                <Pressable onPress={() => carryOn(openId)} disabled={reopening} style={[s.primary, reopening && { opacity: 0.6 }]}
                  accessibilityRole="button" testID="ai-past-carry-on">
                  <Text style={s.primaryText}>{reopening ? 'Opening…' : 'Carry on this chat'}</Text>
                </Pressable>
              </>
            ) : (
              <Text style={s.hint}>That chat couldn’t be found.</Text>
            )}
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
  numHead: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  numRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: c.border },
  numCell: { width: 56, textAlign: 'right' },
  trendCell: { flex: 1, textAlign: 'right', minWidth: 0 },
  trendDay: { flex: 1.4, textAlign: 'left' },
  numName: { flex: 1, width: undefined, textAlign: 'left' },
  numVal: { fontFamily: fonts.bodyBold, fontSize: 15 },
  stepNo: { color: c.primary },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  targetFrom: { fontFamily: fonts.display, fontSize: 22, color: c.textMuted },
  targetTo: { fontFamily: fonts.display, fontSize: 26, color: c.text },
  trackRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 6 },
  resultCard: { borderColor: c.primaryLight, backgroundColor: c.primary + '0d' },
  resultText: { fontFamily: fonts.display, fontSize: 18, lineHeight: 25, color: c.text },
  gapTitle: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  tipRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 2 },
  tipNum: { width: 24, height: 24, borderRadius: 8, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tipNumText: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.onPrimary },
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
  theirs: { alignSelf: 'stretch', maxWidth: '100%', backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  chatFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14 },
  pastTitle: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 21, color: c.text },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
});
