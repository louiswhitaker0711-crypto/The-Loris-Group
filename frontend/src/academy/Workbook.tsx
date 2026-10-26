/**
 * BA Academy workbook — the building blocks the day pages are made of:
 * numbered sections, fill-in gaps, notes boxes, key points, quizzes and the
 * break dividers. State (gaps, notes, ticks, quiz answers) lives in the
 * WorkbookContext the screen provides, so every block saves the same way.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../theme/ThemeContext';
import type { Quiz, WorkbookState } from './day1';

type Ctx = {
  state: WorkbookState;
  readOnly: boolean;
  setField: (id: string, v: string) => void;
  toggleDone: (id: string) => void;
  answer: (quiz: string, i: number, j: number) => void;
  retry: (quiz: string) => void;
};
export const WorkbookContext = createContext<Ctx | null>(null);
const useWb = () => {
  const v = useContext(WorkbookContext);
  if (!v) throw new Error('WorkbookContext missing');
  return v;
};
const RevealContext = createContext(false);

export function useWbStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

// ── Section ─────────────────────────────────────────────────────────────────
export function Section({ id, n, title, sub, answers = true, footNote, children }: {
  id: string; n: number; title: string; sub?: string; answers?: boolean; footNote?: string; children: React.ReactNode;
}) {
  const s = useWbStyles();
  const c = useColors();
  const { state, toggleDone, readOnly } = useWb();
  const [reveal, setReveal] = useState(false);
  const done = !!state.done[id];
  return (
    <View style={s.sec} nativeID={id} testID={`academy-${id}`}>
      <View style={s.secHead}>
        <View style={[s.num, done && s.numDone]}>
          {done ? <Ionicons name="checkmark" size={18} color={c.onPrimary} />
            : <Text style={s.numText}>{String(n).padStart(2, '0')}</Text>}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.secTitle}>{title}</Text>
          {!!sub && <Text style={s.secSub}>{sub}</Text>}
        </View>
      </View>
      <RevealContext.Provider value={reveal}>
        <View style={s.secBody}>{children}</View>
      </RevealContext.Provider>
      <View style={s.foot}>
        {answers ? (
          <Pressable onPress={() => setReveal((r) => !r)} style={s.btn} accessibilityRole="button">
            <Text style={s.btnText}>{reveal ? 'Hide answers' : 'Show answers'}</Text>
          </Pressable>
        ) : <Text style={s.label}>{footNote || 'Your own answers'}</Text>}
        {readOnly ? (
          <Text style={[s.label, done && { color: c.sgreenInk }]}>{done ? 'Done ✓' : 'Not done yet'}</Text>
        ) : (
          <Pressable onPress={() => toggleDone(id)} style={[s.btn, done ? s.btnDone : s.btnPrimary]} accessibilityRole="button" testID={`academy-done-${id}`}>
            <Text style={[s.btnText, done ? { color: c.sgreenInk } : { color: c.onPrimary }]}>{done ? 'Done ✓' : 'Mark section done'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Fill-in gaps ────────────────────────────────────────────────────────────
export type Gap = { id: string; a?: string; w?: number };
/** A sentence with gaps: ['The most important link is ', {id:'o1', a:'BA', w:12}, '.'] */
export function Fill({ parts, big }: { parts: (string | Gap)[]; big?: boolean }) {
  const s = useWbStyles();
  const c = useColors();
  const { state, setField, readOnly } = useWb();
  const reveal = useContext(RevealContext);
  const out: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    if (typeof p === 'string') {
      // One Text per word so the line wraps like a sentence around the gaps.
      p.split(/(\s+)/).forEach((w, j) => {
        if (!w) return;
        if (/^\s+$/.test(w)) { out.push(<Text key={`${i}-${j}`} style={[s.fillText, big && s.fillBig]}>{' '}</Text>); return; }
        out.push(<Text key={`${i}-${j}`} style={[s.fillText, big && s.fillBig]}>{w}</Text>);
      });
      return;
    }
    const key = `b-${p.id}`;
    out.push(
      <View key={key} style={s.gapWrap}>
        <TextInput
          value={state.fields[key] || ''}
          onChangeText={(v) => setField(key, v)}
          editable={!readOnly}
          placeholder="✎"
          placeholderTextColor={c.primaryLight}
          style={[s.gap, { width: Math.max(5, p.w || 8) * 9.5 }]}
          accessibilityLabel="Fill in the gap"
          autoCapitalize="none"
          testID={`academy-gap-${p.id}`}
        />
        {reveal && !!p.a && <Text style={s.ans}>{p.a}</Text>}
      </View>,
    );
  });
  return <View style={s.fillRow}>{out}</View>;
}

