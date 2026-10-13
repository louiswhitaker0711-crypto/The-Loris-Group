// Quick COD sign-off: one person's stage as a plain list. Tap the level you
// want them at (Know · Do · Deliver · Teach · Systemise), tick the items you
// want them to test on and send. Opened from "Sign off COD" on Home.
//   /cod-signoff?user_id=…&stage=1&name=…
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { COD_STAGE_ORDER, codStageShortName } from '../src/components/cod/stageOrder';

const RUNGS = [
  { v: 1, short: 'K', label: 'Know' },
  { v: 2, short: 'D', label: 'Do' },
  { v: 3, short: 'D', label: 'Deliver' },
  { v: 4, short: 'T', label: 'Teach' },
  { v: 5, short: 'S', label: 'Systemise' },
];
// Stages 1–2 top out at Deliver, 3 adds Teach, 3+ and above Systemise.
const maxRung = (stage: number) => (stage <= 2 ? 3 : stage === 3 ? 4 : 5);

export default function CodSignoffScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ user_id?: string; stage?: string; name?: string }>();
  const userId = String(params.user_id || '');
  const [stage, setStage] = useState<number>(Math.min(6, Math.max(1, parseInt(String(params.stage || '1'), 10) || 1)));
  const [testPick, setTestPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const mods = useQuery({ queryKey: ['modules', stage], queryFn: () => apiService.listModules(stage as any).then((r) => r.data) });
  const prog = useQuery({
    queryKey: ['trainee-module-progress', userId, stage], enabled: !!userId,
    queryFn: () => apiService.getTraineeModuleProgress(userId, stage as any).then((r) => r.data.progress),
  });
  const tests = useQuery({ queryKey: ['cod-tests', userId], enabled: !!userId, queryFn: () => apiService.getCodTestsFor(userId).then((r) => r.data.requests) });

  const ladder: Record<string, number> = {};
  (prog.data || []).forEach((p: any) => { ladder[p.module_id] = p.ladder ?? 0; });
  const open = new Set((tests.data || []).map((t: any) => t.module_id));
  const list: any[] = mods.data?.modules || [];
  const groups: Record<string, any[]> = {};
  list.forEach((m) => { (groups[m.category || 'Other'] = groups[m.category || 'Other'] || []).push(m); });
  const top = maxRung(stage === 5 ? 3.5 : stage);
  const signed = list.filter((m) => (ladder[m.id] || 0) >= 3).length;

  const setLevel = async (m: any, rung: number) => {
    const cur = ladder[m.id] || 0;
    const next = cur === rung ? rung - 1 : rung;
    setBusy(m.id);
    try {
      await apiService.upsertModuleProgress(m.id, { ladder: next }, userId);
      qc.invalidateQueries({ queryKey: ['trainee-module-progress', userId, stage] });
      qc.invalidateQueries({ queryKey: ['leader-today'] });
    } catch (e: any) { showAlert('Could not sign that', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };
  const toggleTest = (id: string) => setTestPick((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sendTests = async () => {
    setBusy('send');
    try {
      const r = await apiService.setCodTests(userId, Array.from(testPick));
      toast.success(r.data?.created ? `Sent ${r.data.created} to test on` : 'Already waiting on those');
      setTestPick(new Set());
      tests.refetch();
    } catch (e: any) { showAlert('Could not send', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 110 }]}>
        <Text style={s.title}>{params.name || 'COD'}</Text>
        <Text style={s.muted}>
          Tap the level you've seen them at; tap it again to take it back. Tick "Test" on anything you want them to
          test themselves on, then send.
        </Text>
        <View style={s.stages}>
          {COD_STAGE_ORDER.map((st) => (
            <Pressable key={st} onPress={() => { setStage(st); setTestPick(new Set()); }} style={[s.stage, stage === st && s.stageOn]} accessibilityRole="button">
              <Text style={[s.stageText, stage === st && { color: c.onPrimary }]}>Stage {codStageShortName(st)}</Text>
            </Pressable>
          ))}
        </View>
        {!!list.length && <Text style={s.small}>{signed} of {list.length} signed off at Deliver or above</Text>}

        {(mods.isLoading || prog.isLoading) ? <ActivityIndicator color={c.primary} style={{ marginTop: 20 }} /> : Object.entries(groups).map(([cat, ms]) => (
          <View key={cat} style={s.card}>
            <Text style={s.cat}>{cat}</Text>
            {ms.map((m) => {
              const lv = ladder[m.id] || 0;
              const testing = open.has(m.id);
              const picked = testPick.has(m.id);
              return (
                <View key={m.id} style={s.item}>
                  <Pressable onPress={() => router.push(`/module/${m.id}?trainee_id=${userId}` as never)} style={{ flex: 1 }} accessibilityRole="link">
                    <Text style={s.itemTitle}>{m.title || m.topic}</Text>
                    {testing && <Text style={s.testing}>Waiting on their test</Text>}
                  </Pressable>
                  <View style={s.rungs}>
                    {RUNGS.filter((r) => r.v <= top).map((r) => {
                      const on = lv >= r.v;
                      return (
                        <Pressable key={r.v} onPress={() => setLevel(m, r.v)} disabled={busy === m.id}
                          style={[s.rung, on && s.rungOn]} accessibilityRole="button" accessibilityLabel={`${r.label}${on ? ', signed' : ''}`}>
                          <Text style={[s.rungText, on && { color: c.onPrimary }]}>{r.short}</Text>
                        </Pressable>
                      );
                    })}
                    <Pressable onPress={() => toggleTest(m.id)} style={[s.test, picked && s.testOn]} accessibilityRole="checkbox" accessibilityState={{ checked: picked }}>
                      <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={16} color={picked ? c.onPrimary : c.textMuted} />
                      <Text style={[s.testText, picked && { color: c.onPrimary }]}>Test</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        <Text style={s.small}>K Know · D Do · D Deliver · T Teach · S Systemise. Tap a name to open the full item.</Text>
      </ScrollView>
      {testPick.size > 0 && (
        <View style={[s.bar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={sendTests} disabled={busy === 'send'} style={s.btn} accessibilityRole="button" testID="signoff-send">
            {busy === 'send' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="paper-plane" size={16} color={c.onPrimary} />}
            <Text style={s.btnText}>Send {testPick.size} to test on</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  scroll: { padding: 16, gap: 10, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { fontFamily: fonts.display, fontSize: 24, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stage: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  stageOn: { backgroundColor: c.primary, borderColor: c.primary },
  stageText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  card: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 12, gap: 2 },
  cat: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.text, marginBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border, flexWrap: 'wrap' },
  itemTitle: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  testing: { fontFamily: fonts.body, fontSize: 11.5, color: c.primary, marginTop: 2 },
  rungs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rung: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  rungOn: { backgroundColor: c.green || c.primary, borderColor: c.green || c.primary },
  rungText: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.text },
  test: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, marginLeft: 4 },
  testOn: { backgroundColor: c.primary, borderColor: c.primary },
  testText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.textMuted },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16, backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.border, alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
});
