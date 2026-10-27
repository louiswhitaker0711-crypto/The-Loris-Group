/**
 * My Week — a BA's one-page weekly plan for the week being planned
 * (Mon–Sat: this week; on Sunday: next week):
 *   • Schedule — which days they're Not scheduled (straight onto Bells).
 *   • Weekly goal — onto their Bells row; locks Monday 10:30 like the crew's.
 *   • COD focus — they pick their own (the Owner's call, Oct 2026).
 *   • Their own LOA from last week.
 *   • Submit — ticks them on their Coach's Team Planners and the Owner's
 *     Sunday card.
 * Schedule and goal go through the same writer as the Coach's crew section,
 * so the Coach sees them and can change them until the lock.
 * A Coach or Admin opening `?user_id=` sees it read-only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../src/theme/ThemeContext';
import { fonts } from '../src/theme/brand';
import { api, apiService } from '../src/api/client';
import { router as nav } from 'expo-router';
import { showAlert } from '../src/utils/showAlert';
import { APP_LOCALE } from '../src/utils/appTime';
import { DAY_STATUS_LABEL } from '../src/utils/dayStatus';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import PlannerLoaReview from '../src/components/planner/PlannerLoaReview';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function niceDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' }) : '';
}

export default function BaWeekScreen() {
  const colors = useColors();
  const s = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const kb = useKeyboardInset();
  const clearance = useTabBarClearance();
  const params = useLocalSearchParams<{ user_id?: string; week?: string }>();
  const otherId = typeof params.user_id === 'string' && params.user_id ? params.user_id : undefined;
  const weekParam = typeof params.week === 'string' && params.week ? params.week : undefined;

  const q = useQuery({
    queryKey: ['ba-week', otherId || 'me', weekParam || ''],
    queryFn: () => apiService.getBaWeek({ ...(otherId ? { user_id: otherId } : {}), ...(weekParam ? { week: weekParam } : {}) }).then((r) => r.data),
  });
  const data = q.data;
  const canEdit = !!data?.can_edit;
  const weekEnding: string = data?.week_ending || '';

  const focusQ = useQuery({
    enabled: !!weekEnding,
    queryKey: ['ba-week-focus', otherId || 'me', weekEnding],
    queryFn: () => (otherId
      ? apiService.getCodFocusPerson(otherId, weekEnding)
      : apiService.getCodFocusMe(weekEnding)).then((r) => r.data),
  });

  // Their breakeven from Plan your earnings (the Owner, 26 Oct 2026).
  const planQ = useQuery({
    queryKey: ['earnings-plan', otherId || 'me'],
    queryFn: () => api.get(`/earnings-plan${otherId ? `?user_id=${encodeURIComponent(otherId)}` : ''}`).then((r) => r.data),
    retry: false,
  });
  const breakeven: number | null = planQ.data?.breakeven ?? null;
  const planTarget: number | null = planQ.data?.target ?? null;

  const [days, setDays] = useState<string[]>(['off', 'off', 'off', 'off', 'off', 'off']);
  const [goal, setGoal] = useState('');
  const [picking, setPicking] = useState(false);
  const [stage, setStage] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setDays(data.day_statuses || ['off', 'off', 'off', 'off', 'off', 'off']);
    setGoal(data.weekly_goal != null ? String(data.weekly_goal) : '');
  }, [data]);

  const focus = focusQ.data?.focus;
  const options: any[] = focusQ.data?.options || [];
  const stages = useMemo(() => Array.from(new Set(options.map((o) => o.stage))).sort(), [options]);
  useEffect(() => {
    if (stage == null && stages.length) setStage(focus?.stage ?? stages[0]);
  }, [stages, focus, stage]);

  const focusMut = useMutation({
    mutationFn: (moduleId: string) => apiService.setCodFocus(data.user_id, moduleId, weekEnding),
    onSuccess: () => {
      setPicking(false);
      qc.invalidateQueries({ queryKey: ['ba-week-focus'] });
    },
    onError: (e: any) => showAlert('Error', e?.response?.data?.detail || 'Could not save your focus'),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      const body: any = { week_ending: weekEnding, day_statuses: days };
      if (!data.goal_locked) body.weekly_goal = goal.trim() === '' ? null : Number(goal);
      await apiService.setCrewMemberPlan(data.user_id, body);
      return apiService.submitBaWeek(weekEnding);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ba-week'] });
      showAlert('Week submitted', 'Your Coach can see your plan. You can still change it until Monday 10:30.');
    },
    onError: (e: any) => showAlert('Not submitted', e?.response?.data?.detail || 'Could not save your week. Try again.'),
  });

  if (q.isLoading) return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!data) return <View style={s.center}><Text style={s.muted}>Couldn't load this week.</Text></View>;

  const toggleDay = (i: number) => {
    if (!canEdit) return;
    const cur = days[i];
    if (cur !== 'off' && cur !== 'ab') return; // a worked day on Bells stays as it is
    const next = [...days];
    next[i] = cur === 'ab' ? 'off' : 'ab';
    setDays(next);
  };
  const goalOk = goal.trim() !== '' && !Number.isNaN(Number(goal));
  const lastWeek = data.last_week;

  return (
    <ScrollView style={s.page} contentContainerStyle={{ padding: 16, paddingBottom: clearance + kb + 24 }}>
      <Text style={s.title}>{canEdit ? 'My week' : `${data.name}'s week`}</Text>
      <Text style={s.muted}>
        Week ending {niceDate(weekEnding)}
        {data.submitted_at ? ` · Submitted ${niceDate(data.submitted_at)}` : ' · Not submitted yet'}
      </Text>

      {/* Schedule */}
      <View style={s.card}>
        <Text style={s.head}>Schedule</Text>
        <Text style={s.hint}>{canEdit ? 'Tap a day you won\'t be in the field.' : 'Days they won\'t be in the field.'}</Text>
        <View style={s.dayRow}>
          {DAYS.map((d, i) => {
            const st = days[i];
            const off = st === 'ab';
            const fixed = st !== 'off' && st !== 'ab';
            return (
              <TouchableOpacity key={d} onPress={() => toggleDay(i)} disabled={!canEdit || fixed}
                style={[s.day, off ? s.dayOff : s.dayOn]} testID={`ba-week-day-${i}`}>
                <Text style={[s.dayName, off && s.dayNameOff]}>{d}</Text>
                <Text style={[s.dayState, off && s.dayNameOff]} numberOfLines={1}>
                  {off ? 'Not scheduled' : fixed ? (DAY_STATUS_LABEL as any)[st] || st.toUpperCase() : 'In'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Goal */}
      <View style={s.card}>
        <Text style={s.head}>Weekly goal</Text>
        {lastWeek ? (
          <Text style={s.hint}>Last week: {lastWeek.total ?? 0} sign-ups{lastWeek.goal != null ? ` (goal ${lastWeek.goal})` : ''}</Text>
        ) : null}
        <TextInput
          value={goal}
          onChangeText={(v) => setGoal(v.replace(/[^0-9.]/g, ''))}
          editable={canEdit && !data.goal_locked}
          keyboardType="number-pad"
          placeholder="Sign-ups this week"
          placeholderTextColor={colors.textMuted}
          style={[s.input, (!canEdit || data.goal_locked) && s.inputOff]}
          testID="ba-week-goal"
        />
        {data.goal_locked ? <Text style={s.hint}>Goals locked at Monday 10:30. Ask your Coach to change it.</Text> : null}
        {breakeven != null ? (
          <Text style={s.hint}>
            Breakeven: {breakeven} a week{planTarget != null ? ` · target ${planTarget}` : ''}
            {goal.trim() !== '' && Number(goal) < breakeven ? '  ·  This goal is below breakeven.' : ''}
          </Text>
        ) : null}
        {!otherId ? (
          <TouchableOpacity onPress={() => nav.push('/earnings-plan' as never)} accessibilityRole="button" testID="ba-week-earnings-plan">
            <Text style={[s.hint, { color: colors.primary }]}>{breakeven != null ? 'Update my earnings plan' : 'Plan your earnings to see your breakeven'}</Text>
          </TouchableOpacity>
        ) : breakeven == null ? <Text style={s.hint}>No earnings plan yet.</Text> : null}
      </View>

      {/* COD focus */}
      <View style={s.card}>
        <Text style={s.head}>COD focus</Text>
        {focus ? (
          <Text style={s.focus}>{focus.topic}{focus.stage ? ` · Stage ${focus.stage}` : ''}</Text>
        ) : (
          <Text style={s.hint}>{canEdit ? 'Pick what you\'ll work on this week.' : 'No focus picked yet.'}</Text>
        )}
        {/* What to do on it this week: the next rung (the Owner, 27 Oct 2026). */}
        {!!focus && !!focusQ.data?.next && (
          <Text style={s.hint}>{focusQ.data.next.rung ? `This week: ${focusQ.data.next.rung}. ` : ''}{focusQ.data.next.text}</Text>
        )}
        {canEdit && (
          <TouchableOpacity style={s.ghostBtn} onPress={() => setPicking((v) => !v)} testID="ba-week-pick-focus">
            <Text style={s.ghostTxt}>{picking ? 'Close' : focus ? 'Change focus' : 'Choose focus'}</Text>
          </TouchableOpacity>
        )}
        {canEdit && picking && (
          <>
            <View style={s.stageRow}>
              {stages.map((st) => (
                <TouchableOpacity key={st} onPress={() => setStage(st)} style={[s.stageChip, stage === st && s.stageChipOn]}>
                  <Text style={[s.stageTxt, stage === st && s.stageTxtOn]}>Stage {st}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {options.filter((o) => o.stage === stage).map((o) => (
              <TouchableOpacity key={o.id} style={s.option} onPress={() => focusMut.mutate(o.id)}>
                <Ionicons name={focus?.module_id === o.id ? 'radio-button-on' : 'radio-button-off'} size={18} color={colors.primary} />
                <Text style={s.optionTxt}>{o.topic}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </View>

      {/* LOA — their own, from last week */}
      <View style={s.card}>
        <Text style={s.head}>My LOA · last week</Text>
        <PlannerLoaReview weekEnding={data.review_week_ending} ownerUserId={data.user_id} meOnly />
      </View>

      {canEdit && (
        <TouchableOpacity
          style={[s.submit, (!goalOk && !data.goal_locked) && { opacity: 0.5 }]}
          disabled={(!goalOk && !data.goal_locked) || submitMut.isPending}
          onPress={() => submitMut.mutate()}
          testID="ba-week-submit"
        >
          {submitMut.isPending ? <ActivityIndicator color={colors.onPrimary} /> : (
            <Text style={s.submitTxt}>{data.submitted_at ? 'Update my week' : 'Submit my week'}</Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function createStyles(c: any) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
    title: { fontFamily: fonts.display, fontSize: 24, color: c.text },
    muted: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted, marginTop: 2, marginBottom: 12 },
    card: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 12 },
    head: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
    hint: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted, marginBottom: 8 },
    dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    day: { width: '31%', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1 },
    dayOn: { backgroundColor: c.background, borderColor: c.primary },
    dayOff: { backgroundColor: c.surfaceAlt, borderColor: c.border },
    dayName: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
    dayNameOff: { color: c.textMuted },
    dayState: { fontFamily: fonts.body, fontSize: 11, color: c.textSecondary, marginTop: 2 },
    input: { fontFamily: fonts.mono, fontSize: 20, color: c.text, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    inputOff: { opacity: 0.6 },
    focus: { fontFamily: fonts.bodySemibold, fontSize: 16, color: c.text, marginBottom: 8 },
    ghostBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: c.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    ghostTxt: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
    stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 6 },
    stageChip: { borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 5 },
    stageChipOn: { backgroundColor: c.primary, borderColor: c.primary },
    stageTxt: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textSecondary },
    stageTxtOn: { color: c.onPrimary },
    option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    optionTxt: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: c.text },
    submit: { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    submitTxt: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  });
}