// ── Notes ───────────────────────────────────────────────────────────────────
export function Notes({ id, label = 'My notes', placeholder = 'Anything you want to remember' }: { id: string; label?: string; placeholder?: string }) {
  const s = useWbStyles();
  const c = useColors();
  const { state, setField, readOnly } = useWb();
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={state.fields[id] || ''}
        onChangeText={(v) => setField(id, v)}
        editable={!readOnly}
        multiline
        placeholder={readOnly ? '' : placeholder}
        placeholderTextColor={c.textMuted}
        style={s.notes}
        textAlignVertical="top"
        testID={`academy-notes-${id}`}
      />
    </View>
  );
}

// ── Tick boxes ──────────────────────────────────────────────────────────────
export function Ticks({ items, prefix }: { items: string[]; prefix: string }) {
  const s = useWbStyles();
  const c = useColors();
  const { state, setField, readOnly } = useWb();
  return (
    <View style={s.ticks}>
      {items.map((t, i) => {
        const id = `${prefix}${i}`;
        const on = state.fields[id] === '1';
        return (
          <Pressable key={id} disabled={readOnly} onPress={() => setField(id, on ? '' : '1')} style={s.tick} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.textMuted} />
            <Text style={s.body}>{t}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Text blocks ─────────────────────────────────────────────────────────────
export function P({ children, muted, small }: { children: React.ReactNode; muted?: boolean; small?: boolean }) {
  const s = useWbStyles();
  return <Text style={[s.body, muted && s.muted, small && { fontSize: 13.5 }]}>{children}</Text>;
}
export function B({ children }: { children: React.ReactNode }) {
  const s = useWbStyles();
  return <Text style={s.bold}>{children}</Text>;
}
export function H3({ children }: { children: React.ReactNode }) {
  const s = useWbStyles();
  return <Text style={s.h3}>{children}</Text>;
}
export function Label({ children, color }: { children: React.ReactNode; color?: string }) {
  const s = useWbStyles();
  return <Text style={[s.label, color ? { color } : null]}>{children}</Text>;
}
/** Bullets; an item may be [bold lead, rest]. */
export function Points({ items }: { items: (string | [string, string])[] }) {
  const s = useWbStyles();
  return (
    <View style={{ gap: 7 }}>
      {items.map((it, i) => (
        <View key={i} style={s.pt}>
          <View style={s.dot} />
          <Text style={[s.body, { flex: 1 }]}>
            {Array.isArray(it) ? <><Text style={s.bold}>{it[0]}</Text>{it[1] ? ` ${it[1]}` : ''}</> : it}
          </Text>
        </View>
      ))}
    </View>
  );
}
export function Panel({ label, hi, children }: { label?: string; hi?: boolean; children: React.ReactNode }) {
  const s = useWbStyles();
  return (
    <View style={[s.panel, hi && s.panelHi]}>
      {!!label && <Text style={[s.label, s.panelLabel]}>{label}</Text>}
      {children}
    </View>
  );
}
export function Two({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  return <View style={{ flexDirection: width >= 620 ? 'row' : 'column', gap: 12 }}>{React.Children.map(children, (ch) => <View style={{ flex: 1, minWidth: 0 }}>{ch}</View>)}</View>;
}
export function Say({ children }: { children: React.ReactNode }) {
  const s = useWbStyles();
  return <View style={s.say}><Text style={s.body}>{children}</Text></View>;
}
/** Label on the left, value on the right, rows divided by hairlines. */
export function Rows({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  const s = useWbStyles();
  return (
    <View>
      {rows.map(([k, v], i) => (
        <View key={i} style={[s.row, i === 0 && { borderTopWidth: 0 }]}>
          <Text style={[s.body, s.muted, { flex: 1 }]}>{k}</Text>
          <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>{typeof v === 'string' ? <Text style={[s.bold, s.num2]}>{v}</Text> : v}</View>
        </View>
      ))}
    </View>
  );
}
export function Figure({ caption, children }: { caption?: string; children: React.ReactNode }) {
  const s = useWbStyles();
  return (
    <View style={s.fig}>
      {children}
      {!!caption && <Text style={[s.small, s.muted]}>{caption}</Text>}
    </View>
  );
}
export function Break() {
  const s = useWbStyles();
  return (
    <View style={s.brk}>
      <View style={s.brkLine} /><Text style={s.label}>Break</Text><View style={s.brkLine} />
    </View>
  );
}

// ── Quiz ────────────────────────────────────────────────────────────────────
export function QuizBlock({ quiz }: { quiz: Quiz }) {
  const s = useWbStyles();
  const c = useColors();
  const { state, answer, retry, readOnly } = useWb();
  const st = state.quiz[quiz.id] || {};
  const answered = Object.keys(st).length;
  const score = quiz.qs.filter((q, i) => st[String(i)] === q.a).length;
  return (
    <View style={s.quiz} nativeID={quiz.id} testID={`academy-${quiz.id}`}>
      <View>
        <Text style={[s.label, { color: c.inkMuted }]}>Quick check</Text>
        <Text style={s.quizTitle}>{quiz.title}</Text>
      </View>
      {quiz.qs.map((q, i) => {
        const picked = st[String(i)];
        const has = picked != null;
        return (
          <View key={i} style={{ gap: 8 }}>
            <Text style={s.quizQ}>{i + 1}. {q.p}</Text>
            <View style={{ gap: 6 }}>
              {q.o.map((o, j) => {
                const right = has && j === q.a;
                const wrong = has && j === picked && j !== q.a;
                return (
                  <Pressable key={j} disabled={has || readOnly} onPress={() => answer(quiz.id, i, j)}
                    style={[s.opt, right && s.optRight, wrong && s.optWrong]} accessibilityRole="button">
                    <Text style={s.optText}>{o}</Text>
                  </Pressable>
                );
              })}
            </View>
            {has && (
              <Text style={s.why}><Text style={{ fontFamily: fonts.bodySemibold, color: c.inkText }}>{picked === q.a ? 'Correct. ' : 'Not quite. '}</Text>{q.w}</Text>
            )}
          </View>
        );
      })}
      {answered === quiz.qs.length && (
        <View style={s.quizFoot}>
          <Text style={s.score}>{score} / {quiz.qs.length}</Text>
          {!readOnly && (
            <Pressable onPress={() => retry(quiz.id)} style={[s.opt, { paddingVertical: 7 }]} accessibilityRole="button">
              <Text style={s.optText}>Try again</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const webOnly = (o: any) => (Platform.OS === 'web' ? o : {});
function makeStyles(c: any) {
  return StyleSheet.create({
    sec: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, marginBottom: 16, overflow: 'hidden' },
    secHead: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 18 },
    num: { width: 34, height: 34, borderRadius: 9, borderWidth: 1.5, borderColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    numDone: { backgroundColor: c.sgreen, borderColor: c.sgreen },
    numText: { fontFamily: fonts.monoSemibold, fontSize: 13, color: c.primary },
    secTitle: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: c.text },
    secSub: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted, marginTop: 2 },
    secBody: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18, gap: 16 },
    foot: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 16, paddingVertical: 12 },
    btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    btnPrimary: { backgroundColor: c.primary, borderColor: c.primary },
    btnDone: { backgroundColor: c.sgreenBg, borderColor: c.sgreen },
    btnText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },

    body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: c.text },
    bold: { fontFamily: fonts.bodySemibold, color: c.text },
    muted: { color: c.textMuted },
    small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 },
    num2: { fontSize: 15, ...webOnly({ fontVariantNumeric: 'tabular-nums' }) },
    h3: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },

    fillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 8 },
    fillText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 30, color: c.text },
    fillBig: { fontSize: 16 },
    gapWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 2 },
    gap: {
      fontFamily: fonts.bodySemibold, fontSize: 15, color: c.primary, textAlign: 'center', maxWidth: '100%',
      backgroundColor: c.primary + '14', borderBottomWidth: 2, borderBottomColor: c.primaryLight,
      borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 6, paddingVertical: 4, minHeight: 30,
      ...webOnly({ outlineStyle: 'none' }),
    },
    ans: { fontFamily: fonts.monoSemibold, fontSize: 12, color: c.sgreenInk, backgroundColor: c.sgreenBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 4, overflow: 'hidden' },

    notes: {
      fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: c.text, backgroundColor: c.surface,
      borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, minHeight: 200,
      ...webOnly({ outlineStyle: 'none', resize: 'vertical' }),
    },
    ticks: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    tick: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '48%', minWidth: 150, paddingVertical: 4 },

    pt: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.primaryLight, marginTop: 9 },
    panel: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14, gap: 10 },
    panelHi: { borderColor: c.primaryLight, backgroundColor: c.primary + '12' },
    panelLabel: { color: c.primary },
    say: { borderLeftWidth: 3, borderLeftColor: c.yellow, backgroundColor: c.yellowBg, paddingHorizontal: 12, paddingVertical: 10, borderTopRightRadius: 8, borderBottomRightRadius: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
    fig: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, backgroundColor: c.surface, gap: 8 },
    brk: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 6, marginBottom: 18 },
    brkLine: { flex: 1, height: 1, backgroundColor: c.border },

    quiz: { backgroundColor: c.ink, borderRadius: 16, padding: 18, gap: 16, marginBottom: 16 },
    quizTitle: { fontFamily: fonts.display, fontSize: 20, color: c.inkText, marginTop: 2 },
    quizQ: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 22, color: c.inkText },
    opt: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
    optRight: { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: '#3ddc9a' },
    optWrong: { backgroundColor: 'rgba(239,68,68,0.22)', borderColor: '#ff8a8a' },
    optText: { fontFamily: fonts.body, fontSize: 15, color: c.inkText },
    why: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: c.inkMuted },
    quizFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    score: { fontFamily: fonts.display, fontSize: 18, color: '#22d0ec' },
  });
}
