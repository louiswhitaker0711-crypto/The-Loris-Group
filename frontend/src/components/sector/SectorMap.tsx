// The sector map: OpenStreetMap streets around the sector's postcode, with
// the streets marked off in the last 12 weeks (red this week, amber the last
// month, grey older). At the end of the day the sector leader taps along the
// streets they did and saves the mark-off. (backend routes/coverage.py)
//
// Web only (the app ships as an installed web app). Leaflet 1.9.4 is served
// from our own /vendor/leaflet (no CDN); the postcode is placed with
// postcodes.io (open data, no key).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';
import { APP_LOCALE } from '../../utils/appTime';

const FREE_MAP_TOOLS = 'https://www.freemaptools.com/uk-postcode-map.htm';
// How old a mark-off is, coloured from the theme.
const ages = (c: any) => [
  { max: 7, colour: c.red, label: 'This week' },
  { max: 28, colour: c.yellow, label: 'Last 4 weeks' },
  { max: 9999, colour: c.textMuted, label: 'Older' },
];

let leafletLoading: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    // Wait for the stylesheet and the script, so the map sizes itself right.
    let left = 2;
    const one = () => { left -= 1; if (left === 0) resolve(w.L); };
    const fail = () => { leafletLoading = null; reject(new Error('Map could not load')); };
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    css.onload = one;
    css.onerror = one;            // the map still works without its styles, just less tidy
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = one;
    js.onerror = fail;
    document.head.appendChild(js);
  });
  return leafletLoading;
}

