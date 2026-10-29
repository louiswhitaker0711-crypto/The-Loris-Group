/**
 * Notes on a planner slot (the Owner, 29 Oct 2026). Any time slot — and the
 * big Notes box at the bottom of each day — can hold several notes besides
 * its plan: someone else's coaching in Primetime, a tip from the meeting.
 * Each note has a title, where it files (a pitch heading or a COD topic) and
 * photos, and files itself into the Notes folder when the planner saves.
 * (backend routes/notes_folder.py: clean_slot_notes, POST /notes/photo)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useColors, fonts } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import { toast } from '../../utils/toast';
import FolderTag from '../notes/FolderTag';

export type SlotNote = { id: string; title: string; head: string; body: string; photos: string[]; share?: boolean; label?: string };

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
export const blankNote = (label: string, head = ''): SlotNote => ({ id: newId(), title: '', head, body: '', photos: [], label });

async function pickAndUpload(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
  if (res.canceled || !res.assets?.[0]?.uri) return null;
  const a = res.assets[0];
  const wide = (a.width || 0) >= (a.height || 0);
  const resize = Math.max(a.width || 0, a.height || 0) > 1600 ? [{ resize: wide ? { width: 1600 } : { height: 1600 } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, resize as any, { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!out.base64) return null;
  const { data } = await api.post('/notes/photo', { image: `data:image/jpeg;base64,${out.base64}` }, { timeout: 60_000 });
  return data?.url || null;
}

function NoteCard({ note, label, defaultHead, isAdmin, canEdit, onChange, onRemove, s, c }: {
  note: SlotNote; label: string; defaultHead: string; isAdmin: boolean; canEdit: boolean;
  onChange: (n: SlotNote) => void; onRemove: () => void; s: any; c: any;
}) {
  const [uploading, setUploading] = useState(false);
  const addPhoto = async () => {
    if (note.photos.length >= 4) return;
    setUploading(true);
    try {
      const url = await pickAndUpload();
      if (url) onChange({ ...note, photos: [...note.photos, url] });
    } catch (e: any) {
      toast.error('Couldn’t add the photo', typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Try again.');
    } finally {
      setUploading(false);
    }
  };
  return (
    <View style={s.card}>
      <View style={s.row}>
        <TextInput value={note.title} onChangeText={(t) => onChange({ ...note, title: t })} editable={canEdit}
          placeholder={`Title (e.g. ${label})`} placeholderTextColor={c.textMuted} style={s.title} maxLength={120} />
        {canEdit && (
          <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove this note">
            <Ionicons name="trash-outline" size={18} color={c.textMuted} />
          </Pressable>
        )}
      </View>
      {canEdit && (
        <FolderTag value={{ head: note.head, title: note.title, share: !!note.share }} defaultHead={defaultHead} defaultTitle={label}
          isAdmin={isAdmin} onChange={(v) => onChange({ ...note, head: v.head, title: v.title, share: v.share })} />
      )}
      <TextInput value={note.body} onChangeText={(t) => onChange({ ...note, body: t })} editable={canEdit} multiline
        placeholder="Write the note…" placeholderTextColor={c.textMuted} style={s.body} textAlignVertical="top" />
      {(note.photos.length > 0 || canEdit) && (
        <View style={s.photos}>
          {note.photos.map((p, i) => (
            <View key={p.slice(-40) + i}>
              <Image source={{ uri: p }} style={s.photo} />
              {canEdit && (
                <Pressable onPress={() => onChange({ ...note, photos: note.photos.filter((_, j) => j !== i) })} style={s.photoX}
                  accessibilityRole="button" accessibilityLabel="Remove photo" hitSlop={6}>
                  <Ionicons name="close" size={14} color={c.onPrimary} />
                </Pressable>
              )}
            </View>
          ))}
          {canEdit && note.photos.length < 4 && (
            <Pressable onPress={addPhoto} style={[s.photo, s.addPhoto]} accessibilityRole="button" accessibilityLabel="Add a photo" disabled={uploading}>
              {uploading ? <ActivityIndicator color={c.primary} /> : <Ionicons name="camera-outline" size={22} color={c.primary} />}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export default function SlotNotesEditor({ notes, label, defaultHead, isAdmin, canEdit, onChange }: {
  notes: SlotNote[]; label: string; defaultHead: string; isAdmin: boolean; canEdit: boolean;
  onChange: (notes: SlotNote[]) => void;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  return (
    <View style={{ gap: 12 }}>
      {notes.length === 0 && !canEdit && <Text style={s.muted}>No notes here.</Text>}
      {notes.map((n, i) => (
        <NoteCard key={n.id} note={n} label={label} defaultHead={defaultHead} isAdmin={isAdmin} canEdit={canEdit} s={s} c={c}
          onChange={(v) => onChange(notes.map((x, j) => (j === i ? v : x)))}
          onRemove={() => onChange(notes.filter((_, j) => j !== i))} />
      ))}
      {canEdit && notes.length < 10 && (
        <Pressable onPress={() => onChange([...notes, blankNote(label)])} style={s.add} accessibilityRole="button" testID="slot-notes-add">
          <Ionicons name="add" size={18} color={c.primary} />
          <Text style={s.addText}>{notes.length ? 'Add another note' : 'Add a note'}</Text>
        </Pressable>
      )}
      {canEdit && notes.length > 0 && (
        <Text style={s.muted}>Each note files into your Notes folder under its heading.</Text>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, gap: 10, backgroundColor: c.background },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 16, color: c.text, paddingVertical: 6 },
  body: { minHeight: 140, fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10, backgroundColor: c.surface },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 84, height: 84, borderRadius: 10, backgroundColor: c.surface },
  addPhoto: { borderWidth: 1, borderColor: c.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  photoX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: c.primary, borderStyle: 'dashed' },
  addText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.primary },
  muted: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
});
