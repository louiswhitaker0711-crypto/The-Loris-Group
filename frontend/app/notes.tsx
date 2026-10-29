/**
 * Notes (route: /notes) — the Owner's call, 29 Oct 2026. Everything written
 * in the planner's note boxes, filed by heading: the pitch headings
 * (Introduction … Sales tips) and the COD, stage by stage with every section
 * and its topics listed (so nobody has to guess what's inside). Your own
 * notes are yours; the Owner's posted notes are marked and come first.
 * Search finds any word in any note. (GET /notes/folder, GET /notes)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator, Image, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { APP_LOCALE } from '../src/utils/appTime';
import { useDeviceInsets } from '../src/nav/AppShell';
import { toast } from '../src/utils/toast';
import FolderTag from '../src/components/notes/FolderTag';

type Note = { id: string; head: string; head_label: string; title: string; body: string; date: string;
  source_label: string; shared: boolean; author_name: string; mine: boolean; photos?: string[] };
type View_ = { kind: 'root' } | { kind: 'stage'; stage: number } | { kind: 'head'; head: string; label: string; sub?: string };

const fmt = (iso: string) => {
  try { return new Date(`${iso}T12:00:00Z`).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return iso; }
};

export default function NotesScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tabClear = useTabBarClearance();
  const [view, setView] = useState<View_>({ kind: 'root' });
  const [q, setQ] = useState('');
  // Tap your own note to change it; Write a note adds one (under the heading you're in).
  const [editing, setEditing] = useState<null | { note?: Note; head: string }>(null);
  const folder = useQuery({ queryKey: ['notes-folder'], queryFn: async () => (await api.get('/notes/folder')).data });
  const search = q.trim();
  const listQ = useQuery({
    enabled: view.kind === 'head' || search.length >= 2,
    queryKey: ['notes-list', view.kind === 'head' ? view.head : '', search],
    queryFn: async () => (await api.get('/notes', { params: search.length >= 2 ? { q: search } : { head: (view as any).head } })).data.notes as Note[],
  });
  const d = folder.data;
  const stage = view.kind === 'stage' ? (d?.cod || []).find((x: any) => x.stage === view.stage) : null;
  const back = view.kind === 'head' && view.sub ? () => setView({ kind: 'stage', stage: Number(view.sub) }) : () => setView({ kind: 'root' });

  const ownerName: string = d?.owner_name || 'the Owner';
  const Count = ({ n, owner }: { n: number; owner: number }) => (
    <>
      {owner > 0 && <Text style={s.owner}>{owner} from {ownerName}</Text>}
      <Text style={s.count}>{n}</Text>
    </>
  );

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: 'Notes' }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear }]} keyboardShouldPersistTaps="handled">
        <View style={s.shell}>
          {/* Write a note here, filed under the heading you're in; it also lands in today's planner (the Owner, 29 Oct 2026). */}
          <Pressable onPress={() => setEditing({ head: view.kind === 'head' ? view.head : '' })} style={s.write} accessibilityRole="button" testID="notes-write">
            <Ionicons name="add" size={18} color={c.onPrimary} />
            <Text style={s.writeT}>Write a note</Text>
          </Pressable>
          <View style={s.search}>
            <Ionicons name="search" size={16} color={c.textMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search all your notes" placeholderTextColor={c.textMuted} style={s.searchInput} accessibilityLabel="Search all your notes" />
            {!!q && <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear"><Ionicons name="close-circle" size={17} color={c.textMuted} /></Pressable>}
          </View>

          {search.length >= 2 ? (
            <NoteList notes={listQ.data} loading={listQ.isLoading} empty={`No notes with “${search}”.`} s={s} c={c} showHead ownerName={ownerName} onEdit={(n) => setEditing({ note: n, head: n.head })} />
          ) : folder.isLoading ? <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} /> : view.kind === 'root' ? (
            <>
              {!!d?.latest_from_owner && (
                <Pressable onPress={() => setView({ kind: 'head', head: d.latest_from_owner.head, label: d.latest_from_owner.head_label })} style={s.latest} accessibilityRole="button">
                  <Text style={s.latestK}>New from {ownerName} · {fmt(d.latest_from_owner.date)}</Text>
                  <Text style={s.latestT}>{d.latest_from_owner.title}</Text>
                  <Text style={s.small}>{d.latest_from_owner.head_label}</Text>
                </Pressable>
              )}
              <Text style={s.kicker}>The pitch and sign-up</Text>
              <View style={s.list}>
                {(d?.pitch || []).map((p: any, i: number) => (
                  <Pressable key={p.head} onPress={() => setView({ kind: 'head', head: p.head, label: p.label })} style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button">
                    <Text style={s.rowT}>{p.label}</Text>
                    <Count n={p.count} owner={p.from_owner} />
                    <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                  </Pressable>
                ))}
              </View>
              <Text style={s.kicker}>The CoD</Text>
              <View style={s.list}>
                {(d?.cod || []).map((st: any, i: number) => (
                  <Pressable key={st.stage} onPress={() => setView({ kind: 'stage', stage: st.stage })} style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button">
                    <Text style={s.rowT}>{st.name}</Text>
                    <Count n={st.count} owner={st.from_owner} />
                    <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                  </Pressable>
                ))}
              </View>
              {!d?.total && <Text style={[s.small, { textAlign: 'center' }]}>Notes you write in your planner’s note boxes land here by themselves, under the heading you give them.</Text>}
            </>
          ) : view.kind === 'stage' && stage ? (
            <>
              <Pressable onPress={back} hitSlop={6}><Text style={s.back}>‹ Notes</Text></Pressable>
              <Text style={s.h1}>{stage.name}</Text>
              {stage.sections.map((sec: any) => (
                <View key={sec.category} style={{ gap: 6 }}>
                  <Text style={s.section}>{sec.category}</Text>
                  <View style={s.list}>
                    {sec.topics.map((t: any, i: number) => (
                      <Pressable key={t.head} onPress={() => setView({ kind: 'head', head: t.head, label: t.topic, sub: String(stage.stage) })}
                        style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button">
                        <Text style={[s.rowT, !t.count && { color: c.textMuted, fontFamily: fonts.body }]}>{t.topic}</Text>
                        <Count n={t.count} owner={t.from_owner} />
                        <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </>
          ) : view.kind === 'head' ? (
            <>
              <Pressable onPress={back} hitSlop={6}><Text style={s.back}>‹ {view.sub ? (stage?.name || 'Back') : 'Notes'}</Text></Pressable>
              <Text style={s.h1}>{view.label}</Text>
              <NoteList notes={listQ.data} loading={listQ.isLoading} empty="No notes here yet. Tap Write a note to add one." s={s} c={c} ownerName={ownerName} onEdit={(n) => setEditing({ note: n, head: n.head })} />
            </>
          ) : null}
        </View>
      </ScrollView>
      {editing && <NoteEditor note={editing.note} head={editing.head} onClose={() => setEditing(null)} />}
    </View>
  );
}

function NoteEditor({ note, head, onClose }: { note?: Note; head: string; onClose: () => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useDeviceInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [h, setH] = useState(note?.head || head || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (note) await api.put(`/notes/${note.id}`, { title, body, head: h });
      else await api.post('/notes', { title, body, head: h });
      qc.invalidateQueries({ queryKey: ['notes-folder'] });
      qc.invalidateQueries({ queryKey: ['notes-list'] });
      qc.invalidateQueries({ queryKey: ['weekly-planner'] });
      toast.success(note ? 'Note saved' : 'Note added');
      onClose();
    } catch (e: any) {
      toast.error('Couldn\u2019t save', typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Try again.');
    } finally { setBusy(false); }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[s.edRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={s.edHead}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button"><Text style={s.back}>Cancel</Text></Pressable>
          <Text style={s.edTitle}>{note ? 'Edit note' : 'New note'}</Text>
          <Pressable onPress={save} disabled={busy} hitSlop={8} accessibilityRole="button" testID="note-save">
            {busy ? <ActivityIndicator color={c.primary} /> : <Text style={[s.back, { fontFamily: fonts.bodyBold }]}>Save</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={c.textMuted} style={s.edInput} maxLength={120} />
          <FolderTag value={{ head: h, title, share: false }} defaultHead={h || 'pitch:other'} defaultTitle={title || 'Note'} isAdmin={false}
            onChange={(v) => { setH(v.head); setTitle(v.title); }} />
          <TextInput value={body} onChangeText={setBody} placeholder="Write the note…" placeholderTextColor={c.textMuted}
            style={[s.edInput, { minHeight: 260 }]} multiline textAlignVertical="top" autoFocus={!note} />
          {!note && <Text style={s.small}>{'It also goes in today\u2019s Notes box in your planner.'}</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}

function NoteList({ notes, loading, empty, s, c, showHead, ownerName, onEdit }: { notes?: Note[]; loading: boolean; empty: string; s: any; c: any; showHead?: boolean; ownerName: string; onEdit?: (n: Note) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (loading) return <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} />;
  if (!notes?.length) return <Text style={[s.small, { textAlign: 'center', marginTop: 12 }]}>{empty}</Text>;
  const owner = notes.filter((n) => n.shared && !n.mine);
  const mine = notes.filter((n) => !(n.shared && !n.mine));
  const card = (n: Note) => {
    const big = open === n.id;
    return (
      <Pressable key={n.id} onPress={() => (n.mine && onEdit ? onEdit(n) : setOpen(big ? null : n.id))} style={[s.note, n.shared && !n.mine && s.noteOwner]} accessibilityRole="button" accessibilityHint={n.mine ? 'Edit this note' : undefined}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={s.noteT}>{n.title}</Text>
          <Text style={s.small}>{fmt(n.date)}</Text>
        </View>
        {!!n.body && <Text style={s.body} numberOfLines={big ? undefined : 3}>{n.body}</Text>}
        {!!n.photos?.length && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {n.photos.map((p, i) => (
              <Image key={i} source={{ uri: p }} style={big ? { width: '100%', aspectRatio: 1, borderRadius: 10 } : { width: 64, height: 64, borderRadius: 8 }} resizeMode={big ? 'contain' : 'cover'} />
            ))}
          </View>
        )}
        <Text style={s.small}>{showHead ? `${n.head_label} · ` : ''}{n.source_label}{n.shared ? (n.mine ? ' · posted to everyone' : ` · ${n.author_name.split(' ')[0]}`) : ''}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 10 }}>
      {owner.length > 0 && <Text style={[s.kicker, { color: c.text }]}>From {ownerName} · for everyone</Text>}
      {owner.map(card)}
      {mine.length > 0 && owner.length > 0 && <Text style={s.kicker}>My notes</Text>}
      {mine.map(card)}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 12 },
  edRoot: { flex: 1, backgroundColor: c.page || c.surface },
  edHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  edTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  edInput: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.background },
  write: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: c.primary },
  writeT: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.onPrimary },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: c.text, paddingVertical: 10 },
  latest: { backgroundColor: c.yellowBg, borderWidth: 1, borderColor: c.yellow, borderRadius: 14, padding: 12, gap: 3 },
  latestK: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.text },
  latestT: { fontFamily: fonts.bodySemibold, fontSize: 15.5, color: c.text },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted, marginTop: 4 },
  section: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text, marginTop: 6 },
  h1: { fontFamily: fonts.display, fontSize: 26, color: c.text },
  back: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  list: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  rowLine: { borderTopWidth: 1, borderTopColor: c.border },
  rowT: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  count: { fontFamily: fonts.mono, fontSize: 13, color: c.textMuted, minWidth: 16, textAlign: 'right' },
  owner: { fontFamily: fonts.bodySemibold, fontSize: 11.5, color: c.text, backgroundColor: c.yellowBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  note: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, gap: 6 },
  noteOwner: { backgroundColor: c.yellowBg, borderColor: c.yellow },
  noteT: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15.5, color: c.text },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: c.text },
});
