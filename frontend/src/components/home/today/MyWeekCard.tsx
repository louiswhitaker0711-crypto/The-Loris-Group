// "My week" on Home: this week's sign-ups against the traffic light (and
// your weekly goal when you've set one), from your own Bells row (tap for your numbers, Field KPIs).
// Quality has its own card at the top of Home the week a report lands (QualityNewCard).
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSurface } from '../../../theme/teamTheme';
import { useColors, fonts } from '../../../theme/ThemeContext';
import { apiService } from '../../../api/client';
import { ukNow } from '../../../utils/fieldTime';
import { weekBand, WEEK_BAND_LABELS, AMBER_WEEK_MIN, GREEN_WEEK_MIN, SUPER_GREEN_WEEK_MIN } from '../../../utils/weekBands';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// On the navy Home hero (Nov 2026 restyle): what each traffic light reads as.
const ON_NAVY = { red: '#ff8178', amber: '#ffc35c', green: '#6ee794', muted: '#8fa7c4', soft: '#b3c5da', text: '#ffffff', cyan: '#22d0ec' };
// A day's sign-ups on the Owner's daily lights: 0–1 red, 2 amber, 3 light green, 4+ green.
const dayTone = (v: number) => (v >= 4 ? '#30d158' : v === 3 ? ON_NAVY.green : v === 2 ? ON_NAVY.amber : ON_NAVY.red);

