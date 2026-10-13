// Territory (Admins only): upload Acwyre's territory zip (a fresh set of
// sectors each quarter, then the weekly one with the sales pins), check what
// it holds, save it, and see the whole territory on one map: every sector,
// new builds, sales pins and every street the sectors confirmed as worked.
// Sector leaders and BAs never see this: they get their own sector's map.
// (backend routes/territory.py)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { todayISO } from '../src/utils/calendarDates';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { APP_LOCALE } from '../src/utils/appTime';
import { loadLeaflet, OSM_TILES, OSM_ATTRIBUTION, esc } from '../src/utils/leaflet';

// Acwyre's own map colours, so the layers look the way they do in their file.
const LAYERS = [
  { key: 'active', label: 'Active', colour: '#00BFFF' },
  { key: 'priority', label: 'Priority (road trip)', colour: '#FEE12B' },
  { key: 'not_active', label: 'Not active yet', colour: '#D30000' },
  { key: 'new_build', label: 'New builds', colour: '#FF8C00' },
  { key: 'worked', label: 'Worked (confirmed)', colour: '#000000' },
  { key: 'sale', label: 'Sales', colour: '#228B22' },
  { key: 'out_of_territory', label: 'Out-of-territory sales', colour: '#dc3545' },
];

type Picked = { name: string; b64: string };

