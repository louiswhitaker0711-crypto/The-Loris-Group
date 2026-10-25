/**
 * "From the COD" on a meeting box in the weekly plan (Coaches Meeting,
 * Morning Meeting · Topic). Picking an item links it to that day's box
 * (tap the chip to open the item) and puts its name in the box. A Coaches
 * Meeting pick also nudges that team's BAs who are in that day to do the
 * item's quiz at 10:58 (backend cod_meeting_quiz_tick). The Coaches
 * Meeting only offers COD Stage 3 on (minStage, the Owner's call, 25 Oct 2026).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../theme/ThemeContext';
import { fonts } from '../../theme/brand';
import { apiService } from '../../api/client';
import { codStageRank, codStageLabel, sortCodStages } from '../cod/stageOrder';

type Item = { id: string; stage: number; topic: string };

export default function MeetingCodPick({ moduleId, canEdit, hint, minStage, onPick, onClear }: {
  moduleId?: string;
  minStage?: number;
  canEdit: boolean;
  hint?: string;
  onPick: (id: string, topic: string) => void;
  onClear: () => void;
}) {
  const colors = useColors();
  const s = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['cod-items-for-meetings'],
    queryFn: () => apiService.getCodFocusMe().then((r) => (r.data?.options || []) as Item[]),
    staleTime: 30 * 60 * 1000,
    enabled: canEdit || !!moduleId,
  });
  const all = q.data || [];
  // SL is stored as 5 but sits between 3 and 4, so compare by COD order, not number.
  const items = useMemo(() => all.filter((i) => !minStage || codStageRank(i.stage) >= codStageRank(minStage)), [all, minStage]);
  const picked = moduleId ? all.find((i) => i.id === moduleId) : undefined;
  const stages = useMemo(() => sortCodStages(Array.from(new Set(items.map((i) => i.stage)))), [items]);
  const curStage = stage ?? (picked && stages.includes(picked.stage) ? picked.stage : undefined) ?? stages[0] ?? null;

  if (!canEdit && !moduleId) return null;

  return (
    <View style={s.wrap}>
      {moduleId ? (
        <View style={s.chipRow}>
          <TouchableOpacity style={s.chip} onPress={() => router.push(`/module/${moduleId}` as any)} testID="meeting-cod-open">
            <Ionicons name="school-outline" size={14} color={colors.onPrimary} />
            <Text style={s.chipTxt} numberOfLines={1}>
              {picked ? `${picked.topic} · Stage ${codStageLabel(picked.stage)}` : 'COD item'}
            </Text>
          </TouchableOpacity>
          {canEdit && (
            <TouchableOpacity onPress={onClear} hitSlop={8} testID="meeting-cod-clear">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      ) : null}
      {canEdit && (
        <TouchableOpacity style={s.btn} onPress={() => setOpen(true)} testID="meeting-cod-pick">
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={s.btnTxt}>{moduleId ? 'Change COD item' : 'From the COD'}</Text>
        </TouchableOpacity>
      )}
      {!!hint && !!moduleId && <Text style={s.hint}>{hint}</Text>}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <Text style={s.sheetTitle}>Pick from the COD</Text>
            <View style={s.stageRow}>
              {stages.map((st) => (
                <TouchableOpacity key={st} onPress={() => setStage(st)} style={[s.stageChip, curStage === st && s.stageChipOn]}>
                  <Text style={[s.stageTxt, curStage === st && s.stageTxtOn]}>Stage {codStageLabel(st)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {items.filter((i) => i.stage === curStage).map((i) => (
                <TouchableOpacity key={i.id} style={s.option} onPress={() => { onPick(i.id, i.topic); setOpen(false); }}>
                  <Ionicons name={i.id === moduleId ? 'radio-button-on' : 'radio-button-off'} size={18} color={colors.primary} />
                  <Text style={s.optionTxt}>{i.topic}</Text>
                </TouchableOpacity>
              ))}
              {!items.length && <Text style={s.hint}>{q.isLoading ? 'Loading…' : 'No COD items found.'}</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(c: any) {
  return StyleSheet.create({
    wrap: { marginBottom: 8, gap: 6 },
    chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    chip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipTxt: { flexShrink: 1, fontFamily: fonts.bodySemibold, fontSize: 13, color: c.onPrimary },
    btn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: c.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    btnTxt: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.primary },
    hint: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
    sheetTitle: { fontFamily: fonts.display, fontSize: 18, color: c.text, marginBottom: 10 },
    stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    stageChip: { borderRadius: 999, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 5 },
    stageChipOn: { backgroundColor: c.primary, borderColor: c.primary },
    stageTxt: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textSecondary },
    stageTxtOn: { color: c.onPrimary },
    option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    optionTxt: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: c.text },
  });
}
