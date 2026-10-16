// Pick the COD topics a meeting covered: one row per COD stage, tap to expand
// it into that stage's topics, tick as many as you like across stages.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { codStageLabel, codStageName, sortCodStages } from '../cod/stageOrder';

export type CodTopic = { id: string; title: string; stage: number };

export function CodTopicPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState<number[]>([]);
  const q = useQuery({
    queryKey: ['coaching-impacts'],
    queryFn: () => apiService.coachingImpacts().then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const stages: number[] = useMemo(() => sortCodStages((q.data?.stages || []) as number[]), [q.data]);
  const byStage: Record<string, CodTopic[]> = q.data?.grouped || {};
  const toggleStage = (st: number) => setOpen((o) => (o.includes(st) ? o.filter((x) => x !== st) : [...o, st]));
  const toggleTopic = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (q.isLoading) return <ActivityIndicator color={c.primary} />;
  if (q.isError) return <Text style={s.muted}>Couldn't load the COD topics.</Text>;

  return (
    <View style={{ gap: 6 }}>
      {stages.map((st) => {
        const topics = byStage[String(st)] || [];
        const isOpen = open.includes(st);
        const picked = topics.filter((t) => selected.includes(t.id)).length;
        return (
          <View key={st} style={s.stage}>
            <Pressable onPress={() => toggleStage(st)} style={s.stageHead} accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }} testID={`cod-stage-${st}`}>
              <Text style={s.stageTitle}>COD {codStageLabel(st)} · {codStageName(st)}</Text>
              {picked > 0 && <View style={s.count}><Text style={s.countText}>{picked}</Text></View>}
              <View style={{ flex: 1 }} />
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
            </Pressable>
            {isOpen && (
              topics.length === 0 ? (
                <Text style={[s.muted, { paddingHorizontal: 12, paddingBottom: 10 }]}>No topics in this stage yet.</Text>
              ) : topics.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <Pressable key={t.id} onPress={() => toggleTopic(t.id)} style={s.topic}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.textMuted} />
                    <Text style={s.topicText}>{t.title}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  stage: { borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  stageTitle: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  count: { minWidth: 20, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: c.onPrimary },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
  topicText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: c.text },
});
