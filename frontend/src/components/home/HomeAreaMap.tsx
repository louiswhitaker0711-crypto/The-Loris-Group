// "Your area today" — the first thing on Home once someone's been given a map:
// the sector map zoomed in to the streets drawn in their bunny hop's colour
// (or the whole sector's plan if they're not in a hop), with what's been done
// and what's worked. A still snapshot; tap it to open the full map and draw.
// Hidden until there's a planned area for them. (GET /sector/map)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { todayISO } from '../../utils/calendarDates';
import { loadLeaflet, OSM_TILES, OSM_ATTRIBUTION } from '../../utils/leaflet';
import { hopHex, hopLabel } from '../../utils/hopColours';

export default function HomeAreaMap() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const today = todayISO();
  const q = useQuery({
    queryKey: ['home-area-map', today],
    queryFn: () => apiService.getSectorMap(today).then((r) => r.data),
    refetchInterval: 3 * 60 * 1000,
    retry: false,
  });
  const d = q.data;
  const marks: any[] = d?.marks || [];
  const mine: string | null = d?.my_colour || null;
  const plans = marks.filter((m) => m.status === 'plan' && (!mine || m.colour === mine));
  const show = Platform.OS === 'web' && !!d?.sector && plans.length > 0;

  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!show) return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el) return;
      if (map.current) { map.current.remove(); map.current = null; }
      const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false });
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      if (d?.shape?.geometry) {
        L.geoJSON(d.shape.geometry, { interactive: false, style: { color: c.primary, weight: 1.5, fillOpacity: 0.04 } }).addTo(m);
      }
      const order = (mk: any) => (mk.status === 'plan' ? 0 : mk.status === 'draft' ? 1 : 2);
      for (const mk of marks.slice().sort((a, b) => order(a) - order(b))) {
        const style = mk.status === 'plan'
          ? { color: hopHex(mk.colour), weight: 7, opacity: mine && mk.colour !== mine ? 0.15 : 0.55 }
          : mk.status === 'draft'
            ? { color: hopHex(mk.colour, c.primary), weight: 3.5, opacity: 0.95 }
            : { color: '#000', weight: 4, opacity: mk.days_ago > 28 ? 0.35 : 0.85 };
        for (const line of mk.lines || []) L.polyline(line, { ...style, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m);
      }
      // Zoom to their own area's streets.
      const pts = plans.flatMap((p) => p.lines || []).flat();
      if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [18, 18], maxZoom: 18 });
      map.current = m;
      setTimeout(() => m.invalidateSize(), 200);
    }).catch(() => setFailed(true));
    return () => { dead = true; };
  }, [show, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null; } }, []);

  if (!show) return null;
  const done = marks.filter((m) => m.status === 'draft' && (!mine || m.colour === mine)).length;
  return (
    <Pressable onPress={() => router.push('/sector-map' as never)} style={s.card} accessibilityRole="button"
      accessibilityLabel="Your area today, open the map" testID="home-area-map">
      <View style={s.head}>
        {mine ? <View style={[s.dot, { backgroundColor: hopHex(mine) }]} /> : <Ionicons name="map" size={16} color={c.primary} />}
        <Text style={s.title} numberOfLines={1}>
          {mine ? `Your area today · ${hopLabel(mine)}` : 'Your sector today'}{d?.sector?.postcode ? ` · ${d.sector.postcode}` : ''}
        </Text>
      </View>
      <View style={s.mapBox} pointerEvents="none">
        <View ref={box} style={StyleSheet.absoluteFill} />
        {failed && <View style={s.overlay}><Text style={s.muted}>The map couldn't load. Tap to try again.</Text></View>}
      </View>
      <View style={s.foot}>
        <Text style={s.muted}>{done ? `${done} line${done === 1 ? '' : 's'} marked off today` : 'Tap to open the map and mark off streets as you go'}</Text>
        <Ionicons name="expand-outline" size={16} color={c.primary} />
      </View>
    </Pressable>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 10, gap: 8, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 2 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: c.text, flex: 1 },
  mapBox: { height: 260, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 12 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 2 },
  muted: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, flex: 1 },
});
