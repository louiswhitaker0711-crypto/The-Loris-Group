/**
 * Set up today's new starts (route: /new-starts). The Owner's call
 * (26 Oct 2026): on BA Academy days the Owner shows ONE QR code to the room.
 * A single scan signs a new start up (name, email, their own password),
 * opens the app and shows them how to add it to their home screen. The code
 * only works today: it ends at midnight, or when the Owner taps All done.
 * Each sign-up appears in Who's in, with Remove for a mistake. For anyone
 * who can't scan, the Owner can still add them by name and email and show
 * them a starter password or their own QR code.
 * (GET /new-starts/room-code, POST /new-starts/room-code/close,
 *  POST /new-starts, POST /new-starts/{id}/again, DELETE /new-starts/{id},
 *  GET /new-starts/today)
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
const signupLink = (code: string) => `${origin()}/public/signup?c=${encodeURIComponent(code)}`;
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
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const codeQ = useQuery({
    queryKey: ['new-starts-room-code'],
    queryFn: async () => (await api.get('/new-starts/room-code')).data as { code: string; expires_at: string },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const listQ = useQuery({
    queryKey: ['new-starts-today'],
    queryFn: async () => (await api.get('/new-starts/today')).data as { people: Person[] },
    refetchInterval: 10 * 1000,
    retry: false,
  });
  const people = listQ.data?.people || [];
  const readyCount = people.filter((p) => p.ready).length;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['new-starts-today'] });
    qc.invalidateQueries({ queryKey: ['academy-class'] });
  };

  const add = async () => {
    if (busy) return;
    setError(null);
    if (!name.trim() || !email.trim()) { setError('Add their name and email.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/new-starts', { name: name.trim(), email: email.trim() });
      setIssued(r.data);
      setName(''); setEmail('');
      refresh();
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
      setShowAdd(true);
    } catch (e: any) {
      setError(errText(e));
    }
  };

  const remove = async (p: Person) => {
    setError(null);
    try {
      await api.delete(`/new-starts/${encodeURIComponent(p.user_id)}`);
      setConfirmRemove(null);
      refresh();
    } catch (e: any) {
      setError(errText(e));
    }
  };

  const allDone = async () => {
    try { await api.post('/new-starts/room-code/close'); } catch {}
    try { await AsyncStorage.setItem(NEW_STARTS_DONE_KEY, todayISO()); } catch {}
    qc.invalidateQueries({ queryKey: ['new-starts-done'] });
    qc.removeQueries({ queryKey: ['new-starts-room-code'] });
    router.replace('/(tabs)' as never);
  };

  const code = codeQ.data?.code;

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        {/* 1 ─ One scan for the room */}
        <View style={s.card}>
          <Text style={s.step}>Everyone scans this</Text>
          {codeQ.isLoading ? <ActivityIndicator color={c.primary} /> : code && origin() ? (
            <View style={s.qrBox}><QRCode value={signupLink(code)} size={240} color="#0c2340" backgroundColor="#ffffff" /></View>
          ) : (
            <Text style={s.error}>{codeQ.error ? errText(codeQ.error) : 'Open this on the web app to show the QR code.'}</Text>
          )}
          <Text style={s.hint}>They type their name and email, choose a password, and they’re in. The app then shows them how to add it to their home screen. This code works until midnight, or until you tap All done.</Text>
        </View>

        {/* 2 ─ Who's in */}
        <View style={s.card}>
          <Text style={s.step}>Who’s in</Text>
          {people.length === 0 ? (
            <Text style={s.hint}>Nobody yet. Names appear here as they sign up.</Text>
          ) : (
            <>
              <Text style={s.hint}>{readyCount} of {people.length} in</Text>
              {people.map((p) => (
                <View key={p.user_id} style={s.row}>
                  <Ionicons name={p.ready ? 'checkmark-circle' : 'time-outline'} size={22} color={p.ready ? c.sgreen : c.yellow} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>{p.ready ? 'In' : 'Not signed in yet'} · {p.email}</Text>
                  </View>
                  {confirmRemove === p.user_id ? (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable onPress={() => remove(p)} style={[s.btn, { borderColor: c.red }]} accessibilityRole="button">
                        <Text style={[s.btnText, { color: c.red }]}>Remove</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmRemove(null)} style={s.btn} accessibilityRole="button">
                        <Text style={s.btnText}>Keep</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {!p.ready && (
                        <Pressable onPress={() => again(p)} style={s.btn} accessibilityRole="button">
                          <Text style={s.btnText}>Show login</Text>
                        </Pressable>
                      )}
                      <Pressable onPress={() => setConfirmRemove(p.user_id)} style={s.iconBtn} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
                        <Ionicons name="trash-outline" size={18} color={c.textMuted} />
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
          {!!error && !showAdd && <Text style={s.error}>{error}</Text>}
        </View>

        {/* 3 ─ Backup: add someone yourself */}
        <View style={s.card}>
          <Pressable onPress={() => setShowAdd((v) => !v)} style={s.addHead} accessibilityRole="button">
            <Text style={[s.step, { fontSize: 16 }]}>Someone can’t scan? Add them yourself</Text>
            <Ionicons name={showAdd ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
          </Pressable>
          {showAdd && (issued ? (
            <View style={{ gap: 14 }}>
              <Text style={s.issuedName}>{issued.name}</Text>
              <View style={s.creds}>
                <Text style={s.credLabel}>Email</Text>
                <Text selectable style={s.credValue}>{issued.email}</Text>
                <Text style={[s.credLabel, { marginTop: 8 }]}>Starter password</Text>
                <Text selectable style={s.password}>{issued.password}</Text>
              </View>
              {!!origin() && (
                <>
                  <Text style={s.hint}>Or they scan their own code to sign straight in:</Text>
                  <View style={s.qrBox}><QRCode value={joinLink(issued.join_token)} size={200} color="#0c2340" backgroundColor="#ffffff" /></View>
                </>
              )}
              <Text style={s.hint}>Either way, they choose their own password first. Their code works once, for 3 days.</Text>
              <Pressable onPress={() => setIssued(null)} style={[s.btn, s.btnPrimary]} accessibilityRole="button">
                <Text style={s.btnPrimaryText}>Next person</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={{ gap: 4 }}>
                <Text style={s.credLabel}>Name</Text>
                <TextInput value={name} onChangeText={setName} placeholder="First and last name" placeholderTextColor={c.textMuted}
                  autoCapitalize="words" style={s.input} testID="new-starts-name" />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={s.credLabel}>Email</Text>
                <TextInput value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={c.textMuted}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={s.input} testID="new-starts-email"
                  onSubmitEditing={add} />
              </View>
              <Pressable onPress={add} disabled={busy} style={[s.btn, s.btnPrimary, busy && { opacity: 0.6 }]} accessibilityRole="button" testID="new-starts-add">
                {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnPrimaryText}>Add and show their login</Text>}
              </Pressable>
            </View>
          ))}
          {!!error && showAdd && <Text style={s.error}>{error}</Text>}
        </View>

        <Pressable onPress={allDone} style={[s.btn, { alignSelf: 'center', paddingHorizontal: 22 }]} accessibilityRole="button" testID="new-starts-done">
          <Text style={s.btnText}>All done for today</Text>
        </Pressable>
        <Text style={[s.hint, { textAlign: 'center' }]}>Stops the QR code working and hides the button until tomorrow.</Text>
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 14 },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 18, gap: 12 },
  step: { fontFamily: fonts.display, fontSize: 20, color: c.text },
  qrBox: { alignSelf: 'center', padding: 14, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: c.border },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  input: { fontFamily: fonts.body, fontSize: 17, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.surface },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary, paddingVertical: 14 },
  btnPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  addHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
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
