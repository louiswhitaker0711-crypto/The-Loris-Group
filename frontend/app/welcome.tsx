/**
 * Welcome (route: /welcome). The Owner's call (26 Oct 2026): the first thing
 * a new start sees — what we look for in people and our core values — before
 * their Day 1 workbook. Opens once by itself on a new start's Home (Days 1-2);
 * reachable again from the workbook.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { router } from 'expo-router';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { APP_NAME, ORG_NAME } from '../src/theme/brand';
import { useAuth } from '../src/auth/AuthContext';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { LOOK_FOR, CORE_VALUES } from '../src/academy/values';

export default function WelcomeScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const tabClear = useTabBarClearance();
  const first = ((user as any)?.name || '').trim().split(/\s+/)[0];
  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: 40 + tabClear }]}>
      <View style={s.shell}>
        <Image source={require('../assets/images/icon.png')} style={s.logo} />
        <Text style={s.kicker}>{ORG_NAME}</Text>
        <Text style={s.h1}>Welcome{first ? `, ${first}` : ''}</Text>
        <Text style={s.body}>You impressed us to get here. Before we start, this is what we look for in people, and the values everything we do is built on.</Text>

        <Text style={s.h2}>What we look for</Text>
        <View style={s.lookRow}>
          {LOOK_FOR.map((v, i) => (
            <View key={v.title} style={s.look}>
              <Text style={s.lookN}>{i + 1}</Text>
              <Text style={s.lookT}>{v.title}</Text>
              <Text style={s.small}>{v.text}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Our core values</Text>
        <View style={s.values}>
          {CORE_VALUES.map((v, i) => (
            <View key={v.title} style={[s.value, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={s.valueT}>{v.title}</Text>
              <Text style={s.small}>{v.text}</Text>
            </View>
          ))}
        </View>

        <Pressable onPress={() => router.replace('/academy/1' as never)} style={s.btn} accessibilityRole="button" testID="welcome-start">
          <Text style={s.btnText}>Open my Day 1 workbook</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)' as never)} accessibilityRole="button">
          <Text style={s.link}>Go to {APP_NAME} home</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 20, paddingTop: 36 },
  shell: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 14 },
  logo: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#ffffff', alignSelf: 'center' },
  kicker: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted, textAlign: 'center' },
  h1: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: c.text, textAlign: 'center' },
  h2: { fontFamily: fonts.display, fontSize: 21, color: c.text, marginTop: 10 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: c.textMuted, textAlign: 'center' },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.textMuted },
  lookRow: { gap: 10 },
  look: { backgroundColor: c.ink, borderRadius: 16, padding: 16, gap: 4 },
  lookN: { fontFamily: fonts.monoSemibold, fontSize: 12, color: c.markOnInk },
  lookT: { fontFamily: fonts.display, fontSize: 19, color: c.inkText },
  values: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingHorizontal: 16 },
  value: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: c.border, gap: 3 },
  valueT: { fontFamily: fonts.bodySemibold, fontSize: 16, color: c.text },
  btn: { backgroundColor: c.primary, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.onPrimary },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary, textAlign: 'center', paddingVertical: 6 },
});
