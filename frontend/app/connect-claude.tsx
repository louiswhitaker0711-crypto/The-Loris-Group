/**
 * Connect Claude (route: /connect-claude, from Profile). The Owner, 2 Nov 2026:
 * your own link, so a chat with Claude can read what you can see in the app
 * and fill in your plans (weekly goal, set-ups, planner, bunny hops). Claude
 * asks you before it changes anything. It runs on your own Claude account, so
 * it costs the app nothing.
 * Admins make their own and choose who else can (GET/POST/DELETE
 * /ai/connector-link, GET /ai/connector-people, PUT /ai/connector-allowed/{id}).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Switch, Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { copyText } from '../src/utils/whatsapp';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';

type Status = { allowed: boolean; has_link: boolean; created_at?: string | null; last_used_at?: string | null };
type Person = { id: string; name: string; role: string; allowed: boolean; connected: boolean };

function linkFor(path: string): string {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL
    || (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${path}`;
}

export default function ConnectClaudeScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const tabClear = useTabBarClearance();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === 'admin';
  const statusQ = useQuery({
    queryKey: ['ai', 'connector-link'],
    queryFn: async () => (await api.get('/ai/connector-link')).data as Status,
    retry: false,
  });
  const peopleQ = useQuery({
    queryKey: ['ai', 'connector-people'],
    queryFn: async () => (await api.get('/ai/connector-people')).data?.people as Person[],
    retry: false,
    enabled: isAdmin,
  });
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    try {
      const r = (await api.post('/ai/connector-link')).data;
      setLink(linkFor(r.path));
      qc.invalidateQueries({ queryKey: ['ai', 'connector-link'] });
    } catch (e: any) {
      toast.error('Couldn’t make a link', e?.response?.data?.detail || 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  const confirmMake = () => {
    if (!statusQ.data?.has_link) { make(); return; }
    showAlert('Make a new link?', 'Your old link will stop working, so you’ll need to paste the new one into Claude.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make a new link', onPress: make },
    ]);
  };
  const revoke = () => {
    showAlert('Disconnect Claude?', 'Your link stops working straight away.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        try {
          await api.delete('/ai/connector-link');
          setLink('');
          qc.invalidateQueries({ queryKey: ['ai'] });
        } catch {
          toast.error('Couldn’t disconnect', 'Try again.');
        }
      } },
    ]);
  };
  const allow = async (p: Person, allowed: boolean) => {
    try {
      await api.put(`/ai/connector-allowed/${encodeURIComponent(p.id)}`, { allowed });
      qc.invalidateQueries({ queryKey: ['ai', 'connector-people'] });
    } catch {
      toast.error('Couldn’t change that', 'Try again.');
    }
  };
  const copy = async () => {
    try {
      await copyText(link);
      toast.success('Copied', 'Now paste it into Claude.');
    } catch {
      toast.error('Couldn’t copy', 'Press and hold the link to copy it.');
    }
  };

  if (statusQ.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  if (!statusQ.data?.allowed) {
    return (
      <View style={[s.page, s.center, { padding: 24 }]}>
        <Text style={[s.hint, { textAlign: 'center' }]}>Ask the Owner to switch Claude on for you.</Text>
      </View>
    );
  }
  const st = statusQ.data;

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear }]}>
      <View style={s.shell}>
        <Text style={s.h1}>Connect Claude</Text>
        <Text style={s.hint}>Talk to Claude about your numbers and plans, and have it fill them in here: your weekly goal, sector set-ups, your planner and bunny hops. Claude sees what you can see in the app and asks you before it changes anything. It uses your own Claude account, so it costs the app nothing.</Text>

        <View style={s.card}>
          <Text style={s.label}>{st.has_link ? 'Connected' : 'Not connected yet'}</Text>
          {!!link ? (
            <>
              <Text style={s.body}>Your link (shown once, keep it to yourself):</Text>
              <Text style={s.link} selectable testID="connect-claude-link">{link}</Text>
              <Pressable onPress={copy} style={s.primary} accessibilityRole="button" testID="connect-claude-copy">
                <Ionicons name="copy-outline" size={17} color={c.onPrimary} />
                <Text style={s.primaryText}>Copy link</Text>
              </Pressable>
              <Text style={s.small}>In Claude, add a custom connector, give it a name like “The Loris Hub”, and paste this link as its address. Then ask Claude things like “How did my week go?” or “Fill in tomorrow’s set-up”.</Text>
            </>
          ) : (
            <>
              <Text style={s.hint}>{st.has_link
                ? 'Your link is working. For your safety it isn’t shown again: make a new one if you need to paste it somewhere else.'
                : 'Make your personal link, then paste it into Claude once.'}</Text>
              <Pressable onPress={confirmMake} disabled={busy} style={[s.primary, busy && { opacity: 0.6 }]} accessibilityRole="button" testID="connect-claude-make">
                {busy ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.primaryText}>{st.has_link ? 'Make a new link' : 'Make my link'}</Text>}
              </Pressable>
            </>
          )}
          {st.has_link && (
            <Pressable onPress={revoke} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
              <Text style={s.danger}>Disconnect</Text>
            </Pressable>
          )}
        </View>

        {isAdmin && (
          <View style={s.card}>
            <Text style={s.h2}>Who can connect Claude</Text>
            <Text style={s.hint}>Admins always can. Switch it on for anyone else and they’ll see Connect Claude on their Profile. Each person’s Claude only sees what they can see in the app.</Text>
            {peopleQ.isLoading && <ActivityIndicator color={c.primary} />}
            {(peopleQ.data || []).filter((p) => p.role !== 'admin').map((p) => (
              <View key={p.id} style={s.personRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.body} numberOfLines={1}>{p.name}</Text>
                  {p.connected && <Text style={s.small}>Connected</Text>}
                </View>
                <Switch value={p.allowed} onValueChange={(v) => allow(p, v)} trackColor={{ false: c.border, true: c.primary }} />
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 12 },
  h1: { fontFamily: fonts.display, fontSize: 28, color: c.text },
  h2: { fontFamily: fonts.display, fontSize: 19, color: c.text },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 10 },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.text },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: c.textMuted },
  link: { fontFamily: fonts.mono, fontSize: 12.5, color: c.text, backgroundColor: c.surface, borderRadius: 10, padding: 10 },
  primary: { flexDirection: 'row', gap: 8, justifyContent: 'center', backgroundColor: c.primary, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  primaryText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  danger: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.danger || c.error || c.textMuted },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border },
});
