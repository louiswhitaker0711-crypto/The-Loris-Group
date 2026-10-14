// The last field day's sectors on one screen, to plan the next from (Plan
// sectors, and Sector → Yesterday's recap): every street marked worked that
// day on one map in black, then each sector's goal and hit, its bunny hops,
// and everyone's numbers and breakdown. (GET /sector/recap)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { loadLeaflet, OSM_TILES, OSM_ATTRIBUTION } from '../../utils/leaflet';
import { hopHex, hopLabel } from '../../utils/hopColours';

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

function WorkedMap({ lines, height = 300 }: { lines: number[][][]; height?: number }) {
  const c = useColors();
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el) return;
      if (map.current) { map.current.remove(); map.current = null; }
      const m = L.map(el, { scrollWheelZoom: false }).setView([53.7, -1.5], 10);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      for (const line of lines) L.polyline(line, { color: '#000', weight: 4, opacity: 0.85, interactive: false }).addTo(m);
      const pts = lines.flat();
      if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [16, 16], maxZoom: 17 });
      map.current = m;
      setTimeout(() => m.invalidateSize(), 200);
    }).catch(() => {});
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; } };
  }, [lines]);
  if (Platform.OS !== 'web') return null;
  return <View ref={box} style={{ height, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.border }} />;
}

export default function SectorRecap({ date, collapsible = false, defaultOpen = true }: { date?: string; collapsible?: boolean; defaultOpen?: boolean }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const q = useQuery({ queryKey: ['sector-recap', date || 'last'], queryFn: () => apiService.getSectorRecap(date).then((r) => r.data), retry: false });
  const d = q.data;
  if (!d) return null;
  const sectors: any[] = d.sectors || [];
  if (!sectors.length && !(d.lines || []).length) {
    return collapsible ? null : <Text style={s.muted}>No sectors on {d.label}.</Text>;
  }

  return (
    <View style={s.wrap} testID="sector-recap">
      <Pressable onPress={() => collapsible && setOpen(!open)} style={s.head} accessibilityRole={collapsible ? 'button' : undefined}>
        <Text style={s.title}>📋 {d.label}'s sectors</Text>
        {collapsible && <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />}
      </Pressable>
      {open && (
        <View style={{ gap: 12 }}>
          {(d.lines || []).length > 0
            ? <View style={{ gap: 4 }}><WorkedMap lines={d.lines} /><Text style={s.small}>Everything marked worked on {d.label}, every sector, in black.</Text></View>
            : <Text style={s.muted}>No streets were marked worked that day.</Text>}
          {sectors.map((sec) => (
            <View key={sec.leader_id} style={s.sector}>
              <View style={s.secHead}>
                <View style={{ flex: 1 }}>
                  <Text style={s.code}>{sec.postcode || 'No postcode'}</Text>
                  <Text style={s.muted}>{first(sec.leader_name)}'s sector{sec.breakdown_posted_at ? ' · breakdown posted' : ''}</Text>
                </View>
                <View style={s.goalPill}>
                  <Text style={s.goalNum}>{sec.hit}{sec.goal != null ? `/${sec.goal}` : ''}</Text>
                  <Text style={s.small}>{sec.goal != null ? 'hit / goal' : 'sign-ups'}</Text>
                </View>
              </View>
              {(sec.hops || []).length > 0 && (
                <View style={s.hops}>
                  {sec.hops.map((h: any) => (
                    <View key={h.colour} style={s.hop}>
                      <View style={[s.dot, { backgroundColor: hopHex(h.colour) }]} />
                      <Text style={s.hopText}>{hopLabel(h.colour)}: {h.names.map(first).join(' & ') || '–'}</Text>
                    </View>
                  ))}
                </View>
              )}
              {sec.people.map((p: any) => {
                const b = p.breakdown;
                const nums = b && [b.doors, b.spoken, b.pitched, b.closed].some((v: any) => v != null)
                  ? [b.doors, b.spoken, b.pitched, b.closed].map((v: any) => (v == null ? '-' : v)).join('/') : '';
                const tiers = b && (b.silver != null || b.gold != null) ? `🥈${b.silver ?? 0} 🥇${b.gold ?? 0} ⭕️${b.round ?? 0}` : '';
                return (
                  <View key={p.user_id} style={s.person}>
                    <View style={s.personTop}>
                      {p.hop ? <View style={[s.dot, { backgroundColor: hopHex(p.hop) }]} /> : null}
                      <Text style={s.name}>{first(p.name)}</Text>
                      <View style={s.pills}>
                        {b ? <View style={s.pill}><Text style={s.pillText}>{b.hit ?? 0} of {p.goal ?? '-'}</Text></View> : null}
                        {nums ? <View style={s.pill}><Text style={s.pillText}>{nums}</Text></View> : null}
                        {tiers ? <View style={s.pill}><Text style={s.pillText}>{tiers}</Text></View> : null}
                      </View>
                    </View>
                    {b ? (
                      <Text style={s.line}>
                        {b.proud ? `Proud: ${b.proud}` : ''}{b.proud && b.change ? ' · ' : ''}{b.change ? `Change: ${b.change}` : ''}
                        {b.note ? `${b.proud || b.change ? ' · ' : ''}${b.note}` : ''}
                      </Text>
                    ) : <Text style={[s.line, { fontStyle: 'italic' }]}>No breakdown</Text>}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  wrap: { gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted },
  sector: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: { fontFamily: fonts.bodyBold, fontSize: 18, color: c.text },
  goalPill: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: c.primary + '14' },
  goalNum: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.primary },
  hops: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  hop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hopText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  person: { gap: 3, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: c.surface },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.text },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  pillText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.text },
  line: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
});
