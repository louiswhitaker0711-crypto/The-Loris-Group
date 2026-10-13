// The sector map: the one sector the person is in today (or a leader's
// sector, for the leader or an Admin). Acwyre's outline of the postcode
// sector, the streets confirmed in the last 12 weeks in solid black, and
// today's drawing.
//
//   • Draw with your finger (or a mouse): the Pen draws, the Eraser rubs out
//     anything today's you're allowed to remove, Move pans the map.
//   • Bunny hops: the sector leader gives each pair one of five colours and
//     draws each hop's AREA in its colour (a wide highlighter line). Share
//     sends each hop their coloured area.
//   • Through the day each hop draws what they've DONE in their colour; the
//     leader can draw, erase and add too. Confirm turns what's done solid
//     black and puts it on the Owner's territory map.
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
import { HOP_COLOURS, hopHex, hopLabel } from '../../utils/hopColours';

const FREE_MAP_TOOLS = 'https://www.freemaptools.com/uk-postcode-map.htm';
const MAX_POINTS = 380;
type Mode = 'move' | 'pen' | 'erase';
type Kind = 'plan' | 'done';

type Props = {
  date: string;
  leaderId?: string;          // an Admin looking at someone's sector
  height?: number;
  endOfDay?: boolean;         // the breakdown: drawing what's done, then confirm
};

/** Distance in pixels from point p to segment a–b. */
function segDist(p: any, a: any, b: any) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx, y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

