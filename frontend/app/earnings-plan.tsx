/**
 * Plan your earnings (route: /earnings-plan; ?user=<id> to read someone you
 * coach). The Owner's call (26 Oct 2026): everyone knows their weekly
 * breakeven. Needs and wants, each per week or per month; one sign-up counts
 * as the Gold fee up front plus The Round on 75% of sign-ups (from Rates).
 * The breakeven fills the BE column on Bells and shows on the weekly plan.
 * (GET/PUT /earnings-plan; the maths matches backend/core/earnings_plan.py)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { formatMoney } from '../src/utils/appTime';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { toast } from '../src/utils/toast';

type Row = { id: string; label: string; amount: string; per: 'week' | 'month' };
type Plan = { user_id: string; name: string; needs: Row[]; wants: Row[]; updated_at?: string | null;
  per_sign_up: number; breakeven: number | null; target: number | null; read_only: boolean };

const NEEDS = ['Rent', 'Bills', 'Phone', 'Food', 'Travel'];
const WANTS = ['Savings', 'Going out'];
const blank = (label = '', per: Row['per'] = 'month'): Row => ({ id: `r-${Math.random().toString(36).slice(2, 9)}`, label, amount: '', per });
const num = (x: string) => { const n = parseFloat(String(x || '').replace(/[£,]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const weekly = (r: Row) => (r.per === 'month' ? num(r.amount) * 12 / 52 : num(r.amount));

export default function EarningsPlanScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const tabClear = useTabBarClearance();
  const kb = useKeyboardInset();
  const { user: other } = useLocalSearchParams<{ user?: string }>();
  const otherId = typeof other === 'string' ? other : '';
  const q = useQuery({
    queryKey: ['earnings-plan', otherId || 'me'],
    queryFn: async () => (await api.get(`/earnings-plan${otherId ? `?user_id=${encodeURIComponent(otherId)}` : ''}`)).data as Plan,
    retry: false,
  });
  const readOnly = !!q.data?.read_only;
  const [needs, setNeeds] = useState<Row[]>([]);
  const [wants, setWants] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setNeeds(q.data.needs?.length ? q.data.needs : NEEDS.map((l) => blank(l)));
    setWants(q.data.wants?.length ? q.data.wants : WANTS.map((l) => blank(l)));
  }, [q.data]);

  const fee = q.data?.per_sign_up || 26;
  const wkNeeds = needs.reduce((a, r) => a + weekly(r), 0);
  const wkWants = wants.reduce((a, r) => a + weekly(r), 0);
  const breakeven = wkNeeds > 0 ? Math.ceil(wkNeeds / fee) : null;
  const target = wkNeeds + wkWants > 0 ? Math.ceil((wkNeeds + wkWants) / fee) : null;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/earnings-plan', { needs, wants });
      qc.invalidateQueries({ queryKey: ['earnings-plan'] });
      qc.invalidateQueries({ queryKey: ['bells'] });
      toast.success('Plan saved', 'Your breakeven is on Bells and your weekly plan');
      router.back();
    } catch {
      toast.error('Couldn’t save', 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <View style={[s.page, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={c.primary} /></View>;

  const group = (title: string, rows: Row[], set: (r: Row[]) => void, hint: string) => (
    <View style={s.card}>
      <Text style={s.h2}>{title}</Text>
      <Text style={s.hint}>{hint}</Text>
      {rows.map((r, i) => (
        <View key={r.id} style={s.row}>
          <TextInput value={r.label} editable={!readOnly} onChangeText={(v) => set(rows.map((x, j) => (j === i ? { ...x, label: v } : x)))}
            placeholder="What for" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1.4 }]} />
          <TextInput value={r.amount} editable={!readOnly} keyboardType="decimal-pad"
            onChangeText={(v) => set(rows.map((x, j) => (j === i ? { ...x, amount: v.replace(/[^0-9.]/g, '') } : x)))}
            placeholder="£0" placeholderTextColor={c.textMuted} style={[s.input, { flex: 0.9, textAlign: 'right' }]} />
          <Pressable disabled={readOnly} onPress={() => set(rows.map((x, j) => (j === i ? { ...x, per: x.per === 'month' ? 'week' : 'month' } : x)))}
            style={s.per} accessibilityRole="button" accessibilityLabel={r.per === 'month' ? 'Per month. Tap for per week' : 'Per week. Tap for per month'}>
            <Text style={s.perText}>{r.per === 'month' ? 'a month' : 'a week'}</Text>
          </Pressable>
          {!readOnly && (
            <Pressable onPress={() => set(rows.filter((_, j) => j !== i))} accessibilityLabel="Remove" style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </Pressable>
          )}
        </View>
      ))}
      {!readOnly && (
        <Pressable onPress={() => set([...rows, blank()])} style={s.add}><Ionicons name="add" size={16} color={c.primary} /><Text style={s.addText}>Add a line</Text></Pressable>
      )}
    </View>
  );

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        <Text style={s.h1}>{readOnly ? `${q.data?.name || ''}’s earnings plan` : 'Plan your earnings'}</Text>
        <Text style={s.hint}>Add what you need to cover and what you want on top, by the week or the month. We’ll work out how many sign-ups a week you need.</Text>

        <View style={s.result}>
          <View style={{ flex: 1 }}>
            <Text style={s.resLabel}>Breakeven</Text>
            <Text style={s.resBig}>{breakeven ?? '–'}</Text>
            <Text style={s.resSub}>sign-ups a week to cover your needs</Text>
          </View>
          <View style={s.resDivider} />
          <View style={{ flex: 1 }}>
            <Text style={s.resLabel}>Target</Text>
            <Text style={s.resBig}>{target ?? '–'}</Text>
            <Text style={s.resSub}>to cover your needs and wants</Text>
          </View>
        </View>
        <Text style={s.small}>Needs {formatMoney(wkNeeds, 2)} a week · wants {formatMoney(wkWants, 2)} a week · each sign-up counted at {formatMoney(fee, 2)} (a Gold sign-up, with The Round on 3 in 4)</Text>

        {group('Needs', needs, setNeeds, 'The things you have to pay for.')}
        {group('Wants', wants, setWants, 'What you’d like on top: savings, going out, a holiday.')}

        {!readOnly && (
          <Pressable onPress={save} disabled={busy} style={[s.save, busy && { opacity: 0.6 }]} accessibilityRole="button" testID="earnings-plan-save">
            {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.saveText}>Save my plan</Text>}
          </Pressable>
        )}
        <Text style={[s.small, { textAlign: 'center' }]}>Your breakeven shows on Bells and on your weekly plan. Update it once a month, or whenever things change.</Text>
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 12 },
  h1: { fontFamily: fonts.display, fontSize: 28, color: c.text },
  h2: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: c.textMuted },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { fontFamily: fonts.body, fontSize: 15, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: c.surface, minWidth: 0 },
  per: { borderWidth: 1, borderColor: c.primaryLight, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  perText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.primary },
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
  addText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  result: { flexDirection: 'row', backgroundColor: c.ink, borderRadius: 18, padding: 18, gap: 14 },
  resLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.inkMuted },
  resBig: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: c.inkText },
  resSub: { fontFamily: fonts.body, fontSize: 13, color: c.inkMuted },
  resDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  save: { backgroundColor: c.primary, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
});
