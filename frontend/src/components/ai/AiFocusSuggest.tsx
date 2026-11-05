/**
 * "Suggest today's focus" (the Owner, 5 Nov 2026): the AI's focus, KPI, goal
 * and one tip for someone's sector set-up, from their numbers, breakdowns and
 * any private coaching notes about them (never shown or quoted).
 *
 * In the set-up form, `onUse` fills the form (they still tap Save). Without
 * `onUse` (e.g. Coaching today), Use this saves it into that day's set-up.
 * Hidden until the AI key is added. (POST /ai/setup-suggestion, POST /ai/apply)
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { toast } from '../../utils/toast';

export type FocusSuggestion = {
  focus?: string; kpi_metric?: string | null; kpi_target?: number | null; goal?: number | null;
  tip?: string; positive?: string;
};

const KPI_WORDS: Record<string, string> = { doors: 'doors', spoken: 'spoken to', pitched: 'pitched', closes: 'closes', callbacks: 'call backs' };

export default function AiFocusSuggest({ userId, date, shadow = false, onUse, label = 'Suggest today’s focus' }: {
  userId: string; date: string; shadow?: boolean; onUse?: (x: FocusSuggestion) => void; label?: string;
}) {
  const c = useColors();
  const s = styles(c);
  const status = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: async () => (await api.get('/ai/status')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState<FocusSuggestion | null>(null);
  const [used, setUsed] = useState(false);
  if (!status.data?.enabled) return null;

  const ask = async (refresh = false) => {
    setBusy(true);
    try {
      const r = (await api.post('/ai/setup-suggestion', { user_id: userId, date, shadow, refresh })).data;
      setSug(r.suggestion || null);
      setUsed(false);
    } catch (e: any) {
      toast.error('No suggestion', e?.response?.data?.detail || 'The AI didn’t answer. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };
  const use = async () => {
    if (!sug) return;
    if (onUse) { onUse(sug); setUsed(true); return; }
    setBusy(true);
    try {
      await api.post('/ai/apply', { kind: 'setup', data: { user_id: userId, date, focus: sug.focus, kpi_metric: sug.kpi_metric,
        kpi_target: sug.kpi_target, goal: sug.goal, positive: sug.positive } });
      setUsed(true);
      toast.success('Done', 'It’s in their set-up for the day.');
    } catch (e: any) {
      toast.error('Couldn’t fill that in', e?.response?.data?.detail || 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!sug) {
    return (
      <Pressable onPress={() => ask(false)} disabled={busy} style={s.ask} accessibilityRole="button" testID={`ai-focus-${userId}`}>
        {busy ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="sparkles-outline" size={15} color={c.primary} />}
        <Text style={s.askText}>{busy ? 'Thinking…' : label}</Text>
      </Pressable>
    );
  }
  const kpi = sug.kpi_metric ? `${sug.kpi_target ?? ''} ${KPI_WORDS[sug.kpi_metric] || sug.kpi_metric}`.trim() : '';
  return (
    <View style={s.box} testID={`ai-focus-result-${userId}`}>
      <View style={s.headRow}>
        <Ionicons name="sparkles" size={14} color={c.primary} />
        <Text style={s.head}>AI suggestion</Text>
      </View>
      {!!sug.focus && <Text style={s.line}><Text style={s.bold}>Focus: </Text>{sug.focus}</Text>}
      {(!!kpi || sug.goal != null) && (
        <Text style={s.line}>{[kpi && `KPI ${kpi}`, sug.goal != null && `Goal ${sug.goal}`].filter(Boolean).join(' · ')}</Text>
      )}
      {!!sug.tip && <Text style={s.tip}>Tip: {sug.tip}</Text>}
      <View style={s.row}>
        {used ? (
          <View style={s.usedPill}><Ionicons name="checkmark" size={14} color={c.primary} /><Text style={s.usedText}>{onUse ? 'Filled in: tap Save' : 'Filled in'}</Text></View>
        ) : (
          <Pressable onPress={use} disabled={busy} style={s.usePill} accessibilityRole="button" testID={`ai-focus-use-${userId}`}>
            {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Text style={s.useText}>Use this</Text>}
          </Pressable>
        )}
        <Pressable onPress={() => ask(true)} disabled={busy} accessibilityRole="button" style={{ paddingVertical: 6 }}>
          <Text style={s.again}>Try another</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  ask: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  askText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
  box: { borderWidth: 1, borderColor: c.primaryLight, backgroundColor: c.primary + '0d', borderRadius: 14, padding: 12, gap: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  head: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.primary },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  bold: { fontFamily: fonts.bodySemibold },
  tip: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  usePill: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, minWidth: 88, alignItems: 'center' },
  useText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: c.onPrimary },
  usedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  usedText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  again: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.textMuted },
});
