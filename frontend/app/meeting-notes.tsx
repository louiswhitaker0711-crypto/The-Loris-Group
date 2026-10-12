/** Meeting notes — one meeting on one day (?block_id=&date=).
 *  Coaches and the Owner add notes (typed, pasted or read from a photo), let
 *  AI write a one-page recap, check it and publish. Everyone the meeting is
 *  for (and everyone above them) reads the recap here and in Coaching →
 *  Meeting recaps. */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Switch } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { MarkdownBody } from '../src/pk/MarkdownBody';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset';
import { APP_LOCALE } from '../src/utils/appTime';

type Note = {
  id: string; block_title: string; date: string; raw_notes?: string; recap: string;
  status: 'draft' | 'published'; published_at?: string | null; created_by_name?: string;
};

function longDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
}
const errText = (e: any, fallback: string) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

export default function MeetingNotesScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const kb = useKeyboardInset();
  const params = useLocalSearchParams<{ block_id?: string; date?: string }>();
  const blockId = String(params.block_id || '');
  const date = String(params.date || '');
  const q = useQuery({
    queryKey: ['meeting-note', blockId, date],
    queryFn: () => apiService.getMeetingNote(blockId, date).then((r) => r.data),
    enabled: !!blockId && !!date,
  });
  const canWrite = !!q.data?.can_write;
  const title = q.data?.block?.title || 'Meeting';
  const [note, setNote] = useState<Note | null>(null);
  const [notes, setNotes] = useState('');
  const [recap, setRecap] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'scan' | 'ai' | 'publish'>('');
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    const n: Note | null = q.data?.note || null;
    setNote(n);
    setNotes(n?.raw_notes || '');
    setRecap(n?.recap || '');
    setEditing(!!q.data?.can_write && !n?.recap);
  }, [q.data]);

  const save = async (extra: { raw_notes?: string; recap?: string }) => {
    const r = await apiService.saveMeetingNote({ block_id: blockId, date, ...extra });
    setNote(r.data);
    return r.data as Note;
  };

  const onSave = async () => {
    setBusy('save');
    try { await save({ raw_notes: notes, recap }); toast.success('Saved'); }
    catch (e) { showAlert('Could not save', errText(e, 'Try again.')); }
    finally { setBusy(''); }
  };

  const onScan = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setBusy('scan');
    try {
      const r = await apiService.scanWeeklyNotes({ uri: res.assets[0].uri, name: 'notes.jpg', type: 'image/jpeg' });
      const text = (r.data?.text || '').trim();
      if (!text) { showAlert('Nothing found', "The photo didn't contain readable text. Try a closer, better-lit shot."); return; }
      const next = notes ? `${notes}\n${text}` : text;
      setNotes(next);
      await save({ raw_notes: next });
      toast.success('Notes read from the photo');
    } catch (e) { showAlert('Could not read the photo', errText(e, 'Try again.')); }
    finally { setBusy(''); }
  };

  const onAi = async () => {
    setBusy('ai');
    try {
      const n = await save({ raw_notes: notes });
      const r = await apiService.writeMeetingRecap(n.id);
      setRecap(r.data?.recap || '');
      toast.success('Recap written: check it, then publish');
    } catch (e) { showAlert('Could not write the recap', errText(e, 'Try again.')); }
    finally { setBusy(''); }
  };

  const onPublish = async (publish: boolean) => {
    setBusy('publish');
    try {
      const n = await save({ raw_notes: notes, recap });
      const r = await apiService.publishMeetingRecap(n.id, { publish, notify: publish && notify });
      setNote(r.data);
      setEditing(false);
      toast.success(publish ? (r.data?.notified ? `Published · ${r.data.notified} notified` : 'Published') : 'Unpublished');
      q.refetch();
    } catch (e) { showAlert('Could not publish', errText(e, 'Try again.')); }
    finally { setBusy(''); }
  };

  if (q.isLoading) {
    return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  }
  if (q.isError) {
    return <View style={[s.page, s.center]}><Text style={s.muted}>{errText(q.error, "This meeting couldn't be found.")}</Text></View>;
  }

  const published = note?.status === 'published';

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 + kb }]} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.muted}>{date ? longDate(date) : ''}{q.data?.block?.start_time ? ` · ${q.data.block.start_time}` : ''}</Text>
        {canWrite && note && (
          <View style={[s.pill, { backgroundColor: published ? c.green : c.surface }]}>
            <Text style={[s.pillText, { color: published ? c.onPrimary : c.textSecondary }]}>{published ? 'Published' : 'Draft'}</Text>
          </View>
        )}
      </View>

      {/* The recap, as everyone reads it */}
      {!!recap && !editing && (
        <View style={s.card}>
          <MarkdownBody text={recap} colors={c} />
          {canWrite && (
            <Pressable onPress={() => setEditing(true)} style={s.ghost} accessibilityRole="button">
              <Ionicons name="create-outline" size={15} color={c.primary} />
              <Text style={s.ghostText}>Edit notes and recap</Text>
            </Pressable>
          )}
        </View>
      )}

      {!recap && !canWrite && (
        <View style={s.card}><Text style={s.muted}>No recap for this meeting yet.</Text></View>
      )}

      {canWrite && editing && (
        <>
          <View style={s.card}>
            <Text style={s.h}>1. Your notes</Text>
            <Text style={s.muted}>Type or paste them, or read them from a photo of handwritten notes. Only Coaches and the Owner see these.</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="What was covered, examples, actions…"
              placeholderTextColor={c.textMuted}
              style={[s.input, { minHeight: 160 }]}
              textAlignVertical="top"
            />
            <View style={s.row}>
              <Pressable onPress={onScan} disabled={!!busy} style={s.ghost} accessibilityRole="button">
                {busy === 'scan' ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="camera-outline" size={15} color={c.primary} />}
                <Text style={s.ghostText}>Read a photo</Text>
              </Pressable>
              <Pressable onPress={onAi} disabled={!!busy || notes.trim().length < 20} style={[s.btn, (busy || notes.trim().length < 20) && { opacity: 0.5 }]} accessibilityRole="button">
                {busy === 'ai' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="sparkles-outline" size={15} color={c.onPrimary} />}
                <Text style={s.btnText}>Write the recap with AI</Text>
              </Pressable>
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.h}>2. The recap</Text>
            <Text style={s.muted}>A one-page recap for anyone who missed it. Check it and change anything you like before you publish.</Text>
            <TextInput
              value={recap}
              onChangeText={setRecap}
              multiline
              placeholder={'## What we covered\n…\n## What to do in the field\n…\n## Check yourself\n…'}
              placeholderTextColor={c.textMuted}
              style={[s.input, { minHeight: 220, fontFamily: fonts.mono, fontSize: 13 }]}
              textAlignVertical="top"
            />
            {!!recap && (
              <>
                <Text style={[s.h, { marginTop: 8 }]}>Preview</Text>
                <View style={s.preview}><MarkdownBody text={recap} colors={c} /></View>
              </>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.h}>3. Publish</Text>
            <Text style={s.muted}>Published recaps show on this meeting in the Schedule and in Coaching → Meeting recaps, for the people this meeting is for and everyone above them.</Text>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={s.label}>Send them a notification</Text>
              <Switch value={notify} onValueChange={setNotify} accessibilityLabel="Send a notification when published" />
            </View>
            <View style={s.row}>
              <Pressable onPress={onSave} disabled={!!busy} style={s.ghost} accessibilityRole="button">
                {busy === 'save' ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="save-outline" size={15} color={c.primary} />}
                <Text style={s.ghostText}>Save draft</Text>
              </Pressable>
              {published && (
                <Pressable onPress={() => onPublish(false)} disabled={!!busy} style={s.ghost} accessibilityRole="button">
                  <Text style={s.ghostText}>Unpublish</Text>
                </Pressable>
              )}
              <Pressable onPress={() => onPublish(true)} disabled={!!busy || !recap.trim()} style={[s.btn, (busy || !recap.trim()) && { opacity: 0.5 }]} accessibilityRole="button" testID="meeting-publish">
                {busy === 'publish' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="paper-plane-outline" size={15} color={c.onPrimary} />}
                <Text style={s.btnText}>{published ? 'Update' : 'Publish'}</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  head: { gap: 4 },
  title: { fontFamily: fonts.display, fontSize: 22, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, marginTop: 4 },
  pillText: { fontFamily: fonts.bodySemibold, fontSize: 12 },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, gap: 10 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
  preview: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, alignSelf: 'flex-start' },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
