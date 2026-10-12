/** Add from OwnerIQ — create app accounts for the people in the office's
 *  OwnerIQ tree who aren't in the app yet. Reads OwnerIQ only; never changes it.
 *  Each new account gets the starter password typed here and must choose its
 *  own password on first login. Coach = stage 3+ in OwnerIQ, otherwise BA; each
 *  person's coach is their parent in the OwnerIQ tree. */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';

type Row = {
  owneriq_user_id: string;
  name: string;
  email: string;
  badges: string[];
  role: 'leader' | 'trainee';
  coach_name: string | null;
  in_tree: boolean;
  status: 'new' | 'no_email' | 'in_app';
  app_user_name: string | null;
};

type Result = {
  created: { owneriq_user_id: string; name: string; email: string; role: string; coach_name?: string }[];
  skipped: { owneriq_user_id: string; name: string | null; reason: string }[];
  starter_password_expires_at: string;
  days: number;
};

const MIN = 8;

function makePassword(): string {
  const words = ['milk', 'round', 'doors', 'bells', 'green', 'early', 'fresh', 'sector'];
  const w = () => words[Math.floor(Math.random() * words.length)];
  return `${w()}-${w()}-${Math.floor(100 + Math.random() * 900)}`;
}

function errText(e: any, fallback: string): string {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

export default function OwnerIqImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['owneriq-import-plan'],
    queryFn: () => apiService.owneriqImportPeople({ dry_run: true }).then((r) => r.data as { rows: Row[] }),
    retry: false,
  });
  const rows = q.data?.rows || [];
  const fresh = rows.filter((r) => r.status === 'new');
  const noEmail = rows.filter((r) => r.status === 'no_email');
  const inApp = rows.filter((r) => r.status === 'in_app');

  // Ticked by default: people under someone in the tree. Top-level accounts
  // (admins, applicants) start unticked.
  const [picked, setPicked] = useState<Record<string, boolean> | null>(null);
  const [roles, setRoles] = useState<Record<string, 'leader' | 'trainee'>>({});
  const ticks = useMemo(() => {
    if (picked) return picked;
    const t: Record<string, boolean> = {};
    fresh.forEach((r) => { t[r.owneriq_user_id] = r.in_tree; });
    return t;
  }, [picked, fresh]);
  const toggle = (id: string) => setPicked({ ...ticks, [id]: !ticks[id] });
  const count = fresh.filter((r) => ticks[r.owneriq_user_id]).length;

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = count > 0 && password.length >= MIN && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const people = fresh.filter((r) => ticks[r.owneriq_user_id])
        .map((r) => ({ owneriq_user_id: r.owneriq_user_id, role: roles[r.owneriq_user_id] || r.role }));
      const res = await apiService.owneriqImportPeople({ dry_run: false, people, starter_password: password, days: 7 });
      setResult(res.data as Result);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['team-tree'] });
      setPicked(null);
      q.refetch();
    } catch (e: any) {
      setError(errText(e, 'Could not add people. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const message = result
    ? `Your account on the team app is ready. Log in with your email address and this starter password: ${password}\n` +
      `You'll then choose your own password. The starter password works for ${result.days} days.`
    : '';
  const copy = async () => {
    await Clipboard.setStringAsync(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const card = [styles.card, { backgroundColor: colors.background, borderColor: colors.border }];
  const muted = { color: colors.textMuted };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 + kb }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={card}>
        <Text style={[styles.title, { color: colors.text }]}>Add your team from OwnerIQ</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Everyone in your OwnerIQ tree who isn't in the app yet. Coaches are people at stage 3 or above; each
          person's coach is the person above them in OwnerIQ. Their badge numbers come across too, so their
          numbers link up. Nothing is changed in OwnerIQ.
        </Text>
      </View>

      {q.isLoading ? (
        <View style={[card, styles.center]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.small, muted]}>Reading your team from OwnerIQ…</Text>
        </View>
      ) : q.isError ? (
        <View style={card}>
          <Text style={[styles.body, { color: colors.red }]}>{errText(q.error, "Couldn't read your team from OwnerIQ.")}</Text>
          <Pressable onPress={() => q.refetch()} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button">
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {result ? (
        <View style={[card, { borderColor: colors.green }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {result.created.length} {result.created.length === 1 ? 'person' : 'people'} added
          </Text>
          {result.created.map((c) => (
            <Text key={c.owneriq_user_id} style={[styles.small, { color: colors.textSecondary }]}>
              {c.name} · {c.role === 'leader' ? 'Coach' : 'BA'}{c.coach_name ? ` · coach ${c.coach_name}` : ''}
            </Text>
          ))}
          {result.skipped.map((s) => (
            <Text key={`s-${s.owneriq_user_id}`} style={[styles.small, { color: colors.red }]}>
              Not added: {s.name || 'someone'} ({s.reason})
            </Text>
          ))}
          {result.created.length > 0 ? (
            <>
              <Text style={[styles.body, { color: colors.textSecondary, marginTop: 8 }]}>
                Send them this message (for example on WhatsApp). The starter password is only shown now.
              </Text>
              <View style={[styles.msg, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.small, { color: colors.text }]} selectable>{message}</Text>
              </View>
              <Pressable onPress={copy} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button" testID="oiq-import-copy">
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.onPrimary} />
                <Text style={[styles.btnText, { color: colors.onPrimary }]}>{copied ? 'Copied' : 'Copy message'}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {!q.isLoading && !q.isError ? (
        <>
          <Text style={[styles.section, muted]}>Can be added · {fresh.length}</Text>
          {fresh.length === 0 ? (
            <View style={card}><Text style={[styles.small, muted]}>Everyone with an email in OwnerIQ is already in the app.</Text></View>
          ) : (
            <View style={card}>
              {fresh.map((r) => {
                const on = !!ticks[r.owneriq_user_id];
                const role = roles[r.owneriq_user_id] || r.role;
                return (
                  <View key={r.owneriq_user_id} style={[styles.row, { borderColor: colors.border }]}>
                    <Pressable onPress={() => toggle(r.owneriq_user_id)} style={styles.rowMain}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.name, { color: colors.text }]}>{r.name}</Text>
                        <Text style={[styles.small, muted]} numberOfLines={2}>
                          {[r.email, r.badges.join(', '), r.coach_name ? `coach ${r.coach_name}` : (r.in_tree ? '' : 'top of the tree')]
                            .filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => setRoles({ ...roles, [r.owneriq_user_id]: role === 'leader' ? 'trainee' : 'leader' })}
                      style={[styles.chip, { borderColor: colors.border, backgroundColor: role === 'leader' ? colors.primary : colors.surface }]}
                      accessibilityRole="button" accessibilityLabel={`Role ${role === 'leader' ? 'Coach' : 'BA'}, tap to change`}
                    >
                      <Text style={[styles.chipText, { color: role === 'leader' ? colors.onPrimary : colors.text }]}>
                        {role === 'leader' ? 'Coach' : 'BA'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}

              <Text style={[styles.label, { color: colors.textSecondary }]}>Starter password (at least {MIN} characters)</Text>
              <View style={styles.pwRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="e.g. fresh-milk-482"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                  testID="oiq-import-password"
                />
                <Pressable onPress={() => setPassword(makePassword())} style={[styles.ghost, { borderColor: colors.border }]} accessibilityRole="button">
                  <Text style={[styles.chipText, { color: colors.primary }]}>Make one</Text>
                </Pressable>
              </View>
              <Text style={[styles.small, muted]}>Everyone added now shares it for 7 days, and chooses their own on first login.</Text>

              {error ? <Text style={[styles.small, { color: colors.red }]} accessibilityRole="alert">{error}</Text> : null}
              <Pressable onPress={submit} disabled={!ready}
                style={[styles.btn, { backgroundColor: colors.primary }, !ready && { opacity: 0.45 }]}
                accessibilityRole="button" testID="oiq-import-add">
                {busy ? <ActivityIndicator color={colors.onPrimary} /> : (
                  <Text style={[styles.btnText, { color: colors.onPrimary }]}>
                    Add {count} {count === 1 ? 'person' : 'people'}
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          {noEmail.length > 0 ? (
            <>
              <Text style={[styles.section, muted]}>Can't add yet · no email in OwnerIQ · {noEmail.length}</Text>
              <View style={card}>
                {noEmail.map((r) => (
                  <Text key={r.owneriq_user_id} style={[styles.small, { color: colors.textSecondary }]}>
                    {r.name}{r.badges.length ? ` · ${r.badges.join(', ')}` : ''}
                  </Text>
                ))}
                <Text style={[styles.small, muted]}>Add their email in OwnerIQ, or add them here with Add Coach / BA.</Text>
              </View>
            </>
          ) : null}

          {inApp.length > 0 ? (
            <>
              <Text style={[styles.section, muted]}>Already in the app · {inApp.length}</Text>
              <View style={card}>
                {inApp.map((r) => (
                  <Text key={r.owneriq_user_id} style={[styles.small, { color: colors.textSecondary }]}>
                    {r.name}{r.app_user_name && r.app_user_name !== r.name ? ` → ${r.app_user_name}` : ''}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  center: { alignItems: 'center' },
  title: { fontFamily: fonts.display, fontSize: 20 },
  h2: { fontFamily: fonts.bodyBold, fontSize: 16 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 },
  section: { fontFamily: fonts.bodySemibold, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13.5, marginTop: 10 },
  pwRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 15 },
  ghost: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  msg: { borderWidth: 1, borderRadius: 12, padding: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, marginTop: 6 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
