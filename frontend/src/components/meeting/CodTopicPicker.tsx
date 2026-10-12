// Pick the COD items a meeting covered, from the Owner's COD sheet: one row per
// stage (1, 2, 3, 3+, 4, 5), tap to expand it into its sections and items,
// tick as many as you like across stages.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueries } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { COD_STAGE_ORDER, codStageTitle } from '../cod/stageOrder';

export type CodTopic = { id: string; title: string; stage: number; section?: string };
type Module = { id: string; topic: string; category?: string; sequence?: number; stage: number };

export function CodTopicPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState<number[]>([]);
  const results = useQueries({
    queries: COD_STAGE_ORDER.map((st) => ({
      queryKey: ['modules', st],
      queryFn: () => apiService.listModules(st as 1 | 2 | 3 | 4 | 5 | 6).then((r) => r.data),
      staleTime: 5 * 60_000,
    })),
  });
  const toggleStage = (st: number) => setOpen((o) => (o.includes(st) ? o.filter((x) => x !== st) : [...o, st]));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (results.every((r) => r.isLoading)) return <ActivityIndicator color={c.primary} />;

  return (
    <View style={{ gap: 6 }}>
      {COD_STAGE_ORDER.map((st, i) => {
        const mods: Module[] = ((results[i].data?.modules || []) as Module[])
          .filter((m) => m.category !== 'Overview')
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        if (!mods.length && !results[i].isLoading) return null;
        const isOpen = open.includes(st);
        const picked = mods.filter((m) => selected.includes(m.id)).length;
        const sections: { name: string; items: Module[] }[] = [];
        for (const m of mods) {
          const name = m.category || 'Other';
          const last = sections[sections.length - 1];
          if (last && last.name === name) last.items.push(m);
          else sections.push({ name, items: [m] });
        }
        return (
          <View key={st} style={s.stage}>
            <Pressable onPress={() => toggleStage(st)} style={s.stageHead} accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }} testID={`cod-stage-${st}`}>
              <Text style={s.stageTitle} numberOfLines={1}>{codStageTitle(st)}</Text>
              {picked > 0 && <View style={s.count}><Text style={s.countText}>{picked}</Text></View>}
              <View style={{ flex: 1 }} />
              <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
            </Pressable>
            {isOpen && sections.map((sec) => (
              <View key={sec.name}>
                <Text style={s.section}>{sec.name.toUpperCase()}</Text>
                {sec.items.map((m) => {
                  const on = selected.includes(m.id);
                  return (
                    <Pressable key={m.id} onPress={() => toggle(m.id)} style={s.topic}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.textMuted} />
                      <Text style={s.topicText}>{m.topic}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  stage: { borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  stageTitle: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text, flexShrink: 1 },
  count: { minWidth: 20, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: c.onPrimary },
  section: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: c.textMuted, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, borderTopWidth: 1, borderTopColor: c.border },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
  topicText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: c.text },
});
