/**
 * Under a planner note box: where the note files in the Notes folder (the
 * Owner, 29 Oct 2026). Shows "Files to: <heading> · <title>"; tap to pick a
 * heading (a pitch heading or a COD topic), give it a title and, for the
 * Owner, post it to everyone. The note itself saves with the planner and
 * files itself (backend routes/notes_folder.py).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';

export type FolderMeta = { head: string; title: string; share: boolean };
type Folder = {
  pitch: { head: string; label: string }[];
  cod: { stage: number; name: string; sections: { category: string; topics: { head: string; topic: string }[] }[] }[];
};

export function useNotesFolder() {
  return useQuery({ queryKey: ['notes-folder'], queryFn: async () => (await api.get('/notes/folder')).data as Folder, staleTime: 60_000 });
}

export function headLabel(folder: Folder | undefined, head: string): string {
  if (!head) return 'Other';
  if (head.startsWith('pitch:')) return folder?.pitch.find((p) => p.head === head)?.label || 'Other';
  for (const st of folder?.cod || []) {
    for (const sec of st.sections) {
      const t = sec.topics.find((x) => x.head === head);
      if (t) return `${st.name.split(' · ')[0]} · ${t.topic}`;
    }
  }
  return 'A COD topic';
}

export default function FolderTag({ value, defaultHead, defaultTitle, isAdmin, onChange }: {
  value?: FolderMeta; defaultHead: string; defaultTitle: string; isAdmin: boolean; onChange: (v: FolderMeta) => void;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const folder = useNotesFolder();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const cur: FolderMeta = { head: value?.head || '', title: value?.title || '', share: !!value?.share };
  const head = cur.head || defaultHead;
  const set = (patch: Partial<FolderMeta>) => onChange({ ...cur, ...patch });
  const needle = q.trim().toLowerCase();
  const [level, setLevel] = useState<string>('root');
  // Stages in the order the Owner reads them: 1, 2, 3, 4, then Sector-Site Leader.
  const ORDER = [1, 2, 3, 4, 5, 6];
  const stages = [...(folder.data?.cod || [])].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
  return (
    <>
      <Pressable onPress={() => { setLevel('root'); setQ(''); setOpen(true); }} style={s.tag} accessibilityRole="button" accessibilityLabel="Where this note files">
        <Ionicons name="folder-outline" size={14} color={c.primary} />
        <Text style={s.tagText} numberOfLines={1}>
          {headLabel(folder.data, head)} · {cur.title || defaultTitle}{cur.share ? ' · for everyone' : ''}
        </Text>
        <Ionicons name="chevron-down" size={13} color={c.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.head}>
              <Text style={s.h}>File this note</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Done">
                <Text style={s.done}>Done</Text>
              </Pressable>
            </View>
            <Text style={s.label}>Title</Text>
            <TextInput value={cur.title} onChangeText={(t) => set({ title: t })} placeholder={defaultTitle} placeholderTextColor={c.textMuted}
              style={s.input} maxLength={120} />
            {isAdmin && (
              <View style={s.share}>
                <View style={{ flex: 1 }}>
                  <Text style={s.opt}>Post to everyone</Text>
                  <Text style={s.small}>Off: it’s just yours.</Text>
                </View>
                <Switch value={cur.share} onValueChange={(v) => set({ share: v })} />
              </View>
            )}
            <Text style={s.label}>Heading</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="Search the headings" placeholderTextColor={c.textMuted} style={s.input} />
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              {needle ? (
                // Searching: everything that matches, in one list.
                <>
                  {(folder.data?.pitch || []).filter((p) => p.label.toLowerCase().includes(needle)).map((p) => (
                    <Row key={p.head} on={head === p.head} text={p.label} onPress={() => set({ head: p.head })} s={s} c={c} />
                  ))}
                  {stages.map((st) => st.sections.map((sec) => sec.topics
                    .filter((t) => t.topic.toLowerCase().includes(needle) || sec.category.toLowerCase().includes(needle))
                    .map((t) => <Row key={t.head} on={head === t.head} text={`${stageTitle(st)} · ${t.topic}`} onPress={() => set({ head: t.head })} s={s} c={c} />)))}
                </>
              ) : level === 'root' ? (
                // Step 1 (the Owner, 29 Oct 2026): Sales, each stage, or Other.
                <>
                  <Row more text="Sales" sub={head.startsWith('pitch:') && head !== 'pitch:other' ? headLabel(folder.data, head) : undefined}
                    onPress={() => setLevel('sales')} s={s} c={c} />
                  {stages.map((st) => {
                    const picked = st.sections.some((sec) => sec.topics.some((t) => t.head === head));
                    return <Row key={st.stage} more text={stageTitle(st)} sub={picked ? headLabel(folder.data, head).split(' · ').slice(1).join(' · ') : undefined}
                      onPress={() => setLevel(`stage:${st.stage}`)} s={s} c={c} />;
                  })}
                  <Row on={head === 'pitch:other' || !head} text="Other" onPress={() => set({ head: 'pitch:other' })} s={s} c={c} />
                </>
              ) : (
                <>
                  <Pressable onPress={() => setLevel('root')} style={s.backRow} accessibilityRole="button">
                    <Ionicons name="chevron-back" size={16} color={c.primary} />
                    <Text style={s.backText}>{level === 'sales' ? 'Sales' : stageTitle(stages.find((x) => `stage:${x.stage}` === level))}</Text>
                  </Pressable>
                  {level === 'sales'
                    ? (folder.data?.pitch || []).filter((p) => p.head !== 'pitch:other').map((p) => (
                      <Row key={p.head} on={head === p.head} text={p.label} onPress={() => set({ head: p.head })} s={s} c={c} />
                    ))
                    : (stages.find((x) => `stage:${x.stage}` === level)?.sections || []).map((sec) => (
                      // Each COD section with its topics, then a gap: laid out like the COD.
                      <View key={sec.category} style={s.secBlock}>
                        <Text style={s.section}>{sec.category}</Text>
                        {sec.topics.map((t) => <Row key={t.head} on={head === t.head} text={t.topic} onPress={() => set({ head: t.head })} s={s} c={c} />)}
                      </View>
                    ))}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({ on, text, sub, more, onPress, s, c }: any) {
  return (
    <Pressable onPress={onPress} style={[s.row, on && s.rowOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      <View style={{ flex: 1 }}>
        <Text style={[s.opt, on && { color: c.primary }]}>{text}</Text>
        {!!sub && <Text style={[s.small, { color: c.primary }]} numberOfLines={1}>{sub}</Text>}
      </View>
      {on && <Ionicons name="checkmark" size={17} color={c.primary} />}
      {more && <Ionicons name="chevron-forward" size={17} color={c.textMuted} />}
    </Pressable>
  );
}

function stageTitle(st?: { stage: number; name: string }) {
  if (!st) return '';
  return st.stage === 5 ? 'Sector-Site Leader' : `Stage ${st.stage === 6 ? 5 : st.stage}`;
}

const styles = (c: any) => StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginTop: 6, backgroundColor: c.surface },
  tagText: { flexShrink: 1, fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 560, backgroundColor: c.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.text },
  done: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted, marginTop: 4 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.surface },
  share: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: c.yellow, backgroundColor: c.yellowBg, borderRadius: 10, padding: 10 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  group: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted, marginTop: 12, marginBottom: 2 },
  section: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.text, marginTop: 8, marginBottom: 2 },
  secBlock: { marginBottom: 14 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10 },
  backText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  rowOn: { backgroundColor: c.primary + '10' },
  opt: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
});
