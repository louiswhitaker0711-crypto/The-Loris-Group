// Who was on an exited person's team (the Owner, 2 Nov 2026). Past weeks on
// Bells show teams as they stood; for exits from before the app kept team
// history, tick who was directly on their team so earlier weeks show it again.
// (backend routes/team_history.py)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';

function ukDate(iso: string) {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export default function PastTeamsCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exited-teams'], queryFn: () => apiService.exitedTeams().then((r) => r.data), retry: false });
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const exited = q.data?.exited || [];
  const people = q.data?.people || [];
  if (!exited.length) return null;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name || 'Someone';

  const open = (id: string, team: string[]) => { setOpenId(id); setPicked(new Set(team)); };
  const toggle = (id: string) => setPicked((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const save = async (id: string) => {
    setBusy(true);
    try {
      await apiService.setPastTeam(id, Array.from(picked));
      toast.success('Saved. Past weeks show their team again');
      setOpenId(null);
      q.refetch();
      qc.invalidateQueries({ queryKey: ['bells'] });
    } catch (e: any) { showAlert('Could not save', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <View style={s.card} testID="admin-past-teams">
      <View style={s.head}>
        <Ionicons name="git-branch-outline" size={18} color={c.primary} />
        <Text style={s.title}>Exited leaders' teams</Text>
      </View>
      <Text style={s.muted}>
        Past weeks on Bells show teams as they were. Tick who was directly on someone's team when they left, so
        weeks before their exit show that team. Anyone sub-teamed under those people comes with them.
      </Text>
      {exited.map((x) => (
        <View key={x.id} style={s.row}>
          <View style={s.rowHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{x.name}</Text>
              <Text style={s.small}>
                Exited {ukDate(x.left_on)} · {x.team.length ? x.team.map(nameOf).join(', ') : 'no team recorded'}
              </Text>
            </View>
            {openId !== x.id && (
              <Pressable onPress={() => open(x.id, x.team)} style={s.ghost} accessibilityRole="button">
                <Text style={s.ghostText}>{x.team.length ? 'Change' : 'Who was on it?'}</Text>
              </Pressable>
            )}
          </View>
          {openId === x.id && (
            <View style={{ gap: 6 }}>
              <View style={s.chips}>
                {people.map((p) => {
                  const on = picked.has(p.id);
                  return (
                    <Pressable key={p.id} onPress={() => toggle(p.id)} style={[s.chip, on && s.chipOn]}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      {on && <Ionicons name="checkmark" size={13} color={c.onPrimary} />}
                      <Text style={[s.chipText, on && { color: c.onPrimary }]}>{p.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={s.btnRow}>
                <Pressable onPress={() => setOpenId(null)} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Cancel</Text></Pressable>
                <Pressable onPress={() => save(x.id)} disabled={busy} style={s.btn} accessibilityRole="button">
                  {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
                  <Text style={s.btnText}>Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  row: { gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  btnRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
