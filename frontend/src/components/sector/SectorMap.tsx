// The sector map: the one sector the person is in today (or a leader's
// sector, for the leader or an Admin). Acwyre's outline of the postcode
// sector, the streets confirmed in the last 12 weeks in solid black, and
// today's draft mark-offs dashed in the brand colour.
//
//   • Anyone in the sector taps along the streets they've done (drafts).
//   • The sector leader shares the map with the sector (a push to each BA
//     they added) and, at the end of the day, checks it and confirms: the
//     drafts turn solid black and feed the Owner's territory map.
//
// Web only (the app ships as an installed web app). Leaflet is served from
// /vendor/leaflet; tiles are OpenStreetMap. (GET /sector/map)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../theme/ThemeContext';
import { apiService } from '../../api/client';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';
import { APP_LOCALE } from '../../utils/appTime';
import { loadLeaflet, placePostcode, OSM_TILES, OSM_ATTRIBUTION, esc } from '../../utils/leaflet';

const FREE_MAP_TOOLS = 'https://www.freemaptools.com/uk-postcode-map.htm';

type Props = {
  date: string;
  leaderId?: string;          // an Admin looking at someone's sector
  height?: number;
  endOfDay?: boolean;         // show the confirm step prominently
};

export function SectorMap({ date, leaderId, height = 360, endOfDay = false }: Props) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const shapeLayer = useRef<any>(null);
  const marksLayer = useRef<any>(null);
  const drawLayer = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [lines, setLines] = useState<number[][][]>([[]]);
  const [busy, setBusy] = useState<string | null>(null);
  const drawingRef = useRef(false);
  drawingRef.current = drawing;
  const placed = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await apiService.getSectorMap(date, leaderId);
      setData(r.data);
    } catch { /* keep what's shown */ }
    finally { setLoading(false); }
  }, [date, leaderId]);
  useEffect(() => { load(); }, [load]);

  // Build the map once.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el || map.current) return;
      const m = L.map(el, { scrollWheelZoom: false }).setView([53.8, -1.55], 9);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      shapeLayer.current = L.layerGroup().addTo(m);
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
      map.current = m;
      setTimeout(() => m.invalidateSize(), 200);
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; } };
  }, []);

  // Outline and marks.
  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !data) return;
    shapeLayer.current.clearLayers();
    marksLayer.current.clearLayers();
    const shape = data.shape;
    if (shape?.geometry) {
      const notActive = shape.kind === 'not_active';
      const gj = L.geoJSON(shape.geometry, { style: {
        color: notActive ? c.red : c.primary, weight: 2.5, fillColor: notActive ? c.red : c.primary, fillOpacity: 0.08 } });
      gj.addTo(shapeLayer.current);
      if (!placed.current) { map.current.fitBounds(gj.getBounds(), { padding: [12, 12] }); placed.current = true; }
    } else if (!placed.current && data.sector?.postcode) {
      placePostcode(data.sector.postcode).then((at) => { if (at && map.current) map.current.setView([at.lat, at.lng], at.zoom); });
      placed.current = true;
    }
    for (const mk of (data.marks || []).slice().reverse()) {
      const draft = mk.status === 'draft';
      const old = !draft && mk.days_ago > 28;
      const when = new Date(mk.date + 'T12:00:00').toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
      for (const line of mk.lines || []) {
        const pl = L.polyline(line, draft
          ? { color: c.primary, weight: 7, opacity: 0.9, dashArray: '2 10', lineCap: 'round' }
          : { color: '#000', weight: 7, opacity: old ? 0.35 : 0.85, lineCap: 'round' }).addTo(marksLayer.current);
        const who = esc(mk.author_name || mk.leader_name || 'Someone');
        const del = mk.can_delete ? `<br/><a href="#" data-del="${esc(mk.id)}">Remove</a>` : '';
        pl.bindPopup(`<b>${draft ? 'Marked off today (not confirmed yet)' : `Worked ${esc(when)}`}</b><br/>By ${who}${del}`);
        pl.on('popupopen', (ev: any) => {
          const a = ev.popup.getElement()?.querySelector('a[data-del]');
          if (a) a.onclick = async (e: any) => {
            e.preventDefault();
            try { await apiService.deleteCoverage(a.getAttribute('data-del')); map.current?.closePopup(); load(); }
            catch (er: any) { showAlert('Could not remove', er?.response?.data?.detail || 'Try again.'); }
          };
        });
      }
    }
  }, [data, ready, c.primary, c.red, load]);

  // What's being drawn now.
  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !drawLayer.current) return;
    drawLayer.current.clearLayers();
    for (const l of lines) {
      if (l.length >= 2) L.polyline(l, { color: c.primary, weight: 7, opacity: 0.95, lineCap: 'round' }).addTo(drawLayer.current);
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
    setBusy('save');
    try {
      await apiService.saveCoverage({ date, lines: done, leader_id: leaderId });
      toast.success('Marked off');
      setLines([[]]); setDrawing(false); load();
    } catch (e: any) { showAlert('Could not save', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };
  const share = async () => {
    setBusy('share');
    try {
      const r = await apiService.shareSectorMap(date);
      toast.success(r.data?.sent ? `Sent to ${r.data.sent}` : 'Nobody else is in the sector yet');
    } catch (e: any) { showAlert('Could not send', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };
  const confirm = () => {
    const go = async () => {
      setBusy('confirm');
      try {
        const r = await apiService.confirmCoverage(date, leaderId);
        toast.success(r.data?.confirmed ? `${r.data.confirmed} marked off in black` : 'Nothing new to confirm');
        load();
      } catch (e: any) { showAlert('Could not confirm', e?.response?.data?.detail || 'Try again.'); }
      finally { setBusy(null); }
    };
    showAlert('Confirm the map?', "Everything marked off today turns solid black and goes on the Owner's territory map. Remove anything that wasn't done first.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: go },
    ]);
  };

  if (Platform.OS !== 'web') return <Text style={s.muted}>The map opens in the installed web app.</Text>;
  if (!loading && !data?.sector) {
    return <Text style={s.muted}>The map shows once you're in a sector today, with its postcode saved.</Text>;
  }
  const shape = data?.shape;
  const drafts = data?.drafts || 0;

  return (
    <View style={{ gap: 8 }}>
      {!!shape && (
        <View style={s.info}>
          <Text style={s.code}>{shape.code}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.line, shape.kind === 'not_active' && { color: c.red }]}>{shape.label}</Text>
            <Text style={s.muted}>
              {[shape.households ? `${shape.households.toLocaleString(APP_LOCALE)} households` : '',
                shape.last_worked ? `Acwyre: last worked ${new Date(shape.last_worked + 'T12:00:00').toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: '2-digit' })}` : '',
                shape.weeks_since != null ? `${shape.weeks_since} weeks ago` : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      )}
      {!loading && data?.sector && !shape && (
        <Text style={s.muted}>
          {data.sector.postcode ? `${data.sector.postcode} isn't on the territory map, so there's no outline. You can still mark off streets.` : 'Save the postcode to see the sector outline.'}
        </Text>
      )}

      <View style={[s.mapBox, { height }]}>
        <View ref={box} style={StyleSheet.absoluteFill} />
        {(!ready || loading) && !failed && <View style={s.overlay} pointerEvents="none"><ActivityIndicator color={c.primary} /></View>}
        {failed && <View style={s.overlay}><Text style={s.muted}>The map couldn't load. Check your signal and try again.</Text></View>}
        <Pressable onPress={locate} style={s.locate} accessibilityLabel="Show where I am" hitSlop={6}>
          <Ionicons name="locate" size={18} color={c.text} />
        </Pressable>
      </View>

      <View style={s.legend}>
        <View style={s.key}><View style={[s.swatch, { backgroundColor: '#000' }]} /><Text style={s.small}>Worked (confirmed)</Text></View>
        <View style={s.key}><View style={[s.swatch, { backgroundColor: c.primary }]} /><Text style={s.small}>Marked off today</Text></View>
      </View>

      {drawing ? (
        <View style={{ gap: 6 }}>
          <Text style={s.muted}>Tap along each street you did. Tap "New street" when you jump to another one.</Text>
          <View style={s.row}>
            <Pressable onPress={undo} style={s.ghost} accessibilityRole="button"><Ionicons name="arrow-undo" size={15} color={c.primary} /><Text style={s.ghostText}>Undo</Text></Pressable>
            <Pressable onPress={newStreet} style={s.ghost} accessibilityRole="button"><Ionicons name="add" size={15} color={c.primary} /><Text style={s.ghostText}>New street</Text></Pressable>
            <Pressable onPress={() => { setDrawing(false); setLines([[]]); }} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Cancel</Text></Pressable>
            <Pressable onPress={save} disabled={!!busy} style={s.btn} accessibilityRole="button" testID="map-save">
              {busy === 'save' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
              <Text style={s.btnText}>Save{done.length ? ` (${done.length})` : ''}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.row}>
          {!!data?.can_draw && (
            <Pressable onPress={() => setDrawing(true)} style={endOfDay ? s.ghost : s.btn} accessibilityRole="button" testID="map-markoff">
              <Ionicons name="brush-outline" size={15} color={endOfDay ? c.primary : c.onPrimary} />
              <Text style={endOfDay ? s.ghostText : s.btnText}>Mark off streets</Text>
            </Pressable>
          )}
          {!!data?.can_share && !endOfDay && (
            <Pressable onPress={share} disabled={!!busy} style={s.ghost} accessibilityRole="button" testID="map-share">
              {busy === 'share' ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name="paper-plane-outline" size={15} color={c.primary} />}
              <Text style={s.ghostText}>Share with the sector</Text>
            </Pressable>
          )}
          {!!data?.can_confirm && (endOfDay || drafts > 0) && (
            <Pressable onPress={confirm} disabled={!!busy} style={endOfDay ? s.btnDark : s.ghost} accessibilityRole="button" testID="map-confirm">
              {busy === 'confirm' ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-done" size={15} color={endOfDay ? '#fff' : c.primary} />}
              <Text style={endOfDay ? s.btnDarkText : s.ghostText}>Confirm{drafts ? ` (${drafts})` : ''} and mark black</Text>
            </Pressable>
          )}
          {!!data?.can_share && (
            <Pressable onPress={() => Linking.openURL(FREE_MAP_TOOLS)} style={s.ghost} accessibilityRole="link">
              <Ionicons name="open-outline" size={15} color={c.primary} />
              <Text style={s.ghostText}>Free Map Tools</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  info: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { fontFamily: fonts.display, fontSize: 22, color: c.text },
  line: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  mapBox: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 900 },
  locate: { position: 'absolute', right: 10, bottom: 24, zIndex: 1000, width: 38, height: 38, borderRadius: 19, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 5, borderRadius: 3 },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  btnDark: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#000' },
  btnDarkText: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
