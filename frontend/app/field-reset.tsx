// The 6pm reset: how many more, which number, what focus — then share it to
// the team's WhatsApp. Coaches and the Owner also see their people's resets
// for today and can share them all in one message.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { openInWhatsApp, copyText } from '../src/utils/whatsapp';

type Reset = { more_signups: number; kpi: string; focus: string; user_name?: string };
const errText = (e: any, f: string) => (typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : f);

export default function FieldResetScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canSeeTeam = user?.role === 'leader' || user?.role === 'admin';

  const mine = useQuery({ queryKey: ['field-reset'], queryFn: () => apiService.getMyFieldReset().then((r) => r.data) });
  const team = useQuery({
    queryKey: ['field-reset-team'],
    queryFn: () => apiService.getTeamFieldResets().then((r) => r.data),
    enabled: canSeeTeam,
  });

  const [more, setMore] = useState(1);
  const [kpi, setKpi] = useState('');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const r: Reset | null = mine.data?.reset || null;
    if (r) { setMore(r.more_signups); setKpi(r.kpi); setFocus(r.focus || ''); }
    setText(mine.data?.whatsapp_text || null);
  }, [mine.data]);

  const save = async () => {
    if (!kpi) { showAlert('Pick a number', 'Choose the number you’re focusing on.'); return null; }
    setBusy(true);
    try {
      const r = await apiService.saveMyFieldReset({ more_signups: more, kpi, focus });
      setText(r.data.whatsapp_text);
      qc.invalidateQueries({ queryKey: ['field-reset-team'] });
      qc.invalidateQueries({ queryKey: ['reset-board'] });
      toast.success('Reset saved');
      return r.data.whatsapp_text as string;
    } catch (e) { showAlert('Could not save', errText(e, 'Try again.')); return null; }
    finally { setBusy(false); }
  };

  const saveAndShare = async () => {
    const t = await save();
    if (t) { try { await openInWhatsApp(t); } catch { showAlert('WhatsApp', t); } }
  };

  if (mine.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const options: string[] = mine.data?.kpi_options || [];
  const teamRows: Reset[] = team.data?.resets || [];

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.title}>🔄 6pm reset</Text>
        <Text style={s.muted}>The last stretch is where the day is won. Reset, set it, share it.</Text>
      </View>

      {!!mine.data?.setup && (
        <View style={s.card}>
          <Text style={s.label}>Your set-up today</Text>
          <Text style={s.muted}>
            {[mine.data.setup.goal != null ? `Goal ${mine.data.setup.goal}` : '', mine.data.setup.kpi ? `KPI ${mine.data.setup.kpi}` : '', mine.data.setup.focus ? `Focus: ${mine.data.setup.focus}` : ''].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}

      <View style={s.card}>
        <Text style={s.label}>How many more sign-ups are you going for?</Text>
        <View style={s.stepper}>
          <Pressable onPress={() => setMore((m) => Math.max(0, m - 1))} style={s.stepBtn} accessibilityLabel="One fewer" hitSlop={6}>
            <Ionicons name="remove" size={22} color={c.text} />
          </Pressable>
          <Text style={s.stepVal}>{more}</Text>
          <Pressable onPress={() => setMore((m) => Math.min(20, m + 1))} style={s.stepBtn} accessibilityLabel="One more" hitSlop={6}>
            <Ionicons name="add" size={22} color={c.text} />
          </Pressable>
        </View>

        <Text style={[s.label, { marginTop: 8 }]}>Which number are you focusing on?</Text>
        <View style={s.chips}>
          {options.map((o) => (
            <Pressable key={o} onPress={() => setKpi(o)} style={[s.chip, kpi === o && s.chipOn]}
              accessibilityRole="button" accessibilityState={{ selected: kpi === o }}>
              <Text style={[s.chipText, kpi === o && { color: c.onPrimary }]}>{o}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[s.label, { marginTop: 8 }]}>Your focus for the rest of the field</Text>
        <TextInput
          value={focus}
          onChangeText={setFocus}
          placeholder="e.g. hooklines before every close, call backs after 7"
          placeholderTextColor={c.textMuted}
          style={s.input}
          maxLength={200}
          multiline
        />

        <View style={s.row}>
          <Pressable onPress={save} disabled={busy} style={s.ghost} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="save-outline" size={15} color={c.primary} />}
            <Text style={s.ghostText}>Save</Text>
          </Pressable>
          <Pressable onPress={saveAndShare} disabled={busy} style={s.btn} accessibilityRole="button" testID="reset-share">
            <Ionicons name="logo-whatsapp" size={16} color={c.onPrimary} />
            <Text style={s.btnText}>Save and share to WhatsApp</Text>
          </Pressable>
        </View>
        {!!text && (
          <View style={s.preview}>
            <Text style={s.previewText}>{text}</Text>
            <Pressable onPress={() => copyText(text).then(() => toast.success('Copied'))} style={s.copy} accessibilityRole="button">
              <Ionicons name="copy-outline" size={14} color={c.primary} />
              <Text style={s.ghostText}>Copy</Text>
            </Pressable>
          </View>
        )}
      </View>

      {canSeeTeam && (
        <View style={s.card}>
          <Text style={s.h}>Your team's resets today</Text>
          {team.isLoading ? <ActivityIndicator color={c.primary} /> : teamRows.length === 0 ? (
            <Text style={s.muted}>No resets yet. They come in after the 6pm notification.</Text>
          ) : (
            <>
              {teamRows.map((r, i) => (
                <View key={i} style={s.teamRow}>
                  <Text style={s.teamName} numberOfLines={1}>{r.user_name}</Text>
                  <Text style={s.muted} numberOfLines={2}>
                    {r.more_signups ? `+${r.more_signups}` : 'Holding'} · {r.kpi}{r.focus ? ` · ${r.focus}` : ''}
                  </Text>
                </View>
              ))}
              <View style={s.row}>
                <Pressable onPress={() => openInWhatsApp(team.data.whatsapp_text).catch(() => showAlert('WhatsApp', team.data.whatsapp_text))}
                  style={s.btn} accessibilityRole="button">
                  <Ionicons name="logo-whatsapp" size={16} color={c.onPrimary} />
                  <Text style={s.btnText}>Share the team's resets</Text>
                </Pressable>
                <Pressable onPress={() => copyText(team.data.whatsapp_text).then(() => toast.success('Copied'))} style={s.ghost} accessibilityRole="button">
                  <Ionicons name="copy-outline" size={15} color={c.primary} />
                  <Text style={s.ghostText}>Copy</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  head: { gap: 4 },
  title: { fontFamily: fonts.display, fontSize: 24, color: c.text },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, gap: 10 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  stepVal: { fontFamily: fonts.display, fontSize: 32, color: c.text, minWidth: 40, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, minHeight: 70, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
  preview: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 8 },
  previewText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: c.text },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  teamRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border, gap: 2 },
  teamName: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
});
