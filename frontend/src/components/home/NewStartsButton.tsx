/**
 * "Set up today's new starts" — a big button at the top of the Owner's Home
 * on BA Academy days (Monday and Tuesday, 13:30–16:00 UK time), the Owner's
 * call (26 Oct 2026). Opens /new-starts: the app's QR code, add a new start,
 * and who's signed in. Hidden for the rest of the day after "All done".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors, fonts } from '../../theme/ThemeContext';
import { ukNow } from '../../utils/fieldTime';
import { todayISO } from '../../utils/calendarDates';

export const NEW_STARTS_DONE_KEY = 'new-starts-done';

/** Monday or Tuesday, 13:30 until 16:00 UK time. */
export function inNewStartsWindow(at: Date = new Date()): boolean {
  const { day, mins } = ukNow(at);
  return (day === 1 || day === 2) && mins >= 13 * 60 + 30 && mins < 16 * 60;
}

export default function NewStartsButton() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const doneQ = useQuery({
    queryKey: ['new-starts-done'],
    queryFn: async () => {
      try { return (await AsyncStorage.getItem(NEW_STARTS_DONE_KEY)) || ''; } catch { return ''; }
    },
  });
  if (!inNewStartsWindow(now) || doneQ.data === todayISO(now)) return null;
  return (
    <Pressable onPress={() => router.push('/new-starts' as never)} style={s.card} accessibilityRole="button" testID="home-new-starts">
      <View style={s.icon}><Ionicons name="qr-code" size={28} color={c.onPrimary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title}>Set up today’s new starts</Text>
        <Text style={s.sub}>Show the app’s QR code, add each new start and give them their login</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={c.onPrimary} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.primary, borderRadius: 20, paddingVertical: 20, paddingHorizontal: 18, marginBottom: 12 },
  icon: { width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: c.onPrimary },
  sub: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.onPrimary, opacity: 0.9, marginTop: 2 },
});
