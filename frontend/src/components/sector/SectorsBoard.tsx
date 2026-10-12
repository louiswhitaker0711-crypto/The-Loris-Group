// The Sectors board: every sector in the office on a day, with each person's
// set-up and breakdown, goal against hit, and the WhatsApp text for each
// sector. Shown in the Performance Hub and at /sectors. (GET /sector/board)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';
import { todayISO } from '../../utils/calendarDates';
import { APP_LOCALE } from '../../utils/appTime';
import { openInWhatsApp, copyText } from '../../utils/whatsapp';

type Row = {
  user_id: string; user_name: string;
  setup: { goal: number | null; kpi?: string; focus?: string } | null;
  breakdown: { doors: number | null; spoken: number | null; pitched: number | null; closed: number | null;
    note?: string; goal: number | null; hit: number | null; proud?: string; change?: string } | null;
  live: { hit?: number };
};
type Sector = { leader_id: string; leader_name: string; people: Row[]; goal: number; hit: number;
  whatsapp: { setup: string; breakdown: string } };

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function label(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { weekday: 'long', day: 'numeric', month: 'short' });
}
const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';
const dash = (v: number | null | undefined) => (v == null ? '–' : String(v));

export function SectorsBoard({ bottomPad = 24 }: { bottomPad?: number }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const router = useRouter();
  const { user } = useAuth();
  const canRun = user?.role === 'leader' || user?.role === 'admin';
  const today = todayISO();
  const [date, setDate] = useState(today);
  const q = useQuery({ queryKey: ['sector-board', date], queryFn: () => apiService.getSectorBoard(date).then((r) => r.data) });
  const sectors: Sector[] = q.data?.sectors || [];
  const goal = sectors.reduce((a, x) => a + (x.goal || 0), 0);
  const hit = sectors.reduce((a, x) => a + (x.hit || 0), 0);

  const share = (t: string) => openInWhatsApp(t).catch(() => showAlert('WhatsApp', t));

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: bottomPad }]}>
      <View style={s.dateRow}>
        <Pressable onPress={() => setDate(addDays(date, -1))} style={s.iconBtn} accessibilityLabel="Day before" hitSlop={6}>
          <Ionicons name="chevron-back" size={18} color={c.text} />
        </Pressable>
        <Text style={s.dateText}>{date === today ? 'Today · ' : ''}{label(date)}</Text>
        <Pressable onPress={() => setDate(addDays(date, 1))} style={s.iconBtn} accessibilityLabel="Day after" hitSlop={6}>
          <Ionicons name="chevron-forward" size={18} color={c.text} />
        </Pressable>
      </View>

      {canRun && date === today && (
        <View style={s.row}>
          <Pressable onPress={() => router.push('/sector?start=1' as never)} style={s.btn} accessibilityRole="button" testID="board-start">
            <Ionicons name="rocket-outline" size={15} color={c.onPrimary} />
            <Text style={s.btnText}>My sector set-up</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/sector?mode=breakdown' as never)} style={s.ghost} accessibilityRole="button">
            <Ionicons name="create-outline" size={15} color={c.primary} />
            <Text style={s.ghostText}>My breakdown</Text>
          </Pressable>
        </View>
      )}

      {q.isLoading ? <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} /> : sectors.length === 0 ? (
        <View style={s.card}>
          <Text style={s.h}>No sectors yet</Text>
          <Text style={s.muted}>When a sector leader ticks who's in their sector, it shows here with everyone's set-up and breakdown.</Text>
        </View>
      ) : (
        <>
          <View style={s.totals}>
            <Text style={s.totalBig}>{hit}<Text style={s.totalSmall}> / {goal}</Text></Text>
            <Text style={s.muted}>sign-ups against goal · {sectors.length} sector{sectors.length === 1 ? '' : 's'}</Text>
          </View>
          {sectors.map((sec) => (
            <View key={sec.leader_id} style={s.card}>
              <View style={s.secHead}>
                <Text style={s.h} numberOfLines={1}>{sec.leader_name || 'Sector'}'s sector</Text>
                <Text style={[s.pill, sec.goal > 0 && sec.hit >= sec.goal && { backgroundColor: c.greenBg, color: c.green }]}>
                  {sec.hit}/{sec.goal}{sec.goal > 0 && sec.hit >= sec.goal ? ' 🔥' : ''}
                </Text>
              </View>
              {sec.people.map((p) => {
                const b = p.breakdown;
                const pg = b?.goal ?? p.setup?.goal;
                const ph = b?.hit ?? p.live?.hit ?? 0;
                return (
                  <View key={p.user_id} style={s.person}>
                    <View style={s.secHead}>
                      <Text style={s.name}>{first(p.user_name)}</Text>
                      <Text style={s.muted}>{pg != null ? `${ph}/${pg}` : `${ph} in`}{pg != null && pg > 0 && ph >= pg ? ' 🔥' : ''}</Text>
                    </View>
                    {p.setup ? (
                      <Text style={s.line}>
                        <Text style={s.tag}>Set-up </Text>
                        {[p.setup.goal != null ? `Goal ${p.setup.goal}` : '', p.setup.kpi ? `KPI ${p.setup.kpi}` : '', p.setup.focus ? `Focus: ${p.setup.focus}` : ''].filter(Boolean).join(' · ') || '—'}
                      </Text>
                    ) : <Text style={s.mutedSm}>No set-up yet</Text>}
                    {b ? (
                      <>
                        <Text style={s.line}>
                          <Text style={s.tag}>Breakdown </Text>
                          {`${dash(b.doors)}/${dash(b.spoken)}/${dash(b.pitched)}/${dash(b.closed)}`}{b.note ? ` (${b.note})` : ''}
                        </Text>
                        {!!b.proud && <Text style={s.line}><Text style={s.tag}>Proud of </Text>{b.proud}</Text>}
                        {!!b.change && <Text style={s.line}><Text style={s.tag}>Change </Text>{b.change}</Text>}
                      </>
                    ) : null}
                  </View>
                );
              })}
              <View style={s.row}>
                <Pressable onPress={() => share(sec.whatsapp.setup)} style={s.ghost} accessibilityRole="button">
                  <Ionicons name="logo-whatsapp" size={15} color={c.primary} />
                  <Text style={s.ghostText}>Share set-up</Text>
                </Pressable>
                <Pressable onPress={() => share(sec.whatsapp.breakdown)} style={s.ghost} accessibilityRole="button">
                  <Ionicons name="logo-whatsapp" size={15} color={c.primary} />
                  <Text style={s.ghostText}>Share breakdown</Text>
                </Pressable>
                <Pressable onPress={() => copyText(`${sec.whatsapp.setup}\n\n${sec.whatsapp.breakdown}`).then(() => toast.success('Copied'))}
                  style={s.ghost} accessibilityRole="button" accessibilityLabel="Copy both">
                  <Ionicons name="copy-outline" size={15} color={c.primary} />
                </Pressable>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  dateText: { fontFamily: fonts.bodySemibold, fontSize: 14.5, color: c.text },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  totals: { alignItems: 'center', gap: 2 },
  totalBig: { fontFamily: fonts.display, fontSize: 34, color: c.text },
  totalSmall: { fontFamily: fonts.display, fontSize: 20, color: c.textMuted },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  h: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: c.text, flexShrink: 1 },
  pill: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.text, backgroundColor: c.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  person: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, gap: 3 },
  name: { fontFamily: fonts.bodySemibold, fontSize: 14.5, color: c.text },
  line: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.text },
  tag: { fontFamily: fonts.bodySemibold, color: c.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  mutedSm: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
