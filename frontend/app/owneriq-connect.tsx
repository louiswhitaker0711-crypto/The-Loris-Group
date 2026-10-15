// Admin → OwnerIQ: keep OwnerIQ connected now it asks for a code at sign-in.
// You sign in on a computer (with your code), copy the session from the
// browser, and paste it here. Shows the state and lets you reconnect. Owner
// (super-admin) only. (routes/owneriq.py /owneriq/connect)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { APP_LOCALE, APP_TZ } from '../src/utils/appTime';
import { showAlert } from '../src/utils/showAlert';
import { toast } from '../src/utils/toast';

const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: APP_TZ }) : '—';

const STATE: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'muted'; sub: string }> = {
  connected: { label: 'Connected', tone: 'green', sub: 'OwnerIQ is pulling data as normal.' },
  signed_out: { label: 'Reconnecting…', tone: 'amber', sub: 'The app is trying to sign in. If OwnerIQ now asks for a code, it will tell you to reconnect.' },
  needs_reconnect: { label: 'Needs reconnecting', tone: 'red', sub: 'Sign in on a computer and paste a fresh session below. Until then, the team’s numbers come from the breakdowns.' },
  off: { label: 'Off', tone: 'muted', sub: 'No session and no saved password. Paste a session below to connect.' },
};

