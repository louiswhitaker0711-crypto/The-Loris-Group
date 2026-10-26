/**
 * Set up today's new starts (route: /new-starts). The Owner's call
 * (26 Oct 2026): on BA Academy days, from the front of the room, the Owner
 * shows the app's QR code, adds each new start by name and email, and gives
 * them a way in: a starter password to read out, or their own QR code that
 * signs them straight in. Either way they choose their own password first.
 * The list shows who's in, so nobody is still stuck when coaching starts.
 * (POST /new-starts, POST /new-starts/{id}/again, GET /new-starts/today)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Platform, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { todayISO } from '../src/utils/calendarDates';
import { NEW_STARTS_DONE_KEY } from '../src/components/home/NewStartsButton';

type Issued = { user_id: string; name: string; email: string; password: string; join_token: string };
type Person = { user_id: string; name: string; email: string; ready: boolean };

const origin = () => (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '');
const joinLink = (token: string) => `${origin()}/public/join?t=${encodeURIComponent(token)}`;
const errText = (e: any) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : 'That didn’t work. Check your connection and try again.';
};

export default function NewStartsScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const tabClear = useTabBarClearance();
  const kb = useKeyboardInset();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const listQ = useQuery({
    queryKey: ['new-starts-today'],
    queryFn: async () => (await api.get('/new-starts/today')).data as { people: Person[] },
    refetchInterval: 15 * 1000,
    retry: false,
  });
  const people = listQ.data?.people || [];
  const readyCount = people.filter((p) => p.ready).length;

  const add = async () => {
    if (busy) return;
    setError(null);
    if (!name.trim() || !email.trim()) { setError('Add their name and email.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/new-starts', { name: name.trim(), email: email.trim() });
      setIssued(r.data);
      setName(''); setEmail('');
      qc.invalidateQueries({ queryKey: ['new-starts-today'] });
      qc.invalidateQueries({ queryKey: ['academy-class'] });
    } catch (e: any) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const again = async (p: Person) => {
    setError(null);
    try {
      const r = await api.post(`/new-starts/${encodeURIComponent(p.user_id)}/again`);
      setIssued(r.data);
    } catch (e: any) {
      setError(errText(e));
    }
  };

  const allDone = async () => {
    try { await AsyncStorage.setItem(NEW_STARTS_DONE_KEY, todayISO()); } catch {}
    qc.invalidateQueries({ queryKey: ['new-starts-done'] });
    router.replace('/(tabs)' as never);
  };

  const appUrl = origin();

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        {/* 1 ─ The app */}
        <View style={s.card}>
          <Text style={s.step}>1 · Everyone scans this</Text>
          {!!appUrl && (
            <View style={s.qrBox}><QRCode value={appUrl} size={220} color="#0c2340" backgroundColor="#ffffff" /></View>
          )}
          <Text style={s.hint}>Opens the app. On iPhone tap <Text style={s.b}>Share → Add to Home Screen</Text>; on Android tap <Text style={s.b}>⋮ → Add to Home screen</Text>.</Text>
        </View>

        {/* 2 ─ Add */}
        <View style={s.card}>
          <Text style={s.step}>2 · Add a new start</Text>
          {issued ? (
            <View style={{ gap: 14 }}>
              <Text style={s.issuedName}>{issued.name}</Text>
              <View style={s.creds}>
                <Text style={s.credLabel}>Email</Text>
                <Text selectable style={s.credValue}>{issued.email}</Text>
                <Text style={[s.credLabel, { marginTop: 8 }]}>Starter password</Text>
                <Text selectable style={s.password}>{issued.password}</Text>
              </View>
              {!!appUrl && (
                <>
                  <Text style={s.hint}>Or they scan their own code to sign straight in:</Text>
                  <View style={s.qrBox}><QRCode value={joinLink(issued.join_token)} size={200} color="#0c2340" backgroundColor="#ffffff" /></View>
                </>
              )}
              <Text style={s.hint}>Either way, they choose their own password first. The code works once, for 3 days.</Text>
              <Pressable onPress={() => setIssued(null)} style={[s.btn, s.btnPrimary]} accessibilityRole="button" testID="new-starts-next">
                <Text style={s.btnPrimaryText}>Next person</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={{ gap: 4 }}>
                <Text style={s.credLabel}>Name</Text>
                <TextInput value={name} onChangeText={setName} placeholder="First and last name" placeholderTextColor={c.textMuted}
                  autoCapitalize="words" style={s.input} testID="new-starts-name" returnKeyType="next" />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={s.credLabel}>Email</Text>
                <TextInput value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={c.textMuted}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={s.input} testID="new-starts-email"
                  returnKeyType="done" onSubmitEditing={add} />
              </View>
              <Text style={s.hint}>They start with no Coach. You give them one on Wednesday.</Text>
              <Pressable onPress={add} disabled={busy} style={[s.btn, s.btnPrimary, busy && { opacity: 0.6 }]} accessibilityRole="button" testID="new-starts-add">
                {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnPrimaryText}>Add and show their login</Text>}
              </Pressable>
            </View>
          )}
          {!!error && <Text style={s.error}>{error}</Text>}
        </View>

        {/* 3 ─ Who's in */}
        <View style={s.card}>
          <Text style={s.step}>3 · Who’s in</Text>
          {people.length === 0 ? (
            <Text style={s.hint}>Nobody added yet this week.</Text>
          ) : (
            <>
              <Text style={s.hint}>{readyCount} of {people.length} signed in with their own password</Text>
              {people.map((p) => (
                <View key={p.user_id} style={s.row}>
                  <Ionicons name={p.ready ? 'checkmark-circle' : 'time-outline'} size={22} color={p.ready ? c.sgreen : c.yellow} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>{p.ready ? 'In' : 'Not signed in yet'} · {p.email}</Text>
                  </View>
                  {!p.ready && (
                    <Pressable onPress={() => again(p)} style={s.btn} accessibilityRole="button">
                      <Text style={s.btnText}>Show login again</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </>
          )}
        </View>

        <Pressable onPress={allDone} style={[s.btn, { alignSelf: 'center', paddingHorizontal: 22 }]} accessibilityRole="button" testID="new-starts-done">
          <Text style={s.btnText}>All done for today</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 14 },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 18, gap: 12 },
  step: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  qrBox: { alignSelf: 'center', padding: 14, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: c.border },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  b: { fontFamily: fonts.bodySemibold, color: c.text },
  input: { fontFamily: fonts.body, fontSize: 17, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.surface },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary, paddingVertical: 14 },
  btnPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  issuedName: { fontFamily: fonts.display, fontSize: 24, color: c.text },
  creds: { backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 2 },
  credLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  credValue: { fontFamily: fonts.bodySemibold, fontSize: 17, color: c.text },
  password: { fontFamily: fonts.monoSemibold, fontSize: 30, color: c.primary, letterSpacing: 1 },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.red },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  rowName: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  rowSub: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
});