export function SectorMap({ date, leaderId, height = 400, endOfDay = false }: Props) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const shapeLayer = useRef<any>(null);
  const marksLayer = useRef<any>(null);
  const liveLayer = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('move');
  const [kind, setKind] = useState<Kind>(endOfDay ? 'done' : 'plan');
  const [colour, setColour] = useState<string>('red');
  const [hopsOpen, setHopsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const placed = useRef(false);
  // The pointer handlers read the latest state through refs.
  const st = useRef({ mode, kind, colour, data, date, leaderId });
  st.current = { mode, kind, colour, data, date, leaderId };

  const load = useCallback(async () => {
    try {
      const r = await apiService.getSectorMap(date, leaderId);
      setData(r.data);
    } catch { /* keep what's shown */ }
    finally { setLoading(false); }
  }, [date, leaderId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // A BA draws in their hop's colour.
    if (data && !data.leads && data.my_colour) setColour(data.my_colour);
  }, [data]);

  const saveStroke = useCallback(async (latlngs: number[][]) => {
    const { kind: k, colour: col, data: d, date: dt, leaderId: lid } = st.current;
    let pts = latlngs;
    if (pts.length > MAX_POINTS) {
      const step = Math.ceil(pts.length / MAX_POINTS);
      pts = pts.filter((_, i) => i % step === 0 || i === latlngs.length - 1);
    }
    try {
      await apiService.saveCoverage({ date: dt, lines: [pts], leader_id: lid,
        kind: d?.can_confirm ? k : 'done', colour: col });
      load();
    } catch (e: any) {
      showAlert('Could not save that line', e?.response?.data?.detail || 'Try again.');
      load();
    }
  }, [load]);

  const erasing = useRef<Set<string>>(new Set());
  const eraseAt = useCallback((pt: any) => {
    const { data: d } = st.current;
    const m = map.current;
    if (!d || !m) return;
    for (const mk of d.marks || []) {
      if (!mk.can_delete || mk.status === 'confirmed' || erasing.current.has(mk.id)) continue;
      for (const line of mk.lines || []) {
        let hit = false;
        for (let i = 1; i < line.length && !hit; i++) {
          if (segDist(pt, m.latLngToContainerPoint(line[i - 1]), m.latLngToContainerPoint(line[i])) < 14) hit = true;
        }
        if (hit) {
          erasing.current.add(mk.id);
          apiService.deleteCoverage(mk.id).then(load).catch(() => {}).finally(() => erasing.current.delete(mk.id));
          break;
        }
      }
    }
  }, [load]);

  // Build the map once, with freehand drawing on top of it.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let dead = false;
    let cleanup = () => {};
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el || map.current) return;
      const m = L.map(el, { scrollWheelZoom: false }).setView([53.8, -1.55], 9);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      shapeLayer.current = L.layerGroup().addTo(m);
      marksLayer.current = L.layerGroup().addTo(m);
      liveLayer.current = L.layerGroup().addTo(m);
      map.current = m;

      let pts: number[][] = [];
      let live: any = null;
      let lastPx: any = null;
      let active = false;
      const down = (e: PointerEvent) => {
        const md = st.current.mode;
        if (md === 'move') return;
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
        active = true;
        const p = m.mouseEventToContainerPoint(e);
        lastPx = p;
        if (md === 'erase') { eraseAt(p); return; }
        const ll = m.containerPointToLatLng(p);
        pts = [[ll.lat, ll.lng]];
        const { kind: k, colour: col, data: d } = st.current;
        const planning = d?.can_confirm && k === 'plan';
        live = L.polyline(pts, planning
          ? { color: hopHex(col), weight: 18, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }
          : { color: hopHex(col, c.primary), weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(liveLayer.current);
      };
      const move = (e: PointerEvent) => {
        if (!active) return;
        e.preventDefault(); e.stopPropagation();
        const p = m.mouseEventToContainerPoint(e);
        if (st.current.mode === 'erase') { eraseAt(p); return; }
        if (lastPx && Math.hypot(p.x - lastPx.x, p.y - lastPx.y) < 3) return;
        lastPx = p;
        const ll = m.containerPointToLatLng(p);
        pts.push([ll.lat, ll.lng]);
        live?.setLatLngs(pts);
      };
      const up = (e: PointerEvent) => {
        if (!active) return;
        active = false;
        e.stopPropagation();
        if (st.current.mode === 'pen' && pts.length >= 2) saveStroke(pts.map((q) => [q[0], q[1]]));
        pts = [];
        setTimeout(() => liveLayer.current?.clearLayers(), 600);
      };
      el.addEventListener('pointerdown', down, true);
      el.addEventListener('pointermove', move, true);
      el.addEventListener('pointerup', up, true);
      el.addEventListener('pointercancel', up, true);
      cleanup = () => {
        el.removeEventListener('pointerdown', down, true);
        el.removeEventListener('pointermove', move, true);
        el.removeEventListener('pointerup', up, true);
        el.removeEventListener('pointercancel', up, true);
      };
      setTimeout(() => m.invalidateSize(), 200);
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { dead = true; cleanup(); if (map.current) { map.current.remove(); map.current = null; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pen and Eraser hold the map still; Move lets it pan and zoom.
  useEffect(() => {
    const m = map.current;
    const el = box.current as unknown as HTMLElement | null;
    if (!m || !el) return;
    if (mode === 'move') { m.dragging.enable(); m.touchZoom.enable(); m.doubleClickZoom.enable(); el.style.cursor = ''; }
    else { m.dragging.disable(); m.touchZoom.disable(); m.doubleClickZoom.disable(); el.style.cursor = 'crosshair'; }
    el.style.touchAction = mode === 'move' ? '' : 'none';
  }, [mode, ready]);

  // Outline and lines.
  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !data) return;
    shapeLayer.current.clearLayers();
    marksLayer.current.clearLayers();
    const shape = data.shape;
    if (shape?.geometry) {
      const notActive = shape.kind === 'not_active';
      const gj = L.geoJSON(shape.geometry, { interactive: false, style: {
        color: notActive ? c.red : c.primary, weight: 2.5, fillColor: notActive ? c.red : c.primary, fillOpacity: 0.06 } });
      gj.addTo(shapeLayer.current);
      if (!placed.current) { map.current.fitBounds(gj.getBounds(), { padding: [12, 12] }); placed.current = true; }
    } else if (!placed.current && data.sector?.postcode) {
      placePostcode(data.sector.postcode).then((at) => { if (at && map.current) map.current.setView([at.lat, at.lng], at.zoom); });
      placed.current = true;
    }
    // Planned areas underneath, then today's done lines, then confirmed black on top.
    const order = (mk: any) => (mk.status === 'plan' ? 0 : mk.status === 'draft' ? 1 : 2);
    const marks = (data.marks || []).slice().sort((a: any, b: any) => order(a) - order(b));
    for (const mk of marks) {
      const when = new Date(mk.date + 'T12:00:00').toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
      const who = esc(mk.author_name || mk.leader_name || 'Someone');
      let style: any; let title: string;
      if (mk.status === 'plan') {
        style = { color: hopHex(mk.colour), weight: 18, opacity: 0.32, lineCap: 'round', lineJoin: 'round' };
        title = `${esc(hopLabel(mk.colour) || 'Planned')} area`;
      } else if (mk.status === 'draft') {
        style = { color: hopHex(mk.colour, c.primary), weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' };
        title = `Done today${mk.colour ? ` · ${esc(hopLabel(mk.colour))}` : ''} (not confirmed yet)`;
      } else {
        style = { color: '#000', weight: 6, opacity: mk.days_ago > 28 ? 0.35 : 0.85, lineCap: 'round', lineJoin: 'round' };
        title = `Worked ${esc(when)}`;
      }
      for (const line of mk.lines || []) {
        const pl = L.polyline(line, style).addTo(marksLayer.current);
        const del = mk.can_delete ? `<br/><a href="#" data-del="${esc(mk.id)}">Remove</a>` : '';
        pl.bindPopup(`<b>${title}</b><br/>By ${who}${del}`);
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

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => map.current?.setView([p.coords.latitude, p.coords.longitude], 17),
      () => showAlert('Location', 'Allow location for the app to show where you are.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
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
    showAlert('Confirm the map?', "Everything drawn as done today turns solid black and goes on the Owner's territory map. Rub out anything that wasn't done first.", [
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
  const leads = !!data?.can_confirm;
  const hops: any[] = data?.hops || [];
  const myColour: string | null = data?.my_colour || null;

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
          {data.sector.postcode ? `${data.sector.postcode} isn't on the territory map, so there's no outline. You can still draw on it.` : 'Save the postcode to see the sector outline.'}
        </Text>
      )}
      {!leads && !!myColour && (
        <View style={s.myHop}>
          <View style={[s.bigDot, { backgroundColor: hopHex(myColour) }]} />
          <Text style={s.line}>You're in the {hopLabel(myColour).toLowerCase()} bunny hop: work the {hopLabel(myColour).toLowerCase()} area.</Text>
        </View>
      )}

      {!!data?.can_draw && (
        <View style={s.toolbar}>
          {([['move', 'hand-left-outline', 'Move'], ['pen', 'pencil', 'Pen'], ['erase', 'remove-circle-outline', 'Eraser']] as const).map(([k, icon, label]) => (
            <Pressable key={k} onPress={() => setMode(k)} style={[s.tool, mode === k && s.toolOn]} accessibilityRole="button" accessibilityState={{ selected: mode === k }} testID={`map-${k}`}>
              <Ionicons name={icon as any} size={16} color={mode === k ? c.onPrimary : c.text} />
              <Text style={[s.toolText, mode === k && { color: c.onPrimary }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!data?.can_draw && leads && mode === 'pen' && (
        <View style={{ gap: 6 }}>
          <View style={s.toolbar}>
            {([['plan', 'Plan areas'], ['done', 'Mark done']] as const).map(([k, label]) => (
              <Pressable key={k} onPress={() => setKind(k)} style={[s.tool, kind === k && s.toolOn]} accessibilityRole="button" accessibilityState={{ selected: kind === k }}>
                <Text style={[s.toolText, kind === k && { color: c.onPrimary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.colours}>
            {HOP_COLOURS.map((h) => (
              <Pressable key={h.key} onPress={() => setColour(h.key)} accessibilityLabel={h.label} accessibilityState={{ selected: colour === h.key }}
                style={[s.swatchBtn, { backgroundColor: h.hex }, colour === h.key && s.swatchOn]} />
            ))}
            <Text style={s.small}>{kind === 'plan' ? `Drawing the ${hopLabel(colour).toLowerCase()} area` : `Marking done in ${hopLabel(colour).toLowerCase()}`}</Text>
          </View>
        </View>
      )}
      {mode !== 'move' && (
        <Text style={s.small}>
          {mode === 'pen' ? 'Draw along the streets with your finger. Tap Move to pan or zoom the map.' : "Rub over a line to remove it (today's lines only)."}
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
        {hops.map((h) => (
          <View key={h.colour} style={s.key}>
            <View style={[s.swatch, { backgroundColor: hopHex(h.colour), height: 8, opacity: 0.6 }]} />
            <Text style={s.small}>{hopLabel(h.colour)}{h.members.length ? `: ${h.members.map((n: string) => n.split(' ')[0]).join(' & ')}` : ''}</Text>
          </View>
        ))}
        <View style={s.key}><View style={[s.swatch, { backgroundColor: '#000' }]} /><Text style={s.small}>Worked (confirmed)</Text></View>
      </View>

      {leads && (hopsOpen || (!hops.length && !endOfDay)) && (
        <HopsEditor date={date} data={data} onSaved={() => { setHopsOpen(false); load(); }} s={s} c={c} />
      )}

      <View style={s.row}>
        {leads && !endOfDay && hops.length > 0 && !hopsOpen && (
          <Pressable onPress={() => setHopsOpen(true)} style={s.ghost} accessibilityRole="button">
            <Ionicons name="color-palette-outline" size={15} color={c.primary} />
            <Text style={s.ghostText}>Bunny hops</Text>
          </Pressable>
        )}
        {!!data?.can_share && !endOfDay && (
          <Pressable onPress={share} disabled={!!busy} style={s.btn} accessibilityRole="button" testID="map-share">
            {busy === 'share' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="paper-plane-outline" size={15} color={c.onPrimary} />}
            <Text style={s.btnText}>Send each hop their map</Text>
          </Pressable>
        )}
        {leads && (endOfDay || drafts > 0) && (
          <Pressable onPress={confirm} disabled={!!busy} style={endOfDay ? s.btnDark : s.ghost} accessibilityRole="button" testID="map-confirm">
            {busy === 'confirm' ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-done" size={15} color={endOfDay ? '#fff' : c.primary} />}
            <Text style={endOfDay ? s.btnDarkText : s.ghostText}>Confirm{drafts ? ` (${drafts})` : ''} and mark black</Text>
          </Pressable>
        )}
        {leads && (
          <Pressable onPress={() => Linking.openURL(FREE_MAP_TOOLS)} style={s.ghost} accessibilityRole="link">
            <Ionicons name="open-outline" size={15} color={c.primary} />
            <Text style={s.ghostText}>Free Map Tools</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Bunny hops: who's in each colour. Someone is in one hop at a time.
function HopsEditor({ date, data, onSaved, s, c }: any) {
  const people: { user_id: string; name: string }[] = data?.sector?.people || [];
  const [pick, setPick] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const h of data?.hops || []) for (const id of h.member_ids || []) out[id] = h.colour;
    return out;
  });
  const [colour, setColour] = useState<string>(HOP_COLOURS[0].key);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPick((p) => ({ ...p, [id]: p[id] === colour ? '' : colour }));
  const save = async () => {
    const hops = HOP_COLOURS.map((h) => ({ colour: h.key, member_ids: Object.keys(pick).filter((id) => pick[id] === h.key) }))
      .filter((h) => h.member_ids.length);
    setBusy(true);
    try { await apiService.saveHops(date, hops); toast.success('Bunny hops saved'); onSaved(); }
    catch (e: any) { showAlert('Could not save', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <View style={s.hops}>
      <Text style={s.line}>Bunny hops</Text>
      <Text style={s.small}>Pick a colour, tap the people in that hop, then draw their area with the Pen in "Plan areas".</Text>
      <View style={s.colours}>
        {HOP_COLOURS.map((h) => (
          <Pressable key={h.key} onPress={() => setColour(h.key)} accessibilityLabel={h.label}
            style={[s.swatchBtn, { backgroundColor: h.hex }, colour === h.key && s.swatchOn]} />
        ))}
        <Text style={s.small}>{hopLabel(colour)}</Text>
      </View>
      <View style={s.people}>
        {people.map((p) => {
          const col = pick[p.user_id];
          return (
            <Pressable key={p.user_id} onPress={() => toggle(p.user_id)} accessibilityRole="button"
              style={[s.person, col && { borderColor: hopHex(col), backgroundColor: hopHex(col) + '22' }]}>
              {!!col && <View style={[s.dotSm, { backgroundColor: hopHex(col) }]} />}
              <Text style={s.personText}>{p.name.split(' ')[0]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={save} disabled={busy} style={s.btn} accessibilityRole="button" testID="hops-save">
        {busy ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={15} color={c.onPrimary} />}
        <Text style={s.btnText}>Save bunny hops</Text>
      </Pressable>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  info: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { fontFamily: fonts.display, fontSize: 22, color: c.text },
  line: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text, flexShrink: 1 },
  myHop: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  bigDot: { width: 18, height: 18, borderRadius: 9 },
  toolbar: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  toolOn: { backgroundColor: c.primary, borderColor: c.primary },
  toolText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  colours: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  swatchBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: 'transparent' },
  swatchOn: { borderColor: c.text },
  mapBox: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 900 },
  locate: { position: 'absolute', right: 10, bottom: 24, zIndex: 1000, width: 38, height: 38, borderRadius: 19, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 5, borderRadius: 3 },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: c.textMuted },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  hops: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.background },
  personText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  dotSm: { width: 10, height: 10, borderRadius: 5 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  btnDark: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#000' },
  btnDarkText: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
