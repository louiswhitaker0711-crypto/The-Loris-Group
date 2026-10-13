// "Learn today" on a BA's Home: anything their Coach sent them to test on
// first, then the next items on their COD stage they haven't got to Know yet.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { codStageShortName } from '../../cod/stageOrder';

const SHOW = 3;

export default function LearnTodayCard({ stage }: { stage: number }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tests = useQuery({ queryKey: ['my-cod-tests'], queryFn: () => apiService.getMyCodTests().then((r) => r.data.requests), retry: false });
  const mods = useQuery({ queryKey: ['modules', stage], queryFn: () => apiService.listModules(stage as any).then((r) => r.data) });
  const prog = useQuery({ queryKey: ['module-progress', stage], queryFn: () => apiService.getMyModuleProgress(stage as any).then((r) => r.data.progress) });
  const ladder: Record<string, number> = {};
  (prog.data || []).forEach((p: any) => { ladder[p.module_id] = p.ladder ?? 0; });
  const reqs: any[] = tests.data || [];
  const asked = new Set(reqs.map((r) => r.module_id));
  const list: any[] = (mods.data?.modules || []).filter((m: any) => !asked.has(m.id) && (ladder[m.id] || 0) < 1);
  const all = (mods.data?.modules || []).length;
  const known = all - (mods.data?.modules || []).filter((m: any) => (ladder[m.id] || 0) < 1).length;
  if (!reqs.length && !list.length) return null;
  return (
    <View style={s.card} testID="home-learn-today">
      <View style={s.head}>
        <Text style={s.title}>Learn today</Text>
        <Pressable onPress={() => router.push(`/cod-sheet?stage=${stage}` as never)} hitSlop={6}>
          <Text style={s.link}>Stage {codStageShortName(stage)} · {known}/{all} known</Text>
        </Pressable>
      </View>
      {reqs.map((r) => (
        <Pressable key={r.id} onPress={() => router.push(`/module/${r.module_id}` as never)} style={s.row} accessibilityRole="button">
          <Ionicons name="flag" size={16} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.item}>{r.module_title}</Text>
            <Text style={s.sub}>{(r.by_name || 'Your coach').split(' ')[0]} wants you to test on this</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </Pressable>
      ))}
      {list.slice(0, Math.max(0, SHOW - reqs.length)).map((m) => (
        <Pressable key={m.id} onPress={() => router.push(`/module/${m.id}` as never)} style={s.row} accessibilityRole="button">
          <Ionicons name="book-outline" size={16} color={c.textMuted} />
          <Text style={[s.item, { flex: 1 }]}>{m.title || m.topic}</Text>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 4, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  link: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  item: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 12, color: c.primary },
});