export default function TerritoryScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [picked, setPicked] = useState<Picked | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const overview = useQuery({ queryKey: ['territory'], enabled: isAdmin, queryFn: () => apiService.getTerritory().then((r) => r.data) });

  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed', 'text/html', '*/*'], copyToCacheDirectory: true, multiple: false });
      if (res.canceled) return;
      const f = res.assets[0];
      const blob = await (await fetch(f.uri)).blob();
      const b64 = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result || '').split(',')[1] || '');
        r.readAsDataURL(blob);
      });
      setPicked({ name: f.name, b64 });
      setBusy('read');
      const r = await apiService.territoryUpload({ filename: f.name, data_b64: b64, save: false });
      setPreview(r.data.summary);
    } catch (e: any) {
      setPicked(null); setPreview(null);
      showAlert('Could not read that file', e?.response?.data?.detail || e?.message || 'Try again.');
    } finally { setBusy(null); }
  };

  const save = async () => {
    if (!picked) return;
    setBusy('save');
    try {
      await apiService.territoryUpload({ filename: picked.name, data_b64: picked.b64, save: true });
      toast.success('Territory saved');
      setPicked(null); setPreview(null);
      qc.invalidateQueries({ queryKey: ['territory'] });
      qc.invalidateQueries({ queryKey: ['territory-map'] });
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(null); }
  };

  if (!isAdmin) {
    return <View style={[s.page, s.center]}><Text style={s.muted}>The territory is for the Owner and Admins.</Text></View>;
  }
  const uploads: any[] = overview.data?.uploads || [];

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}>
      <View style={s.card}>
        <Text style={s.h}>Upload Acwyre's territory</Text>
        <Text style={s.muted}>
          The zip they send: the quarterly one with fresh sectors, or the weekly one with the sales pins. Whatever's in it
          replaces what's here. Only Admins see the full territory; sector leaders and BAs only ever see their own sector.
        </Text>
        <Pressable onPress={pick} disabled={!!busy} style={s.btn} accessibilityRole="button" testID="territory-pick">
          {busy === 'read' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="cloud-upload-outline" size={16} color={c.onPrimary} />}
          <Text style={s.btnText}>{picked ? 'Choose a different file' : 'Choose the zip'}</Text>
        </Pressable>
        {!!preview && (
          <View style={s.preview}>
            <Text style={s.line}>{picked?.name}</Text>
            <Text style={s.muted}>
              {preview.sectors} sectors ({Object.entries(preview.by_kind || {}).map(([k, v]) => `${v} ${LAYERS.find((l) => l.key === k)?.label.toLowerCase() || k}`).join(', ')})
              {preview.zones ? ` · ${preview.zones} new-build zones` : ''}
              {preview.dots?.sale != null ? ` · ${preview.dots.sale} sales` : ''}
              {preview.dots?.out_of_territory != null ? ` · ${preview.dots.out_of_territory} out of territory` : ''}
            </Text>
            <Pressable onPress={save} disabled={!!busy} style={s.btn} accessibilityRole="button" testID="territory-save">
              {busy === 'save' ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Ionicons name="checkmark" size={16} color={c.onPrimary} />}
              <Text style={s.btnText}>Save this territory</Text>
            </Pressable>
          </View>
        )}
        {uploads.length > 0 && (
          <View style={{ gap: 2, marginTop: 6 }}>
            <Text style={s.label}>Uploaded</Text>
            {uploads.slice(0, 5).map((u) => (
              <Text key={u.id} style={s.small}>
                {new Date(u.at).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })} · {u.filename} · {u.summary?.sectors || 0} sectors{u.summary?.dots?.sale != null ? `, ${u.summary.dots.sale} sales` : ''} · {u.by_name}
              </Text>
            ))}
          </View>
        )}
      </View>

      <TodayCard s={s} c={c} />

      {uploads.length > 0 && <BigMap s={s} c={c} />}
    </ScrollView>
  );
}

// Today's sectors, each opening its own map, and the ways into the rest.
function TodayCard({ s, c }: { s: any; c: any }) {
  const router = useRouter();
  const today = todayISO();
  const q = useQuery({ queryKey: ['sector-board', today], queryFn: () => apiService.getSectorBoard(today).then((r) => r.data) });
  const sectors: any[] = q.data?.sectors || [];
  const link = (icon: any, label: string, to: string, testID: string) => (
    <Pressable onPress={() => router.push(to as never)} style={s.ghost} accessibilityRole="button" testID={testID}>
      <Ionicons name={icon} size={15} color={c.primary} />
      <Text style={s.ghostText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={s.card}>
      <Text style={s.h}>Today's sectors</Text>
      {q.isLoading ? <ActivityIndicator color={c.primary} /> : sectors.length === 0 ? (
        <Text style={s.muted}>No sectors set up yet today. To try it yourself: set up your own sector, save a postcode, then open its map.</Text>
      ) : sectors.map((sec) => (
        <Pressable key={sec.leader_id} onPress={() => router.push(`/sector-map?leader=${sec.leader_id}&date=${today}` as never)}
          style={s.sectorRow} accessibilityRole="button">
          <View style={{ flex: 1 }}>
            <Text style={s.line}>{sec.leader_name || 'Sector'}{sec.postcode ? ` · ${sec.postcode}` : ''}</Text>
            <Text style={s.small}>{sec.people?.length || 0} in the sector · {sec.hit}/{sec.goal} sign-ups</Text>
          </View>
          <Ionicons name="map-outline" size={18} color={c.primary} />
        </Pressable>
      ))}
      <View style={s.links}>
        {link('rocket-outline', 'Set up my sector', '/sector?start=1', 'terr-setup')}
        {link('grid-outline', 'Sectors board', '/sectors', 'terr-board')}
        {link('analytics-outline', 'Area history', '/areas', 'terr-areas')}
      </View>
    </View>
  );
}

function BigMap({ s, c }: { s: any; c: any }) {
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const groups = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>({ active: true, priority: true, not_active: true, new_build: true, worked: true, sale: true, out_of_territory: false });
  const q = useQuery({ queryKey: ['territory-map'], queryFn: () => apiService.getTerritoryMap().then((r) => r.data) });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let dead = false;
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el || map.current) return;
      const m = L.map(el, { scrollWheelZoom: true, preferCanvas: true }).setView([53.7, -1.6], 8);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      for (const l of LAYERS) groups.current[l.key] = L.layerGroup();
      map.current = m;
      setTimeout(() => m.invalidateSize(), 200);
      setReady(true);
    });
    return () => { dead = true; if (map.current) { map.current.remove(); map.current = null; } };
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    const d = q.data;
    if (!ready || !L || !d) return;
    for (const g of Object.values(groups.current)) g.clearLayers();
    const colour = (k: string) => LAYERS.find((l) => l.key === k)?.colour || '#888';
    const dt = (iso?: string | null) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: '2-digit' }) : '—');
    const all: any[] = [];
    for (const sec of d.sectors || []) {
      const g = groups.current[sec.kind] || groups.current.active;
      const lay = L.geoJSON(sec.geometry, { style: { color: '#222', weight: 1.2, fillColor: colour(sec.kind), fillOpacity: 0.3 } });
      lay.bindTooltip(`<b>${esc(sec.code)}</b> · ${esc(d.labels?.[sec.kind] || sec.kind)}<br/>Households: ${esc(sec.households ?? '—')}<br/>Last worked: ${esc(dt(sec.last_worked))}${sec.weeks_since != null ? ` (${esc(sec.weeks_since)} weeks)` : ''}<br/>Sales: ${esc(sec.sales ?? 0)}`, { sticky: true });
      lay.addTo(g);
      all.push(lay);
    }
    for (const z of d.zones || []) {
      L.geoJSON(z.geometry, { style: { color: colour('new_build'), weight: 2, fillColor: colour('new_build'), fillOpacity: 0.45 } }).bindTooltip('New build').addTo(groups.current.new_build);
    }
    for (const w of d.worked || []) {
      for (const line of w.lines || []) {
        L.polyline(line, { color: '#000', weight: 4, opacity: 0.85 }).bindTooltip(`Worked ${esc(dt(w.date))}${w.postcode ? ` · ${esc(w.postcode)}` : ''}`).addTo(groups.current.worked);
      }
    }
    for (const p of d.dots || []) {
      const g = groups.current[p.kind];
      if (g) L.circleMarker([p.lat, p.lng], { radius: 3.5, color: '#000', weight: 1, fillColor: colour(p.kind), fillOpacity: 0.9 }).addTo(g);
    }
    if (all.length) map.current.fitBounds(L.featureGroup(all).getBounds(), { padding: [10, 10] });
  }, [q.data, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    for (const l of LAYERS) {
      const g = groups.current[l.key];
      if (!g) continue;
      if (on[l.key] && !map.current.hasLayer(g)) g.addTo(map.current);
      if (!on[l.key] && map.current.hasLayer(g)) map.current.removeLayer(g);
    }
  }, [on, ready, q.data]);

  if (Platform.OS !== 'web') return null;
  return (
    <View style={s.card}>
      <Text style={s.h}>Your territory</Text>
      <View style={s.chips}>
        {LAYERS.map((l) => (
          <Pressable key={l.key} onPress={() => setOn((o) => ({ ...o, [l.key]: !o[l.key] }))}
            style={[s.chip, on[l.key] && { borderColor: c.text }]} accessibilityRole="switch" accessibilityState={{ checked: !!on[l.key] }}>
            <View style={[s.dot, { backgroundColor: l.colour, opacity: on[l.key] ? 1 : 0.3 }]} />
            <Text style={[s.chipText, !on[l.key] && { color: c.textMuted }]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.mapBox}>
        <View ref={box} style={StyleSheet.absoluteFill} />
        {(q.isLoading || !ready) && <View style={s.overlay} pointerEvents="none"><ActivityIndicator color={c.primary} /></View>}
      </View>
      {!!q.data?.pins_updated_at && (
        <Text style={s.small}>Sales pins from the upload on {new Date(q.data.pins_updated_at).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' })}.</Text>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 1100, alignSelf: 'center' },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 },
  h: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  line: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  preview: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
  sectorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  mapBox: { height: 560, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 900 },
});
