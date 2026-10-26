/**
 * Join with your code (route: /public/join?t=<code>). A new start scans the
 * personal QR code the Owner shows them on BA Academy day, chooses their own
 * password here, and is signed straight in. The code works once, for a few
 * days. (POST /new-starts/join/check, POST /new-starts/join)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ActivityIndicator, Image, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useColors, fonts } from '../../src/theme/ThemeContext';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useKeyboardInset } from '../../src/hooks/useKeyboardInset';

const MIN = 8;
const errText = (e: any) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : 'That didn’t work. Check your connection and try again.';
};

export default function JoinScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const kb = useKeyboardInset();
  const { adoptSession } = useAuth();
  const { t } = useLocalSearchParams<{ t?: string }>();
  const token = typeof t === 'string' ? t : '';
  const [name, setName] = useState<string | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setBad('This link is missing its code. Scan your QR code again.'); return; }
    api.post('/new-starts/join/check', { token })
      .then((r) => setName(r.data?.name || ''))
      .catch((e) => setBad(errText(e)));
  }, [token]);

  const first = (name || '').trim().split(/\s+/)[0];
  const ready = pw.length >= MIN && pw === again && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post('/new-starts/join', { token, password: pw });
      await adoptSession(r.data);
      router.replace('/(tabs)' as never);
    } catch (e: any) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 40 + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.shell}>
        <Image source={require('../../assets/images/icon.png')} style={s.logo} />
        {bad ? (
          <>
            <Text style={s.h1}>This code doesn’t work</Text>
            <Text style={s.body}>{bad}</Text>
            <Pressable onPress={() => router.replace('/login' as never)} style={s.btn}><Text style={s.btnText}>Go to sign in</Text></Pressable>
          </>
        ) : name === null ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <>
            <Text style={s.h1}>Welcome{first ? `, ${first}` : ''}</Text>
            <Text style={s.body}>Choose a password only you know. You’ll use it with your email to sign in from now on.</Text>
            <View style={{ gap: 4, width: '100%' }}>
              <Text style={s.label}>New password</Text>
              <TextInput value={pw} onChangeText={setPw} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                placeholder={`At least ${MIN} characters`} placeholderTextColor={c.textMuted} style={s.input} testID="join-password" />
            </View>
            <View style={{ gap: 4, width: '100%' }}>
              <Text style={s.label}>Type it again</Text>
              <TextInput value={again} onChangeText={setAgain} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                placeholderTextColor={c.textMuted} style={s.input} onSubmitEditing={submit} testID="join-password-again" />
            </View>
            <Pressable onPress={() => setShow((v) => !v)}><Text style={s.link}>{show ? 'Hide password' : 'Show password'}</Text></Pressable>
            {pw.length > 0 && pw.length < MIN && <Text style={s.hint}>{MIN - pw.length} more character{MIN - pw.length === 1 ? '' : 's'}</Text>}
            {again.length > 0 && pw !== again && <Text style={s.hint}>The two don’t match yet</Text>}
            {!!error && <Text style={s.error}>{error}</Text>}
            <Pressable onPress={submit} disabled={!ready} style={[s.btn, s.btnPrimary, !ready && { opacity: 0.5 }]} accessibilityRole="button" testID="join-submit">
              {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnPrimaryText}>Save and sign in</Text>}
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 24, paddingTop: 56 },
  shell: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'center', gap: 14 },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#ffffff', marginBottom: 6 },
  h1: { fontFamily: fonts.display, fontSize: 28, color: c.text, textAlign: 'center' },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.textMuted, textAlign: 'center' },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  input: { fontFamily: fonts.body, fontSize: 17, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.background, width: '100%' },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  hint: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted },
  error: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.red, textAlign: 'center' },
  btn: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', width: '100%' },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  btnPrimary: { backgroundColor: c.primary, borderColor: c.primary, paddingVertical: 15 },
  btnPrimaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
});
