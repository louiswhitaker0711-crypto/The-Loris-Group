// Send announcement (the Owner, 11 Nov 2026): a title and message pushed to
// everyone in the office, Coaches only or BAs only. Each person also gets it
// in their Inbox, marked "Announcement". (backend POST /notifications/broadcast;
// "Everyone" sends audience "office" so it never leaves this office.)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';

type Audience = 'office' | 'leaders' | 'trainees';
const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'office', label: 'Everyone' },
  { id: 'leaders', label: 'Coaches' },
  { id: 'trainees', label: 'BAs' },
];

export default function AnnouncementCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('office');
  const [busy, setBusy] = useState(false);

  const who = AUDIENCES.find((a) => a.id === audience)?.label || 'Everyone';
  const ready = title.trim().length > 0 && body.trim().length > 0 && !busy;

  const send = async () => {
    setBusy(true);
    try {
      const r = await apiService.broadcast({ title: title.trim(), body: body.trim(), audience });
      toast.success(`Sent to ${r.data.sent} ${r.data.sent === 1 ? 'person' : 'people'}`);
      setTitle('');
      setBody('');
    } catch (e: any) {
      showAlert('Could not send', e?.response?.data?.detail || 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => showAlert(`Send to ${who}?`, `“${title.trim()}” goes out as a notification now, and into everyone's Inbox.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Send', onPress: send },
  ]);

  return (
    <View style={s.card} testID="admin-announcement">
      <View style={s.head}>
        <Ionicons name="megaphone-outline" size={18} color={c.primary} />
        <Text style={s.title}>Send announcement</Text>
      </View>
      <Text style={s.muted}>A notification to the office. It also lands in their Inbox, marked Announcement.</Text>
      <View style={s.chips}>
        {AUDIENCES.map((a) => {
          const on = a.id === audience;
          return (
            <Pressable key={a.id} onPress={() => setAudience(a.id)} style={[s.chip, on && s.chipOn]}
              accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Text style={[s.chipText, on && { color: c.onPrimary }]}>{a.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={title} onChangeText={setTitle} placeholder="Title, e.g. Pitch update" placeholderTextColor={c.textMuted}
        style={s.input} maxLength={80} accessibilityLabel="Announcement title" />
      <TextInput value={body} onChangeText={setBody} placeholder="Your message" placeholderTextColor={c.textMuted}
        style={[s.input, s.multi]} multiline maxLength={600} accessibilityLabel="Announcement message" />
      <Pressable onPress={confirm} disabled={!ready} style={[s.btn, !ready && { opacity: 0.5 }]} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="paper-plane-outline" size={16} color={c.onPrimary} />}
        <Text style={s.btnText}>Send to {who}</Text>
      </Pressable>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  input: { fontFamily: fonts.body, fontSize: 14, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.surface },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
});
