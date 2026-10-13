// Today's sector map, for everyone in the sector (the Share button's push
// opens it). Mark off streets as you finish them; the sector leader confirms
// at the end of the day. (components/sector/SectorMap.tsx)
import React, { useMemo } from 'react';
import { Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { todayISO } from '../src/utils/calendarDates';
import { SectorMap } from '../src/components/sector/SectorMap';

export default function SectorMapScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const { date, leader } = useLocalSearchParams<{ date?: string; leader?: string }>();
  const day = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : todayISO();
  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <Text style={s.muted}>Tap "Mark off streets", then tap along each street as you finish it. Your sector leader checks the map and confirms it at the end of the day.</Text>
      <SectorMap date={day} leaderId={leader || undefined} height={460} />
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 820, alignSelf: 'center' },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
});
