// The top of a new start's Home: which day of their first weeks it is, what
// today is about and what good looks like today (the office's day targets).
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { journeyDayOf, dayTargetChips } from '../../../utils/dayTargets';

export default function NewStartTodayHero({ day, target, coach }: { day: number; target: any; coach?: string | null }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const obj: string = target?.day_objective || '';
  // "Practical Learning Day — shadow the pitch, …" → headline + the rest.
  const [head, ...rest] = obj.split(/\s+[—–-]\s+/);
  const chips = dayTargetChips(target);
  return (
    <Pressable onPress={() => router.push('/assessments' as never)} style={s.card} accessibilityRole="button" testID="home-today-hero">
      <Text style={s.kicker}>{journeyDayOf(day)}{coach ? ` · Coach: ${coach.split(' ')[0]}` : ''}</Text>
      <Text style={s.title}>{rest.length ? `Today: ${rest.join(' — ')}` : head || 'Today'}</Text>
      {rest.length > 0 && !!head && <Text style={s.sub}>{head}</Text>}
      {chips.length > 0 && (
        <>
          <Text style={s.label}>What good looks like today</Text>
          <View style={s.chips}>{chips.map((t) => <Text key={t} style={s.chip}>{t}</Text>)}</View>
        </>
      )}
      <View style={s.more}><Text style={s.moreText}>Your first weeks</Text><Ionicons name="chevron-forward" size={14} color={c.onPrimary} /></View>
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.primary, borderRadius: 18, padding: 16, gap: 6, marginBottom: 12 },
  kicker: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.onPrimary, opacity: 0.85 },
  title: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.onPrimary },
  sub: { fontFamily: fonts.body, fontSize: 13, color: c.onPrimary, opacity: 0.85 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.onPrimary, opacity: 0.85, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.onPrimary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-end', marginTop: 4 },
  moreText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.onPrimary },
});
