/**
 * PrimetimeNowCard: today's Primetime plan, published to everyone on Home
 * during Primetime (11:00–11:45 Monday to Friday, the Owner 2 Nov 2026).
 * The same triangles as the Primetime page, with where you are called out
 * at the top. Coaches can still move people; BAs see it read-only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors, fonts } from '../../theme/ThemeContext';
import { inPrimetime, planDayNow } from '../../utils/fieldTime';
import PrimetimeDayBoard from '../primetime/PrimetimeDayBoard';

export default function PrimetimeNowCard() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [on, setOn] = useState(() => inPrimetime());
  useEffect(() => {
    const t = setInterval(() => setOn(inPrimetime()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!on) return null;
  const { weekEnding, dayIndex } = planDayNow();
  if (dayIndex < 0 || dayIndex > 4) return null;
  return (
    <View style={s.card} testID="home-primetime-now">
      <Text style={s.h}>⚡ Primetime now · 11:00–11:45</Text>
      <PrimetimeDayBoard week={weekEnding} dayIndex={dayIndex} />
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, marginBottom: 14 },
  h: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.text },
});
