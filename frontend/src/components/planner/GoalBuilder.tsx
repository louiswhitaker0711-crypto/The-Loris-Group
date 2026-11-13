/**
 * GoalBuilder: the Goals section of the Monthly Goal Planner, on one page
 * (the Owner, 13 Nov 2026). The intro (why goals matter, KPIs vs Rocks, SMART)
 * folds open at the top, open the first time. Below it the KPIs box sits above
 * the Rocks box, each split into 1 month and 3 months; every goal is Business
 * or Personal: that's the short term (1-3 months). Below it, Mid term (6-12
 * months): goals like 'Be Stage 3', Business or Personal, with a How (it
 * replaced the 6-month vision).
 *
 * Data lives in `goals` (v2 shape): { version, kpis[], rocks[], mids[], vision }, and
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
export interface Kpi { id: string; name: string; target: string; horizon: Horizon; area?: Area; reward: string; how?: string; smart_ok: boolean }
export interface Rock { id: string; name: string; horizon: Horizon; area?: Area; reward: string; how?: string; done: boolean }
export interface Mid { id: string; name: string; area?: Area; how?: string; done: boolean }
export type WhyTag = 'people' | 'lifestyle' | 'choices' | 'time' | 'project';
export interface Why { id: string; text: string; tag: WhyTag }
export interface GoalsV2 { version: number; kpis: Kpi[]; rocks: Rock[]; mids: Mid[]; whys?: Why[]; vision: string }

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
const emptyGoals = (): GoalsV2 => ({ version: 2, kpis: [], rocks: [], mids: [], whys: [], vision: '' });
// Long term is their why (the Owner, 13 Nov 2026).
const WHY_TAGS: { key: WhyTag; label: string }[] = [
  { key: 'people', label: 'People' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'choices', label: 'Choices' },
  { key: 'time', label: 'Time' },
  { key: 'project', label: 'Project' },
];
// Goals just added open straight away; everything else starts as one line.
const freshIds = new Set<string>();

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
    () => {
      // A 6-month vision written before mid term existed shows as a mid-term goal.
      const v = String(goalsIn?.vision || '').trim();
      const mids: Mid[] = goalsIn?.mids?.length ? goalsIn.mids : (v ? [{ id: 'vision', name: v, area: 'business', how: '', done: false }] : []);
      return { version: 2, kpis: goalsIn?.kpis || [], rocks: goalsIn?.rocks || [], mids, whys: goalsIn?.whys || [], vision: '' };
    },
    [goalsIn]
  );
  const hasContent = goals.kpis.length > 0 || goals.rocks.length > 0 || goals.mids.length > 0;

  const menuQ = useQuery({
    queryKey: ['planner-goal-menu'],
    queryFn: () => apiService.getPlannerGoalMenu().then((r) => r.data),
    staleTime: 1000 * 60 * 30,
  });
  const kpiMenu: string[] = menuQ.data?.kpis || [];
  const rockMenu: string[] = menuQ.data?.rock_suggestions || [];

  // One page (the Owner, 13 Nov 2026): the intro, then the KPIs box above the
  // Rocks box, each split into 1 month and 3 months (short term), then mid term.
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
    const id = genId(); freshIds.add(id);
    setKpis([...goals.kpis, { id, name: nm, target: '', horizon, area: 'business', reward: '', smart_ok: false }]);
  };
  const updateKpi = (id: string, patch: Partial<Kpi>) =>
    setKpis(goals.kpis.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  const removeKpi = (id: string) => { haptics.light(); setKpis(goals.kpis.filter((k) => k.id !== id)); };

  const addRock = (name: string, horizon: Horizon) => {
    const nm = name.trim();
    if (!nm) return;
    if (goals.rocks.some((r) => r.name.toLowerCase() === nm.toLowerCase() && r.horizon === horizon)) return;
    haptics.light();
    const id = genId(); freshIds.add(id);
    setRocks([...goals.rocks, { id, name: nm, horizon, area: 'business', reward: '', done: false }]);
  };
  const updateRock = (id: string, patch: Partial<Rock>) =>
    setRocks(goals.rocks.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRock = (id: string) => { haptics.light(); setRocks(goals.rocks.filter((r) => r.id !== id)); };

  const setMids = (mids: Mid[]) => commit({ mids, vision: '' });
  const addMid = (name: string) => {
    const nm = name.trim();
    if (!nm || goals.mids.some((m) => m.name.toLowerCase() === nm.toLowerCase())) return;
    haptics.light();
    const id = genId(); freshIds.add(id);
    setMids([...goals.mids, { id, name: nm, area: 'business', how: '', done: false }]);
  };
  const updateMid = (id: string, patch: Partial<Mid>) => setMids(goals.mids.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removeMid = (id: string) => { haptics.light(); setMids(goals.mids.filter((m) => m.id !== id)); };

  const whys = goals.whys || [];
  const setWhys = (w: Why[]) => commit({ whys: w });
  const addWhy = (text: string, tag: WhyTag) => {
    const t = text.trim();
    if (!t) return;
    haptics.light();
    setWhys([...whys, { id: genId(), text: t, tag }]);
  };
  const updateWhy = (id: string, patch: Partial<Why>) => setWhys(whys.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const removeWhy = (id: string) => { haptics.light(); setWhys(whys.filter((w) => w.id !== id)); };

  // Short, Mid and Long term on tabs: one at a time, not one long list.
  const [tab, setTab] = useState<'short' | 'mid' | 'long'>('short');
  const TABS = [
    { key: 'short' as const, label: 'Short term', sub: '1–3 months', n: goals.kpis.length + goals.rocks.length },
    { key: 'mid' as const, label: 'Mid term', sub: '6–12 months', n: goals.mids.length },
    { key: 'long' as const, label: 'Long term', sub: 'Your why', n: whys.length },
  ];

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

      {/* Short / Mid / Long term tabs */}
      <View style={s.tabRow}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={[s.tab, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => { haptics.tap(); setTab(t.key); }} activeOpacity={0.75}>
              <Text style={[s.tabLabel, on && { color: colors.onPrimary }]}>{t.label}{t.n ? ` · ${t.n}` : ''}</Text>
              <Text style={[s.tabSub, on && { color: colors.onPrimary, opacity: 0.85 }]}>{t.sub}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'short' && (<>

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

      </>)}

      {/* Mid term: 6-12 months (replaced the 6-month vision) */}
      {tab === 'mid' && (
      <View style={[s.goalBoxCard, { borderColor: colors.textSecondary }]}>
        <Text style={[s.hint, { marginBottom: 4 }]}>Where you want to be: a stage, a level, or something personal.</Text>
        {goals.mids.map((m) => (
          <MidRow key={m.id} s={s} colors={colors} m={m} canEdit={canEdit}
            onUpdate={(p: Partial<Mid>) => updateMid(m.id, p)} onRemove={() => removeMid(m.id)} />
        ))}
        {!goals.mids.length && !canEdit && <Text style={s.hint}>—</Text>}
        {canEdit && (
          <TermBlockAdd s={s} colors={colors} menu={MID_SUGGESTIONS} chosen={goals.mids.map((m) => m.name)}
            placeholder="Add a mid-term goal…" onAdd={addMid} />
        )}
      </View>
      )}

      {/* Long term: their why */}
      {tab === 'long' && (
        <View style={[s.goalBoxCard, { borderColor: colors.yellow || colors.primary }]}>
          <Text style={[s.hint, { marginBottom: 6 }]}>Your why: the reason behind every goal. People, lifestyle, choices, time or a project.</Text>
          {whys.map((w) => (
            <WhyRow key={w.id} s={s} colors={colors} w={w} canEdit={canEdit}
              onUpdate={(p: Partial<Why>) => updateWhy(w.id, p)} onRemove={() => removeWhy(w.id)} />
          ))}
          {!whys.length && !canEdit && <Text style={s.hint}>—</Text>}
          {canEdit && <AddWhy s={s} colors={colors} onAdd={addWhy} />}
        </View>
      )}

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