export default function MyWeekCard({ hideWhenEmpty = false, hero = false }: { hideWhenEmpty?: boolean; hero?: boolean }) {
  const c = useColors();
  const surface = useSurface();
  const s = useMemo(() => styles(c), [c]);
  const q = useQuery({ queryKey: ['my-bells-summary', 1], queryFn: () => apiService.getMyBellsSummary(1).then((r) => r.data), retry: false });
  const w = q.data?.this_week;
  if (!q.data || (hideWhenEmpty && !q.data.has_entry && !(w?.sign_ups))) return null;
  const n = Number(w?.sign_ups || 0);
  const band = weekBand(n);
  const next = n < AMBER_WEEK_MIN ? { at: AMBER_WEEK_MIN, name: 'Amber' } : n < GREEN_WEEK_MIN ? { at: GREEN_WEEK_MIN, name: 'Green' }
    : n < SUPER_GREEN_WEEK_MIN ? { at: SUPER_GREEN_WEEK_MIN, name: 'Super Green' } : null;
  const goal = Number(w?.weekly_goal || 0) || null;
  const scale = goal || next?.at || SUPER_GREEN_WEEK_MIN;
  const tone = band === 'red' ? c.red : band === 'amber' ? c.yellow : c.green;
  const pa = w?.days_worked ? (n / w.days_worked).toFixed(1) : null;
  // Monday to Saturday from your Bells row; what you need a day for the rest.
  const days: any[] = w?.days || [];
  const todayIdx = (ukNow().day + 6) % 7;   // Monday 0, in UK time
  const AWAY = ['ab', 'ns', 'rt', 'pc', 'nc'];
  const count = (d: any) => Number(d?.silver || 0) + Number(d?.gold || 0);
  const left = days.filter((d, i) => i > todayIdx || (i === todayIdx && count(d) === 0 && d?.status !== 'in'))
    .filter((d) => !AWAY.includes(d?.status)).length;
  const target = goal || next?.at || null;
  const perDay = target && left > 0 && target > n ? Math.ceil(((target - n) / left) * 10) / 10 : null;
  if (hero) {
    const heroTone = band === 'red' ? ON_NAVY.red : band === 'amber' ? ON_NAVY.amber : ON_NAVY.green;
    return (
      <Pressable onPress={() => router.push('/field-kpis' as never)} style={s.hero} accessibilityRole="button" testID="home-my-week">
        <View style={s.head}>
          <Text style={s.heroKicker}>MY WEEK</Text>
          <View style={s.heroBand}>
            <View style={[s.heroDot, { backgroundColor: heroTone }]} />
            <Text style={[s.heroBandText, { color: heroTone }]}>{WEEK_BAND_LABELS[band].name}</Text>
          </View>
        </View>
        <View style={s.heroRow}>
          <Text style={s.heroNum}>{n}</Text>
          <View style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
            <Text style={s.heroOf} numberOfLines={1}>{goal ? `of ${goal} sign-ups` : `sign-up${n === 1 ? '' : 's'} this week`}</Text>
            <Text style={[s.heroNext, { color: surface.accent }]} numberOfLines={1}>
              {next ? `${next.at - n} more for ${next.name}` : 'Top of the lights'}{pa ? ` · PA ${pa}` : ''}
            </Text>
          </View>
        </View>
        <View style={s.heroTrack}>
          <LinearGradient
            colors={[surface.team ? surface.soft : '#2864d9', surface.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[s.heroFill, { width: `${Math.min(100, Math.round((n / scale) * 100))}%` as any }]}
          />
        </View>
        {days.length > 0 && (
          <View style={s.days}>
            {DAY_SHORT.map((lbl, i) => {
              const d = days[i] || {};
              const away = AWAY.includes(d.status);
              const v = count(d);
              const isIn = d.status === 'in' || v > 0;
              return (
                <View key={lbl} style={[s.heroDay, i === todayIdx && [s.heroDayToday, { borderColor: surface.accent }]]}>
                  <Text style={s.heroDayLbl}>{lbl}</Text>
                  <Text style={[s.heroDayNum, away ? s.heroDayOff : isIn ? { color: dayTone(v) } : { color: ON_NAVY.muted }]}>
                    {away ? 'off' : isIn ? v : i < todayIdx ? '–' : '·'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        {perDay != null && (
          <Text style={s.heroNeed}>Need {perDay} a day for the {left} day{left === 1 ? '' : 's'} left to hit {goal ? `your goal of ${goal}` : next?.name}</Text>
        )}
      </Pressable>
    );
  }
  return (
    <View style={s.card}>
    <Pressable onPress={() => router.push('/field-kpis' as never)} style={{ gap: 6 }} accessibilityRole="button" testID="home-my-week">
      <View style={s.head}>
        <Text style={s.title}>My week</Text>
        <Text style={[s.band, { color: tone, borderColor: tone }]}>{WEEK_BAND_LABELS[band].name}</Text>
      </View>
      <Text style={s.line}>
        {n} sign-up{n === 1 ? '' : 's'}{goal ? ` of ${goal}` : ''}
        {next ? ` · ${next.at - n} more for ${next.name}` : ' · top of the lights'}
        {pa ? ` · PA ${pa}` : ''}
      </Text>
      <View style={s.track}><View style={[s.fill, { width: `${Math.min(100, Math.round((n / scale) * 100))}%` as any, backgroundColor: tone }]} /></View>
      {days.length > 0 && (
        <View style={s.days}>
          {DAY_SHORT.map((lbl, i) => {
            const d = days[i] || {};
            const away = AWAY.includes(d.status);
            const v = count(d);
            const isIn = d.status === 'in' || v > 0;
            return (
              <View key={lbl} style={[s.day, i === todayIdx && s.dayToday, away && s.dayAway]}>
                <Text style={s.dayLbl}>{lbl}</Text>
                <Text style={[s.dayNum, isIn && { color: c.text }]}>{away ? 'off' : isIn ? v : i < todayIdx ? '–' : '·'}</Text>
              </View>
            );
          })}
        </View>
      )}
      {perDay != null && (
        <Text style={s.need}>Need {perDay} a day for the {left} day{left === 1 ? '' : 's'} left to hit {goal ? `your goal of ${goal}` : next?.name}</Text>
      )}
    </Pressable>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 6, marginBottom: 12 },
  cardQ: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  band: { fontFamily: fonts.bodyBold, fontSize: 12, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, overflow: 'hidden' },
  line: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  track: { height: 7, borderRadius: 4, backgroundColor: c.surface, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  days: { flexDirection: 'row', gap: 5, marginTop: 4 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 9, backgroundColor: c.surface },
  dayToday: { borderWidth: 1.5, borderColor: c.primary },
  dayAway: { opacity: 0.5 },
  dayLbl: { fontFamily: fonts.body, fontSize: 11, color: c.textMuted },
  dayNum: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.textMuted },
  need: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text, marginTop: 2 },
  // Hero (on the navy Home band)
  hero: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  heroKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: ON_NAVY.soft },
  heroBand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroDot: { width: 8, height: 8, borderRadius: 3 },
  heroBandText: { fontFamily: fonts.bodyBold, fontSize: 12 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  heroNum: { fontFamily: fonts.displayBlack, fontSize: 56, lineHeight: 58, letterSpacing: -2, color: ON_NAVY.text },
  heroOf: { fontFamily: fonts.bodySemibold, fontSize: 15, color: '#d6e3f1' },
  heroNext: { fontFamily: fonts.bodyBold, fontSize: 13, color: ON_NAVY.cyan },
  heroTrack: { height: 6, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  heroFill: { height: '100%', borderRadius: 4 },
  heroDay: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', gap: 1 },
  heroDayToday: { borderWidth: 1.5, borderColor: ON_NAVY.cyan },
  heroDayLbl: { fontFamily: fonts.body, fontSize: 11, color: ON_NAVY.muted },
  heroDayNum: { fontFamily: fonts.displayBlack, fontSize: 18 },
  heroDayOff: { fontFamily: fonts.body, fontSize: 13, color: ON_NAVY.muted },
  heroNeed: { fontFamily: fonts.bodySemibold, fontSize: 13, color: '#d6e3f1' },
});
