// Paste the end-of-day WhatsApp report into Bells: each person's Gold,
// Silver and The Round for one day, so BA fees and MC fees use the real tiers
// instead of counting every sign-up as a Silver. Coaches and the Owner only.
//
// Reads 🥇 🥈 ⭕️ lines, or plain text like "Mason 2G 1S 1R" or
// "Mason - Gold 2, Silver 1, Round 1" (routes/bells_parser.py).
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { todayISO } from '../src/utils/calendarDates';
import { APP_LOCALE } from '../src/utils/appTime';

type Row = { raw_name: string; user_id: string | null; user_name: string; gold: number; silver: number; round: number; picking?: boolean };
type Person = { id: string; name: string };
const errText = (e: any, f: string) => (typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : f);

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function label(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function BellsPasteScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const router = useRouter();
  const qc = useQueryClient();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [officeId, setOfficeId] = useState<string>('');
  const [busy, setBusy] = useState<'' | 'read' | 'apply'>('');
  const [search, setSearch] = useState('');
  const roster = useQuery({ queryKey: ['bells-parse-roster'], queryFn: () => apiService.bellsParseRoster().then((r) => r.data) });
  const people: Person[] = roster.data?.items || [];

  const read = async () => {
    if (!text.trim()) return;
    setBusy('read');
    try {
      const r = await apiService.parseBellsWhatsapp(text);
      setOfficeId(r.data.office_id);
      setRows((r.data.reps || []).map((p: any) => ({
        raw_name: p.raw_name, user_id: p.matched_user_id || null, user_name: p.matched_user_name || p.raw_name,
        gold: p.over30 || 0, silver: p.under30 || 0, round: p.memberships || 0,
      })));
    } catch (e) { showAlert('Could not read that', errText(e, 'Check the message and try again.')); }
    finally { setBusy(''); }
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => (rs || []).map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const apply = async () => {
    if (!rows) return;
    const missing = rows.filter((r) => !r.user_id).map((r) => r.raw_name);
    if (missing.length) { showAlert('Who is this?', `Pick the right person for: ${missing.join(', ')}`); return; }
    setBusy('apply');
    try {
      const r = await apiService.applyBellsBulk({
        date, office_id: officeId,
        reps: rows.map((x) => ({ user_id: x.user_id, user_name: x.user_name, raw_name: x.raw_name,
          over30: x.gold, under30: x.silver, memberships: Math.min(x.round, x.gold + x.silver) })),
      });
      qc.invalidateQueries({ queryKey: ['bells'] });
      const skipped = r.data?.skipped || [];
      toast.success(`Added ${r.data?.upserted || 0} to Bells`);
      if (skipped.length) showAlert('Some were skipped', skipped.map((x: any) => `${x.user_name}: ${x.reason}`).join('\n'));
      else router.back();
    } catch (e) { showAlert('Could not add to Bells', errText(e, 'Try again.')); }
    finally { setBusy(''); }
  };

  const totals = (rows || []).reduce((a, r) => ({ g: a.g + r.gold, s: a.s + r.silver, r: a.r + Math.min(r.round, r.gold + r.silver) }), { g: 0, s: 0, r: 0 });
  const filtered = people.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.h}>1. Which day?</Text>
        <View style={s.row}>
          {[today, addDays(today, -1)].map((d, i) => (
            <Pressable key={d} onPress={() => setDate(d)} style={[s.chip, date === d && s.chipOn]} accessibilityRole="button">
              <Text style={[s.chipText, date === d && { color: c.onPrimary }]}>{i === 0 ? 'Today' : 'Yesterday'}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setDate(addDays(date, -1))} style={s.iconBtn} accessibilityLabel="Day before" hitSlop={6}>
            <Ionicons name="chevron-back" size={16} color={c.text} />
          </Pressable>
          <Text style={s.label}>{label(date)}</Text>
          <Pressable onPress={() => date < today && setDate(addDays(date, 1))} style={s.iconBtn} accessibilityLabel="Day after" hitSlop={6}>
            <Ionicons name="chevron-forward" size={16} color={date < today ? c.text : c.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.h}>2. Paste the message</Text>
        <Text style={s.muted}>Copy the end-of-day message from the WhatsApp group and paste it here. One person per block (🥇 🥈 ⭕️ lines) or per line, like "Mason 2G 1S 1R".</Text>
        <TextInput value={text} onChangeText={setText} multiline placeholder={'Mason 3\n🥇⭕️\n🥇\n🥈\n\nRosa 1G 1S 1R'}
          placeholderTextColor={c.textMuted} style={[s.input, { minHeight: 160 }]} textAlignVertical="top" />
        <Pressable onPress={read} disabled={!!busy || !text.trim()} style={[s.btn, (!!busy || !text.trim()) && { opacity: 0.5 }]} accessibilityRole="button">
          {busy === 'read' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="scan-outline" size={16} color={c.onPrimary} />}
          <Text style={s.btnText}>Read the message</Text>
        </Pressable>
      </View>

      {rows && (
        <View style={s.card}>
          <Text style={s.h}>3. Check it</Text>
          <Text style={s.muted}>{totals.g} Gold · {totals.s} Silver · {totals.r} The Round. This replaces each person's numbers for {label(date)}.</Text>
          {rows.length === 0 && <Text style={s.muted}>Nobody found in that message.</Text>}
          {rows.map((r, i) => (
            <View key={i} style={s.person}>
              <View style={s.personHead}>
                <Pressable onPress={() => { update(i, { picking: !r.picking }); setSearch(''); }} style={[s.pick, !r.user_id && s.pickMissing]} accessibilityRole="button">
                  <Text style={[s.label, !r.user_id && { color: c.red || c.text }]} numberOfLines={1}>
                    {r.user_id ? r.user_name : `Who is "${r.raw_name}"?`}
                  </Text>
                  <Ionicons name={r.picking ? 'chevron-up' : 'chevron-down'} size={16} color={c.textMuted} />
                </Pressable>
                <Pressable onPress={() => setRows((rs) => (rs || []).filter((_, j) => j !== i))} accessibilityLabel="Remove" hitSlop={8}>
                  <Ionicons name="close" size={18} color={c.textMuted} />
                </Pressable>
              </View>
              {r.user_id && r.raw_name !== r.user_name && <Text style={s.small}>From "{r.raw_name}"</Text>}
              {r.picking && (
                <View style={s.picker}>
                  <TextInput value={search} onChangeText={setSearch} placeholder="Search the team" placeholderTextColor={c.textMuted} style={s.search} />
                  {filtered.map((p) => (
                    <Pressable key={p.id} onPress={() => update(i, { user_id: p.id, user_name: p.name, picking: false })} style={s.pickRow}>
                      <Text style={s.pickText}>{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={s.counts}>
                {([['gold', '🥇 Gold'], ['silver', '🥈 Silver'], ['round', '⭕️ Round']] as const).map(([k, lbl]) => (
                  <View key={k} style={s.count}>
                    <Text style={s.small}>{lbl}</Text>
                    <View style={s.stepper}>
                      <Pressable onPress={() => update(i, { [k]: Math.max(0, r[k] - 1) } as any)} hitSlop={6} accessibilityLabel={`One fewer ${k}`}>
                        <Ionicons name="remove-circle-outline" size={22} color={c.textMuted} />
                      </Pressable>
                      <Text style={s.countVal}>{r[k]}</Text>
                      <Pressable onPress={() => update(i, { [k]: r[k] + 1 } as any)} hitSlop={6} accessibilityLabel={`One more ${k}`}>
                        <Ionicons name="add-circle-outline" size={22} color={c.primary} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
              {r.round > r.gold + r.silver && <Text style={s.small}>The Round can't be more than their sign-ups: it'll count as {r.gold + r.silver}.</Text>}
            </View>
          ))}
          {rows.length > 0 && (
            <Pressable onPress={apply} disabled={!!busy} style={[s.btn, !!busy && { opacity: 0.5 }]} accessibilityRole="button" testID="bells-paste-apply">
              {busy === 'apply' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
              <Text style={s.btnText}>Add to Bells</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, gap: 10 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text, flexShrink: 1 },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  iconBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: c.primary, alignSelf: 'flex-start' },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  person: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 6 },
  personHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pick: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  pickMissing: { borderColor: c.red || c.border },
  picker: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, gap: 2, backgroundColor: c.surface },
  search: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontFamily: fonts.body, fontSize: 14, color: c.text, marginBottom: 4 },
  pickRow: { paddingVertical: 8, paddingHorizontal: 6 },
  pickText: { fontFamily: fonts.body, fontSize: 14, color: c.text },
  counts: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  count: { gap: 2, minWidth: 96 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countVal: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.text, minWidth: 20, textAlign: 'center' },
});
