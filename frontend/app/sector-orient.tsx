// Orient view — a read-only look-alike of the home "Your area" map that you can
// twist with two fingers to face the way you're looking in the field. It never
// draws, so turning it can't misplace anything; "Draw on the map" opens the real
// drawing map. Web only (the app runs as a web PWA). (GET /sector/map)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { todayISO } from '../src/utils/calendarDates';
import { loadLeaflet, OSM_TILES, OSM_ATTRIBUTION } from '../src/utils/leaflet';
import { hopHex, hopLabel } from '../src/utils/hopColours';

// How much to scale the map so its corners stay covered at any rotation
// (1 at north, up to ~1.41 at 45°). Keeps the view full-bleed as it turns.
const cover = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return Math.abs(Math.sin(r)) + Math.abs(Math.cos(r));
};
const norm = (deg: number) => ((deg % 360) + 360) % 360;

export default function SectorOrientScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const today = todayISO();
  const q = useQuery({
    queryKey: ['sector-orient', today],
    queryFn: () => apiService.getSectorMap(today).then((r) => r.data),
    retry: false,
  });
  const d = q.data;
  const marks: any[] = d?.marks || [];
  const mine: string | null = d?.my_colour || null;
  const plans = marks.filter((m) => !m.other && m.status === 'plan' && (!mine || m.colour === mine));
  const show = Platform.OS === 'web' && !!d?.sector && plans.length > 0;

  const clipRef = useRef<View>(null);
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const bearing = useRef(0);
  const gesture = useRef<any>(null);
  const [rotated, setRotated] = useState(false);

  const apply = (deg: number) => {
    bearing.current = deg;
    const el = box.current as unknown as HTMLElement | null;
    if (el) {
      el.style.transformOrigin = '50% 50%';
      el.style.transform = `rotate(${deg}deg) scale(${cover(deg).toFixed(4)})`;
    }
    const a = norm(deg);
    setRotated(a > 0.5 && a < 359.5);
  };
  const reset = () => apply(0);

  // Build the read-only map — same tiles, sector shape and hop lines as the
  // home preview. Non-interactive: no drag, no zoom, nothing to draw.
  useEffect(() => {
    if (!show) return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el) return;
      if (map.current) { map.current.remove(); map.current = null; }
      const m = L.map(el, { zoomControl: false, attributionControl: true, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0 });
      const pts = plans.flatMap((p) => p.lines || []).flat();
      m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 17 });
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      if (d?.shape?.geometry) {
        L.geoJSON(d.shape.geometry, { interactive: false, style: { color: c.primary, weight: 1.5, fillOpacity: 0.04 } }).addTo(m);
      }
      const order = (mk: any) => (mk.other ? -1 : mk.status === 'plan' ? 0 : mk.status === 'requested' ? 1 : mk.status === 'draft' ? 2 : 3);
      for (const mk of marks.slice().sort((a, b) => order(a) - order(b))) {
        const style = mk.other
          ? { color: '#6b7280', weight: mk.status === 'plan' ? 7 : 3.5, opacity: mk.status === 'plan' ? 0.2 : 0.55 }
          : mk.status === 'plan'
          ? { color: hopHex(mk.colour), weight: 7, opacity: mine && mk.colour !== mine ? 0.15 : 0.55 }
          : mk.status === 'requested'
            ? { color: hopHex(mk.colour, c.primary), weight: 4, opacity: 0.8, dashArray: '8 8' }
          : mk.status === 'draft'
            ? { color: '#000', weight: 3.5, opacity: 0.95 }
            : { color: '#000', weight: 4, opacity: mk.days_ago > 28 ? 0.35 : 0.85 };
        for (const line of mk.lines || []) L.polyline(line, { ...style, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m);
      }
      map.current = m;
      const refit = () => {
        if (map.current !== m) return;
        m.invalidateSize();
        m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 17 });
        apply(bearing.current);
      };
      [150, 600, 1500].forEach((t) => setTimeout(refit, t));
      apply(bearing.current);
    }).catch(() => { /* map just won't show */ });
    return () => { dead = true; };
  }, [show, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null; } }, []);

  // Two-finger twist → rotate. Leaflet's own touch handling is off here, so
  // there's nothing to fight over the gesture.
  useEffect(() => {
    if (Platform.OS !== 'web' || !show) return;
    const clip = clipRef.current as unknown as HTMLElement | null;
    if (!clip) return;
    // `any` on purpose: React Native's global touch types clash with the DOM
    // ones addEventListener expects, so we read the fields off directly.
    const angleOf = (t: any) => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
    const distOf = (t: any) => Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
    const onStart = (e: any) => {
      if (e.touches.length === 2) gesture.current = {
        startAngle: angleOf(e.touches), startBearing: bearing.current,
        startDist: distOf(e.touches), startZoom: map.current ? map.current.getZoom() : 15,
      };
    };
    const onMove = (e: any) => {
      if (e.touches.length === 2 && gesture.current) {
        e.preventDefault();
        // Twist → rotate, pinch → zoom, both from the same two-finger gesture.
        apply(gesture.current.startBearing + (angleOf(e.touches) - gesture.current.startAngle));
        const dist = distOf(e.touches);
        if (map.current && gesture.current.startDist > 0) {
          map.current.setZoom(gesture.current.startZoom + Math.log2(dist / gesture.current.startDist), { animate: false });
        }
      }
    };
    const onEnd = (e: any) => { if (e.touches.length < 2) gesture.current = null; };
    clip.addEventListener('touchstart', onStart, { passive: false });
    clip.addEventListener('touchmove', onMove, { passive: false });
    clip.addEventListener('touchend', onEnd);
    clip.addEventListener('touchcancel', onEnd);
    return () => {
      clip.removeEventListener('touchstart', onStart);
      clip.removeEventListener('touchmove', onMove);
      clip.removeEventListener('touchend', onEnd);
      clip.removeEventListener('touchcancel', onEnd);
    };
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={s.back} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
        <Text style={s.title} numberOfLines={1}>
          {mine ? `Your area · ${hopLabel(mine)}` : 'Your area'}{d?.sector?.postcode ? ` · ${d.sector.postcode}` : ''}
        </Text>
      </View>

      {q.isLoading ? (
        <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={c.primary} /></View>
      ) : !show ? (
        <View style={[s.center, { flex: 1 }]}><Text style={s.muted}>No area to orient yet today.</Text></View>
      ) : (
        <>
          <View ref={clipRef} style={s.mapBox}>
            <View ref={box} style={StyleSheet.absoluteFill} />
            {rotated && (
              <Pressable onPress={reset} style={s.compass} accessibilityRole="button" accessibilityLabel="Reset to north">
                <Ionicons name="navigate" size={18} color={c.onPrimary} />
                <Text style={s.compassText}>N</Text>
              </Pressable>
            )}
          </View>
          <Text style={s.hint}>Twist with two fingers to turn the map to face the way you’re looking. Tap N to snap back to north.</Text>
        </>
      )}

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={() => router.push('/sector-map' as never)} style={s.draw} accessibilityRole="button" testID="orient-draw">
          <Ionicons name="brush" size={18} color={c.onPrimary} />
          <Text style={s.drawText}>Draw on the map</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  back: { padding: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: c.text, flex: 1 },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: c.textMuted },
  mapBox: { flex: 1, marginHorizontal: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface, position: 'relative' },
  compass: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: c.primary,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  compassText: { fontFamily: fonts.bodyBold, fontSize: 13, color: c.onPrimary },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted, textAlign: 'center', paddingHorizontal: 20, paddingTop: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 10 },
  draw: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: c.primary },
  drawText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
});