// One goal as a single line (tick, name, tag, chevron); tap to open the rest.
function GoalCard({ s, colors, id, canEdit, left, title, meta, done, onRemove, children }: any) {
  const [open, setOpen] = useState(() => freshIds.has(id));
  return (
    <View style={s.goalRow}>
      <View style={s.goalRowHead}>
        <View style={s.goalRowLeft}>{left}</View>
        <TouchableOpacity style={s.goalRowMain} onPress={() => { haptics.tap(); setOpen(!open); }} activeOpacity={0.7}>
          {/* Name gets the full width and wraps; the tag sits underneath. */}
          <View style={{ flex: 1 }}>
            <Text style={[s.goalRowTitle, done && { textDecorationLine: 'line-through', color: colors.textMuted }]} numberOfLines={open ? undefined : 3}>{title}</Text>
            {!!meta && <Text style={s.goalRowMeta} numberOfLines={1}>{meta}</Text>}
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
        </TouchableOpacity>
        {canEdit && (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 8 }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      {open && <View style={{ marginTop: 8 }}>{children}</View>}
    </View>
  );
}

function KpiRow({ s, colors, k, canEdit, onUpdate, onRemove }: any) {
  const left = (
    <TouchableOpacity disabled={!canEdit} onPress={() => onUpdate({ smart_ok: !k.smart_ok })} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Ionicons name={k.smart_ok ? 'checkbox' : 'square-outline'} size={18} color={k.smart_ok ? colors.green : colors.textMuted} />
    </TouchableOpacity>
  );
  return (
    <GoalCard s={s} colors={colors} id={k.id} canEdit={canEdit} left={left} onRemove={onRemove}
      title={k.target ? `${k.name} → ${k.target}` : k.name} meta={areaLabel(k.area)}>
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
      {canEdit && <AreaToggle s={s} colors={colors} value={k.area} onChange={(a: Area) => onUpdate({ area: a })} />}
      {(canEdit || !!k.reward) && (
        <TextInput
          style={s.rewardInput}
          editable={canEdit}
          placeholder="Reward if you hit it (optional)" placeholderTextColor={colors.textMuted}
          value={k.reward}
          onChangeText={(v) => onUpdate({ reward: v })}
        />
      )}
      <HowBox s={s} colors={colors} value={k.how} canEdit={canEdit} onChange={(v: string) => onUpdate({ how: v })} />
      {canEdit && <Text style={[s.hint, { marginTop: 4, fontSize: 11 }]}>Tick the box once it's SMART.</Text>}
    </GoalCard>
  );
}

// How they'll do it (the Owner, 13 Nov 2026): free text on every goal.
function HowBox({ s, colors, value, canEdit, onChange }: any) {
  if (!canEdit && !value) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.fieldLabel, { marginBottom: 4 }]}>How will I do it?</Text>
      <TextInput
        style={[s.rewardInput, { marginTop: 0, minHeight: 56, textAlignVertical: 'top' }, !canEdit && { opacity: 0.7 }]}
        multiline
        scrollEnabled={false}
        editable={canEdit}
        placeholder="What you'll do, with who and by when…"
        placeholderTextColor={colors.textMuted}
        value={value || ''}
        onChangeText={onChange}
      />
    </View>
  );
}

