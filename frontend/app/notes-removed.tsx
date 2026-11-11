/**
 * Recently removed notes (route: /notes-removed) — the Owner, 3 Nov 2026,
 * after a BA lost her notes. Anything a planner save took out (a deleted
 * note, a cleared box, text that got shorter) is kept for 30 days; "Put it
 * back" returns it to the same day and box, adding under anything there now.
 * Your own, or (the Owner, from Admin → Recover notes) anyone in the office.
 * (GET /notes/removed, POST /notes/removed/restore)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { APP_LOCALE } from '../src/utils/appTime';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { toast } from '../src/utils/toast';

type Item = { history_id: string; week_ending: string; key: string; at: string; title: string; body: string; photos: string[] };

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function where(it: Item): string {
  const dayOf = (d: string) => {
    const end = new Date(`${it.week_ending}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() - (6 - Number(d)));
    return `${DAYS[Number(d)] || ''} ${end.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  };
  if (it.key === 'extra') return 'Extra notes';
  const parts = it.key.split(':');
  if (parts[0] === 'box') return `${dayOf(parts[1])} · ${parts[2].replace(/_/g, ' ')}`;
  if (parts[0] === 'note') return `${dayOf(parts[1])} · ${parts[2] === 'day' ? 'Day notes' : parts[2].replace(/_/g, ' ')}`;
  return '';
}

const when = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return iso; }
};

export default function NotesRemoved() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tabClear = useTabBarClearance();
  const qc = useQueryClient();
  const { user_id, name } = useLocalSearchParams<{ user_id?: string; name?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['notes-removed', user_id || 'me'],
    queryFn: async () => (await api.get('/notes/removed', { params: user_id ? { user_id } : {} })).data.items as Item[],
  });

  const putBack = async (it: Item) => {
    const id = it.history_id + it.key;
    setBusy(id);
    try {
      await api.post('/notes/removed/restore', { history_id: it.history_id, key: it.key, user_id: user_id || undefined });
      toast.success('Put back', `It’s in ${where(it)} again.`);
      qc.invalidateQueries({ queryKey: ['notes-removed'] });
      qc.invalidateQueries({ queryKey: ['notes-folder'] });
      qc.invalidateQueries({ queryKey: ['notes-list'] });
      qc.invalidateQueries({ queryKey: ['weekly-planner'] });
    } catch (e: any) {
      toast.error('Couldn’t put it back', typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'Try again.');
    } finally { setBusy(null); }
  };

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: name ? `${name}’s removed notes` : 'Recently removed' }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 32 + tabClear }]}>
        <View style={s.shell}>
          <Text style={s.small}>
            Notes taken out of {name ? `${name}’s` : 'your'} planner or deleted in Notes in the last 30 days, then they’re gone. Putting one back adds it to the same day and box, under anything there now.
          </Text>
          {q.isLoading ? <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} />
            : q.isError ? <Text style={s.small}>Couldn’t load these. Pull down or try again.</Text>
            : !q.data?.length ? <Text style={[s.small, { textAlign: 'center', marginTop: 24 }]}>Nothing removed.</Text>
            : q.data.map((it) => (
              <View key={it.history_id + it.key} style={s.card}>
                <Text style={s.kicker}>{where(it)} · removed after {when(it.at)}</Text>
                {!!it.title && <Text style={s.title}>{it.title}</Text>}
                {!!it.body && <Text style={s.body}>{it.body}</Text>}
                {it.photos?.length > 0 && (
                  <View style={s.photos}>{it.photos.map((p) => <Image key={p} source={{ uri: p }} style={s.photo} />)}</View>
                )}
                <Pressable onPress={() => putBack(it)} disabled={!!busy} style={s.btn} accessibilityRole="button" testID="note-put-back">
                  {busy === it.history_id + it.key ? <ActivityIndicator color={c.onPrimary} />
                    : <><Ionicons name="arrow-undo" size={16} color={c.onPrimary} /><Text style={s.btnT}>Put it back</Text></>}
                </Pressable>
              </View>
            ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.background },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 12 },
  card: { borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 14, gap: 8, backgroundColor: c.surface },
  kicker: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.textMuted },
  title: { fontFamily: fonts.bodySemibold, fontSize: 16, color: c.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: c.text },
  small: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted, lineHeight: 19 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 72, height: 72, borderRadius: 10, backgroundColor: c.background },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: 12, backgroundColor: c.primary, alignSelf: 'flex-start', paddingHorizontal: 16 },
  btnT: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.onPrimary },
});
