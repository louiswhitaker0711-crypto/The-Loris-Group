// Library: everything to learn from, in one place (the Owner, 29 Oct 2026).
// Campaign Knowledge, the Training Manual and the Coaching library used to be
// three separate menu items; the BA Academy workbooks were only on Home for
// new starts. Each folder opens the screen it always was.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';

type Folder = { key: string; title: string; sub: string; icon: React.ComponentProps<typeof Ionicons>['name']; route: string };

const FOLDERS: Folder[] = [
  { key: 'campaign', title: 'Campaign Knowledge', sub: 'The product, the pitch, the playbook and the quiz', icon: 'library-outline', route: '/product-knowledge' },
  { key: 'manual', title: 'Training Manual', sub: 'The manual, assessments, modules and KPIs', icon: 'book-outline', route: '/(tabs)/manual' },
  { key: 'coaching', title: 'Coaching library', sub: 'Coaching resources, in folders', icon: 'people-outline', route: '/coaching?tab=library&only=1' },
  { key: 'academy1', title: 'BA Academy · Day 1', sub: 'The Day 1 workbook', icon: 'school-outline', route: '/academy/1' },
  { key: 'academy2', title: 'BA Academy · Day 2', sub: 'The Day 2 workbook and the final quiz', icon: 'school-outline', route: '/academy/2' },
];

export default function LibraryScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <Pressable onPress={() => router.push('/pitch' as never)} style={s.pitch} accessibilityRole="button" testID="library-pitch">
        <Ionicons name="mic-outline" size={20} color={c.onPrimary} />
        <Text style={s.pitchText}>Your pitch</Text>
        <Ionicons name="chevron-forward" size={18} color={c.onPrimary} />
      </Pressable>
      <View style={s.card}>
        {FOLDERS.map((f, i) => (
          <Pressable key={f.key} onPress={() => router.push(f.route as never)} style={[s.row, i > 0 && s.rowLine]}
            accessibilityRole="button" testID={`library-${f.key}`}>
            <View style={s.icon}><Ionicons name={f.icon} size={20} color={c.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{f.title}</Text>
              <Text style={s.sub} numberOfLines={2}>{f.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 14, width: '100%', maxWidth: 680, alignSelf: 'center' },
  pitch: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 52, borderRadius: 14, backgroundColor: c.primary },
  pitchText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 16, color: c.onPrimary },
  card: { borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 14, minHeight: 64 },
  rowLine: { borderTopWidth: 1, borderTopColor: c.border },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${c.primary}14` },
  title: { fontFamily: fonts.bodySemibold, fontSize: 15.5, color: c.text },
  sub: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted, marginTop: 2 },
});
