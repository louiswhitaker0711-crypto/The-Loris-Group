// A banner on Home for the Owner only when OwnerIQ needs reconnecting. Tap to
// the reconnect screen. Hidden for everyone else and when connected.
// (GET /owneriq/connect — super-admin only)
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

export default function OwnerIQBanner() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const router = useRouter();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['owneriq-banner'],
    queryFn: () => apiService.getOwnerIQConnect().then((r) => r.data),
    enabled: !!user?.is_super_admin,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  if (!user?.is_super_admin || q.data?.state !== 'needs_reconnect') return null;
  return (
    <Pressable onPress={() => router.push('/owneriq-connect' as never)} style={s.card} accessibilityRole="button" testID="home-owneriq-banner">
      <Ionicons name="flash-outline" size={20} color={c.onPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>OwnerIQ needs reconnecting</Text>
        <Text style={s.sub}>Tap to paste a fresh session. Until then the team’s numbers come from the breakdowns.</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={c.onPrimary} />
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: c.red, marginBottom: 12 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  sub: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: c.onPrimary, opacity: 0.92 },
});