const MID_SUGGESTIONS = [
  'Be Stage 2 (Self Management)',
  'Be Stage 3 (Leader)',
  'Be Stage SL (Sector Leader)',
  'Be a Team Builder',
  'Average 15+ sign-ups a week',
  'Average 20+ sign-ups a week',
  'Have my own team',
  'Run my own sector every day',
];

function TermBlockAdd({ s, colors, menu, chosen, placeholder, onAdd }: any) {
  const [showSugg, setShowSugg] = useState(false);
  return (
    <View style={{ marginTop: 6 }}>
      <AddOwn s={s} colors={colors} placeholder={placeholder} onAdd={onAdd} />
      <TouchableOpacity onPress={() => { haptics.tap(); setShowSugg(!showSugg); }} style={{ marginTop: 6 }}>
        <Text style={[s.skipText, { color: colors.primary }]}>{showSugg ? 'Hide suggestions' : 'Suggestions'}</Text>
      </TouchableOpacity>
      {showSugg && <PickerChips s={s} colors={colors} menu={menu} chosen={chosen} loading={false} onPick={onAdd} />}
    </View>
  );
}

function DoneTick({ colors, done, canEdit, onToggle }: any) {
  return (
    <TouchableOpacity disabled={!canEdit} onPress={onToggle} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={done ? colors.green : colors.textMuted} />
    </TouchableOpacity>
  );
}

function MidRow({ s, colors, m, canEdit, onUpdate, onRemove }: any) {
  return (
    <GoalCard s={s} colors={colors} id={m.id} canEdit={canEdit} done={m.done} onRemove={onRemove}
      left={<DoneTick colors={colors} done={m.done} canEdit={canEdit} onToggle={() => onUpdate({ done: !m.done })} />}
      title={m.name} meta={areaLabel(m.area)}>
      {canEdit && (
        <TextInput
          style={[s.rewardInput, { marginTop: 0, marginBottom: 8 }]}
          value={m.name}
          onChangeText={(v) => onUpdate({ name: v })}
          placeholder="The goal"
          placeholderTextColor={colors.textMuted}
        />
      )}
      {canEdit && <AreaToggle s={s} colors={colors} value={m.area} onChange={(a: Area) => onUpdate({ area: a })} />}
      <HowBox s={s} colors={colors} value={m.how} canEdit={canEdit} onChange={(v: string) => onUpdate({ how: v })} />
    </GoalCard>
  );
}

