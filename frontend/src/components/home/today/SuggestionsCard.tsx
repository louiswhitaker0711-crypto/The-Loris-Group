// Suggested for today (Coaches and Admins): what each of your people needs,
// from their numbers — a retrain after a run of low days, order value when
// they're Silver-heavy, The Round, or the step of the Law of Averages
// they're furthest behind on. "Add to Primetime" puts you down to teach it
// to them today. (GET /coach/suggestions, rules in core/coach_suggestions.py)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { toast } from '../../../utils/toast';
import { showAlert } from '../../../utils/showAlert';
import { todayISO } from '../../../utils/calendarDates';

const SHOW = 4;
const ICON: Record<string, any> = {
  retrain: 'refresh-circle-outline', order_value: 'trending-up-outline', the_round: 'sync-outline',
  funnel: 'funnel-outline', work_rate: 'walk-outline',
};

/** The Primetime day to plan: today, or Monday when it's Sunday. */
function primetimeDay(): { week_ending: string; day_index: number } {
  const [y, m, d] = todayISO().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  let idx = (t.getUTCDay() + 6) % 7;               // Mon=0 … Sun=6
  if (idx === 6) { t.setUTCDate(t.getUTCDate() + 1); idx = 0; }
  const sun = new Date(t); sun.setUTCDate(t.getUTCDate() + (6 - idx));
  return { week_ending: sun.toISOString().slice(0, 10), day_index: idx };
}

export default function SuggestionsCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const { user } = useAuth();
  const [all, setAll] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['coach-suggestions'], queryFn: () => apiService.getCoachSuggestions().then((r) => r.data), retry: false });
  const list: any[] = (q.data?.suggestions || []).filter((x: any) => !done[`${x.user_id}:${x.kind}`]);
  if (q.isLoading || !list.length) return null;
  const shown = all ? list : list.slice(0, SHOW);

  const addToPrimetime = async (x: any) => {
    const key = `${x.user_id}:${x.kind}`;
    setBusy(key);
    try {
      await apiService.savePrimetimeEntry({ ...primetimeDay(), subject_user_id: String(user?.id), mode: 'teaching',
        topic: x.topic, with_ids: [x.user_id] });
      toast.success(`Primetime: you're teaching ${x.topic} to ${x.name.split(' ')[0]}`);
      setDone((d) => ({ ...d, [key]: true }));
      qc.invalidateQueries({ queryKey: ['primetime-home'] });
      qc.invalidateQueries({ queryKey: ['primetime-week'] });
    } catch (e: any) {
      showAlert('Could not add it', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(null); }
  };

  return (
    <View style={s.card} testID="home-suggestions">
      <View style={s.head}>
        <Text style={s.title}>Suggested for today</Text>
        <Text style={s.small}>from their numbers</Text>
      </View>
      {shown.map((x) => {
        const key = `${x.user_id}:${x.kind}`;
        return (
          <View key={key} style={s.row}>
            <Ionicons name={ICON[x.kind] || 'bulb-outline'} size={18} color={x.kind === 'retrain' ? c.red : c.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.what}>{x.title}</Text>
              <Text style={s.why}>{x.why}</Text>
            </View>
            <View style={{ gap: 6, alignItems: 'flex-end' }}>
              <Pressable onPress={() => addToPrimetime(x)} disabled={!!busy} style={s.btn} accessibilityRole="button" testID={`suggest-add-${key}`}>
                {busy === key ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="add" size={14} color={c.primary} />}
                <Text style={s.btnText}>Primetime</Text>
              </Pressable>
              <Pressable onPress={() => setDone((d) => ({ ...d, [key]: true }))} hitSlop={6} accessibilityLabel="Not today">
                <Text style={s.skip}>Not today</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {list.length > SHOW && (
        <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button">
          <Text style={s.more}>{all ? 'Show fewer' : `Show all ${list.length}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 4, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
  what: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  why: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: c.textMuted },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.primary },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  skip: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  more: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary, textAlign: 'center', paddingTop: 8 },
});