/** Where a postcode is: a full postcode first, then its district. */
async function placePostcode(pc: string): Promise<{ lat: number; lng: number; zoom: number } | null> {
  const clean = pc.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 2) return null;
  try {
    if (clean.length >= 5) {
      const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
      if (r.ok) {
        const j = await r.json();
        if (j?.result?.latitude) return { lat: j.result.latitude, lng: j.result.longitude, zoom: 16 };
      }
    }
    const out = pc.trim().toUpperCase().split(/\s+/)[0] || clean;
    const r2 = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(out)}`);
    if (r2.ok) {
      const j = await r2.json();
      if (j?.result?.latitude) return { lat: j.result.latitude, lng: j.result.longitude, zoom: 14 };
    }
  } catch { /* offline: leave the map where it is */ }
  return null;
}

type Props = { postcode: string; date: string; startDrawing?: boolean; height?: number };

export function SectorMap({ postcode, date, startDrawing = false, height = 340 }: Props) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const AGE = useMemo(() => ages(c), [c]);
  const ageRef = useRef(AGE);
  ageRef.current = AGE;
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const marksLayer = useRef<any>(null);
  const drawLayer = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [drawing, setDrawing] = useState(startDrawing);
  const [lines, setLines] = useState<number[][][]>([[]]);
  const [busy, setBusy] = useState(false);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  // Build the map once.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el || map.current) return;
      const m = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([54.0, -2.0], 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      marksLayer.current = L.layerGroup().addTo(m);
      drawLayer.current = L.layerGroup().addTo(m);
      m.on('click', (e: any) => {
        if (!drawingRef.current) return;
        setLines((cur) => {
          const next = cur.map((l) => [...l]);
          next[next.length - 1].push([e.latlng.lat, e.latlng.lng]);
          return next;
        });
      });
      m.on('moveend', () => loadMarks());
      map.current = m;
      setTimeout(() => m.invalidateSize(), 200);
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMarks = useCallback(async () => {
    const m = map.current; const L = (window as any).L;
    if (!m || !L || m.getZoom() < 12) { marksLayer.current?.clearLayers(); return; }
    const b = m.getBounds();
    try {
      const r = await apiService.getCoverage({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      marksLayer.current.clearLayers();
      for (const mk of (r.data?.marks || []).slice().reverse()) {
        const colour = (ageRef.current.find((a) => mk.days_ago <= a.max) || ageRef.current[2]).colour;
        for (const line of mk.lines || []) {
          const pl = L.polyline(line, { color: colour, weight: 7, opacity: 0.75, lineCap: 'round' }).addTo(marksLayer.current);
          const when = new Date(mk.date + 'T12:00:00').toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
          pl.bindPopup(`<b>${when}</b><br/>Marked off by ${String(mk.leader_name || 'a leader').replace(/</g, '&lt;')}`);
        }
      }
    } catch { /* keep what's shown */ }
  }, []);

  // Move to the postcode.
  useEffect(() => {
    if (!ready || !postcode) return;
    let dead = false;
    const t = setTimeout(async () => {
      const at = await placePostcode(postcode);
      if (!dead && at && map.current) map.current.setView([at.lat, at.lng], at.zoom);
      else if (!dead) loadMarks();
    }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [ready, postcode, loadMarks]);

  // Draw what's being marked off now.
  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !drawLayer.current) return;
    drawLayer.current.clearLayers();
    for (const l of lines) {
      if (l.length >= 2) L.polyline(l, { color: c.primary, weight: 7, opacity: 0.95, dashArray: '1 10', lineCap: 'round' }).addTo(drawLayer.current);
      for (const p of l) L.circleMarker(p, { radius: 4, color: c.primary, fillOpacity: 1 }).addTo(drawLayer.current);
    }
  }, [lines, ready, c.primary]);

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => map.current?.setView([p.coords.latitude, p.coords.longitude], 17),
      () => showAlert('Location', 'Allow location for the app to show where you are.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const undo = () => setLines((cur) => {
    const next = cur.map((l) => [...l]);
    if (next[next.length - 1].length) next[next.length - 1].pop();
    else if (next.length > 1) next.pop();
    return next;
  });
  const newStreet = () => setLines((cur) => (cur[cur.length - 1].length ? [...cur, []] : cur));
  const done = lines.filter((l) => l.length >= 2);
  const save = async () => {
    if (!done.length) { showAlert('Mark off', 'Tap along each street you did (two taps or more), then save.'); return; }
    setBusy(true);
    try {
      await apiService.saveCoverage({ date, postcode, lines: done });
      toast.success('Marked off');
      setLines([[]]); setDrawing(false); loadMarks();
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(false); }
  };

  if (Platform.OS !== 'web') return <Text style={s.muted}>The map opens in the installed web app.</Text>;

  return (
    <View style={{ gap: 8 }}>
      <View style={[s.mapBox, { height }]}>
        <View ref={box} style={StyleSheet.absoluteFill} />
        {!ready && !failed && <View style={s.overlay}><ActivityIndicator color={c.primary} /></View>}
        {failed && <View style={s.overlay}><Text style={s.muted}>The map couldn't load. Check your signal and try again.</Text></View>}
        <Pressable onPress={locate} style={s.locate} accessibilityLabel="Show where I am" hitSlop={6}>
          <Ionicons name="locate" size={18} color={c.text} />
        </Pressable>
      </View>

      <View style={s.legend}>
        {AGE.map((a) => (
          <View key={a.label} style={s.key}><View style={[s.swatch, { backgroundColor: a.colour }]} /><Text style={s.small}>{a.label}</Text></View>
        ))}
      </View>

      {drawing ? (
        <View style={{ gap: 6 }}>
          <Text style={s.muted}>Tap along each street you did. Start a new street when you jump to another one.</Text>
          <View style={s.row}>
            <Pressable onPress={undo} style={s.ghost} accessibilityRole="button"><Ionicons name="arrow-undo" size={15} color={c.primary} /><Text style={s.ghostText}>Undo</Text></Pressable>
            <Pressable onPress={newStreet} style={s.ghost} accessibilityRole="button"><Ionicons name="add" size={15} color={c.primary} /><Text style={s.ghostText}>New street</Text></Pressable>
            <Pressable onPress={() => { setDrawing(false); setLines([[]]); }} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Cancel</Text></Pressable>
            <Pressable onPress={save} disabled={busy} style={s.btn} accessibilityRole="button" testID="map-save">
              {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
              <Text style={s.btnText}>Save mark-off{done.length ? ` (${done.length})` : ''}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.row}>
          <Pressable onPress={() => setDrawing(true)} style={s.btn} accessibilityRole="button" testID="map-markoff">
            <Ionicons name="brush-outline" size={15} color={c.onPrimary} />
            <Text style={s.btnText}>Mark off streets</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(FREE_MAP_TOOLS)} style={s.ghost} accessibilityRole="link">
            <Ionicons name="open-outline" size={15} color={c.primary} />
            <Text style={s.ghostText}>Sector outline (Free Map Tools)</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  mapBox: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 16 },
  locate: { position: 'absolute', right: 10, bottom: 24, zIndex: 1000, width: 38, height: 38, borderRadius: 19, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 5, borderRadius: 3 },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
