// Everything on Home that isn't about today, folded away under "More".
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../../theme/ThemeContext';

export default function MoreSection({ children, startOpen = false }: { children: React.ReactNode; startOpen?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState(startOpen);
  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} style={s.toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} testID="home-more">
        <View style={s.rule} />
        <Text style={s.text}>{open ? 'Less' : 'More'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={c.textMuted} />
        <View style={s.rule} />
      </Pressable>
      {open && <View>{children}</View>}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  rule: { flex: 1, height: 1, backgroundColor: c.border },
  text: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.textMuted },
});
