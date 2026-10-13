// Area history: every postcode district the office has knocked, from
// OwnerIQ's door logs. Sort by most recent, best (sign-ups per 100 doors) or
// most rested. Tap a district for its postcode sectors, streets and visits.
// (backend routes/areas.py)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { PillTabs } from '../src/components/ui/PillTabs';
import { AreaRow, shortDate, sinceText, matchesDistrict } from '../src/utils/areas';

type Sort = 'recent' | 'best' | 'rested';
const RANGES = [{ key: '28', label: '4 weeks' }, { key: '56', label: '8 weeks' }, { key: '120', label: '4 months' }, { key: '186', label: '6 months' }];

export default function AreasScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [days, setDays] = useState('56');
  const [sort, setSort] = useState<Sort>('recent');
  const [find, setFind] = useState('');
  const q = useQuery({ queryKey: ['areas', days], queryFn: () => apiService.getAreas(Number(days)).then((r) => r.data) });

  const rows: AreaRow[] = useMemo(() => {
    const all: AreaRow[] = q.data?.districts || [];
    const list = all.filter((r) => matchesDistrict(r.key, find));
    const by = [...list];
    if (sort === 'best') by.sort((a, b) => (b.per_100 ?? -1) - (a.per_100 ?? -1) || b.doors - a.doors);
    if (sort === 'rested') by.sort((a, b) => (b.days_since ?? -1) - (a.days_since ?? -1));
    return by;
  }, [q.data, sort, find]);

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        Where the office has knocked, from OwnerIQ's door logs. "Per 100 doors" compares areas fairly however much work they got.
      </Text>
      <PillTabs fit items={RANGES} value={days} onChange={setDays} />
      <PillTabs fit items={[{ key: 'recent', label: 'Most recent' }, { key: 'best', label: 'Best' }, { key: 'rested', label: 'Most rested' }]}
        value={sort} onChange={(k) => setSort(k as Sort)} />
      <TextInput value={find} onChangeText={setFind} placeholder="Find a postcode, like LS6" placeholderTextColor={c.textMuted}
        autoCapitalize="characters" style={s.input} accessibilityLabel="Find a postcode" />

      {q.isLoading ? <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} /> : rows.length === 0 ? (
        <View style={s.card}>
          <Text style={s.h}>{find ? 'Not worked in this period' : 'No area history yet'}</Text>
          <Text style={s.muted}>
            {find ? 'Nobody has knocked there in the dates chosen. Try a longer range.'
              : "It fills in from OwnerIQ's door logs as days are saved. The last few weeks are added one day at a time."}
          </Text>
        </View>
      ) : rows.map((r) => (
        <Pressable key={r.key} onPress={() => router.push(`/area?d=${encodeURIComponent(r.key)}&days=${days}` as never)}
          style={s.card} accessibilityRole="button" testID={`area-${r.key}`}>
          <View style={s.head}>
            <Text style={s.code}>{r.key}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.line}>Last worked {sinceText(r.days_since)} · {shortDate(r.last_worked)}</Text>
              <Text style={s.muted}>{r.days} day{r.days === 1 ? '' : 's'} · {r.doors} doors · {r.sales} sign-up{r.sales === 1 ? '' : 's'}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statNum}>{r.per_100 ?? '–'}</Text>
              <Text style={s.statLab}>per 100</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
          </View>
        </Pressable>
      ))}
      {!!q.data?.covered_from && <Text style={s.small}>Door logs from {shortDate(q.data.covered_from)} onwards.</Text>}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 10, width: '100%', maxWidth: 720, alignSelf: 'center' },
  card: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 12, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { fontFamily: fonts.display, fontSize: 20, color: c.text, minWidth: 58 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  line: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted, textAlign: 'center' },
  stat: { alignItems: 'center', minWidth: 52 },
  statNum: { fontFamily: fonts.display, fontSize: 18, color: c.primary },
  statLab: { fontFamily: fonts.body, fontSize: 11, color: c.textMuted },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, height: 42, fontFamily: fonts.body, fontSize: 15, color: c.text, backgroundColor: c.surface },
});
