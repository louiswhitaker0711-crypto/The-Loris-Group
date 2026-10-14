// BAs: everyone you coach in one list (Admins and Coach+ the whole office,
// a Coach their own team), grouped by team, with a search. Tap someone for
// their page: COD, this week, quality and KPIs. (GET /people)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { APP_SHORT_NAME } from '../src/theme/brand';

type Person = { user_id: string; name: string; role: string; role_label: string; team: string; coach: string; badge_number: string };

export default function BAsScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [find, setFind] = useState('');
  const q = useQuery({ queryKey: ['people-list'], queryFn: () => apiService.listPeople().then((r) => r.data.people as Person[]) });

  const groups = useMemo(() => {
    const term = find.trim().toLowerCase();
    const rows = (q.data || []).filter((p) => !term || p.name.toLowerCase().includes(term) || (p.badge_number || '').toLowerCase().includes(term));
    const out: { team: string; people: Person[] }[] = [];
    for (const p of rows) {
      const team = p.team || `Mini ${APP_SHORT_NAME}`;
      let g = out.find((x) => x.team === team);
      if (!g) { g = { team, people: [] }; out.push(g); }
      g.people.push(p);
    }
    return out;
  }, [q.data, find]);

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;
  const total = (q.data || []).length;

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <View style={s.search}>
        <Ionicons name="search" size={17} color={c.textMuted} />
        <TextInput value={find} onChangeText={setFind} placeholder={`Find someone (${total})`} placeholderTextColor={c.textMuted}
          style={s.searchInput} autoCorrect={false} testID="bas-search" />
        {!!find && <Pressable onPress={() => setFind('')} hitSlop={8}><Ionicons name="close-circle" size={17} color={c.textMuted} /></Pressable>}
      </View>
      {groups.length === 0 && <Text style={s.muted}>{find ? 'Nobody matches that.' : 'Nobody to show yet.'}</Text>}
      {groups.map((g) => (
        <View key={g.team} style={{ gap: 6 }}>
          <Text style={s.heading}>{g.team} · {g.people.length}</Text>
          <View style={s.card}>
            {g.people.map((p, i) => (
              <Pressable key={p.user_id} onPress={() => router.push(`/person/${p.user_id}` as never)}
                style={[s.row, i > 0 && s.rowLine]} accessibilityRole="button" testID={`bas-${p.user_id}`}>
                <View style={s.avatar}><Text style={s.avatarText}>{(p.name || '?').trim().charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{p.name}</Text>
                  <Text style={s.muted} numberOfLines={1}>
                    {p.role_label}{p.coach ? ` · coach ${p.coach.split(' ')[0]}` : ''}{p.badge_number ? ` · ${p.badge_number}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  searchInput: { flex: 1, paddingVertical: 11, fontFamily: fonts.body, fontSize: 15, color: c.text },
  heading: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: c.textMuted },
  card: { borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11 },
  rowLine: { borderTopWidth: 1, borderTopColor: c.border },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.primary + '18', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary },
  name: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
});
