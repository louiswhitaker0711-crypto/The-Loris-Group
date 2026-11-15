/**
 * Visitor sign-up (route: /public/visitor?c=<visitor code>). The Owner's call
 * (15 Nov 2026): leaders visiting from another office scan the visitor QR in
 * Admin → Visitors and make their own account: name, email, password, their
 * home office, their stage and the days they're here. Stage 3 or above can
 * grade new starts. Visitors are in sectors, bunny hops and Primetime, never
 * on Bells or KPIs. (POST /visitors/signup/check, POST /visitors/signup)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Image, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useColors, fonts } from '../../src/theme/ThemeContext';
import { APP_NAME } from '../../src/theme/brand';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useKeyboardInset } from '../../src/hooks/useKeyboardInset';
import DateField from '../../src/components/ui/DateField';
import { todayISO } from '../../src/utils/calendarDates';

const MIN = 8;
const STAGES = ['1', '2', '3', 'SL', '4', '5', '6', '7', '8', '9', '10'];
const errText = (e: any) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : 'That didn’t work. Check your connection and try again.';
};

export default function VisitorSignupScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const kb = useKeyboardInset();
  const { adoptSession } = useAuth();
  const { c: codeParam } = useLocalSearchParams<{ c?: string }>();
  const code = typeof codeParam === 'string' ? codeParam : '';
  const [state, setState] = useState<'checking' | 'bad' | 'form'>('checking');
  const [bad, setBad] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [office, setOffice] = useState('');
  const [stage, setStage] = useState('');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) { setBad('This link is missing its code. Scan the QR code again.'); setState('bad'); return; }
    api.post('/visitors/signup/check', { code })
      .then(() => setState('form'))
      .catch((e) => { setBad(errText(e)); setState('bad'); });
  }, [code]);

  const fullName = name.trim().split(/\s+/).length >= 2;
  const ready = fullName && /\S+@\S+\.\S+/.test(email.trim()) && office.trim().length > 0 && !!stage
    && !!from && !!to && to >= from && pw.length >= MIN && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post('/visitors/signup', {
        code, name: name.trim(), email: email.trim(), password: pw,
        visit_office: office.trim(), stage, visit_from: from, visit_to: to,
      });
      await adoptSession(r.data);
      router.replace('/(tabs)' as never);
    } catch (e: any) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

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
            <Text style={s.body}>Great to have you visiting. Set up your account so you can be put in sectors, bunny hops and Primetime while you’re here.</Text>
            <Field label="Your name" s={s}>
              <TextInput value={name} onChangeText={setName} placeholder="First and last name" placeholderTextColor={c.textMuted}
                autoCapitalize="words" autoComplete="name" style={s.input} testID="visitor-name" />
            </Field>
            <Field label="Your email" s={s}>
              <TextInput value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={c.textMuted}
                autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" style={s.input} testID="visitor-email" />
            </Field>
            <Field label="The office you’re from" s={s}>
              <TextInput value={office} onChangeText={setOffice} placeholder="Your office or team" placeholderTextColor={c.textMuted}
                autoCapitalize="words" style={s.input} testID="visitor-office" />
            </Field>
            <Field label="Your stage" s={s}>
              <View style={s.chips}>
                {STAGES.map((st) => (
                  <Pressable key={st} onPress={() => setStage(st)} style={[s.chip, stage === st && s.chipOn]} accessibilityRole="button" testID={`visitor-stage-${st}`}>
                    <Text style={[s.chipText, stage === st && s.chipTextOn]}>{st === 'SL' ? 'SL' : `Stage ${st}`}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <View style={{ flex: 1 }}><Field label="First day here" s={s}><DateField value={from} onChange={(v) => { setFrom(v); if (to < v) setTo(v); }} /></Field></View>
              <View style={{ flex: 1 }}><Field label="Last day here" s={s}><DateField value={to} onChange={setTo} minDate={from} /></Field></View>
            </View>
            <Field label="Choose a password" s={s}>
              <TextInput value={pw} onChangeText={setPw} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password"
                placeholder={`At least ${MIN} characters`} placeholderTextColor={c.textMuted} style={s.input} onSubmitEditing={submit} testID="visitor-password" />
            </Field>
            <Pressable onPress={() => setShow((v) => !v)}><Text style={s.link}>{show ? 'Hide password' : 'Show password'}</Text></Pressable>
            {name.length > 0 && !fullName && <Text style={s.hint}>Add your surname too</Text>}
            {pw.length > 0 && pw.length < MIN && <Text style={s.hint}>{MIN - pw.length} more character{MIN - pw.length === 1 ? '' : 's'} for your password</Text>}
            {!!error && <Text style={s.error}>{error}</Text>}
            <Pressable onPress={submit} disabled={!ready} style={[s.btn, s.btnPrimary, !ready && { opacity: 0.5 }]} accessibilityRole="button" testID="visitor-submit">
              {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnPrimaryText}>Create my account</Text>}
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.background },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  chipTextOn: { color: c.onPrimary },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  hint: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.red, textAlign: 'center' },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', width: '100%' },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary, paddingVertical: 15 },
  btnPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
});
