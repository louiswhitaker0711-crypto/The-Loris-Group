/** Badges — the ID badge maker. Opened from Admin (Office tools); one person's
 *  badge is also made and printed from their own page (app/person/[id].tsx).
 *  When the office uses its own badge maker (BADGE_MAKER_URL in
 *  src/theme/brand.ts), this page just points there. */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../src/theme/ThemeContext';
import BadgeStudio from '../src/components/badges/BadgeStudio';
import { openBadgeMaker, usesExternalBadgeMaker } from '../src/utils/openBadgeMaker';

function ExternalBadgeMaker() {
  const colors = useColors();
  return (
    <View style={[styles.page, { backgroundColor: colors.page }]}>
      <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Ionicons name="ribbon-outline" size={28} color={colors.primary} />
        <Text style={[styles.title, { color: colors.text }]}>ID badges</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Badges are made in your campaign badge maker, which prints the approved design. Each person's badge
          number still goes on their card in Admin: that is what links them to their OwnerIQ numbers.
        </Text>
        <Pressable onPress={openBadgeMaker} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button" testID="open-badge-maker">
          <Ionicons name="open-outline" size={16} color={colors.onPrimary} />
          <Text style={[styles.btnText, { color: colors.onPrimary }]}>Open badge maker</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function BadgesScreen() {
  return usesExternalBadgeMaker ? <ExternalBadgeMaker /> : <BadgeStudio />;
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 480, borderRadius: 16, borderWidth: 1, padding: 20, gap: 10, alignItems: 'flex-start' },
  title: { fontFamily: fonts.display, fontSize: 20 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, marginTop: 6 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
