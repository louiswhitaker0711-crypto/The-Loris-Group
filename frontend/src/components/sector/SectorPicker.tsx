// "Who's in your sector?" — tick people from the office. Someone already in
// another leader's sector today is marked; picking them moves them to yours.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';
import { useAuth } from '../../auth/AuthContext';

type P = { user_id: string; user_name: string; role: string; in_sector_of?: string | null };

export function SectorPicker({ date, current, startOpen, onSaved }: { date: string; current: string[] | null; startOpen: boolean; onSaved: () => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const [open, setOpen] = useState(startOpen);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>(current && current.length ? current : user?.id ? [String(user.id)] : []);
  const [busy, setBusy] = useState(false);
  const roster = useQuery({ queryKey: ['sector-roster', date], queryFn: () => apiService.getSectorRoster(date).then((r) => r.data), enabled: open });
  const people: P[] = roster.data?.people || [];
  const shown = people.filter((p) => p.user_name.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));

  const save = async () => {
    if (!picked.length) return;
    setBusy(true);
    try {
      await apiService.saveMySector(date, picked);
      toast.success('Sector saved');
      setOpen(false);
      onSaved();
    } catch (e: any) { showAlert('Could not save', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.card}>
      <Pressable onPress={() => setOpen(!open)} style={s.head} accessibilityRole="button">
        <Ionicons name="people-outline" size={18} color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.h}>Who's in your sector?</Text>
          <Text style={s.muted}>{current && current.length ? `${current.length} people · tap to change` : 'Pick who you’re taking out today'}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
      </Pressable>
      {open && (
        <View style={{ gap: 8 }}>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search the office" placeholderTextColor={c.textMuted} style={s.input} />
          {roster.isLoading ? <ActivityIndicator color={c.primary} /> : shown.map((p) => {
            const on = picked.includes(p.user_id);
            return (
              <Pressable key={p.user_id} onPress={() => toggle(p.user_id)} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.primary : c.textMuted} />
                <Text style={s.name}>{p.user_name}</Text>
                {!!p.in_sector_of && <Text style={s.tag}>with {p.in_sector_of.split(' ')[0]}</Text>}
              </Pressable>
            );
          })}
          <Pressable onPress={save} disabled={busy || !picked.length} style={[s.btn, (busy || !picked.length) && { opacity: 0.5 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
            <Text style={s.btnText}>Save sector ({picked.length})</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.primary, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  name: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: c.text },
  tag: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary, alignSelf: 'flex-start' },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
});
