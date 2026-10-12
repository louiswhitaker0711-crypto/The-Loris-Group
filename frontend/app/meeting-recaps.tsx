// Meeting recaps library: every published recap this person can read,
// newest first. Tap one to open it (same screen as from the Schedule).
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { APP_LOCALE } from '../src/utils/appTime';
import { GROUP_LABEL } from '../src/components/schedule/calendarModel';
import { codStageLabel, sortCodStages } from '../src/components/cod/stageOrder';

type Recap = {
  id: string; block_id: string; block_title: string; title?: string; date: string; groups?: string[]; recap?: string;
  cod_topics?: { id: string; title: string; stage: number }[]; pdf?: { file_name: string } | null;
};

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function firstLine(md?: string) {
  const line = (md || '').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l && !/^what we covered$/i.test(l));
  return line || '';
}

export default function MeetingRecapsScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['meeting-recaps'],
    queryFn: () => apiService.meetingRecapLibrary().then((r) => (r.data?.recaps || []) as Recap[]),
  });
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    let all = q.data || [];
    if (stage != null) all = all.filter((r) => (r.cod_topics || []).some((x) => x.stage === stage));
    return t ? all.filter((r) => `${r.title || ''} ${r.block_title} ${(r.cod_topics || []).map((x) => x.title).join(' ')} ${r.recap || ''}`.toLowerCase().includes(t)) : all;
  }, [q.data, search, stage]);
  const stages = useMemo(() => sortCodStages(Array.from(new Set<number>((q.data || []).flatMap((r) => (r.cod_topics || []).map((x) => x.stage))))), [q.data]);

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        Notes from meetings, written up for anyone who missed one. Open a meeting on the Schedule to add notes.
      </Text>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search recaps"
        placeholderTextColor={c.textMuted}
        style={s.input}
      />
      {stages.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[null, ...stages].map((st) => (
            <Pressable key={String(st)} onPress={() => setStage(st)} style={[s.chip, stage === st && s.chipOn]}
              accessibilityRole="button" accessibilityState={{ selected: stage === st }}>
              <Text style={[s.chipText, stage === st && { color: c.onPrimary }]}>{st == null ? 'All' : `COD ${codStageLabel(st)}`}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {q.isLoading ? (
        <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} />
      ) : q.isError ? (
        <Text style={s.muted}>Couldn't load recaps. Try again shortly.</Text>
      ) : list.length === 0 ? (
        <View style={s.card}><Text style={s.muted}>{search ? 'No recaps match that.' : 'No recaps yet.'}</Text></View>
      ) : (
        list.map((r) => {
          const lanes = (r.groups || []).map((g) => GROUP_LABEL[g]).filter(Boolean);
          return (
            <Pressable
              key={r.id}
              style={s.card}
              accessibilityRole="button"
              onPress={() => router.push(`/meeting-notes?block_id=${encodeURIComponent(r.block_id)}&date=${r.date}` as any)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>{r.title || r.block_title}</Text>
                  <Text style={s.meta}>{shortDate(r.date)}{r.title && r.title !== r.block_title ? ` · ${r.block_title}` : ''}{lanes.length && lanes.length < 4 ? ` · ${lanes.join(' · ')}` : ''}</Text>
                  {(r.cod_topics || []).length > 0 && (
                    <Text style={s.meta} numberOfLines={2}>{(r.cod_topics || []).map((x) => `COD ${codStageLabel(x.stage)} · ${x.title}`).join('  ·  ')}</Text>
                  )}
                </View>
                {r.pdf ? <Ionicons name="document-attach-outline" size={17} color={c.textMuted} /> : null}
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </View>
              {firstLine(r.recap) ? <Text style={s.muted} numberOfLines={2}>{firstLine(r.recap)}</Text> : null}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 10, width: '100%', maxWidth: 720, alignSelf: 'center' },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, marginTop: 2 },
  title: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
});
