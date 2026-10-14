// The last field day's sectors: worked map, hops, numbers and breakdowns.
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../src/theme/ThemeContext';
import SectorRecap from '../src/components/sector/SectorRecap';

export default function SectorRecapScreen() {
  const c = useColors();
  const s = useMemo(() => StyleSheet.create({
    page: { flex: 1, backgroundColor: c.page },
    scroll: { padding: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  }), [c]);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined;
  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <SectorRecap date={date} />
    </ScrollView>
  );
}
