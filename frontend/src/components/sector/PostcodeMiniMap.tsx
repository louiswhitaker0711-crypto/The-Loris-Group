// A small read-only map preview of a postcode, under the postcode box when
// planning a sector. Web only; debounced as you type. (postcodes.io + Leaflet)
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { useColors, fonts } from '../../theme/ThemeContext';
import { loadLeaflet, placePostcode, OSM_TILES } from '../../utils/leaflet';

export default function PostcodeMiniMap({ postcode, height = 140 }: { postcode: string; height?: number }) {
  const c = useColors();
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const [pc, setPc] = useState(postcode.trim());
  const [state, setState] = useState<'idle' | 'ok' | 'none'>('idle');

  useEffect(() => { const t = setTimeout(() => setPc(postcode.trim()), 500); return () => clearTimeout(t); }, [postcode]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (pc.replace(/\s/g, '').length < 2) { setState('idle'); return; }
    let dead = false;
    loadLeaflet().then(async (L) => {
      const at = await placePostcode(pc);
      if (dead) return;
      if (!at) { setState('none'); return; }
      setState('ok');
      const el = box.current as unknown as HTMLElement | null;
      if (!el) return;
      if (!map.current) {
        map.current = L.map(el, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false });
        L.tileLayer(OSM_TILES, { maxZoom: 19 }).addTo(map.current);
      }
      map.current.setView([at.lat, at.lng], at.zoom);
      if (marker.current) { marker.current.remove(); marker.current = null; }
      marker.current = L.circleMarker([at.lat, at.lng], { radius: 8, color: c.primary, weight: 3, fillColor: c.primary, fillOpacity: 0.3 }).addTo(map.current);
      setTimeout(() => map.current && map.current.invalidateSize(), 150);
    }).catch(() => { if (!dead) setState('none'); });
    return () => { dead = true; };
  }, [pc, c.primary]);

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
