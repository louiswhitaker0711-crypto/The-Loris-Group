/**
 * GoalBuilder: the Goals section of the Monthly Goal Planner, on one page
 * (the Owner, 13 Nov 2026). The intro (why goals matter, KPIs vs Rocks, SMART)
 * folds open at the top, open the first time. Below it the KPIs box sits above
 * the Rocks box, each split into 1 month and 3 months; every goal is Business
 * or Personal. The 6-month vision is the long term, at the bottom.
 *
 * Data lives in `goals` (v2 shape): { version, kpis[], rocks[], vision }, and
 * every edit flows up through `onChange` into the planner draft (autosaves).
 * When `canEdit` is false (locked / someone else's planner) it's read-only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { haptics } from '../../utils/haptics';

// ── Types ───────────────────────────────────────────────────────────────
export type Horizon = 'short' | 'medium' | 'long';
export type Area = 'business' | 'personal';
export interface Kpi { id: string; name: string; target: string; horizon: Horizon; area?: Area; reward: string; smart_ok: boolean }
export interface Rock { id: string; name: string; horizon: Horizon; area?: Area; reward: string; done: boolean }
export interface GoalsV2 { version: number; kpis: Kpi[]; rocks: Rock[]; vision: string }

// A planner's goals are v2 (structured) once they carry a version / kpis key.
// Legacy planners (six free-text strings) are handled by the old grid.
export function isV2Goals(goals: any): boolean {
  return !!goals && (goals.version === 2 || Array.isArray(goals.kpis));
}

const TUTORIAL_FLAG = 'goalTutorialSeenV1';
const HORIZONS: { key: Horizon; short: string; long: string }[] = [
  { key: 'short', short: '1 mo', long: '1 month' },
  { key: 'medium', short: '3 mo', long: '3 months' },
  { key: 'long', short: '6 mo', long: '6 months' },
];
const horizonLabel = (h: Horizon) => HORIZONS.find((x) => x.key === h)?.long || '1 month';
// The booklet splits goals Business / Personal (the Owner, 13 Nov 2026).
const areaLabel = (a?: Area) => (a === 'personal' ? 'Personal' : 'Business');

function AreaToggle({ s, colors, value, onChange }: any) {
  return (
    <View style={[s.horizonRow, { marginTop: 8 }]}>
      {(['business', 'personal'] as Area[]).map((a) => {
        const sel = (value || 'business') === a;
        return (
          <TouchableOpacity
            key={a}
            style={[s.horizonPill, sel && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => { haptics.light(); onChange(a); }}
          >
            <Text style={[s.horizonText, sel && { color: colors.onPrimary }]}>{areaLabel(a)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const genId = () => `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const emptyGoals = (): GoalsV2 => ({ version: 2, kpis: [], rocks: [], vision: '' });

// KPI count → recommended Rock count (4 KPIs → 3 rocks, 5+ → 2). 7 total.
const recommendedRocks = (kpiCount: number) => (kpiCount >= 5 ? 2 : 3);


interface Props {
  goals: GoalsV2 | any;
  canEdit: boolean;
  onChange: (goals: GoalsV2) => void;
}

export function GoalBuilder({ goals: goalsIn, canEdit, onChange }: Props) {
  const colors = useColors();
  const s = useMemo(() => createS(colors), [colors]);

  const goals: GoalsV2 = useMemo(
    () => ({ version: 2, kpis: goalsIn?.kpis || [], rocks: goalsIn?.rocks || [], vision: goalsIn?.vision || '' }),
    [goalsIn]
  );
  const hasContent = goals.kpis.length > 0 || goals.rocks.length > 0 || !!goals.vision.trim();

  const menuQ = useQuery({
    queryKey: ['planner-goal-menu'],
    queryFn: () => apiService.getPlannerGoalMenu().then((r) => r.data),
    staleTime: 1000 * 60 * 30,
  });
  const kpiMenu: string[] = menuQ.data?.kpis || [];
  const rockMenu: string[] = menuQ.data?.rock_suggestions || [];

  // One page (the Owner, 13 Nov 2026): the intro, then the KPIs box above the
  // Rocks box, each split into 1 month and 3 months, then the 6-month vision.
  // The intro starts open until they've seen it once.
  const [introOpen, setIntroOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(TUTORIAL_FLAG)
      .then((seen) => { if (alive) setIntroOpen(!seen && !hasContent && canEdit); })
      .catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleIntro = () => {
    haptics.tap();
    if (introOpen) AsyncStorage.setItem(TUTORIAL_FLAG, '1').catch(() => {});
    setIntroOpen(!introOpen);
  };

  // ── Mutators (write the whole goals object up) ──────────────────────────
  const commit = (next: Partial<GoalsV2>) => onChange({ ...emptyGoals(), ...goals, ...next });
  const setKpis = (kpis: Kpi[]) => commit({ kpis });
  const setRocks = (rocks: Rock[]) => commit({ rocks });

  const addKpi = (name: string, horizon: Horizon) => {
    const nm = name.trim();
    if (!nm) return;
    if (goals.kpis.some((k) => k.name.toLowerCase() === nm.toLowerCase() && k.horizon === horizon)) return;
    haptics.light();
    setKpis([...goals.kpis, { id: genId(), name: nm, target: '', horizon, area: 'business', reward: '', smart_ok: false }]);
  };
  const updateKpi = (id: string, patch: Partial<Kpi>) =>
    setKpis(goals.kpis.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  const removeKpi = (id: string) => { haptics.light(); setKpis(goals.kpis.filter((k) => k.id !== id)); };

  const addRock = (name: string, horizon: Horizon) => {
    const nm = name.trim();
    if (!nm) return;
    if (goals.rocks.some((r) => r.name.toLowerCase() === nm.toLowerCase() && r.horizon === horizon)) return;
    haptics.light();
    setRocks([...goals.rocks, { id: genId(), name: nm, horizon, area: 'business', reward: '', done: false }]);
  };
  const updateRock = (id: string, patch: Partial<Rock>) =>
    setRocks(goals.rocks.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRock = (id: string) => { haptics.light(); setRocks(goals.rocks.filter((r) => r.id !== id)); };

  // 1 month and 3 months always; 6 months only for goals set that way before.
  const terms = (list: { horizon: Horizon }[]): Horizon[] =>
    ['short', 'medium', ...(list.some((x) => x.horizon === 'long') ? ['long' as Horizon] : [])] as Horizon[];
  const kpiCount = goals.kpis.length;

  return (
    <View>
      {/* The intro */}
      <TouchableOpacity style={s.introHead} onPress={toggleIntro} activeOpacity={0.7}>
        <Ionicons name="bulb-outline" size={16} color={colors.primary} />
        <Text style={s.introHeadText}>How goals work</Text>
        <Ionicons name={introOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {introOpen && (
        <View style={{ gap: 14, marginBottom: 14 }}>
          <StepWhy s={s} colors={colors} />
          <StepTypes s={s} colors={colors} />
          <StepSmart s={s} colors={colors} />
        </View>
      )}

      {/* KPIs */}
      <View style={[s.goalBoxCard, { borderColor: colors.primary }]}>
        <View style={s.typeHead}>
          <Ionicons name="stats-chart" size={16} color={colors.primary} />
          <Text style={[s.typeTitle, { color: colors.primary, flex: 1 }]}>KPIs · the numbers</Text>
          <Text style={[s.hint, { color: kpiCount >= 4 && kpiCount <= 5 ? colors.green : colors.textMuted }]}>{kpiCount} · aim for 4–5</Text>
        </View>
        {terms(goals.kpis).map((h) => (
          <TermBlock
            key={h} s={s} colors={colors} label={horizonLabel(h)} canEdit={canEdit}
            menu={kpiMenu} loading={menuQ.isLoading}
            chosen={goals.kpis.filter((k) => k.horizon === h).map((k) => k.name)}
            placeholder="Add your own KPI…"
            onAdd={(nm: string) => addKpi(nm, h)}
          >
            {goals.kpis.filter((k) => k.horizon === h).map((k) => (
              <KpiRow key={k.id} s={s} colors={colors} k={k} canEdit={canEdit}
                onUpdate={(p: Partial<Kpi>) => updateKpi(k.id, p)} onRemove={() => removeKpi(k.id)} />
            ))}
          </TermBlock>
        ))}
      </View>

      {/* Rocks */}
      <View style={[s.goalBoxCard, { borderColor: colors.green }]}>
        <View style={s.typeHead}>
          <Ionicons name="checkbox" size={16} color={colors.green} />
          <Text style={[s.typeTitle, { color: colors.green, flex: 1 }]}>Rocks · did I / didn't I</Text>
          <Text style={s.hint}>{goals.rocks.length} · aim for {kpiCount >= 4 ? recommendedRocks(kpiCount) : '2–3'}</Text>
        </View>
        {terms(goals.rocks).map((h) => (
          <TermBlock
            key={h} s={s} colors={colors} label={horizonLabel(h)} canEdit={canEdit}
            menu={rockMenu} loading={menuQ.isLoading}
            chosen={goals.rocks.filter((r) => r.horizon === h).map((r) => r.name)}
            placeholder="Add your own Rock…"
            onAdd={(nm: string) => addRock(nm, h)}
          >
            {goals.rocks.filter((r) => r.horizon === h).map((r) => (
              <RockRow key={r.id} s={s} colors={colors} r={r} canEdit={canEdit}
                onUpdate={(p: Partial<Rock>) => updateRock(r.id, p)} onRemove={() => removeRock(r.id)} />
            ))}
          </TermBlock>
        ))}
      </View>

      {/* Long term */}
      <Text style={[s.pickLabel, { marginTop: 4 }]}>6-month vision</Text>
      <TextInput
        style={[s.visionInput, !canEdit && { opacity: 0.6 }]}
        multiline
        editable={canEdit}
        placeholder="Where do you want to be in 6 months?" placeholderTextColor={colors.textMuted}
        value={goals.vision}
        onChangeText={(v) => commit({ vision: v })}
      />
    </View>
  );
}

