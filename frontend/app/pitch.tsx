/**
 * Learn your pitch (route: /pitch). The Owner's call (26 Oct 2026): the
 * pitch word for word, then line by line with why (linked to the COD) and
 * how to say it. Say it (the Owner's 10 out loud · 10 in the mirror · 10
 * recorded and listened back), Learn (each line hidden to its first
 * letters) and Check (6 questions). A new start's first night is Read only;
 * the rest opens at 18:00 the next day. Progress saves to their account.
 * The Owner can change the words (27 Oct 2026: just the words; the why and
 * how notes stay): Edit on the pitch, saved for the whole office.
 * (GET/PUT /pitch, PUT /pitch/words; content in src/academy/pitch.ts)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { APP_LOCALE, APP_TZ } from '../src/utils/appTime';
import { PITCH, PITCH_QUIZ, REHASH, PitchLine } from '../src/academy/pitch';

type Tab = 'read' | 'say' | 'learn' | 'check';
type State = { counts: Record<string, number>; ladder: Record<string, boolean>; quiz: Record<string, number>; shown: Record<string, boolean> };
type Status = { unlocked: boolean; unlocks_at: string | null; new_start: boolean; state: State; words?: Record<string, string>; can_edit?: boolean };

const COUNTERS = [
  { id: 'read', t: 'Read it out loud', d: 'From the page, out loud, all the way through.' },
  { id: 'mirror', t: 'Say it in the mirror', d: 'Watch your smile, eye contact and hands.' },
  { id: 'record', t: 'Record it and listen back', d: 'A voice memo on your phone. Do you sound like you mean it?' },
];
const LADDER = [
  { id: 'l1', t: 'Read it through with the notes on why and how' },
  { id: 'l3', t: 'Done all 30: out loud, in the mirror, recorded and listened back' },
  { id: 'l4', t: 'Said it to someone at home, smiling, as if they opened the door' },
  { id: 'l2', t: 'Said every line from the first letters only' },
  { id: 'l5', t: 'Scored 6 out of 6 on Check' },
];
const hint = (s: string) => s.replace(/[’']/g, "'").split(/\s+/).map((w) => {
  const m = w.match(/^([^A-Za-z]*)([A-Za-z])/);
  return m ? `${m[1]}${m[2]}…` : w;
}).join(' ');

export default function PitchScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tabClear = useTabBarClearance();
  const stepColour = (k: string) => ({ '--s1': c.primary, '--s2': c.primaryLight, '--s3': c.sgreen, '--s4': c.yellow } as Record<string, string>)[k] || c.primary;

  const q = useQuery({ queryKey: ['pitch'], queryFn: async () => (await api.get('/pitch')).data as Status, retry: false });
  const unlocked = q.data?.unlocked ?? true;
  const qc = useQueryClient();
  const words = q.data?.words || {};
  const canEdit = !!q.data?.can_edit;
  // The office's own wording over the original lines.
  const pitch = useMemo(() => PITCH.map((b) => ({
    ...b,
    lines: b.lines.map((l, i) => ({ ...l, say: words[`L${b.n}-${i}`] || l.say, q: l.q ? (words[`L${b.n}-${i}q`] || l.q) : l.q })),
  })), [words]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const startEdit = () => {
    const d: Record<string, string> = {};
    pitch.forEach((b) => b.lines.forEach((l, i) => { d[`L${b.n}-${i}`] = l.say; if (l.q) d[`L${b.n}-${i}q`] = l.q; }));
    setDraft(d); setSaveErr(''); setEditing(true);
  };
  const original = () => {
    const d: Record<string, string> = {};
    PITCH.forEach((b) => b.lines.forEach((l, i) => { d[`L${b.n}-${i}`] = l.say; if (l.q) d[`L${b.n}-${i}q`] = l.q; }));
    setDraft(d);
  };
  const saveWords = async () => {
    // Only lines that differ from the original are kept; a blank line goes back to the original.
    const out: Record<string, string> = {};
    PITCH.forEach((b) => b.lines.forEach((l, i) => {
      const k = `L${b.n}-${i}`;
      const v = (draft[k] || '').trim();
      if (v && v !== l.say) out[k] = v;
      if (l.q) { const vq = (draft[`${k}q`] || '').trim(); if (vq && vq !== l.q) out[`${k}q`] = vq; }
    }));
    setSaving(true); setSaveErr('');
    try {
      await api.put('/pitch/words', { words: out });
      await qc.invalidateQueries({ queryKey: ['pitch'] });
      setEditing(false);
    } catch (e: any) {
      setSaveErr(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Couldn’t save. Check your connection and try again.');
    } finally { setSaving(false); }
  };
  const [tab, setTab] = useState<Tab>('read');
  const [st, setSt] = useState<State>({ counts: {}, ladder: {}, quiz: {}, shown: {} });
  const loaded = useRef(false);
  useEffect(() => {
    if (q.data && !loaded.current) { loaded.current = true; const v: Partial<State> = q.data.state || {}; setSt({ counts: v.counts || {}, ladder: v.ladder || {}, quiz: v.quiz || {}, shown: v.shown || {} }); }
  }, [q.data]);

  const timer = useRef<any>(null);
  const pending = useRef<State | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current; pending.current = null;
    if (body) api.put('/pitch', body).catch(() => {});
  }, []);
  useEffect(() => () => flush(), [flush]);
  const update = (fn: (p: State) => State) => setSt((prev) => {
    const next = fn(prev);
    const allTen = COUNTERS.every((x) => (next.counts[x.id] || 0) >= 10);
    const fullQuiz = Object.keys(next.quiz).length === PITCH_QUIZ.length && PITCH_QUIZ.every((x, i) => next.quiz[String(i)] === x.a);
    const out = { ...next, ladder: { ...next.ladder, ...(allTen ? { l3: true } : {}), ...(fullQuiz ? { l5: true } : {}) } };
    pending.current = out;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
    return out;
  });

  if (q.isLoading) return <View style={[s.page, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={c.primary} /></View>;

  const opens = q.data?.unlocks_at ? new Date(q.data.unlocks_at).toLocaleString(APP_LOCALE, { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP_TZ }) : '';
  const locked = (t: Tab) => t !== 'read' && !unlocked;

  const Line = ({ l, id, learn }: { l: PitchLine; id: string; learn?: boolean }) => {
    const hidden = learn && !st.shown[id];
    const body = (
      <View style={s.line}>
        <Text style={[s.say, hidden && s.hiddenSay]}>{hidden ? hint(l.say) : l.say}{!hidden && l.q ? <Text style={s.q}>{`  … ${l.q}`}</Text> : null}</Text>
        {!learn && (
          <>
            <Text style={s.why}><Text style={s.whyB}>Why: </Text>{l.why}</Text>
            <View style={s.how}><Text style={s.howB}>HOW</Text><Text style={s.howT}>{l.how}</Text></View>
            <View style={s.tags}>{l.tags.map((t) => <Text key={t[0]} style={[s.tag, t[1] === 'g' && s.tagG, t[1] === 'q' && s.tagQ]}>{t[0]}</Text>)}</View>
          </>
        )}
      </View>
    );
    if (!learn) return body;
    return <Pressable onPress={() => update((p) => ({ ...p, shown: { ...p.shown, [id]: !p.shown[id] } }))} accessibilityRole="button" accessibilityLabel={hidden ? 'Show this line' : 'Hide this line'}>{body}</Pressable>;
  };

  const Steps = ({ learn }: { learn?: boolean }) => (
    <>
      {pitch.map((b) => (
        <View key={b.n} style={[s.block, { borderLeftColor: stepColour(b.c) }]}>
          <View style={s.blockHead}>
            <View style={[s.num, { borderColor: stepColour(b.c) }]}><Text style={[s.numT, { color: stepColour(b.c) }]}>0{b.n}</Text></View>
            <Text style={s.blockT}>{b.t}</Text>
            <Text style={s.job}>{b.job}</Text>
          </View>
          {b.lines.map((l, i) => <Line key={i} l={l} id={`L${b.n}-${i}`} learn={learn} />)}
        </View>
      ))}
    </>
  );

  return (
    <View style={s.page}>
      <View style={s.tabs}>
        {(['read', 'say', 'learn', 'check'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            {locked(t) && <Ionicons name="lock-closed" size={11} color={tab === t ? c.onPrimary : c.textMuted} />}
            <Text style={[s.tabT, tab === t && { color: c.onPrimary }]}>{t === 'read' ? 'Read' : t === 'say' ? 'Say it' : t === 'learn' ? 'Learn' : 'Check'}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear }]}>
        <View style={s.shell}>
          {tab === 'read' && (
            <>
              <Text style={s.kicker}>Your pitch</Text>
              <Text style={s.h1}>Learn your pitch</Text>
              <Text style={s.muted}>What you’ll say at every door: four steps, about 30 seconds. Learn what each line is for, not just the words, so you always know where you are.</Text>
              <View style={s.full}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.kicker}>The pitch</Text>
                    <Text style={s.h2}>Say this at every door</Text>
                  </View>
                  {canEdit && !editing && (
                    <Pressable onPress={startEdit} style={[s.btn, { flexDirection: 'row', gap: 6 }]} accessibilityRole="button" testID="pitch-edit">
                      <Ionicons name="create-outline" size={15} color={c.text} /><Text style={s.btnT}>Edit</Text>
                    </Pressable>
                  )}
                </View>
                {editing ? (
                  <>
                    <Text style={s.small}>Change the words people say. The notes on why and how stay as they are. Leave a line blank to go back to the original.</Text>
                    {PITCH.map((b) => (
                      <View key={b.n} style={{ gap: 6 }}>
                        <Text style={[s.kicker, { color: stepColour(b.c) }]}>{b.n} · {b.t}</Text>
                        {b.lines.map((l, i) => {
                          const k = `L${b.n}-${i}`;
                          return (
                            <View key={k} style={{ gap: 4 }}>
                              <TextInput value={draft[k] ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, [k]: v }))} multiline placeholder={l.say}
                                placeholderTextColor={c.textMuted} style={s.edit} accessibilityLabel={`Line ${b.n}.${i + 1}`} />
                              {!!l.q && (
                                <TextInput value={draft[`${k}q`] ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, [`${k}q`]: v }))} placeholder={l.q}
                                  placeholderTextColor={c.textMuted} style={[s.edit, { marginLeft: 14 }]} accessibilityLabel={`Line ${b.n}.${i + 1}, after they answer`} />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                    {!!saveErr && <Text style={[s.small, { color: c.red }]}>{saveErr}</Text>}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <Pressable onPress={saveWords} disabled={saving} style={[s.btn, s.btnPrimary]} accessibilityRole="button" testID="pitch-save">
                        <Text style={[s.btnT, { color: c.onPrimary }]}>{saving ? 'Saving…' : 'Save for everyone'}</Text>
                      </Pressable>
                      <Pressable onPress={() => setEditing(false)} style={s.btn} accessibilityRole="button"><Text style={s.btnT}>Cancel</Text></Pressable>
                      <Pressable onPress={original} style={s.btn} accessibilityRole="button"><Text style={s.btnT}>Use the original wording</Text></Pressable>
                    </View>
                  </>
                ) : pitch.map((b) => (
                  <View key={b.n} style={{ gap: 3 }}>
                    <Text style={[s.kicker, { color: stepColour(b.c) }]}>{b.n} · {b.t}</Text>
                    {/* One line each, like the Owner's own pitch sheet. */}
                    {b.lines.map((l, i) => (
                      <View key={i} style={{ marginBottom: 6 }}>
                        <Text style={s.fullP}>{l.say}</Text>
                        {!!l.q && <Text style={[s.fullP, { color: c.textMuted, paddingLeft: 14 }]}>… {l.q}</Text>}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
              <Text style={[s.h2, { marginTop: 8 }]}>Line by line: why and how</Text>
              <Steps />
              <View style={s.after}>
                <Text style={[s.kicker, { color: c.inkMuted }]}>After they say yes</Text>
                <Text style={[s.h2, { color: c.inkText, fontSize: 17 }]}>Then the Rehash</Text>
                {REHASH.map((r) => <Text key={r} style={{ fontFamily: fonts.body, fontSize: 14, color: c.inkMuted }}>• {r}</Text>)}
              </View>
              {!unlocked && <Text style={[s.muted, { textAlign: 'center' }]}>Tonight, just read it through. We’ll go over it together tomorrow, then Say it, Learn and Check open {opens ? `on ${opens}` : 'tomorrow evening'}.</Text>}
            </>
          )}

          {tab !== 'read' && locked(tab) && (
            <View style={s.lock}>
              <Ionicons name="lock-closed-outline" size={26} color={c.textMuted} />
              <Text style={s.kicker}>{opens ? `Opens ${opens}` : 'Opens tomorrow evening'}</Text>
              <Text style={s.h2}>Not yet</Text>
              <Text style={[s.muted, { textAlign: 'center' }]}>Tonight, read the pitch through with the notes on why and how. We’ll go over it together tomorrow, then this opens.</Text>
              <Pressable onPress={() => setTab('read')} style={s.btn}><Text style={s.btnT}>Read the pitch</Text></Pressable>
            </View>
          )}

          {tab === 'say' && !locked('say') && (
            <>
              <Text style={s.h2}>Practise it 30 times</Text>
              <Text style={s.muted}>The full pitch, start to finish, every time. Tick each one off as you go.</Text>
              {COUNTERS.map((x) => {
                const n = st.counts[x.id] || 0;
                return (
                  <View key={x.id} style={[s.ctr, n >= 10 && s.ctrDone]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={s.ctrT}>{x.t}</Text>
                      <Text style={s.small}>{x.d}</Text>
                    </View>
                    <Text style={s.ctrN}>{n}<Text style={s.small}> / 10</Text></Text>
                    <View style={{ gap: 6 }}>
                      <Pressable onPress={() => update((p) => ({ ...p, counts: { ...p.counts, [x.id]: Math.min(10, (p.counts[x.id] || 0) + 1) } }))} style={[s.btn, s.btnPrimary]} accessibilityLabel={`${x.t}: one more done`}><Text style={[s.btnT, { color: c.onPrimary }]}>+1</Text></Pressable>
                      <Pressable onPress={() => update((p) => ({ ...p, counts: { ...p.counts, [x.id]: Math.max(0, (p.counts[x.id] || 0) - 1) } }))} style={s.btn} accessibilityLabel={`${x.t}: take one off`}><Text style={s.btnT}>−</Text></Pressable>
                    </View>
                  </View>
                );
              })}
              <View style={s.card}>
                <Text style={s.kicker}>Your checklist</Text>
                {LADDER.map((x) => {
                  const on = !!st.ladder[x.id];
                  return (
                    <Pressable key={x.id} onPress={() => update((p) => ({ ...p, ladder: { ...p.ladder, [x.id]: !on } }))} style={[s.tick, on && s.tickOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.sgreen : c.textMuted} />
                      <Text style={s.tickT}>{x.t}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={s.tips}>
                {[['Smile when you say it', 'People hear a smile. Body language and tone are most of the message; the words are only 7%.'],
                  ['Pause after a question', '“Is it yourself that does the shopping?” Then stop and let them answer. The yeses are the point.'],
                  ['Keep it chatty', 'It should sound like a neighbour, not a script. Slow down and say it like you mean it.'],
                  ['Learn it in steps', 'Get the Introduction perfect, then add the Presentation, and so on.']].map(([t, d]) => (
                  <View key={t} style={s.tip}><Text style={s.ctrT}>{t}</Text><Text style={s.small}>{d}</Text></View>
                ))}
              </View>
            </>
          )}

          {tab === 'learn' && !locked('learn') && (
            <>
              <Text style={s.muted}>Each line is hidden down to its first letters. Say it out loud, then tap the line to check.</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => update((p) => ({ ...p, shown: {} }))} style={s.btn}><Text style={s.btnT}>Hide all</Text></Pressable>
                <Pressable onPress={() => update((p) => ({ ...p, shown: Object.fromEntries(pitch.flatMap((b) => b.lines.map((_, i) => [`L${b.n}-${i}`, true]))) }))} style={s.btn}><Text style={s.btnT}>Show all</Text></Pressable>
              </View>
              <Steps learn />
            </>
          )}

          {tab === 'check' && !locked('check') && (
            <View style={s.quiz}>
              <Text style={[s.kicker, { color: c.inkMuted }]}>Check yourself</Text>
              <Text style={[s.h2, { color: c.inkText }]}>6 quick questions</Text>
              {PITCH_QUIZ.map((x, i) => {
                const pk = st.quiz[String(i)];
                const has = pk != null;
                return (
                  <View key={i} style={{ gap: 8 }}>
                    <Text style={s.qq}>{i + 1}. {x.p}</Text>
                    {x.o.map((o, j) => (
                      <Pressable key={j} disabled={has} onPress={() => update((p) => ({ ...p, quiz: { ...p.quiz, [String(i)]: j } }))}
                        style={[s.opt, has && j === x.a && s.optR, has && j === pk && j !== x.a && s.optW]}>
                        <Text style={s.optT}>{o}</Text>
                      </Pressable>
                    ))}
                    {has && <Text style={s.qw}><Text style={{ fontFamily: fonts.bodySemibold, color: c.inkText }}>{pk === x.a ? 'Correct. ' : 'Not quite. '}</Text>{x.w}</Text>}
                  </View>
                );
              })}
              {Object.keys(st.quiz).length === PITCH_QUIZ.length && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.score}>{PITCH_QUIZ.filter((x, i) => st.quiz[String(i)] === x.a).length} / {PITCH_QUIZ.length}</Text>
                  <Pressable onPress={() => update((p) => ({ ...p, quiz: {} }))} style={s.opt}><Text style={s.optT}>Try again</Text></Pressable>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  tabs: { flexDirection: 'row', gap: 4, margin: 12, marginBottom: 0, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  tab: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 999 },
  tabOn: { backgroundColor: c.primary },
  tabT: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.textMuted },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 12 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  h1: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, color: c.text },
  h2: { fontFamily: fonts.display, fontSize: 20, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  full: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 12 },
  fullP: { fontFamily: fonts.bodyMedium, fontSize: 16.5, lineHeight: 25, color: c.text },
  block: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderLeftWidth: 4, borderRadius: 14, overflow: 'hidden' },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4, flexWrap: 'wrap' },
  num: { width: 28, height: 28, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  numT: { fontFamily: fonts.monoSemibold, fontSize: 12 },
  blockT: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  job: { fontFamily: fonts.mono, fontSize: 11, color: c.textMuted, marginLeft: 'auto' },
  line: { paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.border, gap: 6 },
  say: { fontFamily: fonts.bodySemibold, fontSize: 17, lineHeight: 25, color: c.text },
  hiddenSay: { fontFamily: fonts.mono, fontSize: 15, color: c.textMuted, letterSpacing: 0.5 },
  q: { fontFamily: fonts.body, color: c.textMuted, fontStyle: 'italic' },
  why: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  whyB: { fontFamily: fonts.bodySemibold, color: c.text },
  how: { flexDirection: 'row', gap: 8, backgroundColor: c.yellowBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  howB: { fontFamily: fonts.monoSemibold, fontSize: 10.5, color: c.yellow, paddingTop: 2 },
  howT: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag: { fontFamily: fonts.mono, fontSize: 10.5, color: c.primary, backgroundColor: c.primary + '14', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  tagG: { color: c.yellow, backgroundColor: c.yellowBg },
  tagQ: { color: c.sgreenInk, backgroundColor: c.sgreenBg },
  after: { backgroundColor: c.ink, borderRadius: 14, padding: 16, gap: 6 },
  lock: { alignItems: 'center', gap: 8, backgroundColor: c.background, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, borderRadius: 16, padding: 24, marginTop: 8 },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary },
  btnT: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  ctr: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14 },
  ctrDone: { borderColor: c.sgreen, backgroundColor: c.sgreenBg },
  ctrT: { fontFamily: fonts.display, fontSize: 16, color: c.text },
  ctrN: { fontFamily: fonts.display, fontSize: 30, color: c.text },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, gap: 8 },
  tick: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10 },
  tickOn: { borderColor: c.sgreen, backgroundColor: c.sgreenBg },
  tickT: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: c.text },
  tips: { gap: 10 },
  tip: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, gap: 2 },
  quiz: { backgroundColor: c.ink, borderRadius: 16, padding: 18, gap: 16 },
  qq: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 22, color: c.inkText },
  opt: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  optR: { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: '#3ddc9a' },
  optW: { backgroundColor: 'rgba(239,68,68,0.22)', borderColor: '#ff8a8a' },
  optT: { fontFamily: fonts.body, fontSize: 15, color: c.inkText },
  edit: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 23, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: c.surface, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any,
  qw: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: c.inkMuted },
  score: { fontFamily: fonts.display, fontSize: 18, color: c.markOnInk },
});
