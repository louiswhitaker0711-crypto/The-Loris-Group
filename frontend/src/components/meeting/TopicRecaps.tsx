// "Meeting recaps on this topic": published recaps tagged with one COD topic
// that this person can read. Renders nothing when there are none.
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { APP_LOCALE } from '../../utils/appTime';

type Recap = { id: string; block_id: string; block_title: string; title?: string; date: string };

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : iso;
}

export function TopicRecaps({ topicId }: { topicId: string }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({
    queryKey: ['meeting-recaps', 'topic', topicId],
    queryFn: () => apiService.meetingRecapLibrary(topicId).then((r) => (r.data?.recaps || []) as Recap[]),
    enabled: !!topicId,
  });
  const list = q.data || [];
  if (!list.length) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.label}>MEETING RECAPS ON THIS TOPIC</Text>
      {list.slice(0, 10).map((r) => (
        <Pressable key={r.id} style={s.row} accessibilityRole="button"
          onPress={() => router.push(`/meeting-notes?block_id=${encodeURIComponent(r.block_id)}&date=${r.date}` as any)}>
          <Ionicons name="document-text-outline" size={17} color={c.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{r.title || r.block_title}</Text>
            <Text style={s.meta}>{shortDate(r.date)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  wrap: { marginTop: 18, gap: 8 },
  label: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  title: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  meta: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted, marginTop: 1 },
});