export default function OwnerIQConnectScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['owneriq-connect'], queryFn: () => apiService.getOwnerIQConnect().then((r) => r.data), retry: false, refetchInterval: 60 * 1000 });

  if (!user?.is_super_admin) {
    return <View style={[s.page, s.center]}><Text style={s.muted}>This is for the Owner only.</Text></View>;
  }
  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const d = q.data || {};
  const st = STATE[d.state] || STATE.off;
  const isRelay = d.source === 'browser_relay';
  const relay = d.relay || {};
  const label = isRelay ? 'Live from your browser' : st.label;
  const sub = isRelay
    ? 'Your OwnerIQ tab is feeding the app. Keep that tab open and signed in on the computer running it.'
    : st.sub;
  const toneColor = isRelay ? c.green
    : st.tone === 'green' ? c.green : st.tone === 'red' ? c.red : st.tone === 'amber' ? c.yellow : c.textMuted;

  const connect = async () => {
    if (!paste.trim()) return;
    setBusy('connect');
    try {
      await apiService.connectOwnerIQ(paste.trim());
      toast.success('OwnerIQ connected');
      setPaste('');
      ['owneriq-connect', 'owneriq-switch', 'owneriq-banner'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) { showAlert('Could not connect', e?.response?.data?.detail || 'Try again with a fresh session.'); }
    setBusy(null);
  };
  const test = async () => {
    setBusy('test');
    try {
      const r = await apiService.testOwnerIQSync();
      const n = r.data?.rows_synced ?? 0;
      toast.success(n ? `Working — pulled ${n} rows` : 'Connected, nothing new to pull right now');
      ['owneriq-connect', 'owneriq-switch', 'owneriq-banner'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      showAlert('Test failed', e?.response?.data?.detail || 'OwnerIQ didn’t answer. Try a fresh session.');
    }
    setBusy(null);
  };
  const turnOff = async () => {
    setBusy('off');
    try {
      await apiService.turnOffOwnerIQ();
      toast.success('OwnerIQ switched off — running on the breakdowns');
      ['owneriq-connect', 'owneriq-switch', 'owneriq-banner', 'owneriq-performance-week'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) { showAlert('Could not switch off', e?.response?.data?.detail || 'Try again.'); }
    setBusy(null);
  };
  const retry = async () => {
    setBusy('retry');
    try { await apiService.retryOwnerIQ(); toast.success('Trying again'); qc.invalidateQueries({ queryKey: ['owneriq-connect'] }); }
    catch (e: any) { showAlert('Could not retry', e?.response?.data?.detail || 'Try again.'); }
    setBusy(null);
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <View style={[s.statusCard, { borderColor: toneColor }]}>
        <View style={s.statusHead}>
          <View style={[s.dot, { backgroundColor: toneColor }]} />
          <Text style={[s.statusLabel, { color: toneColor }]}>{label}</Text>
        </View>
        <Text style={s.muted}>{sub}</Text>
        <View style={s.meta}>
          {isRelay ? (
            <>
              <Text style={s.metaLine}>Last sync: {when(relay.at || d.last_ok_at)}</Text>
              {relay.linked != null ? <Text style={s.metaLine}>People linked: {relay.linked}</Text> : null}
              {relay.kpis_rows != null ? <Text style={s.metaLine}>Last pull: {relay.kpis_rows} KPI rows</Text> : null}
              {relay.bells && relay.bells.goals != null ? <Text style={s.metaLine}>Bells goals set from OwnerIQ: {relay.bells.goals}</Text> : null}
            </>
          ) : (
            <>
              <Text style={s.metaLine}>Last worked: {when(d.last_ok_at)}</Text>
              {d.source ? <Text style={s.metaLine}>Session from: {d.source === 'browser' ? 'your paste' : 'password sign-in'}</Text> : null}
              {d.api_base ? <Text style={s.metaLine}>Server: {String(d.api_base).replace('https://', '')}</Text> : null}
            </>
          )}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.h}>Reconnect</Text>
        <Text style={s.step}><Text style={s.b}>1.</Text> On a computer, sign in at owner-iq.ai with the account the app uses{d.email ? ` (${d.email})` : ''}. Enter your code as normal.</Text>
        <Text style={s.step}><Text style={s.b}>2.</Text> On that page, open the browser console:</Text>
        <Text style={s.sub}>  • Chrome on Windows: Ctrl + Shift + J  •  Mac: Cmd + Option + J</Text>
        <Text style={s.step}><Text style={s.b}>3.</Text> Paste this line and press Enter (if it blocks pasting, type <Text style={s.code}>allow pasting</Text> first):</Text>
        <View style={s.codeBox}>
          <Text style={s.codeText} selectable>copy(localStorage.getItem('auth-storage'))</Text>
          {Platform.OS === 'web' && (
            <Pressable onPress={async () => { try { await (navigator as any).clipboard.writeText("copy(localStorage.getItem('auth-storage'))"); toast.success('Copied the line'); } catch { /* ignore */ } }} hitSlop={8}>
              <Ionicons name="copy-outline" size={18} color={c.primary} />
            </Pressable>
          )}
        </View>
        <Text style={s.step}><Text style={s.b}>4.</Text> It’s now copied. Paste it in the box below and press Connect. Then close the OwnerIQ tab — <Text style={s.b}>don’t press Log out in OwnerIQ.</Text></Text>

        <TextInput value={paste} onChangeText={setPaste} placeholder="Paste the session here" placeholderTextColor={c.textMuted}
          style={s.input} multiline autoCapitalize="none" autoCorrect={false} testID="owneriq-paste" />
        <Pressable onPress={connect} disabled={!paste.trim() || busy === 'connect'} style={[s.btn, (!paste.trim() || busy === 'connect') && { opacity: 0.5 }]} accessibilityRole="button" testID="owneriq-connect-btn">
          {busy === 'connect' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="link" size={16} color={c.onPrimary} />}
          <Text style={s.btnText}>Connect</Text>
        </Pressable>
      </View>

      {(d.state === 'connected' || d.has_token) && (
        <Pressable onPress={test} disabled={busy === 'test'} style={s.testBtn} accessibilityRole="button" testID="owneriq-test-btn">
          {busy === 'test' ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="pulse-outline" size={16} color={c.primary} />}
          <Text style={s.testText}>{busy === 'test' ? 'Testing…' : 'Test the connection now'}</Text>
        </Pressable>
      )}
      <Pressable onPress={retry} disabled={busy === 'retry'} style={s.ghost} accessibilityRole="button">
        <Text style={s.ghostText}>{busy === 'retry' ? 'Trying…' : 'Try a password sign-in (if the alert was a false alarm)'}</Text>
      </Pressable>
      {(d.state === 'connected' || d.has_token) && (
        <Pressable onPress={turnOff} disabled={busy === 'off'} style={s.offBtn} accessibilityRole="button" testID="owneriq-off-btn">
          <Text style={s.offText}>{busy === 'off' ? 'Switching off…' : 'Switch OwnerIQ off (run on the breakdowns)'}</Text>
        </Pressable>
      )}
      <Text style={s.fine}>This never gets around OwnerIQ’s code. You sign in and enter the code; the app just reuses the session you made. If OwnerIQ ever offers an API key, we’ll switch to that and drop this.</Text>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
  statusCard: { padding: 16, borderRadius: 16, borderWidth: 1.5, backgroundColor: c.background, gap: 8 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontFamily: fonts.bodyBold, fontSize: 17 },
  meta: { gap: 2, marginTop: 4 },
  metaLine: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, gap: 10 },
  h: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  step: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: c.textMuted },
  b: { fontFamily: fonts.bodyBold },
  code: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: c.primary },
  codeBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: c.surface, borderRadius: 10, padding: 12 },
  codeText: { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 13, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, minHeight: 72, fontFamily: fonts.body, fontSize: 14, color: c.text, backgroundColor: c.surface, textAlignVertical: 'top' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  testBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.primary },
  testText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.primary },
  ghost: { alignItems: 'center', paddingVertical: 10 },
  offBtn: { alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: c.red },
  offText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.red },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary, textAlign: 'center' },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  fine: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: c.textMuted },
});
