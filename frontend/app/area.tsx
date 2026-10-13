// One postcode district: its totals, postcode sectors, streets (best first)
// and every day it was worked, with who was there. (GET /areas/district/{d})
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { AreaRow, shortDate, sinceText } from '../src/utils/areas';

type Street = AreaRow & { street: string; sector: string; city: string };
type Visit = { date: string; doors: number; sales: number; people: string[] };

export default function AreaScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const { d, days } = useLocalSearchParams<{ d?: string; days?: string }>();
  const q = useQuery({
    queryKey: ['area', d, days], enabled: !!d,
    queryFn: () => apiService.getAreaDistrict(String(d), days ? Number(days) : 186).then((r) => r.data),
  });
  const t: AreaRow | null = q.data?.total || null;
  const sectors: AreaRow[] = q.data?.sectors || [];
  const streets: Street[] = q.data?.streets || [];
  const visits: Visit[] = q.data?.visits || [];

  if (q.isLoading) return <View style={[s.page, s.center]}><ActivityIndicator color={c.primary} /></View>;

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={s.title}>{q.data?.district || d}</Text>
      {!t ? (
        <View style={s.card}><Text style={s.muted}>Not worked in these dates.</Text></View>
      ) : (
        <>
          <View style={s.tiles}>
            <Tile s={s} n={sinceText(t.days_since)} l={`last worked · ${shortDate(t.last_worked)}`} />
            <Tile s={s} n={String(t.per_100 ?? '–')} l="sign-ups per 100 doors" />
            <Tile s={s} n={String(t.pa ?? '–')} l="PA here" />
            <Tile s={s} n={`${t.doors}`} l={`doors over ${t.days} day${t.days === 1 ? '' : 's'}`} />
          </View>

          {sectors.length > 1 && (
            <View style={s.card}>
              <Text style={s.h}>Postcode sectors</Text>
              {sectors.map((r) => (
                <View key={r.key} style={s.row}>
                  <Text style={[s.name, { width: 64 }]}>{r.key}</Text>
                  <Text style={[s.muted, { flex: 1 }]}>{sinceText(r.days_since)} · {r.doors} doors · {r.sales} sign-ups</Text>
                  <Text style={s.num}>{r.per_100 ?? '–'}</Text>
                </View>
              ))}
              <Text style={s.small}>Right-hand number: sign-ups per 100 doors.</Text>
            </View>
          )}

          <View style={s.card}>
            <Text style={s.h}>Streets</Text>
            {streets.map((r, i) => (
              <View key={r.street + r.sector + i} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{r.street}</Text>
                  <Text style={s.muted}>{r.sector} · {sinceText(r.days_since)} · {r.doors} doors · {r.sales} sign-up{r.sales === 1 ? '' : 's'}</Text>
                </View>
                <Text style={s.num}>{r.per_100 ?? '–'}</Text>
              </View>
            ))}
          </View>

          <View style={s.card}>
            <Text style={s.h}>Days worked</Text>
            {visits.map((v) => (
              <View key={v.date} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{shortDate(v.date)}</Text>
                  <Text style={s.muted} numberOfLines={2}>{v.people.join(', ')}</Text>
                </View>
                <Text style={s.muted}>{v.doors} doors · {v.sales} sign-ups</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Tile({ s, n, l }: { s: any; n: string; l: string }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileNum} numberOfLines={1}>{n}</Text>
      <Text style={s.tileLab}>{l}</Text>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { fontFamily: fonts.display, fontSize: 28, color: c.text },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 12, gap: 2 },
  tileNum: { fontFamily: fonts.display, fontSize: 20, color: c.text },
  tileLab: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  card: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 12, gap: 4 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: c.border },
  name: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  num: { fontFamily: fonts.display, fontSize: 16, color: c.primary, minWidth: 36, textAlign: 'right' },
  muted: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted, marginTop: 4 },
});