// ── One term inside a box: its goals, then add your own or tap a suggestion ──
function TermBlock({ s, colors, label, canEdit, menu, loading, chosen, placeholder, onAdd, children }: any) {
  const [showSugg, setShowSugg] = useState(false);
  const rows = React.Children.toArray(children);
  return (
    <View style={s.termBlock}>
      <Text style={s.termLabel}>{label.toUpperCase()}</Text>
      {rows.length ? rows : <Text style={[s.hint, { marginBottom: 4 }]}>{canEdit ? 'Nothing yet.' : '—'}</Text>}
      {canEdit && (
        <>
          <AddOwn s={s} colors={colors} placeholder={placeholder} onAdd={onAdd} />
          {menu.length > 0 && (
            <TouchableOpacity onPress={() => { haptics.tap(); setShowSugg(!showSugg); }} style={{ marginTop: 6 }}>
              <Text style={[s.skipText, { color: colors.primary }]}>{showSugg ? 'Hide suggestions' : 'Suggestions'}</Text>
            </TouchableOpacity>
          )}
          {showSugg && <PickerChips s={s} colors={colors} menu={menu} chosen={chosen} loading={loading} onPick={onAdd} />}
        </>
      )}
    </View>
  );
}

function KpiRow({ s, colors, k, canEdit, onUpdate, onRemove }: any) {
  return (
    <View style={s.goalRow}>
      <View style={s.goalRowHead}>
        <TouchableOpacity disabled={!canEdit} onPress={() => onUpdate({ smart_ok: !k.smart_ok })} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name={k.smart_ok ? 'checkbox' : 'square-outline'} size={18} color={k.smart_ok ? colors.green : colors.textMuted} />
        </TouchableOpacity>
        <Text style={[s.goalName, { flex: 1 }]}>{k.name}</Text>
        {canEdit && (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <View style={s.fieldRow}>
        <Text style={s.fieldLabel}>Target</Text>
        <TextInput
          style={[s.targetInput, !canEdit && { opacity: 0.6 }]}
          editable={canEdit}
          placeholder="e.g. 40" placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          value={k.target}
          onChangeText={(v) => onUpdate({ target: v })}
        />
        {canEdit && <HorizonToggle s={s} colors={colors} value={k.horizon} onChange={(h: Horizon) => onUpdate({ horizon: h })} />}
      </View>
      {canEdit
        ? <AreaToggle s={s} colors={colors} value={k.area} onChange={(a: Area) => onUpdate({ area: a })} />
        : <Text style={s.sumSub}>{areaLabel(k.area)}</Text>}
      {(canEdit || !!k.reward) && (
        <TextInput
          style={s.rewardInput}
          editable={canEdit}
          placeholder="Reward if you hit it (optional)" placeholderTextColor={colors.textMuted}
          value={k.reward}
          onChangeText={(v) => onUpdate({ reward: v })}
        />
      )}
      {canEdit && <Text style={[s.hint, { marginTop: 4, fontSize: 11 }]}>Tick the box once it's SMART.</Text>}
    </View>
  );
}

function RockRow({ s, colors, r, canEdit, onUpdate, onRemove }: any) {
  return (
    <View style={s.goalRow}>
      <View style={s.goalRowHead}>
        <TouchableOpacity disabled={!canEdit} onPress={() => onUpdate({ done: !r.done })} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name={r.done ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={r.done ? colors.green : colors.textMuted} />
        </TouchableOpacity>
        <Text style={[s.goalName, { flex: 1 }, r.done && { textDecorationLine: 'line-through', color: colors.textMuted }]}>{r.name}</Text>
        {canEdit && (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      {canEdit ? (
        <View style={[s.fieldRow, { flexWrap: 'wrap' }]}>
          <HorizonToggle s={s} colors={colors} value={r.horizon} onChange={(h: Horizon) => onUpdate({ horizon: h })} />
          <AreaToggle s={s} colors={colors} value={r.area} onChange={(a: Area) => onUpdate({ area: a })} />
        </View>
      ) : <Text style={s.sumSub}>{areaLabel(r.area)}</Text>}
      {(canEdit || !!r.reward) && (
        <TextInput
          style={s.rewardInput}
          editable={canEdit}
          placeholder="Reward if you do it (optional)" placeholderTextColor={colors.textMuted}
          value={r.reward}
          onChangeText={(v) => onUpdate({ reward: v })}
        />
      )}
    </View>
  );
}

// ── Teaching steps ────────────────────────────────────────────────────────
function StepWhy({ s, colors }: any) {
  return (
    <View>
      <Text style={s.stepKicker}>WHY</Text>
      <Text style={s.stepTitle}>Why bother with goals?</Text>
      <Text style={s.body}>
        Working with no goals is like watching a match with no goalposts — 23 people running
        around, nothing to aim at. Goals give the day a point and pull you forward.
      </Text>
      <View style={[s.callout, { borderColor: colors.primary, backgroundColor: `${colors.primary}12` }]}>
        <Text style={[s.calloutTitle, { color: colors.primary }]}>“Get fit” vs “run a 5K by June 1st”</Text>
        <Text style={s.calloutBody}>
          Same intention — but only one tells you what to do on Monday morning. A goal with a
          number and a deadline pulls you forward; a vague wish just sits there. That’s the
          difference setting real goals makes to your month.
        </Text>
      </View>
    </View>
  );
}

function StepTypes({ s, colors }: any) {
  return (
    <View>
      <Text style={s.stepKicker}>THE TWO TYPES</Text>
      <Text style={s.stepTitle}>KPIs vs Rocks</Text>

      <View style={[s.typeCard, { borderColor: colors.primary }]}>
        <View style={s.typeHead}>
          <Ionicons name="stats-chart" size={16} color={colors.primary} />
          <Text style={[s.typeTitle, { color: colors.primary }]}>KPIs — the numbers</Text>
        </View>
        <Text style={s.body}>
          Anything measurable: sign-ups, retention %, initial appointments booked, first-day-ons, personal best.
          If you can put a number on it, it's a KPI. <Text style={s.bold}>Pick 4–5.</Text>
        </Text>
      </View>

      <View style={[s.typeCard, { borderColor: colors.green }]}>
        <View style={s.typeHead}>
          <Ionicons name="checkbox" size={16} color={colors.green} />
          <Text style={[s.typeTitle, { color: colors.green }]}>Rocks — did I / didn't I</Text>
        </View>
        <Text style={s.body}>
          A task you tick off at month-end: visit another office, run 2 team meetings, finish a
          book, run a sector. Not a routine — a thing you did or you didn't. <Text style={s.bold}>Pick 2–3.</Text>
        </Text>
      </View>

      <View style={[s.callout, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
        <Text style={s.calloutBody}>
          <Text style={s.bold}>4 KPIs → 3 Rocks. 5 KPIs → 2 Rocks.</Text> Seven goals in total.
        </Text>
      </View>
    </View>
  );
}

function StepSmart({ s, colors }: any) {
  const rows = [
    ['S', 'Specific', 'Say exactly what — “hit a 6-sign-up day”, not “do well”.'],
    ['M', 'Measurable', 'A number you can check off — like a doctor reads your bloods.'],
    ['A', 'Attainable', 'A stretch, but reachable in your role right now.'],
    ['R', 'Realistic', 'Big is fine; 1,000 sign-ups solo in a week isn’t.'],
    ['T', 'Time-based', 'A deadline creates urgency — “by the 20th”.'],
  ];
  return (
    <View>
      <Text style={s.stepKicker}>THE TEST</Text>
      <Text style={s.stepTitle}>Make every goal SMART</Text>
      {rows.map(([l, t, d]) => (
        <View key={l} style={s.smartRow}>
          <View style={[s.smartLetter, { backgroundColor: colors.primary }]}><Text style={s.smartLetterText}>{l}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.smartTitle}>{t}</Text>
            <Text style={s.smartDesc}>{d}</Text>
          </View>
        </View>
      ))}
      <View style={[s.callout, { borderColor: colors.red, backgroundColor: `${colors.red}10` }]}>
        <Text style={s.calloutBody}>
          <Text style={[s.bold, { color: colors.red }]}>Weak goals:</Text> “get better”, “be more confident”,
          “be on time”. They're feelings or baseline — you can't measure them.
        </Text>
      </View>
    </View>
  );
}

// ── Build steps ───────────────────────────────────────────────────────────
function PickerChips({ s, colors, menu, chosen, loading, onPick }: any) {
  if (loading) return <Text style={s.hint}>Loading suggestions…</Text>;
  if (!menu.length) return null;
  return (
    <View style={s.chips}>
      {menu.map((m: string) => {
        const picked = chosen.some((c: string) => c.toLowerCase() === m.toLowerCase());
        return (
          <TouchableOpacity
            key={m}
            style={[s.chip, picked && { backgroundColor: `${colors.primary}18`, borderColor: colors.primary }]}
            onPress={() => onPick(m)}
            disabled={picked}
          >
            <Ionicons name={picked ? 'checkmark' : 'add'} size={13} color={picked ? colors.primary : colors.textSecondary} />
            <Text style={[s.chipText, picked && { color: colors.primary, fontWeight: '800' }]}>{m}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function AddOwn({ s, colors, placeholder, onAdd }: any) {
  const [val, setVal] = useState('');
  return (
    <View style={s.addOwnRow}>
      <TextInput
        style={s.addOwnInput}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={val}
        onChangeText={setVal}
        onSubmitEditing={() => { onAdd(val); setVal(''); }}
        returnKeyType="done"
      />
      <TouchableOpacity style={s.addOwnBtn} onPress={() => { onAdd(val); setVal(''); }} disabled={!val.trim()}>
        <Ionicons name="add" size={16} color={val.trim() ? colors.onPrimary : colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

function HorizonToggle({ s, colors, value, onChange }: any) {
  return (
    <View style={s.horizonRow}>
      {HORIZONS.filter((h) => h.key !== 'long' || value === 'long').map((h) => {
        const sel = value === h.key;
        return (
          <TouchableOpacity
            key={h.key}
            style={[s.horizonPill, sel && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => { haptics.light(); onChange(h.key); }}
          >
            <Text style={[s.horizonText, sel && { color: colors.onPrimary }]}>{h.short}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const createS = (colors: any) => StyleSheet.create({
  introHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 12 },
  introHeadText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.text },
  goalBoxCard: { borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 14, backgroundColor: colors.surface },
  termBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  termLabel: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.6, color: colors.textSecondary, marginBottom: 6 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 14 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary, width: 20 },
  dotDone: { backgroundColor: colors.primary },
  stepKicker: { fontSize: 10, fontWeight: '900', color: colors.textMuted, letterSpacing: 0.8, marginBottom: 4 },
  stepTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginBottom: 8 },
  body: { fontSize: 13.5, color: colors.text, lineHeight: 20 },
  bold: { fontWeight: '800', color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 8, lineHeight: 17 },
  callout: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  calloutTitle: { fontSize: 13, fontWeight: '900', marginBottom: 4 },
  calloutBody: { fontSize: 12.5, color: colors.text, lineHeight: 18 },
  typeCard: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginTop: 10 },
  typeHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  typeTitle: { fontSize: 14, fontWeight: '900' },
  smartRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  smartLetter: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  smartLetterText: { color: colors.onPrimary, fontWeight: '900', fontSize: 15 },
  smartTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  smartDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 1, lineHeight: 16 },
  counter: { fontSize: 12, fontWeight: '800', marginBottom: 10 },
  goalRow: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, marginBottom: 8 },
  goalRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  goalName: { fontSize: 14, fontWeight: '800', color: colors.text, flex: 1, marginRight: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  targetInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13, fontWeight: '700', color: colors.text, minWidth: 70, textAlign: 'center' },
  rewardInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontSize: 12.5, color: colors.text, marginTop: 8 },
  horizonRow: { flexDirection: 'row', gap: 5 },
  horizonPill: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  horizonText: { fontSize: 11.5, fontWeight: '800', color: colors.textSecondary },
  pickLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.text },
  addOwnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  addOwnInput: { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, fontSize: 13, color: colors.text },
  addOwnBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  reviewMeta: { fontWeight: '800', color: colors.textSecondary },
  reviewSub: { fontSize: 11.5, color: colors.textMuted, marginTop: 1 },
  visionInput: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 13, color: colors.text, minHeight: 60, textAlignVertical: 'top' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  navBack: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  navBackText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  navNext: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary },
  navNextText: { fontSize: 13, fontWeight: '800', color: colors.onPrimary },
  skipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  replay: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 12 },
  replayText: { fontSize: 11.5, color: colors.textMuted, fontWeight: '600' },
  emptySummary: { alignItems: 'flex-start', gap: 10 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primary, alignSelf: 'flex-start', marginTop: 12 },
  editBtnText: { fontSize: 12.5, fontWeight: '800', color: colors.onPrimary },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  sumTag: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6 },
  sumTagText: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.4 },
  sumName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  sumSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  visionSum: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: colors.surfaceAlt },
});
