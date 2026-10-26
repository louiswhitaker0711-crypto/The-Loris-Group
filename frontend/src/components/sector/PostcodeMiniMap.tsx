// A map preview of a postcode, under the postcode box when planning a
// sector. Web only; debounced as you type. (postcodes.io + Leaflet)
//
// `marked` (Plan sectors): the postcode sector's outline and every street
// marked as worked in the last 12 weeks, in black (GET /territory/check,
// /coverage), and the map can be moved and zoomed to look around.
//
// The lookup finds the spot first; the map is drawn only once its box is on
// the page (a second effect, after the render that shows the box). Drawing in
// the same step as the lookup left an empty box: the box didn't exist yet.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { APP_LOCALE } from '../../utils/appTime';
import { loadLeaflet, placePostcode, OSM_TILES } from '../../utils/leaflet';

type Spot = { lat: number; lng: number; zoom: number };

export default function PostcodeMiniMap({ postcode, height = 140, marked = false }: { postcode: string; height?: number; marked?: boolean }) {
  const c = useColors();
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const [pc, setPc] = useState(postcode.trim());
  const [state, setState] = useState<'idle' | 'ok' | 'none'>('idle');
  const [spot, setSpot] = useState<Spot | null>(null);
  const layers = useRef<{ shape: any; worked: any } | null>(null);
  const [info, setInfo] = useState<{ streets: number; last: string | null; outline: boolean } | null>(null);

  useEffect(() => { const t = setTimeout(() => setPc(postcode.trim()), 500); return () => clearTimeout(t); }, [postcode]);

  // 1) Find the postcode.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (pc.replace(/\s/g, '').length < 2) { setState('idle'); setSpot(null); return; }
    let dead = false;
    placePostcode(pc).then((at) => {
      if (dead) return;
      if (!at) { setState('none'); setSpot(null); return; }
      setSpot(at);
      setState('ok');
    }).catch(() => { if (!dead) setState('none'); });
    return () => { dead = true; };
  }, [pc]);

  // 2) Draw it, once the box is on the page.
  useEffect(() => {
    if (Platform.OS !== 'web' || state !== 'ok' || !spot) return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el) return;
      if (map.current && map.current.getContainer() !== el) { map.current.remove(); map.current = null; }
      if (!map.current) {
        map.current = marked
          ? L.map(el, { zoomControl: true, attributionControl: false, scrollWheelZoom: false, dragging: true, doubleClickZoom: true, tap: true })
          : L.map(el, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false });
        L.tileLayer(OSM_TILES, { maxZoom: 19 }).addTo(map.current);
        if (marked) {
          layers.current = { shape: L.layerGroup().addTo(map.current), worked: L.layerGroup().addTo(map.current) };
          // Worked streets for whatever's in view, refreshed as the map moves.
          let t: any = null;
          const loadWorked = () => {
            clearTimeout(t);
            t = setTimeout(async () => {
              if (!map.current || !layers.current) return;
              const b = map.current.getBounds();
              try {
                const r = await apiService.getCoverage({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
                const marks: any[] = r.data?.marks || [];
                layers.current.worked.clearLayers();
                let streets = 0;
                let last: string | null = null;
                for (const mk of marks) {
                  // Lighter the longer ago it was worked.
                  const age = Number(mk.days_ago || 0);
                  const opacity = age <= 14 ? 0.95 : age <= 42 ? 0.7 : 0.45;
                  for (const line of mk.lines || []) {
                    L.polyline(line, { color: '#000', weight: 4, opacity, interactive: false }).addTo(layers.current.worked);
                    streets += 1;
                  }
                  if (mk.date && (!last || mk.date > last)) last = mk.date;
                }
                setInfo((i) => ({ outline: i?.outline || false, streets, last }));
              } catch { /* coverage is Coach+ only; the map still shows */ }
            }, 250);
          };
          map.current.on('moveend', loadWorked);
          (map.current as any)._loadWorked = loadWorked;
        }
      }
      map.current.setView([spot.lat, spot.lng], marked ? Math.max(14, spot.zoom - 1) : spot.zoom);
      if (marker.current) { marker.current.remove(); marker.current = null; }
      marker.current = L.circleMarker([spot.lat, spot.lng], { radius: marked ? 5 : 8, color: c.primary, weight: 3, fillColor: c.primary, fillOpacity: 0.3 }).addTo(map.current);
      if (marked && layers.current) {
        layers.current.shape.clearLayers();
        apiService.territoryCheck(pc, true).then((r) => {
          const geo = r.data?.geometry;
          if (dead || !map.current || !layers.current) return;
          if (geo) {
            const gj = L.geoJSON(geo, { interactive: false, style: { color: c.primary, weight: 2.5, fillColor: c.primary, fillOpacity: 0.06 } });
            gj.addTo(layers.current.shape);
            map.current.fitBounds(gj.getBounds(), { padding: [10, 10] });
          }
          setInfo((i) => ({ streets: i?.streets || 0, last: i?.last || null, outline: !!geo }));
          (map.current as any)._loadWorked?.();
        }).catch(() => { (map.current as any)?._loadWorked?.(); });
      }
      setTimeout(() => map.current && map.current.invalidateSize(), 150);
    }).catch(() => { if (!dead) setState('none'); });
    return () => { dead = true; };
  }, [state, spot, c.primary, marked, pc]);

  // The box goes away when the postcode is cleared or not found: so does the map.
  useEffect(() => {
    if (state !== 'ok' && map.current) { map.current.remove(); map.current = null; marker.current = null; }
  }, [state]);
  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null; } }, []);

  if (Platform.OS !== 'web') return null;
  if (state === 'idle') return null;
  if (state === 'none') return <Text style={styles(c).none}>No map for that postcode yet — it’ll still save.</Text>;
  if (!marked) return <View ref={box} style={[styles(c).map, { height }]} />;
  const last = info?.last
    ? new Date(`${info.last}T12:00:00`).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })
    : null;
  return (
    <View>
      <View ref={box} style={[styles(c).map, { height }]} />
      <Text style={styles(c).key}>
        {info?.streets ? `⬛ ${info.streets} street${info.streets === 1 ? '' : 's'} worked in the last 12 weeks · latest ${last}` : 'Nothing marked as worked here in the last 12 weeks.'}
        {info && !info.outline ? ' · no sector outline for this postcode' : ''}
      </Text>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  map: { borderRadius: 10, overflow: 'hidden', marginTop: 8, borderWidth: 1, borderColor: c.border },
  none: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, marginTop: 6 },
  key: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted, marginTop: 5 },
});
