/**
 * Admin → Visitors (route: /visitors-admin) — the Owner, 15 Nov 2026. Show the
 * visitor QR: a visitor from another office scans it and makes their own
 * account (name, email, password, home office, stage, the days they're here).
 * Visitors go in sectors, bunny hops and Primetime and count towards the
 * sector's goal, but never Bells or KPIs. Stage 3 or above can grade new
 * starts. Change anyone's details here, or take them off.
 * (GET /admin/visitors, GET /visitors/code, POST /visitors/code/close,
 *  PUT/DELETE /admin/visitors/{id})
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { toast } from '../src/utils/toast';
import DateField from '../src/components/ui/DateField';
import { fmtDay } from '../src/utils/meetups';

type Visitor = { id: string; name: string; email: string; visit_office: string; stage: string; coach: boolean;
  visit_from: string; visit_to: string; status: 'upcoming' | 'here' | 'finished' };

const STAGES = ['1', '2', '3', 'SL', '4', '5', '6', '7', '8', '9', '10'];
const origin = () => (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '');
const visitorLink = (code: string) => `${origin()}/public/visitor?c=${encodeURIComponent(code)}`;
const errText = (e: any, fallback: string) => (typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : fallback);
const confirm = (title: string, msg: string): Promise<boolean> => {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${msg}`));
  return new Promise((res) => Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Yes', style: 'destructive', onPress: () => res(true) }]));
};
const STATUS: Record<Visitor['status'], string> = { upcoming: 'Coming', here: 'Here now', finished: 'Finished' };

export default function VisitorsAdminScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const tabClear = useTabBarClearance();
  const [showQr, setShowQr] = useState(false);
  const [editing, setEditing] = useState<Visitor | null>(null);
  const [busy, setBusy] = useState(false);

  const listQ = useQuery({ queryKey: ['visitors-admin'], queryFn: async () => (await api.get('/admin/visitors')).data as { visitors: Visitor[] },
    refetchInterval: showQr ? 10 * 1000 : false });
  const codeQ = useQuery({ queryKey: ['visitor-code'], enabled: showQr, retry: false, staleTime: 5 * 60 * 1000,
    queryFn: async () => (await api.get('/visitors/code')).data as { code: string; expires_at: string } });
  const refresh = () => qc.invalidateQueries({ queryKey: ['visitors-admin'] });
  const visitors = listQ.data?.visitors || [];
  const code = codeQ.data?.code;

  const closeCode = async () => {
    try { await api.post('/visitors/code/close'); } catch {}
    qc.removeQueries({ queryKey: ['visitor-code'] });
    setShowQr(false);
  };

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      await api.put(`/admin/visitors/${encodeURIComponent(editing.id)}`, {
        name: editing.name, visit_office: editing.visit_office, stage: editing.stage,
        visit_from: editing.visit_from, visit_to: editing.visit_to,
      });
      setEditing(null); refresh(); toast.success('Saved');
    } catch (e: any) {
      toast.error(errText(e, 'Couldn’t save that'));
    } finally { setBusy(false); }
  };

  const remove = async (v: Visitor) => {
    if (!(await confirm(`Take ${v.name} off?`, 'They won’t be able to sign in or be put in sectors. Their past sectors, hops and grades stay.'))) return;
    try { await api.delete(`/admin/visitors/${encodeURIComponent(v.id)}`); setEditing(null); refresh(); }
    catch (e: any) { toast.error(errText(e, 'Couldn’t take them off')); }
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        <View style={s.card}>
          <Text style={s.step}>Visitors from another office</Text>
          <Text style={s.hint}>They go in sectors, bunny hops and Primetime, and their sign-ups count towards the sector’s goal. They’re never on Bells or the KPIs. Stage 3 or above can grade new starts.</Text>
          {!showQr ? (
            <Pressable onPress={() => setShowQr(true)} style={[s.btn, s.btnPrimary]} accessibilityRole="button" testID="visitors-show-qr">
              <Text style={s.btnPrimaryText}>Show the visitor QR code</Text>
            </Pressable>
          ) : (
            <>
              {codeQ.isLoading ? <ActivityIndicator color={c.primary} /> : code && origin() ? (
                <View style={s.qrBox}><QRCode value={visitorLink(code)} size={240} color="#0c2340" backgroundColor="#ffffff" /></View>
              ) : (
                <Text style={s.error}>{codeQ.error ? errText(codeQ.error, 'Couldn’t load the code') : 'Open this on the web app to show the QR code.'}</Text>
              )}
              <Text style={s.hint}>They scan it, type their details, stage and the days they’re here, and they’re in. The code works for a week, or until you tap Stop the code.</Text>
              <Pressable onPress={closeCode} style={s.btn} accessibilityRole="button"><Text style={s.btnText}>Stop the code</Text></Pressable>
            </>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.step}>Visitors</Text>
          {listQ.isLoading ? <ActivityIndicator color={c.primary} /> : visitors.length === 0 ? (
            <Text style={s.hint}>Nobody yet. Names appear here as they sign up.</Text>
          ) : visitors.map((v) => editing?.id === v.id ? (
            <View key={v.id} style={s.editBox}>
              <TextInput value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} style={s.input} placeholder="Name" placeholderTextColor={c.textMuted} />
              <TextInput value={editing.visit_office} onChangeText={(t) => setEditing({ ...editing, visit_office: t })} style={s.input} placeholder="Their office" placeholderTextColor={c.textMuted} />
              <View style={s.chips}>
                {STAGES.map((st) => (
                  <Pressable key={st} onPress={() => setEditing({ ...editing, stage: st })} style={[s.chip, editing.stage === st && s.chipOn]}>
                    <Text style={[s.chipText, editing.stage === st && s.chipTextOn]}>{st === 'SL' ? 'SL' : `Stage ${st}`}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><DateField value={editing.visit_from} onChange={(d) => setEditing({ ...editing, visit_from: d, visit_to: editing.visit_to < d ? d : editing.visit_to })} /></View>
                <View style={{ flex: 1 }}><DateField value={editing.visit_to} onChange={(d) => setEditing({ ...editing, visit_to: d })} minDate={editing.visit_from} /></View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable onPress={() => setEditing(null)} style={[s.btn, { flex: 1 }]}><Text style={s.btnText}>Cancel</Text></Pressable>
                <Pressable onPress={save} style={[s.btn, s.btnPrimary, { flex: 1 }]}>
                  {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnPrimaryText}>Save</Text>}
                </Pressable>
              </View>
              <Pressable onPress={() => remove(v)}><Text style={[s.link, { color: c.red }]}>Take {v.name.split(' ')[0]} off</Text></Pressable>
            </View>
          ) : (
            <Pressable key={v.id} onPress={() => setEditing({ ...v })} style={s.row} accessibilityRole="button">
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name}>{v.name}</Text>
                <Text style={s.hint}>{v.visit_office} · {v.stage === 'SL' ? 'SL' : `Stage ${v.stage}`}{v.coach ? ' · can grade' : ''}</Text>
                <Text style={s.hint}>{fmtDay(v.visit_from)} – {fmtDay(v.visit_to)}</Text>
              </View>
              <View style={[s.pill, v.status === 'here' && { backgroundColor: c.primary }]}>
                <Text style={[s.pillText, v.status === 'here' && { color: c.onPrimary }]}>{STATUS[v.status]}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 14 },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 16, gap: 12 },
  step: { fontFamily: fonts.display, fontSize: 20, color: c.text },
  hint: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.red },
  qrBox: { alignSelf: 'center', padding: 14, backgroundColor: '#ffffff', borderRadius: 16 },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center' },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary },
  btnPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  name: { fontFamily: fonts.bodySemibold, fontSize: 16, color: c.text },
  pill: { borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textMuted },
  editBox: { gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  input: { fontFamily: fonts.body, fontSize: 16, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  chipTextOn: { color: c.onPrimary },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
});
