// Read-only viewers (the Owner only): add someone — your own coach, say —
// who can log in and see everything you see in the office, but can't change
// anything. (backend routes/viewers.py)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';

export default function ViewersCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({ queryKey: ['viewers'], queryFn: () => apiService.listViewers().then((r) => r.data.viewers), retry: false });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const viewers: any[] = q.data || [];

  const add = async () => {
    setBusy(true);
    try {
      await apiService.addViewer({ name, email, password });
      toast.success(`${name.split(' ')[0]} can now log in and look around`);
      setName(''); setEmail(''); setPassword(''); setOpen(false);
      q.refetch();
    } catch (e: any) { showAlert('Could not add them', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(false); }
  };
  const remove = (v: any) => showAlert(`Remove ${v.name}?`, "They won't be able to log in any more.", [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await apiService.removeViewer(v.id); q.refetch(); } catch (e: any) { showAlert('Could not remove', e?.response?.data?.detail || 'Try again.'); }
    } },
  ]);

  return (
    <View style={s.card} testID="admin-viewers">
      <View style={s.head}>
        <Ionicons name="eye-outline" size={18} color={c.primary} />
        <Text style={s.title}>Read-only viewers</Text>
      </View>
      <Text style={s.muted}>
        Someone who sees everything you see in the office (your own coach, say) but can't change anything. They log
        in with the email and password you set here; tell them the password yourself.
      </Text>
      {viewers.map((v) => (
        <View key={v.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{v.name}</Text>
            <Text style={s.small}>{v.email}</Text>
          </View>
          <Pressable onPress={() => remove(v)} hitSlop={6} accessibilityLabel={`Remove ${v.name}`}>
            <Ionicons name="trash-outline" size={18} color={c.textMuted} />
          </Pressable>
        </View>
      ))}
      {open ? (
        <View style={{ gap: 8 }}>
          <TextInput value={name} onChangeText={setName} placeholder="Their name" placeholderTextColor={c.textMuted} style={s.input} autoCapitalize="words" />
          <TextInput value={email} onChangeText={setEmail} placeholder="Their email" placeholderTextColor={c.textMuted} style={s.input}
            autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          <TextInput value={password} onChangeText={setPassword} placeholder="A password for them (8+ characters)" placeholderTextColor={c.textMuted}
            style={s.input} autoCapitalize="none" autoCorrect={false} />
          <View style={s.btnRow}>
            <Pressable onPress={() => setOpen(false)} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Cancel</Text></Pressable>
            <Pressable onPress={add} disabled={busy} style={s.btn} accessibilityRole="button" testID="viewer-add">
              {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
              <Text style={s.btnText}>Add viewer</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={s.ghost} accessibilityRole="button" testID="viewer-open">
          <Ionicons name="person-add-outline" size={15} color={c.primary} />
          <Text style={s.ghostText}>Add a viewer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  name: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, height: 42, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
  btnRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
