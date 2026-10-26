// Search at the top of Home: type part of a screen's name ("bells",
// "quality", "review") and jump straight there, so nothing has to be found
// in the sidebar. Only screens this role can open are listed.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { eligibleForRole } from '../../customization/tabRegistry';
import { hrefOf, PROFILE_ITEM } from '../../nav/navModel';

type Entry = { label: string; words: string; icon: any; href: string };
type R = 'trainee' | 'leader' | 'admin';

// Screens that aren't nav items but people look for by name.
const EXTRA: Array<{ label: string; words?: string; icon: any; href: string; roles: R[] }> = [
  { label: 'Bells', words: 'sign-ups roll call sheet', icon: 'notifications-outline', href: '/bells', roles: ['trainee', 'leader', 'admin'] },
  { label: 'Weekly Review', words: 'monday review last week office', icon: 'stats-chart-outline', href: '/weekly-review', roles: ['admin'] },
  { label: 'Team Planners', words: 'plans weekly monthly coaches', icon: 'people-outline', href: '/monthly-planner-team', roles: ['leader', 'admin'] },
  { label: 'My week', words: 'weekly plan goal schedule', icon: 'calendar-outline', href: '/ba-week', roles: ['trainee'] },
  { label: 'Plan sectors', words: 'sectors postcodes', icon: 'compass-outline', href: '/sector-plan', roles: ['leader', 'admin'] },
  { label: 'Coaching', words: 'primetime cod focus', icon: 'school-outline', href: '/coaching', roles: ['leader', 'admin'] },
  { label: 'COD checks', words: 'sign off cod', icon: 'checkmark-done-outline', href: '/cod-checks', roles: ['leader', 'admin'] },
  { label: 'Paste from WhatsApp', words: 'bells paste report', icon: 'clipboard-outline', href: '/bells-paste', roles: ['leader', 'admin'] },
  { label: 'Bulletins', words: 'share top 5', icon: 'megaphone-outline', href: '/share-bulletins', roles: ['leader', 'admin'] },
];

export default function HomeSearch() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const { user } = useAuth();
  const role = (user?.role || 'trainee') as R;
  const [q, setQ] = useState('');

  const all: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const it of [...eligibleForRole(role as any), PROFILE_ITEM]) {
      if (it.id === 'home') continue;
      out.push({ label: it.label, words: `${it.longLabel || ''}`.toLowerCase(), icon: it.icon, href: hrefOf(it) });
    }
    for (const e of EXTRA) {
      if (e.roles.includes(role) && !out.some((o) => o.href === e.href)) {
        out.push({ label: e.label, words: (e.words || '').toLowerCase(), icon: e.icon, href: e.href });
      }
    }
    return out;
  }, [role]);

  const term = q.trim().toLowerCase();
  const hits = term
    ? all.filter((e) => e.label.toLowerCase().includes(term) || e.words.includes(term)).slice(0, 6)
    : [];

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Ionicons name="search" size={17} color={c.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search the app (Bells, Quality, Review…)"
          placeholderTextColor={c.textMuted}
          style={s.input}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={() => { if (hits[0]) { setQ(''); router.push(hits[0].href as never); } }}
          testID="home-search"
        />
        {!!q && (
          <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={17} color={c.textMuted} /></Pressable>
        )}
      </View>
      {term.length > 0 && (
        <View style={s.list}>
          {hits.length === 0 ? <Text style={s.none}>Nothing called that.</Text> : hits.map((h) => (
            <Pressable key={h.href} style={s.row} onPress={() => { setQ(''); router.push(h.href as never); }} accessibilityRole="button">
              <Ionicons name={h.icon} size={17} color={c.primary} />
              <Text style={s.rowTxt}>{h.label}</Text>
              <Ionicons name="chevron-forward" size={15} color={c.textMuted} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  wrap: { marginBottom: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: c.text, paddingVertical: 0 },
  list: { marginTop: 6, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  rowTxt: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  none: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted, padding: 12 },
});
