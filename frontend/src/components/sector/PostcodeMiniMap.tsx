// A small read-only map preview of a postcode, under the postcode box when
// planning a sector. Web only; debounced as you type. (postcodes.io + Leaflet)
//
// The lookup finds the spot first; the map is drawn only once its box is on
// the page (a second effect, after the render that shows the box). Drawing in
// the same step as the lookup left an empty box: the box didn't exist yet.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useColors, fonts } from '../../theme/ThemeContext';
import { loadLeaflet, placePostcode, OSM_TILES } from '../../utils/leaflet';

type Spot = { lat: number; lng: number; zoom: number };

export default function PostcodeMiniMap({ postcode, height = 140 }: { postcode: string; height?: number }) {
  const c = useColors();
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const [pc, setPc] = useState(postcode.trim());
  const [state, setState] = useState<'idle' | 'ok' | 'none'>('idle');
  const [spot, setSpot] = useState<Spot | null>(null);

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
        map.current = L.map(el, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false });
        L.tileLayer(OSM_TILES, { maxZoom: 19 }).addTo(map.current);
      }
      map.current.setView([spot.lat, spot.lng], spot.zoom);
      if (marker.current) { marker.current.remove(); marker.current = null; }
      marker.current = L.circleMarker([spot.lat, spot.lng], { radius: 8, color: c.primary, weight: 3, fillColor: c.primary, fillOpacity: 0.3 }).addTo(map.current);
      setTimeout(() => map.current && map.current.invalidateSize(), 150);
    }).catch(() => { if (!dead) setState('none'); });
    return () => { dead = true; };
  }, [state, spot, c.primary]);

  // The box goes away when the postcode is cleared or not found: so does the map.
  useEffect(() => {
    if (state !== 'ok' && map.current) { map.current.remove(); map.current = null; marker.current = null; }
  }, [state]);
  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null; } }, []);

  if (Platform.OS !== 'web') return null;
  if (state === 'idle') return null;
  if (state === 'none') return <Text style={styles(c).none}>No map for that postcode yet — it’ll still save.</Text>;
  return <View ref={box} style={[styles(c).map, { height }]} />;
}

const styles = (c: any) => StyleSheet.create({
  map: { borderRadius: 10, overflow: 'hidden', marginTop: 8, borderWidth: 1, borderColor: c.border },
  none: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, marginTop: 6 },
});
