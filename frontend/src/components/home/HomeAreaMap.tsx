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
  // Their own colour's streets; if none are drawn in it yet, the sector's whole plan.
  const ownPlans = marks.filter((m) => !m.other && m.status === 'plan' && (!mine || m.colour === mine));
  const plans = ownPlans.length ? ownPlans : marks.filter((m) => !m.other && m.status === 'plan');
  const hasShape = !!d?.shape?.geometry;
  // Anyone in a sector today gets the preview: their streets, the plan, or at least the sector's outline.
  const show = Platform.OS === 'web' && !!d?.sector && (plans.length > 0 || hasShape);

  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!show) return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el) return;
      if (map.current) { map.current.remove(); map.current = null; }
      roRef.current?.disconnect();
      const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false });
      // Place the map on their area FIRST: Leaflet can't draw lines on a map
      // that doesn't know where it's looking yet.
      const pts = plans.flatMap((p) => p.lines || []).flat();
      const outline = d?.shape?.geometry ? L.geoJSON(d.shape.geometry, { interactive: false, style: { color: c.primary, weight: 1.5, fillOpacity: 0.04 } }) : null;
      // Their streets if there are any; otherwise the sector's outline.
      const bounds = () => (pts.length ? L.latLngBounds(pts) : outline ? outline.getBounds() : null);
      const b0 = bounds();
      if (!b0) return;
      m.fitBounds(b0, { padding: [18, 18], maxZoom: 17 });
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      if (outline) outline.addTo(m);
      const order = (mk: any) => (mk.other ? -1 : mk.status === 'plan' ? 0 : mk.status === 'requested' ? 1 : mk.status === 'draft' ? 2 : 3);
      for (const mk of marks.slice().sort((a, b) => order(a) - order(b))) {
        const style = mk.other
          ? { color: '#6b7280', weight: mk.status === 'plan' ? 7 : 3.5, opacity: mk.status === 'plan' ? 0.2 : 0.55 }
          : mk.status === 'plan'
          ? { color: hopHex(mk.colour), weight: 7, opacity: mine && mk.colour !== mine && ownPlans.length ? 0.15 : 0.55 }
          : mk.status === 'requested'
            ? { color: hopHex(mk.colour, c.primary), weight: 4, opacity: 0.8, dashArray: '8 8' }
          : mk.status === 'draft'
            ? { color: '#000', weight: 3.5, opacity: 0.95 }
            : { color: '#000', weight: 4, opacity: mk.days_ago > 28 ? 0.35 : 0.85 };
        for (const line of mk.lines || []) L.polyline(line, { ...style, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m);
      }
      map.current = m;
      setFailed(false);
      // Home lays out after the map is made (cards above it load in), so the
      // map can start at the wrong size and draw one grey tile. Whenever the
      // card's size changes, re-measure and zoom back to their streets.
      const refit = () => {
        if (!map.current || map.current !== m) return;
        m.invalidateSize();
        const b = bounds();
        if (b) m.fitBounds(b, { padding: [18, 18], maxZoom: 17 });
      };
      [150, 600, 1500].forEach((t) => setTimeout(refit, t));
      if (typeof ResizeObserver !== 'undefined') {
        let last = '';
        const ro = new ResizeObserver(() => {
          const r = el.getBoundingClientRect();
          const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
          if (key !== last && r.width > 0) { last = key; refit(); }
        });
        ro.observe(el);
        roRef.current = ro;
      }
    }).catch(() => setFailed(true));
    return () => { dead = true; };
  }, [show, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { roRef.current?.disconnect(); if (map.current) { map.current.remove(); map.current = null; } }, []);

  if (!show) return null;
  const done = marks.filter((m) => !m.other && m.status === 'draft' && (!mine || m.colour === mine)).length;
  return (
    <View style={s.card}>
    <Pressable onPress={() => router.push('/sector-orient' as never)} style={s.mapTap} accessibilityRole="button"
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
        <Text style={s.muted}>{done ? `${done} line${done === 1 ? '' : 's'} marked off today` : 'Tap to face your way, then draw as you go'}</Text>
        <Ionicons name="expand-outline" size={16} color={c.primary} />
      </View>
    </Pressable>
    {/* The one way into the sector from Home (the Owner, 29 Oct 2026). */}
    <Pressable onPress={() => router.push('/my-sector' as never)} style={s.go} accessibilityRole="button" testID="home-go-to-sector">
      <Text style={s.goText}>Go to sector</Text>
      <Ionicons name="arrow-forward" size={17} color={c.onPrimary} />
    </Pressable>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 10, gap: 8, marginBottom: 12 },
  mapTap: { gap: 8 },
  go: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: c.primary },
  goText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.onPrimary },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 2 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: c.text, flex: 1 },
  mapBox: { height: 210, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 12 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 2 },
  muted: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, flex: 1 },
});
