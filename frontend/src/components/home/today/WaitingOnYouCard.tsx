// "Waiting on you" on a Coach's Home: grades due and COD checks people have
// asked for. Hidden when there's nothing.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';

export default function WaitingOnYouCard({ toGrade }: { toGrade: number }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const checks = useQuery({ queryKey: ['cod-checks'], queryFn: () => apiService.getPendingChecks().then((r) => r.data.checks), retry: false });
  const nChecks = (checks.data || []).length;
  if (!toGrade && !nChecks) return null;
  return (
    <View style={s.card} testID="home-waiting">
      <Text style={s.title}>Waiting on you</Text>
      <View style={s.row}>
        {toGrade > 0 && (
          <View style={s.chip}><Ionicons name="school-outline" size={15} color={c.primary} /><Text style={s.chipText}>{toGrade} day{toGrade === 1 ? '' : 's'} to grade</Text></View>
        )}
        {nChecks > 0 && (
          <Pressable onPress={() => router.push('/cod-checks' as never)} style={s.chip} accessibilityRole="button">
            <Ionicons name="checkmark-done-outline" size={15} color={c.primary} />
            <Text style={s.chipText}>{nChecks} COD check{nChecks === 1 ? '' : 's'}</Text>
            <Ionicons name="chevron-forward" size={13} color={c.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8, marginBottom: 12 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
});
