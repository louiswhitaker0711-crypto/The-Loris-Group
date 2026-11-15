/**
 * "Run it": a meeting's run-through, full screen, card by card (the Owner,
 * 15 Nov 2026). Opens from a planner box ("Run it") and from a topic on the
 * office Weekly Plan. The run-through is plain text in a small format, so it
 * can be typed in the app or written by Claude:
 *
 *   # What's your why?                     title
 *   > Know your why, know your number · 20 min      subtitle
 *   ## Opener · 4 min                      a card (the "· 4 min" shows as its time)
 *   Plain lines are what to say/do.
 *   - a bullet
 *   Say: "words to say out loud"          a quote to read out
 *   Ask: "a question for the room"        a question
 *   Steer to: what you want them to land on
 *   VIDEO: Derek Redmond, Barcelona 1992 | https://…   a play button
 *   TIMER: 30                              a 30-second timer
 *   DIAGRAM: flow: Show > Share > Observe > Review > Step back
 *   DIAGRAM: funnel: Doors 120 > Spoken 70 > Pitched 25 > Closed 15 > Sign-ups 4
 *   DIAGRAM: compare: Follower | Leader ; What do I do now? | Here's what I think I should do
 *   DIAGRAM: cycle: Plan > Do > Review > Improve
 *   DIAGRAM: pyramid: Why > Vision > Concentration > Today's number   (top first)
 *   DIAGRAM: quadrant: High effort | Low effort ; Top-left | Top-right | Bottom-left | Bottom-right
 *
 * Text without any "##" is shown as a single card, so older boxes still open.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, useWindowDimensions, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import { useColors, fonts } from '../../theme/ThemeContext';
import { useDeviceInsets } from '../../nav/AppShell';

type Line =
  | { kind: 'text' | 'bullet' | 'say' | 'ask' | 'steer'; text: string }
  | { kind: 'video'; title: string; url: string }
  | { kind: 'timer'; seconds: number }
  | { kind: 'diagram'; type: string; spec: string };
type Card = { title: string; time: string; lines: Line[] };
export type RunDoc = { title: string; subtitle: string; cards: Card[] };

const strip = (s: string) => s.replace(/^["“]|["”]$/g, '').trim();

export function parseRunSheet(raw: string, fallbackTitle = ''): RunDoc {
  const doc: RunDoc = { title: '', subtitle: '', cards: [] };
  let card: Card | null = null;
  const push = (l: Line) => {
    if (!card) { card = { title: '', time: '', lines: [] }; doc.cards.push(card); }
    card.lines.push(l);
  };
  for (const rawLine of String(raw || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.*)$/)) && !doc.title) { doc.title = m[1].trim(); continue; }
    if ((m = line.match(/^>\s*(.*)$/)) && !doc.cards.length) { doc.subtitle = m[1].trim(); continue; }
    if ((m = line.match(/^##\s+(.*)$/))) {
      const [t, time] = m[1].split(/\s+·\s+/);
      card = { title: (t || '').trim(), time: (time || '').trim(), lines: [] };
      doc.cards.push(card);
      continue;
    }
    if ((m = line.match(/^video:\s*(.*)$/i))) {
      const [t, url] = m[1].split('|').map((x) => x.trim());
      push({ kind: 'video', title: t || 'Play the video', url: url || `https://www.youtube.com/results?search_query=${encodeURIComponent(t || '')}` });
      continue;
    }
    if ((m = line.match(/^timer:\s*(\d+)/i))) { push({ kind: 'timer', seconds: Math.min(3600, parseInt(m[1], 10)) }); continue; }
    if ((m = line.match(/^diagram:\s*([a-z]+)\s*:\s*(.*)$/i))) { push({ kind: 'diagram', type: m[1].toLowerCase(), spec: m[2] }); continue; }
    if ((m = line.match(/^say:\s*(.*)$/i))) { push({ kind: 'say', text: strip(m[1]) }); continue; }
    if ((m = line.match(/^ask:\s*(.*)$/i))) { push({ kind: 'ask', text: strip(m[1]) }); continue; }
    if ((m = line.match(/^steer to:\s*(.*)$/i))) { push({ kind: 'steer', text: m[1].trim() }); continue; }
    if ((m = line.match(/^[-•*]\s+(.*)$/))) { push({ kind: 'bullet', text: m[1].trim() }); continue; }
    push({ kind: 'text', text: line });
  }
  if (!doc.title) doc.title = fallbackTitle;
  return doc;
}

// ── Diagrams ────────────────────────────────────────────────────────────────
function Diagram({ type, spec, c }: { type: string; spec: string; c: any }) {
  const parts = spec.split('>').map((x) => x.trim()).filter(Boolean);
  const box = { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border };
  const label = { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text, textAlign: 'center' as const };
  if (type === 'flow') {
    return (
      <View style={{ gap: 6, alignItems: 'stretch' }}>
        {parts.map((p, i) => (
          <View key={i} style={{ alignItems: 'center', gap: 6 }}>
            <View style={[box, { alignSelf: 'stretch', backgroundColor: i === 0 ? c.primary : c.surface, borderColor: i === 0 ? c.primary : c.border }]}>
              <Text style={[label, i === 0 && { color: c.onPrimary }]}>{i + 1}. {p}</Text>
            </View>
            {i < parts.length - 1 && <Ionicons name="arrow-down" size={18} color={c.textMuted} />}
          </View>
        ))}
      </View>
    );
  }
  if (type === 'funnel') {
    return (
      <View style={{ gap: 6, alignItems: 'center' }}>
        {parts.map((p, i) => (
          <View key={i} style={[box, { width: `${100 - i * (60 / Math.max(1, parts.length - 1))}%` as any, backgroundColor: i === parts.length - 1 ? c.primary : c.surface }]}>
            <Text style={[label, i === parts.length - 1 && { color: c.onPrimary }]}>{p}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (type === 'pyramid') {
    return (
      <View style={{ gap: 6, alignItems: 'center' }}>
        {parts.map((p, i) => (
          <View key={i} style={[box, { width: `${40 + i * (60 / Math.max(1, parts.length - 1))}%` as any, backgroundColor: i === 0 ? c.primary : c.surface }]}>
            <Text style={[label, i === 0 && { color: c.onPrimary }]}>{p}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (type === 'compare' || type === 'quadrant') {
    const rows = spec.split(';').map((r) => r.split('|').map((x) => x.trim()));
    if (type === 'quadrant' && rows.length >= 2) {
      const [heads, cells] = rows;
      const q = (i: number) => cells[i] || '';
      return (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {heads.slice(0, 2).map((h, i) => <Text key={i} style={[label, { flex: 1, color: c.textMuted, fontSize: 13 }]}>{h}</Text>)}
          </View>
          {[0, 2].map((r) => (
            <View key={r} style={{ flexDirection: 'row', gap: 6 }}>
              {[r, r + 1].map((i) => (
                <View key={i} style={[box, { flex: 1, minHeight: 70, justifyContent: 'center' }]}><Text style={label}>{q(i)}</Text></View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    return (
      <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
        {rows.map((r, ri) => (
          <View key={ri} style={{ flexDirection: 'row', backgroundColor: ri === 0 ? c.primary : ri % 2 ? c.surface : c.background }}>
            {r.map((cell, ci) => (
              <Text key={ci} style={[label, { flex: 1, padding: 10, textAlign: 'left', fontSize: ri === 0 ? 14 : 15 },
                ri === 0 && { color: c.onPrimary, fontFamily: fonts.bodyBold }]}>{cell}</Text>
            ))}
          </View>
        ))}
      </View>
    );
  }
  if (type === 'cycle') {
    const n = Math.max(1, parts.length), size = 280, r = 100, cx = size / 2, cy = size / 2;
    const pt = (i: number) => ({ x: cx + r * Math.sin((2 * Math.PI * i) / n), y: cy - r * Math.cos((2 * Math.PI * i) / n) });
    return (
      <View style={{ alignItems: 'center' }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} stroke={c.border} strokeWidth={2} fill="none" strokeDasharray="6 6" />
          {parts.map((_, i) => {
            const a = pt(i + 0.5), b = pt(i + 0.55);
            return <Path key={`a${i}`} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke={c.primary} strokeWidth={3} />;
          })}
          {parts.map((p, i) => {
            const { x, y } = pt(i);
            return (
              <React.Fragment key={i}>
                <Circle cx={x} cy={y} r={34} fill={i === 0 ? c.primary : c.surface} stroke={c.primary} strokeWidth={1.5} />
                <SvgText x={x} y={y + 4} fontSize={11} fontWeight="700" fill={i === 0 ? c.onPrimary : c.text} textAnchor="middle">
                  {p.length > 12 ? `${p.slice(0, 11)}…` : p}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    );
  }
  return <Text style={{ color: c.textMuted }}>{spec}</Text>;
}

function Timer({ seconds, c }: { seconds: number; c: any }) {
  const [left, setLeft] = useState(seconds);
  const [on, setOn] = useState(false);
  const ref = useRef<any>(null);
  useEffect(() => {
    if (!on) return;
    ref.current = setInterval(() => setLeft((l) => (l <= 1 ? (setOn(false), 0) : l - 1)), 1000);
    return () => clearInterval(ref.current);
  }, [on]);
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
  return (
    <Pressable onPress={() => { if (left === 0) setLeft(seconds); setOn((v) => !v); }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', borderRadius: 999,
        paddingVertical: 10, paddingHorizontal: 16, backgroundColor: left === 0 ? c.green || c.primary : c.surface, borderWidth: 1, borderColor: c.border }}
      accessibilityRole="button">
      <Ionicons name={on ? 'pause' : left === 0 ? 'refresh' : 'timer-outline'} size={20} color={c.text} />
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 22, color: c.text }}>{mm}:{ss}</Text>
    </Pressable>
  );
}

function LineView({ l, c }: { l: Line; c: any }) {
  const body = { fontFamily: fonts.body, fontSize: 18, lineHeight: 26, color: c.text };
  switch (l.kind) {
    case 'bullet':
      return <View style={{ flexDirection: 'row', gap: 10 }}><Text style={[body, { color: c.primary }]}>•</Text><Text style={[body, { flex: 1 }]}>{l.text}</Text></View>;
    case 'say':
      return (
        <View style={{ borderLeftWidth: 4, borderLeftColor: c.primary, paddingLeft: 12, paddingVertical: 4 }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: c.primary }}>SAY</Text>
          <Text style={[body, { fontFamily: fonts.bodySemibold, fontSize: 20, lineHeight: 28 }]}>“{l.text}”</Text>
        </View>
      );
    case 'ask':
      return (
        <View style={{ borderRadius: 12, backgroundColor: c.surface, padding: 12, gap: 2 }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: c.textMuted }}>ASK THE ROOM</Text>
          <Text style={[body, { fontFamily: fonts.bodySemibold }]}>{l.text}</Text>
        </View>
      );
    case 'steer':
      return <Text style={[body, { color: c.textMuted, fontSize: 16 }]}><Text style={{ fontFamily: fonts.bodyBold }}>Steer to: </Text>{l.text}</Text>;
    case 'video':
      return (
        <Pressable onPress={() => Linking.openURL(l.url).catch(() => {})} accessibilityRole="link"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, backgroundColor: c.primary }}>
          <Ionicons name="play-circle" size={30} color={c.onPrimary} />
          <Text style={{ flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: c.onPrimary }}>{l.title}</Text>
        </Pressable>
      );
    case 'timer':
      return <Timer seconds={l.seconds} c={c} />;
    case 'diagram':
      return <Diagram type={l.type} spec={l.spec} c={c} />;
    default:
      return <Text style={body}>{l.text}</Text>;
  }
}

export default function RunSheet({ visible, text, title, onClose }: { visible: boolean; text: string; title?: string; onClose: () => void }) {
  const c = useColors();
  // A full-screen modal covers the top bar, so it needs the device's real
  // insets (status bar / notch on an installed iPhone app).
  const insets = useDeviceInsets();
  const { width } = useWindowDimensions();
  const doc = useMemo(() => parseRunSheet(text, title), [text, title]);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const w = Math.min(width, 720);
  const n = doc.cards.length;
  useEffect(() => { if (visible) { setPage(0); scroller.current?.scrollTo({ x: 0, animated: false }); } }, [visible, text]);
  const go = (i: number) => {
    const p = Math.max(0, Math.min(n - 1, i));
    setPage(p);
    scroller.current?.scrollTo({ x: p * w, animated: true });
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: c.page || c.background, paddingTop: Math.max(insets.top, 12) + 8 }}>
        <View style={{ width: w, alignSelf: 'center', paddingHorizontal: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 26, color: c.text }}>{doc.title}</Text>
            {!!doc.subtitle && <Text style={{ fontFamily: fonts.body, fontSize: 14, color: c.textMuted, marginTop: 2 }}>{doc.subtitle}</Text>}
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={22} color={c.text} />
          </Pressable>
        </View>
        {n > 1 && (
          <View style={{ width: w, alignSelf: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 18, marginTop: 14 }}>
            {doc.cards.map((cd, i) => (
              <Pressable key={i} onPress={() => go(i)} style={{ flex: 1, paddingVertical: 4 }} accessibilityRole="button" accessibilityLabel={cd.title}>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: i <= page ? c.primary : c.border }} />
              </Pressable>
            ))}
          </View>
        )}
        <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          style={{ flex: 1, width: w, alignSelf: 'center' }}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / w))}
          scrollEventThrottle={16}>
          {doc.cards.map((cd, i) => (
            <ScrollView key={i} style={{ width: w }} contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 14 }}>
              {(!!cd.title || !!cd.time) && (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={{ flex: 1, fontFamily: fonts.display, fontSize: 30, color: c.primary }}>{cd.title}</Text>
                  {!!cd.time && <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: c.textMuted }}>{cd.time.toUpperCase()}</Text>}
                </View>
              )}
              {cd.lines.map((l, j) => <LineView key={j} l={l} c={c} />)}
            </ScrollView>
          ))}
        </ScrollView>
        {n > 1 && (
          <View style={{ width: w, alignSelf: 'center', flexDirection: 'row', gap: 10, padding: 18, paddingBottom: Math.max(insets.bottom, 12) + 6 }}>
            <Pressable onPress={() => go(page - 1)} disabled={page === 0}
              style={{ flex: 1, borderRadius: 999, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border, opacity: page === 0 ? 0.4 : 1 }}>
              <Text style={{ fontFamily: fonts.bodySemibold, fontSize: 16, color: c.text }}>Back</Text>
            </Pressable>
            <Pressable onPress={() => (page >= n - 1 ? onClose() : go(page + 1))}
              style={{ flex: 2, borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: c.primary }}>
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary }}>
                {page >= n - 1 ? 'Done' : `Next: ${doc.cards[page + 1]?.title || ''}`}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

/** A small "Run it" button for any box holding a run-through. */
export function RunItButton({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="run-it"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999,
        paddingVertical: 8, paddingHorizontal: 14, backgroundColor: c.primary, marginTop: 8 }}>
      <Ionicons name="play" size={14} color={c.onPrimary} />
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary }}>Run it</Text>
    </Pressable>
  );
}
