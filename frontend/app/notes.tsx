/**
 * Notes (route: /notes) — the Owner's call, 29 Oct 2026. Everything written
 * in the planner's note boxes, filed by heading: the pitch headings
 * (Introduction … Sales tips) and the COD, stage by stage with every section
 * and its topics listed (so nobody has to guess what's inside). Your own
 * notes are yours; the Owner's posted notes are marked and come first.
 * Search finds any word in any note. (GET /notes/folder, GET /notes)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator, Image, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { showAlert } from '../src/utils/showAlert';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { APP_LOCALE } from '../src/utils/appTime';
import { useDeviceInsets } from '../src/nav/AppShell';
import { toast } from '../src/utils/toast';
import { readBackup, writeBackup, clearBackup, onLeave } from '../src/utils/draftBackup';
import { pickNotePhoto } from '../src/utils/pickImage';
import RunSheet, { RunItButton } from '../src/components/planner/RunSheet';

type Note = { id: string; head: string; head_label: string; title: string; body: string; date: string;
  source_label: string; shared: boolean; author_name: string; mine: boolean; photos?: string[]; can_delete?: boolean; can_photo?: boolean;
  where?: string; updated_at?: string; meeting?: boolean };
type View_ = { kind: 'root' } | { kind: 'stage'; stage: number } | { kind: 'head'; head: string; label: string; sub?: string };

/** Where a heading files, in words: "Close", "Stage 1 · Pitch delivery", a meet-up's name. */
function whereOf(d: any, head: string): string {
  if (!head) return '';
  const p = (d?.pitch || []).find((x: any) => x.head === head);
  if (p) return p.label;
  const m = (d?.meetups || []).find((x: any) => x.head === head);
  if (m) return m.label;
  for (const st of d?.cod || []) for (const sec of st.sections || []) {
    const t = (sec.topics || []).find((x: any) => x.head === head);
    if (t) return `${String(st.name).split(' · ')[0]} · ${t.topic}`;
  }
  return head.startsWith('cod:') ? 'A CoD topic' : 'Other';
}

