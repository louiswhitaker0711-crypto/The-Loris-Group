/**
 * New start sign-up (route: /public/signup?c=<today's room code>). The
 * Owner's call (26 Oct 2026): one scan of the QR code on the Owner's setup
 * screen signs a new start up (name, email, their own password), opens the
 * app, and shows them how to add it to their home screen. The code only works
 * on the day (POST /new-starts/signup/check, POST /new-starts/signup).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Image, ScrollView, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../src/theme/ThemeContext';
import { APP_NAME } from '../../src/theme/brand';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useKeyboardInset } from '../../src/hooks/useKeyboardInset';

const MIN = 8;
const errText = (e: any) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : 'That didn’t work. Check your connection and try again.';
};

type Device = 'iphone' | 'android' | 'other';
function device(): Device {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}
function installedAlready(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  } catch { return false; }
}

export default function SignupScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const kb = useKeyboardInset();
  const { adoptSession } = useAuth();
  const { c: codeParam } = useLocalSearchParams<{ c?: string }>();
  const code = typeof codeParam === 'string' ? codeParam : '';
  const [state, setState] = useState<'checking' | 'bad' | 'form' | 'done'>('checking');
  const [bad, setBad] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<any>(null);

  useEffect(() => {
    if (!code) { setBad('This link is missing its code. Scan the QR code again.'); setState('bad'); return; }
    api.post('/new-starts/signup/check', { code })
      .then(() => setState('form'))
      .catch((e) => { setBad(errText(e)); setState('bad'); });
  }, [code]);

  // Android/Chrome offer a one-tap install; keep it for the button below.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const on = (e: any) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);

  const fullName = name.trim().split(/\s+/).length >= 2;
  const ready = fullName && /\S+@\S+\.\S+/.test(email.trim()) && pw.length >= MIN && pw === again && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post('/new-starts/signup', { code, name: name.trim(), email: email.trim(), password: pw });
      await adoptSession(r.data);
      if (installedAlready()) { router.replace('/academy/1' as never); return; }
      setState('done');
    } catch (e: any) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    try { installEvt?.prompt?.(); await installEvt?.userChoice; } catch {}
    setInstallEvt(null);
  };

  const first = name.trim().split(/\s+/)[0];
  const dev = device();

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 40 + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        <Image source={require('../../assets/images/icon.png')} style={s.logo} />
        {state === 'checking' && <ActivityIndicator color={c.primary} />}

        {state === 'bad' && (
          <>
            <Text style={s.h1}>This code has finished</Text>
            <Text style={s.body}>{bad}</Text>
            <Pressable onPress={() => router.replace('/login' as never)} style={s.btn}><Text style={s.btnText}>I already have an account</Text></Pressable>
          </>
        )}

        {state === 'form' && (
          <>
            <Text style={s.h1}>Welcome to {APP_NAME}</Text>
            <Text style={s.body}>Set up your account. You’ll use your email and password to sign in from now on.</Text>
            <Field label="Your name" s={s}>
              <TextInput value={name} onChangeText={setName} placeholder="First and last name" placeholderTextColor={c.textMuted}
                autoCapitalize="words" autoComplete="name" style={s.input} testID="signup-name" />
            </Field>
            <Field label="Your email" s={s}>
              <TextInput value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={c.textMuted}
                autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" style={s.input} testID="signup-email" />
            </Field>
            <Field label="Choose a password" s={s}>
              <TextInput value={pw} onChangeText={setPw} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password"
                placeholder={`At least ${MIN} characters`} placeholderTextColor={c.textMuted} style={s.input} testID="signup-password" />
            </Field>
            <Field label="Type it again" s={s}>
              <TextInput value={again} onChangeText={setAgain} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password"
                placeholderTextColor={c.textMuted} style={s.input} onSubmitEditing={submit} testID="signup-password-again" />
            </Field>
            <Pressable onPress={() => setShow((v) => !v)}><Text style={s.link}>{show ? 'Hide password' : 'Show password'}</Text></Pressable>
            {name.length > 0 && !fullName && <Text style={s.hint}>Add your surname too</Text>}
            {pw.length > 0 && pw.length < MIN && <Text style={s.hint}>{MIN - pw.length} more character{MIN - pw.length === 1 ? '' : 's'} for your password</Text>}
            {again.length > 0 && pw !== again && <Text style={s.hint}>The two passwords don’t match yet</Text>}
            {!!error && <Text style={s.error}>{error}</Text>}
            <Pressable onPress={submit} disabled={!ready} style={[s.btn, s.btnPrimary, !ready && { opacity: 0.5 }]} accessibilityRole="button" testID="signup-submit">
              {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnPrimaryText}>Create my account</Text>}
            </Pressable>
          </>
        )}

        {state === 'done' && (
          <>
            <Text style={s.h1}>You’re in{first ? `, ${first}` : ''}!</Text>
            <Text style={s.body}>Now put {APP_NAME} on your home screen, so it opens like an app.</Text>
            {installEvt ? (
              <Pressable onPress={install} style={[s.btn, s.btnPrimary]} accessibilityRole="button">
                <Text style={s.btnPrimaryText}>Add to my home screen</Text>
              </Pressable>
            ) : (
              <View style={s.steps}>
                {(dev === 'android' ? ANDROID : IPHONE).map((st, i) => (
                  <View key={i} style={s.stepRow}>
                    <View style={s.stepNum}><Text style={s.stepNumText}>{i + 1}</Text></View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={s.stepTitle}>{st.t}</Text>
                      {!!st.d && <Text style={s.hint}>{st.d}</Text>}
                    </View>
                    {!!st.icon && <Ionicons name={st.icon as any} size={24} color={c.primary} />}
                  </View>
                ))}
              </View>
            )}
            <Text style={s.hint}>When you open it from your home screen, sign in with the email and password you just chose.</Text>
            <Pressable onPress={() => router.replace('/academy/1' as never)} style={s.btn} accessibilityRole="button" testID="signup-open-workbook">
              <Text style={s.btnText}>Open my Day 1 workbook</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const IPHONE = [
  { t: 'Tap the Share button', d: 'The square with an arrow, at the bottom of Safari (top right in Chrome).', icon: 'share-outline' },
  { t: 'Scroll down and tap “Add to Home Screen”', d: '', icon: 'add-circle-outline' },
  { t: 'Tap “Add” in the top corner', d: 'The app appears on your home screen.', icon: 'checkmark-circle-outline' },
];
const ANDROID = [
  { t: 'Tap ⋮ at the top right of Chrome', d: '', icon: 'ellipsis-vertical' },
  { t: 'Tap “Add to Home screen” or “Install app”', d: '', icon: 'add-circle-outline' },
  { t: 'Tap “Install” or “Add”', d: 'The app appears on your home screen.', icon: 'checkmark-circle-outline' },
];

function Field({ label, s, children }: { label: string; s: any; children: React.ReactNode }) {
  return <View style={{ gap: 4, width: '100%' }}><Text style={s.label}>{label}</Text>{children}</View>;
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 24, paddingTop: 48 },
  shell: { width: '100%', maxWidth: 440, alignSelf: 'center', alignItems: 'center', gap: 14 },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#ffffff', marginBottom: 6 },
  h1: { fontFamily: fonts.display, fontSize: 28, color: c.text, textAlign: 'center' },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.textMuted, textAlign: 'center' },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  input: { fontFamily: fonts.body, fontSize: 17, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.background, width: '100%' },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  hint: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.red, textAlign: 'center' },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', width: '100%' },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary, paddingVertical: 15 },
  btnPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  steps: { width: '100%', backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 14, gap: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: fonts.monoSemibold, fontSize: 14, color: c.onPrimary },
  stepTitle: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
});