function RockRow({ s, colors, r, canEdit, onUpdate, onRemove }: any) {
  return (
    <GoalCard s={s} colors={colors} id={r.id} canEdit={canEdit} done={r.done} onRemove={onRemove}
      left={<DoneTick colors={colors} done={r.done} canEdit={canEdit} onToggle={() => onUpdate({ done: !r.done })} />}
      title={r.name} meta={areaLabel(r.area)}>
      {canEdit && (
        <View style={[s.fieldRow, { flexWrap: 'wrap' }]}>
          <HorizonToggle s={s} colors={colors} value={r.horizon} onChange={(h: Horizon) => onUpdate({ horizon: h })} />
          <AreaToggle s={s} colors={colors} value={r.area} onChange={(a: Area) => onUpdate({ area: a })} />
        </View>
      )}
      {(canEdit || !!r.reward) && (
        <TextInput
          style={s.rewardInput}
          editable={canEdit}
          placeholder="Reward if you do it (optional)" placeholderTextColor={colors.textMuted}
          value={r.reward}
          onChangeText={(v) => onUpdate({ reward: v })}
        />
      )}
      <HowBox s={s} colors={colors} value={r.how} canEdit={canEdit} onChange={(v: string) => onUpdate({ how: v })} />
    </GoalCard>
  );
}

const whyLabel = (t?: WhyTag) => WHY_TAGS.find((x) => x.key === t)?.label || 'People';

function WhyTags({ s, colors, value, onChange }: any) {
  return (
    <View style={[s.horizonRow, { flexWrap: 'wrap' }]}>
      {WHY_TAGS.map((t) => {
        const sel = value === t.key;
        return (
          <TouchableOpacity key={t.key}
            style={[s.horizonPill, sel && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => { haptics.light(); onChange(t.key); }}>
            <Text style={[s.horizonText, sel && { color: colors.onPrimary }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function WhyRow({ s, colors, w, canEdit, onUpdate, onRemove }: any) {
  return (
    <GoalCard s={s} colors={colors} id={w.id} canEdit={canEdit} onRemove={onRemove}
      left={<Ionicons name="heart-outline" size={17} color={colors.primary} />}
      title={w.text} meta={whyLabel(w.tag)}>
      {canEdit ? (
        <>
          <WhyTags s={s} colors={colors} value={w.tag} onChange={(t: WhyTag) => onUpdate({ tag: t })} />
          <TextInput
            style={[s.rewardInput, { minHeight: 56, textAlignVertical: 'top' }]}
            multiline scrollEnabled={false}
            value={w.text}
            onChangeText={(v) => onUpdate({ text: v })}
          />
        </>
      ) : <Text style={s.body}>{w.text}</Text>}
    </GoalCard>
  );
}

function AddWhy({ s, colors, onAdd }: any) {
  const [tag, setTag] = useState<WhyTag>('people');
  return (
    <View style={{ marginTop: 6, gap: 6 }}>
      <WhyTags s={s} colors={colors} value={tag} onChange={setTag} />
      <AddOwn s={s} colors={colors} placeholder={`Add a why (${whyLabel(tag)})…`} onAdd={(t: string) => onAdd(t, tag)} />
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
  termHeading: { fontSize: 13, fontWeight: '900', letterSpacing: 0.8, color: colors.text, marginBottom: 8, marginTop: 4 },
  termHeadingSub: { fontWeight: '600', color: colors.textMuted, letterSpacing: 0 },
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
  goalRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 },
  goalRowLeft: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', marginRight: 8, alignSelf: 'flex-start' },
  goalRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  goalRowTitle: { fontSize: 14, fontWeight: '800', color: colors.text, lineHeight: 20 },
  goalRowMeta: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center' },
  tabLabel: { fontSize: 12.5, fontWeight: '900', color: colors.text },
  tabSub: { fontSize: 10.5, fontWeight: '600', color: colors.textMuted, marginTop: 1 },
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