const ago = (iso?: string) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!t) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24 && new Date(t).toDateString() === new Date().toDateString()) return `${Math.round(mins / 60)} hr ago`;
  return new Date(t).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
};

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
  const [editing, setEditing] = useState<null | { note?: Note; head: string; restored?: NoteDraft }>(null);
  const folder = useQuery({ queryKey: ['notes-folder'], queryFn: async () => (await api.get('/notes/folder')).data });
  // A note that was being written when the app closed opens again by itself.
  useEffect(() => {
    readBackup<NoteDraft>('note:open').then((b) => {
      if (b?.pending && b.value) setEditing({ note: b.value.note, head: b.value.head, restored: b.value });
    });
  }, []);
  // Recent: your own notes, last written first (the Owner, 26 Nov 2026).
  const recentQ = useQuery({ queryKey: ['notes-recent'], queryFn: async () => (await api.get('/notes', { params: { recent: 8 } })).data.notes as Note[] });
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
          {!(view.kind === 'head' && ['pitch:morning', 'pitch:leaders'].includes(view.head)) && <Pressable onPress={() => setEditing({ head: view.kind === 'head' ? view.head : '' })} style={s.write} accessibilityRole="button" testID="notes-write">
            <Ionicons name="create-outline" size={20} color={c.onPrimary} />
            <Text style={s.writeT}>{view.kind === 'head' ? `New note in ${view.label}` : 'New note'}</Text>
          </Pressable>}
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
              <View style={s.blockHead}>
                <Text style={s.h2}>Recent</Text>
              </View>
              {recentQ.isLoading ? <ActivityIndicator color={c.primary} />
                : !recentQ.data?.length ? <Text style={s.small}>Nothing yet. Tap New note to write your first one.</Text>
                : <View style={s.list}>
                    {recentQ.data.map((n, i) => (
                      <Pressable key={n.id} onPress={() => setEditing({ note: n, head: n.head })} style={[s.recent, i > 0 && s.rowLine]} accessibilityRole="button" accessibilityHint="Open this note" testID="notes-recent-row">
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={s.noteT} numberOfLines={1}>{n.title || 'Note'}</Text>
                          <Text style={s.small}>{ago(n.updated_at) || fmt(n.date)}</Text>
                        </View>
                        {!!n.body && <Text style={s.preview} numberOfLines={2}>{n.body}</Text>}
                        <View style={s.chip}>
                          <Ionicons name="folder-outline" size={12} color={c.primary} />
                          <Text style={s.chipT} numberOfLines={1}>{n.where || n.head_label}</Text>
                          {!!n.photos?.length && <><Ionicons name="image-outline" size={12} color={c.textMuted} /><Text style={s.small}>{n.photos.length}</Text></>}
                        </View>
                      </Pressable>
                    ))}
                  </View>}
              <View style={s.blockHead}>
                <Text style={s.h2}>Folders</Text>
              </View>
              {/* The Leaders meeting for everyone; Ownership for the Owner only (the Owner, 11 Nov 2026). */}
              {[['meeting', 'Meetings'], ['owner', 'Ownership · just you']].map(([g, label]) => {
                const rows = (d?.pitch || []).filter((p: any) => p.group === g);
                if (!rows.length) return null;
                return (
                  <React.Fragment key={g}>
                    <Text style={s.kicker}>{label}</Text>
                    <View style={s.list}>
                      {rows.map((p: any, i: number) => (
                        <Pressable key={p.head} onPress={() => setView({ kind: 'head', head: p.head, label: p.label })} style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button">
                          <Text style={s.rowT}>{p.label}</Text>
                          <Count n={p.count} owner={p.from_owner} />
                          <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                        </Pressable>
                      ))}
                    </View>
                  </React.Fragment>
                );
              })}
              <Text style={s.kicker}>The pitch and sign-up</Text>
              <View style={s.list}>
                {(d?.pitch || []).filter((p: any) => !p.group || p.group === 'sales').map((p: any, i: number) => (
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
              {(d?.meetups || []).length > 0 && <>
                <Text style={s.kicker}>Meet-ups</Text>
                <View style={s.list}>
                  {(d?.meetups || []).map((mt: any, i: number) => (
                    <Pressable key={mt.head} onPress={() => setView({ kind: 'head', head: mt.head, label: mt.label })} style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button">
                      <Text style={s.rowT}>{mt.label}</Text>
                      <Count n={mt.count} owner={0} />
                      <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
                    </Pressable>
                  ))}
                </View>
              </>}
              <Pressable onPress={() => router.push('/notes-removed' as any)} style={[s.row, s.list]} accessibilityRole="button" testID="notes-removed">
                <Ionicons name="arrow-undo-outline" size={16} color={c.primary} />
                <Text style={s.rowT}>Recently removed</Text>
                <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
              </Pressable>
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
      {editing && <NoteEditor note={editing.note} head={editing.head} restored={editing.restored} onClose={() => setEditing(null)} />}
    </View>
  );
}

type NoteDraft = { note?: Note; head: string; id?: string; title: string; body: string; h: string; photos?: string[] };

// Saves as you type (the Owner, 3 Nov 2026: a BA lost her notes). A new note
// is created on the first words and kept up to date after that; the phone
// also keeps a copy until the server has it, so nothing typed is lost if the
// app closes, the signal drops or the page reloads.
function NoteEditor({ note, head, restored, onClose }: { note?: Note; head: string; restored?: NoteDraft; onClose: () => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useDeviceInsets();
  const qc = useQueryClient();
  const [title, setTitle] = useState(restored?.title ?? note?.title ?? '');
  const [body, setBody] = useState(restored?.body ?? note?.body ?? '');
  const [h, setH] = useState(restored?.h ?? note?.head ?? head ?? '');
  const folderQ = useQuery({ queryKey: ['notes-folder'], queryFn: async () => (await api.get('/notes/folder')).data });
  const where = whereOf(folderQ.data, h);
  const meetup = h.startsWith('meetup:');
  // Pick where it goes before writing (the Owner, 26 Nov 2026).
  const [picking, setPicking] = useState(!note && !restored && !head);
  // Photos (the Owner, 13 Nov 2026): take one or pick one, up to 4, on a new
  // note or one that sits in the planner as its own note.
  const [photos, setPhotos] = useState<string[]>(restored?.photos ?? note?.photos ?? []);
  const [adding, setAdding] = useState(false);
  const canPhoto = !h.startsWith('meetup:') && (!note || !!note.can_photo || !!restored?.id);
  const addPhoto = async () => {
    if (photos.length >= 4 || adding) return;
    setAdding(true);
    try {
      const url = await pickNotePhoto();
      if (url) setPhotos((ps) => [...ps, url].slice(0, 4));
    } catch (e: any) {
      toast.error('Couldn\u2019t add the photo', typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Try again.');
    } finally { setAdding(false); }
  };
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const idRef = useRef<string | undefined>(restored?.id ?? note?.id);
  const lastSaved = useRef(JSON.stringify([note?.title || '', note?.body || '', note?.head || head || '', note?.photos || []]));
  const timer = useRef<any>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const latest = useRef({ title, body, h, photos });
  latest.current = { title, body, h, photos };

  const push = async (): Promise<void> => {
    if (inFlight.current) { await inFlight.current; }
    const { title: t, body: b, h: hh, photos: ph } = latest.current;
    const sig = JSON.stringify([t, b, hh, ph]);
    if (sig === lastSaved.current) return;
    if (!idRef.current && !(b.trim() || t.trim() || ph.length)) return;
    const pics = canPhoto ? { photos: ph } : {};
    setState('saving');
    const run = (async () => {
      try {
        let saved = false;
        if (idRef.current) {
          try {
            await api.put(`/notes/${idRef.current}`, { title: t, body: b, head: hh, ...pics });
            saved = true;
          } catch (err: any) {
            // The note it was editing has gone (emptied or removed in the
            // planner): keep what's typed as a new note instead of getting
            // stuck (11 Nov 2026: Done wouldn't close and no new note opened).
            if (err?.response?.status !== 404) throw err;
            idRef.current = undefined;
          }
        }
        if (!saved) {
          if (!(b.trim() || t.trim() || ph.length)) { lastSaved.current = sig; return; }
          const r = await api.post('/notes', { title: t, body: b, head: hh, ...pics });
          idRef.current = r.data?.note_id || undefined;
        }
        lastSaved.current = sig;
        setState('saved');
        // Show it straight away in Recent and its folder, before the refresh lands.
        const local: Note = { ...(note || {} as Note), id: idRef.current || note?.id || 'new', head: hh, title: t || 'Note', body: b,
          photos: ph, mine: true, shared: !!note?.shared, can_delete: true, can_photo: canPhoto || !!note?.can_photo,
          where: whereOf(folderQ.data, hh), head_label: whereOf(folderQ.data, hh), updated_at: new Date().toISOString(),
          date: note?.date || new Date().toISOString().slice(0, 10), source_label: note?.source_label || 'Day notes', author_name: note?.author_name || '' };
        qc.setQueryData(['notes-recent'], (old: Note[] | undefined) => [local, ...(old || []).filter((x) => x.id !== local.id)].slice(0, 8));
        qc.setQueriesData({ queryKey: ['notes-list'] }, (old: Note[] | undefined) => old && old.map((x) => (x.id === local.id ? { ...x, ...local } : x)));
        if (sig === JSON.stringify([latest.current.title, latest.current.body, latest.current.h, latest.current.photos])) clearBackup('note:open');
        qc.invalidateQueries({ queryKey: ['notes-folder'] });
        qc.invalidateQueries({ queryKey: ['notes-list'] });
        qc.invalidateQueries({ queryKey: ['notes-recent'] });
        qc.invalidateQueries({ queryKey: ['weekly-planner'] });
      } catch (e: any) {
        setState('error');
        throw e;
      }
    })();
    inFlight.current = run.finally(() => { inFlight.current = null; }).catch(() => {});
    return run;
  };

  // Every change: keep a copy on the phone, then save a moment later.
  useEffect(() => {
    const sig = JSON.stringify([title, body, h, photos]);
    if (sig === lastSaved.current) return;
    writeBackup<NoteDraft>('note:open', { note, head, id: idRef.current, title, body, h, photos });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { push().catch(() => {}); }, 900);
  }, [title, body, h, photos]);
  useEffect(() => onLeave(() => { if (timer.current) clearTimeout(timer.current); push().catch(() => {}); }), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Done / back: save what's there and close. Only closes once it's saved;
  // if it can't save, it stays open with the text kept.
  const save = async () => {
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      await push();
      clearBackup('note:open');
      if (idRef.current || note) toast.success('Saved', `In ${where || 'Other'}. It\u2019s at the top of Recent.`);
      qc.refetchQueries({ queryKey: ['notes-recent'] });
      qc.refetchQueries({ queryKey: ['notes-list'] });
      qc.refetchQueries({ queryKey: ['notes-folder'] });
      onClose();
    } catch (e: any) {
      toast.error('Couldn\u2019t save yet', typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Your note is kept on this phone and will save when you\u2019re back online.');
    } finally { setBusy(false); }
  };
  // Throw this away: closes without saving and clears the phone's copy, so a
  // note that can't save never blocks writing another.
  const discard = () => {
    const go = () => { if (timer.current) clearTimeout(timer.current); clearBackup('note:open'); onClose(); };
    const unsaved = JSON.stringify([title, body, h, photos]) !== lastSaved.current;
    if (!unsaved) { go(); return; }
    showAlert('Discard this note?', 'What you’ve typed since it last saved will be lost.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: go },
    ]);
  };
  // Delete (the Owner, 11 Nov 2026): out of the planner too, and kept in
  // Recently removed for 30 days in case it was a mistake.
  const canDelete = !!note?.can_delete;
  const remove = () => {
    showAlert('Delete this note?', 'It comes out of your planner too. You can put it back from Recently removed for 30 days, then it’s gone.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (timer.current) clearTimeout(timer.current);
        setBusy(true);
        try {
          if (inFlight.current) await inFlight.current;
          await api.delete(`/notes/${idRef.current || note!.id}`);
          clearBackup('note:open');
          qc.invalidateQueries({ queryKey: ['notes-folder'] });
          qc.invalidateQueries({ queryKey: ['notes-list'] });
          qc.invalidateQueries({ queryKey: ['notes-recent'] });
          qc.invalidateQueries({ queryKey: ['weekly-planner'] });
          toast.success('Note deleted', 'It’s in Recently removed for 30 days.');
          onClose();
        } catch (e: any) {
          if (e?.response?.status === 404) { clearBackup('note:open'); onClose(); return; }
          toast.error('Couldn’t delete it', typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Try again in a moment.');
        } finally { setBusy(false); }
      } },
    ]);
  };
  const dirty = JSON.stringify([title, body, h, photos]) !== lastSaved.current;
  const status = state === 'error' ? { icon: 'cloud-offline-outline', text: 'Not saved yet \u2014 kept on this phone', col: c.red || '#c0392b' }
    : state === 'saving' || (dirty && (idRef.current || title.trim() || body.trim() || photos.length)) ? { icon: 'sync-outline', text: 'Saving\u2026', col: c.textMuted }
    : idRef.current ? { icon: 'checkmark-circle', text: 'Saved', col: c.green }
    : { icon: 'create-outline', text: 'Start typing \u2014 it saves as you go', col: c.textMuted };

  if (picking) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => (h ? setPicking(false) : onClose())}>
        <View style={[s.edRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
          <View style={s.edHead}>
            <Pressable onPress={() => (h ? setPicking(false) : onClose())} hitSlop={8} accessibilityRole="button" style={{ width: 60 }}>
              <Text style={[s.back, { color: c.textMuted }]}>{h ? 'Back' : 'Cancel'}</Text>
            </Pressable>
            <Text style={s.edTitle}>Where does this go?</Text>
            <View style={{ width: 60 }} />
          </View>
          <FolderPicker d={folderQ.data} loading={folderQ.isLoading} current={h} s={s} c={c}
            onPick={(hd) => { setH(hd); setPicking(false); }} />
        </View>
      </Modal>
    );
  }
  return (
    <Modal visible animationType="slide" onRequestClose={save}>
      <View style={[s.edRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={s.edHead}>
          <Pressable onPress={discard} hitSlop={8} accessibilityRole="button" testID="note-discard" style={{ width: 60 }}>
            <Text style={[s.back, { color: c.textMuted }]}>{state === 'error' ? 'Discard' : 'Cancel'}</Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={s.edTitle}>{note ? 'Edit note' : 'New note'}</Text>
          </View>
          <Pressable onPress={save} disabled={busy} hitSlop={8} accessibilityRole="button" testID="note-save" style={{ width: 60, alignItems: 'flex-end' }}>
            {busy ? <ActivityIndicator color={c.primary} /> : <Text style={[s.back, { fontFamily: fonts.bodyBold }]}>Done</Text>}
          </Pressable>
        </View>
        <View style={[s.status, { borderBottomColor: c.border }]}>
          <Ionicons name={status.icon as any} size={15} color={status.col} />
          <Text style={[s.statusT, { color: status.col }]}>{status.text}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => !meetup && setPicking(true)} disabled={meetup} style={s.filed} accessibilityRole="button" accessibilityLabel={`Filed in ${where || 'Other'}. Tap to change`} testID="note-filed-in">
            <View style={s.filedIcon}><Ionicons name="folder-open" size={18} color={c.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.filedK}>Filed in</Text>
              <Text style={s.filedT} numberOfLines={2}>{where || 'Other'}</Text>
            </View>
            {!meetup && <Text style={s.back}>Change</Text>}
          </Pressable>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={c.textMuted} style={[s.edInput, s.edTitleInput]} maxLength={120} />
          <TextInput value={body} onChangeText={setBody} placeholder="Write the note…" placeholderTextColor={c.textMuted}
            style={[s.edInput, { minHeight: 240 }]} multiline textAlignVertical="top" autoFocus={!note} />
          {canPhoto && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {photos.map((p, i) => (
                <View key={p + i}>
                  <Image source={{ uri: p }} style={{ width: 84, height: 84, borderRadius: 12 }} />
                  <Pressable onPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove photo"
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: c.surface, borderRadius: 12 }}>
                    <Ionicons name="close-circle" size={22} color={c.textMuted} />
                  </Pressable>
                </View>
              ))}
              {photos.length < 4 && (
                <Pressable onPress={addPhoto} disabled={adding} accessibilityRole="button" accessibilityLabel="Add a photo" testID="note-add-photo"
                  style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  {adding ? <ActivityIndicator color={c.primary} /> : <>
                    <Ionicons name="camera-outline" size={22} color={c.primary} />
                    <Text style={[s.small, { color: c.primary }]}>Photo</Text>
                  </>}
                </Pressable>
              )}
            </View>
          )}
          {canDelete && (
            <Pressable onPress={remove} disabled={busy} style={s.delBtn} accessibilityRole="button" testID="note-delete">
              <Ionicons name="trash-outline" size={16} color={c.red || '#c0392b'} />
              <Text style={[s.delT, { color: c.red || '#c0392b' }]}>Delete note</Text>
            </Pressable>
          )}
          {!note && <Text style={s.small}>{meetup ? 'It also goes in your meet-up planner.' : 'It also goes in today\u2019s Notes box in your planner.'}</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Where a new note goes (the Owner, 26 Nov 2026): recently used, then every
 * heading in plain sight, CoD stages opening to their topics; search finds any. */
function FolderPicker({ d, loading, current, onPick, s, c }: { d: any; loading: boolean; current: string; onPick: (head: string) => void; s: any; c: any }) {
  const [stage, setStage] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const qc = useQueryClient();
  const recent = (qc.getQueryData(['notes-recent']) as Note[] | undefined) || [];
  if (loading || !d) return <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} />;
  const used = Array.from(new Set(recent.map((n) => n.head).filter((h) => h && !h.startsWith('meetup:')))).slice(0, 4);
  const all: { head: string; label: string }[] = [
    ...(d.pitch || []).map((p: any) => ({ head: p.head, label: p.label })),
    ...(d.cod || []).flatMap((st: any) => (st.sections || []).flatMap((sec: any) => (sec.topics || []).map((t: any) => ({ head: t.head, label: `${String(st.name).split(' · ')[0]} · ${t.topic}` })))),
    ...(d.meetups || []).map((m: any) => ({ head: m.head, label: m.label })),
  ];
  const Row = ({ head, label, i, chevron, onPress }: { head?: string; label: string; i: number; chevron?: boolean; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button">
      <Text style={s.rowT}>{label}</Text>
      {head === current && <Ionicons name="checkmark" size={18} color={c.primary} />}
      {chevron && <Ionicons name="chevron-forward" size={15} color={c.textMuted} />}
    </Pressable>
  );
  const needle = q.trim().toLowerCase();
  const st = stage != null ? (d.cod || []).find((x: any) => x.stage === stage) : null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
      <View style={s.search}>
        <Ionicons name="search" size={16} color={c.textMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Find a heading or CoD topic" placeholderTextColor={c.textMuted} style={s.searchInput} />
      </View>
      {needle ? (
        <View style={s.list}>
          {all.filter((x) => x.label.toLowerCase().includes(needle)).slice(0, 40).map((x, i) => <Row key={x.head} head={x.head} label={x.label} i={i} onPress={() => onPick(x.head)} />)}
        </View>
      ) : st ? (
        <>
          <Pressable onPress={() => setStage(null)} hitSlop={6}><Text style={s.back}>‹ All headings</Text></Pressable>
          <Text style={s.h2}>{st.name}</Text>
          {(st.sections || []).map((sec: any) => (
            <View key={sec.category} style={{ gap: 6 }}>
              <Text style={s.section}>{sec.category}</Text>
              <View style={s.list}>
                {(sec.topics || []).map((t: any, i: number) => <Row key={t.head} head={t.head} label={t.topic} i={i} onPress={() => onPick(t.head)} />)}
              </View>
            </View>
          ))}
        </>
      ) : (
        <>
          {used.length > 0 && <>
            <Text style={s.kicker}>Used lately</Text>
            <View style={s.list}>{used.map((h, i) => <Row key={h} head={h} label={whereOf(d, h)} i={i} onPress={() => onPick(h)} />)}</View>
          </>}
          <Text style={s.kicker}>The pitch and sign-up</Text>
          <View style={s.list}>
            {(d.pitch || []).filter((p: any) => !p.group || p.group === 'sales').map((p: any, i: number) => <Row key={p.head} head={p.head} label={p.label} i={i} onPress={() => onPick(p.head)} />)}
          </View>
          {(d.pitch || []).some((p: any) => p.group && p.group !== 'sales' && !['pitch:morning', 'pitch:leaders'].includes(p.head)) && <>
            <Text style={s.kicker}>Meetings</Text>
            <View style={s.list}>
              {(d.pitch || []).filter((p: any) => p.group && p.group !== 'sales' && !['pitch:morning', 'pitch:leaders'].includes(p.head)).map((p: any, i: number) => <Row key={p.head} head={p.head} label={p.group === 'owner' ? `${p.label} · just you` : p.label} i={i} onPress={() => onPick(p.head)} />)}
            </View>
          </>}
          <Text style={s.kicker}>The CoD</Text>
          <View style={s.list}>
            {(d.cod || []).map((x: any, i: number) => <Row key={x.stage} label={x.name} i={i} chevron onPress={() => setStage(x.stage)} />)}
          </View>
          {(d.meetups || []).length > 0 && <>
            <Text style={s.kicker}>Meet-ups</Text>
            <View style={s.list}>{d.meetups.map((m: any, i: number) => <Row key={m.head} head={m.head} label={m.label} i={i} onPress={() => onPick(m.head)} />)}</View>
          </>}
        </>
      )}
    </ScrollView>
  );
}

function NoteList({ notes, loading, empty, s, c, showHead, ownerName, onEdit }: { notes?: Note[]; loading: boolean; empty: string; s: any; c: any; showHead?: boolean; ownerName: string; onEdit?: (n: Note) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [run, setRun] = useState<Note | null>(null);
  if (loading) return <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} />;
  if (!notes?.length) return <Text style={[s.small, { textAlign: 'center', marginTop: 12 }]}>{empty}</Text>;
  const owner = notes.filter((n) => n.shared && !n.mine);
  const mine = notes.filter((n) => !(n.shared && !n.mine));
  const card = (n: Note) => {
    const big = open === n.id;
    return (
      <Pressable key={n.id} onPress={() => (n.mine && onEdit && !n.meeting ? onEdit(n) : setOpen(big ? null : n.id))} style={[s.note, n.shared && !n.mine && s.noteOwner]} accessibilityRole="button" accessibilityHint={n.mine ? 'Edit this note' : undefined}>
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
        {n.meeting && big && (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <RunItButton onPress={() => setRun(n)} />
            <Pressable onPress={() => router.push((n.head === 'pitch:leaders' ? '/(tabs)/schedule?view=plan' : '/weekly-planner') as any)} hitSlop={6} accessibilityRole="button">
              <Text style={s.back}>{n.head === 'pitch:leaders' ? 'Change it on the Weekly Plan' : 'Change it in the planner'}</Text>
            </Pressable>
          </View>
        )}
        <Text style={s.small}>{showHead ? `${n.where || n.head_label} · ` : ''}{n.source_label}{n.shared ? (n.mine ? ' · posted to everyone' : ` · ${n.author_name.split(' ')[0]}`) : ''}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 10 }}>
      {owner.length > 0 && <Text style={[s.kicker, { color: c.text }]}>From {ownerName} · for everyone</Text>}
      {owner.map(card)}
      {mine.length > 0 && owner.length > 0 && <Text style={s.kicker}>My notes</Text>}
      {mine.map(card)}
      <RunSheet visible={!!run} text={run?.body || ''} title={run?.title} onClose={() => setRun(null)} />
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
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 10, marginTop: 8 },
  delT: { fontFamily: fonts.bodySemibold, fontSize: 14.5 },
  write: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 54, borderRadius: 16, backgroundColor: c.primary },
  writeT: { fontFamily: fonts.bodyBold, fontSize: 16.5, color: c.onPrimary },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  h2: { fontFamily: fonts.display, fontSize: 21, color: c.text },
  recent: { paddingHorizontal: 14, paddingVertical: 12, gap: 5 },
  preview: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: `${c.primary}16`, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: '100%' },
  chipT: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.primary, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 7, borderBottomWidth: 1 },
  statusT: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  filed: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: c.primary, backgroundColor: c.background },
  filedIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${c.primary}16` },
  filedK: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  filedT: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  edTitleInput: { fontFamily: fonts.bodyBold, fontSize: 17 },
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
