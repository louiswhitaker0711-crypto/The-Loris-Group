// The sector map: the one sector the person is in today (or a leader's
// sector, for the leader or an Admin). Acwyre's outline of the postcode
// sector, the streets confirmed in the last 12 weeks in solid black, and
// today's drawing.
//
//   • Like drawing on a WhatsApp photo: one finger draws, two fingers move
//     and zoom the map, Undo takes back your last line. Tap a line to remove
//     it. On a computer: drag to draw, hold Shift and drag (or right-drag)
//     to move, scroll to zoom.
//   • Bunny hops: the sector leader gives each pair one of five colours and
//     draws each hop's AREA in its colour (a wide highlighter line). Share
//     sends each hop their coloured area.
//   • Through the day each hop draws what they've DONE in their colour; the
//     leader can draw, erase and add too. Confirm turns what's done solid
//     black and puts it on the Owner's territory map.
//   • Snap to streets (the Owner, 26 Nov 2026): every line drawn is moved
//     onto the roads it went along (OpenStreetMap roads, not footpaths;
//     POST /roads/snap). The switch turns it off to draw freehand.
//   • Half street: a done line (or a route) on one side of the road only.
//   • Draw route: optional, per bunny hop. The hop's route in its colour,
//     arrows the way it was drawn, a start and a finish flag. Only that hop
//     and the Coaches planning the areas see it (src/utils/mapDeco.ts).
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
import { setDeco, decoFor, isDeco } from '../../utils/mapDeco';

const FREE_MAP_TOOLS = 'https://www.freemaptools.com/uk-postcode-map.htm';
const MAX_POINTS = 380;
type Kind = 'plan' | 'done' | 'request' | 'move' | 'edit' | 'route';
type RouteTool = 'draw' | 'start' | 'finish';
const SNAP_KEY = 'loris.map.snap';
const readSnap = () => { try { return globalThis.localStorage?.getItem(SNAP_KEY) !== '0'; } catch { return true; } };
// When the server can't reach OpenStreetMap, the phone fetches the roads
// itself (tiles the server names) and hands them over: they're kept for
// everyone for a month.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const fetching: Record<string, Promise<boolean>> = {};
async function fetchTiles(missing: { key: string; query: string }[] | undefined): Promise<boolean> {
  if (!missing?.length) return false;
  const one = (m: { key: string; query: string }) => (fetching[m.key] ||= (async () => {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: m.query }) });
        if (!r.ok) continue;
        await apiService.uploadRoadTile(m.key, await r.json());
        return true;
      } catch { /* next server */ }
    }
    delete fetching[m.key];
    return false;
  })());
  const got = await Promise.all(missing.slice(0, 4).map(one));
  return got.some(Boolean);
}
// A light moving average: takes the wobble out of a freehand line.
const smoothLine = (pts: number[][]) => {
  let out = pts;
  for (let k = 0; k < 2 && out.length > 2; k++) {
    out = [out[0], ...out.slice(1, -1).map((p, i) => [(out[i][0] + 2 * p[0] + out[i + 2][0]) / 4, (out[i][1] + 2 * p[1] + out[i + 2][1]) / 4]), out[out.length - 1]];
  }
  return out;
};
// Line weights: planned areas a soft, fairly thin band; done lines thin.
const PLAN_STYLE = { weight: 7, opacity: 0.45 };
const DONE_WEIGHT = 3.5;
const WORKED_WEIGHT = 4;

type Props = {
  date: string;
  leaderId?: string;          // an Admin looking at someone's sector
  height?: number;
  endOfDay?: boolean;         // the breakdown: drawing what's done, then confirm
};

export function SectorMap({ date, leaderId, height = 400, endOfDay = false }: Props) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const box = useRef<View>(null);
  const map = useRef<any>(null);
  const shapeLayer = useRef<any>(null);
  const marksLayer = useRef<any>(null);
  const liveLayer = useRef<any>(null);
  const pendingLayer = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>('move');
  const [colour, setColour] = useState<string>('red');
  const [hopsOpen, setHopsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const placed = useRef(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [snap, setSnapState] = useState<boolean>(readSnap);
  const setSnap = (v: boolean) => { setSnapState(v); try { globalThis.localStorage?.setItem(SNAP_KEY, v ? '1' : '0'); } catch { /* fine */ } };
  const [half, setHalf] = useState(false);
  const [routeTool, setRouteTool] = useState<RouteTool>('draw');
  const warmed = useRef('');
  // A request for more streets (a BA) or a sector leader's redraw of one is
  // drawn here first, then sent as one: nothing is saved line by line.
  const [pending, setPending] = useState<number[][][]>([]);
  const [editing, setEditing] = useState<any>(null);   // the request being redrawn
  // The pointer handlers read the latest state through refs.
  const st = useRef({ kind, colour, data, date, leaderId, editColour: '', snap, half, routeTool });
  st.current = { kind, colour, data, date, leaderId, editColour: editing?.colour || '', snap, half, routeTool };

  const load = useCallback(async () => {
    try {
      const r = await apiService.getSectorMap(date, leaderId);
      setData(r.data);
    } catch { /* keep what's shown */ }
    finally { setLoading(false); }
  }, [date, leaderId]);
  useEffect(() => { load(); }, [load]);
  // The map always opens on Move map: one finger moves it, for everyone,
  // the sector leader included. Nobody draws until they press a button (a
  // BA: Mark done or Request more streets; the leader: Plan areas or Mark
  // done).
  const chosen = useRef(false);
  useEffect(() => {
    if (!data) return;
    // A BA draws in their hop's colour.
    // A Coach planning areas picks their own colour.
    if (!data.leads && !data.can_plan_areas && data.my_colour) setColour(data.my_colour);
    // Fetch the sector's roads ahead of the first line, so snapping is quick.
    const b = data.shape?.bbox;
    const key = b ? `${b.s},${b.w},${b.n},${b.e}` : '';
    if (key && warmed.current !== key) {
      warmed.current = key;
      apiService.warmRoads({ s: b.s - 0.003, w: b.w - 0.005, n: b.n + 0.003, e: b.e + 0.005 })
        .then((r) => fetchTiles(r.data?.missing)).catch(() => { /* snapping fetches on demand */ });
    }
    if (!chosen.current) { chosen.current = true; setKind('move'); }
    else if (!data.can_confirm && !data.can_plan_areas) setKind((k) => (k === 'plan' ? 'move' : k));
  }, [data]);
  const pick = (k: Kind) => {
    chosen.current = true;
    // Leaving a redraw drops it (nothing was sent).
    if (k !== 'edit') setEditing((e: any) => { if (e) setPending([]); return null; });
    setKind(k);
  };
  const drawing = !!data?.can_draw && kind !== 'move';

  const saveStroke = useCallback(async (latlngs: number[][]) => {
    const { kind: k, colour: col, data: d, date: dt, leaderId: lid, snap: snapOn, half: halfOn } = st.current;
    let pts = latlngs;
    if (pts.length > MAX_POINTS) {
      const step = Math.ceil(pts.length / MAX_POINTS);
      pts = pts.filter((_, i) => i % step === 0 || i === latlngs.length - 1);
    }
    // Snap to the streets (or smooth a freehand line), and find the side
    // of the road it was drawn on for Half street.
    let side = 'left';
    let snapped = false;
    if (snapOn) {
      try {
        const z = map.current?.getZoom?.() ?? 17;
        const lat = pts[0][0];
        const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z + 8);
        const tol = Math.max(8, Math.min(45, mpp * 22));
        // Never keep someone waiting too long: after that the line goes in freehand.
        const timed = (p: Promise<any>, ms: number) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms))]);
        let r: any = await timed(apiService.snapLines([pts], tol), 10000);
        if (r.data?.missing?.length && await timed(fetchTiles(r.data.missing), 15000).catch(() => false)) {
          r = await timed(apiService.snapLines([pts], tol), 10000);
        }
        const o = r.data?.lines?.[0];
        if (o?.line?.length >= 2) { pts = o.line; side = o.side || 'left'; snapped = !!o.snapped; }
      } catch { pts = smoothLine(pts); }
    } else {
      pts = smoothLine(pts);
    }
    if (k === 'edit' || (!d?.can_confirm && k === 'request')) {
      setPending((p) => [...p, pts]);
      return;
    }
    const routing = k === 'route';
    const halfLine = halfOn && (routing || k === 'done');
    try {
      const r = await apiService.saveCoverage({ date: dt, lines: [pts], leader_id: lid,
        kind: routing ? 'route' : k === 'plan' && (d?.can_confirm || d?.can_plan_areas) ? 'plan'
          : d?.can_confirm ? 'done' : (k === 'request' ? 'request' : 'done'),
        colour: routing && !d?.can_plan_areas && d?.my_colour ? d.my_colour : col,
        half: halfLine || undefined, side: halfLine ? side : undefined, snapped });
      if (r.data?.id) setUndoStack((u) => [...u, r.data.id]);
      await load();   // wait, so the drawn line stays until the saved one shows
    } catch (e: any) {
      showAlert('Could not save that line', e?.response?.data?.detail || 'Try again.');
      await load();
    }
  }, [load]);

  const flagRef = useRef<(w: 'start' | 'finish', at: number[]) => void>(() => {});
  const placeFlag = (w: 'start' | 'finish', at: number[]) => flagRef.current(w, at);
  flagRef.current = async (w, at) => {
    const d = st.current.data;
    const col = d?.can_plan_areas ? st.current.colour : (d?.my_colour || st.current.colour);
    try {
      await apiService.setRouteFlag({ date: st.current.date, colour: col, which: w, at, leader_id: st.current.leaderId });
      toast.success(w === 'start' ? 'Start flag placed' : 'Finish flag placed');
      setRouteTool('draw');
      load();
    } catch (e: any) { showAlert('Could not place the flag', e?.response?.data?.detail || 'Try again.'); }
  };

  // Build the map once, with freehand drawing on top of it.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let dead = false;
    let cleanup = () => {};
    loadLeaflet().then((L) => {
      const el = box.current as unknown as HTMLElement | null;
      if (dead || !el || map.current) return;
      // A generous renderer padding: lines just off screen don't vanish while zooming.
      const m = L.map(el, { scrollWheelZoom: true, renderer: L.svg({ padding: 1 }) }).setView([53.8, -1.55], 9);
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(m);
      shapeLayer.current = L.layerGroup().addTo(m);
      marksLayer.current = L.layerGroup().addTo(m);
      liveLayer.current = L.layerGroup().addTo(m);
      pendingLayer.current = L.layerGroup().addTo(m);
      map.current = m;

      // One finger (or a mouse drag) draws; a second finger cancels the line
      // and Leaflet's pinch moves and zooms the map. Dragging is off so one
      // finger never pans.
      let pts: number[][] = [];
      let live: any = null;
      let lastPx: any = null;
      let drawingNow = false;
      let panFrom: any = null;
      const fingers = new Set<number>();
      const cancelStroke = () => { drawingNow = false; pts = []; liveLayer.current?.clearLayers(); };
      const down = (e: PointerEvent) => {
        if (!st.current.data?.can_draw || st.current.kind === 'move') return;
        fingers.add(e.pointerId);
        if (e.pointerType === 'mouse' && (e.shiftKey || e.button === 1 || e.button === 2)) {
          panFrom = { x: e.clientX, y: e.clientY };
          e.preventDefault();
          return;
        }
        if (fingers.size > 1) { cancelStroke(); return; }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (st.current.kind === 'route' && st.current.routeTool !== 'draw') {
          // Tap the map to put the start or finish flag there.
          const ll = m.containerPointToLatLng(m.mouseEventToContainerPoint(e));
          placeFlag(st.current.routeTool as 'start' | 'finish', [ll.lat, ll.lng]);
          return;
        }
        drawingNow = true;
        const p = m.mouseEventToContainerPoint(e);
        lastPx = p;
        const ll = m.containerPointToLatLng(p);
        pts = [[ll.lat, ll.lng]];
        const { kind: k, colour: col, data: d } = st.current;
        const planning = (d?.can_confirm || d?.can_plan_areas) && k === 'plan';
        const asking = !d?.can_confirm && k === 'request';
        live = L.polyline(pts, k === 'route'
          ? { color: hopHex(d?.can_plan_areas ? col : (d?.my_colour || col)), weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }
          : k === 'edit'
          ? { color: hopHex(st.current.editColour, c.primary), ...PLAN_STYLE, opacity: 0.8, lineCap: 'round', lineJoin: 'round', interactive: false }
          : planning
          ? { color: hopHex(col), ...PLAN_STYLE, lineCap: 'round', lineJoin: 'round', interactive: false }
          : asking
            ? { color: hopHex(col, c.primary), weight: 5, opacity: 0.9, dashArray: '8 8', lineCap: 'round', lineJoin: 'round', interactive: false }
            : { color: '#000', weight: DONE_WEIGHT, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(liveLayer.current);
      };
      const move = (e: PointerEvent) => {
        if (panFrom) {
          m.panBy([panFrom.x - e.clientX, panFrom.y - e.clientY], { animate: false });
          panFrom = { x: e.clientX, y: e.clientY };
          return;
        }
        if (!drawingNow || fingers.size > 1) return;
        const p = m.mouseEventToContainerPoint(e);
        if (lastPx && Math.hypot(p.x - lastPx.x, p.y - lastPx.y) < 3) return;
        lastPx = p;
        const ll = m.containerPointToLatLng(p);
        pts.push([ll.lat, ll.lng]);
        live?.setLatLngs(pts);
      };
      const up = (e: PointerEvent) => {
        fingers.delete(e.pointerId);
        if (panFrom) { panFrom = null; return; }
        if (!drawingNow) return;
        drawingNow = false;
        // The line stays on screen until it's snapped and saved.
        if (pts.length >= 2) {
          const mine = live;
          saveStroke(pts.map((q) => [q[0], q[1]])).finally(() => { if (mine) liveLayer.current?.removeLayer(mine); });
        }
        else setTimeout(() => liveLayer.current?.clearLayers(), 600);
        pts = [];
      };
      const noMenu = (e: Event) => { if (st.current.data?.can_draw && st.current.kind !== 'move') e.preventDefault(); };
      el.addEventListener('contextmenu', noMenu);
      el.addEventListener('pointerdown', down, true);
      el.addEventListener('pointermove', move, true);
      el.addEventListener('pointerup', up, true);
      el.addEventListener('pointercancel', up, true);
      cleanup = () => {
        el.removeEventListener('contextmenu', noMenu);
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

  // When you can draw, one finger draws (no one-finger panning); two
  // fingers still pinch to move and zoom. Otherwise the map pans as normal.
  useEffect(() => {
    const m = map.current;
    const el = box.current as unknown as HTMLElement | null;
    if (!m || !el || !data) return;
    if (drawing) { m.dragging.disable(); m.doubleClickZoom.disable(); el.style.cursor = 'crosshair'; el.style.touchAction = 'none'; }
    else { m.dragging.enable(); m.doubleClickZoom.enable(); el.style.cursor = ''; el.style.touchAction = ''; }
    m.touchZoom.enable();
  }, [data, ready, drawing]);

  // Outline and lines.
  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !data) return;
    shapeLayer.current.clearLayers();
    marksLayer.current.clearLayers();
    const shape = data.shape;
    // Open on YOUR area: a BA in a bunny hop lands zoomed in on the streets
    // drawn in their colour; otherwise on the sector.
    if (!placed.current && data.my_colour) {
      const mine = (data.marks || []).filter((mk: any) => !mk.other && mk.status === 'plan' && mk.colour === data.my_colour)
        .flatMap((mk: any) => mk.lines || []).flat();
      if (mine.length) {
        map.current.fitBounds(L.latLngBounds(mine), { padding: [24, 24], maxZoom: 18 });
        placed.current = true;
      }
    }
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
    // Another sector's plan and today's lines lie faint underneath everything.
    const order = (mk: any) => (mk.other ? -1 : mk.status === 'plan' ? 0 : mk.status === 'requested' ? 1 : mk.status === 'draft' ? 2 : 3);
    const marks = (data.marks || []).slice().sort((a: any, b: any) => order(a) - order(b));
    const styleOf: Record<string, any> = {};
    for (const mk of marks) {
      const when = new Date(mk.date + 'T12:00:00').toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
      const who = esc(mk.author_name || mk.leader_name || 'Someone');
      let style: any; let title: string;
      if (mk.other) {
        // Another sector in this area today: view only.
        const plan = mk.status === 'plan';
        style = { color: '#6b7280', weight: plan ? 7 : 3.5, opacity: plan ? 0.25 : 0.6, dashArray: plan ? undefined : '2 6', lineCap: 'round', lineJoin: 'round' };
        title = `${esc((mk.other_leader || 'Another').split(' ')[0])}’s sector · ${plan ? 'their planned area' : 'done today'}`;
      } else if (mk.status === 'requested' && editing?.id === mk.id) {
        style = { color: '#6b7280', weight: 5, opacity: 0.55, dashArray: '8 8', lineCap: 'round', lineJoin: 'round' };
        title = 'What they asked for (you’re redrawing it)';
      } else if (mk.status === 'requested') {
        style = { color: hopHex(mk.colour, c.primary), weight: 5, opacity: 0.9, dashArray: '8 8', lineCap: 'round', lineJoin: 'round' };
        title = `More streets asked for${mk.colour ? ` · ${esc(hopLabel(mk.colour))}` : ''} (waiting for the sector leader)`;
      } else if (mk.status === 'plan') {
        style = { color: hopHex(mk.colour), ...PLAN_STYLE, lineCap: 'round', lineJoin: 'round' };
        title = `${esc(hopLabel(mk.colour) || 'Planned')} area`;
      } else if (mk.status === 'route') {
        style = { color: hopHex(mk.colour), weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round' };
        title = `${esc(hopLabel(mk.colour) || 'Bunny hop')} hop's route${mk.half ? ' · half street' : ''}`;
      } else if (mk.status === 'draft') {
        // Marked done: black, over the top of the coloured plan.
        style = { color: '#000', weight: DONE_WEIGHT, opacity: 0.95, lineCap: 'round', lineJoin: 'round' };
        title = `Done today${mk.colour ? ` · ${esc(hopLabel(mk.colour))}` : ''} (not saved yet)`;
      } else {
        style = { color: '#000', weight: WORKED_WEIGHT, opacity: mk.days_ago > 28 ? 0.35 : 0.85, lineCap: 'round', lineJoin: 'round' };
        title = `Worked ${esc(when)}`;
      }
      if (mk.half && mk.status !== 'route') title += ' · half street';
      styleOf[mk.id] = style;
      for (const line of mk.lines || []) {
        // A wider invisible line underneath makes thin lines easy to tap.
        const hit = L.polyline(line, { weight: 18, opacity: 0, interactive: true }).addTo(marksLayer.current);
        // Half street lines and routes are drawn on the decoration layer.
        if (!isDeco(mk)) L.polyline(line, { ...style, interactive: false }).addTo(marksLayer.current);
        const del = mk.can_delete ? `<br/><a href="#" data-del="${esc(mk.id)}">Remove</a>` : '';
        hit.bindPopup(`<b>${title}</b><br/>By ${who}${del}`);
        hit.on('popupopen', (ev: any) => {
          const a = ev.popup.getElement()?.querySelector('a[data-del]');
          if (a) a.onclick = async (e: any) => {
            e.preventDefault();
            try { await apiService.deleteCoverage(a.getAttribute('data-del')); map.current?.closePopup(); load(); }
            catch (er: any) { showAlert('Could not remove', er?.response?.data?.detail || 'Try again.'); }
          };
        });
      }
    }
    setDeco(L, map.current, decoFor(marks, data.routes || [], (mk) => styleOf[mk.id] || { color: '#000', weight: DONE_WEIGHT, opacity: 0.95 }, (k) => hopHex(k)));
  }, [data, ready, c.primary, c.red, load, editing]);

  // What's drawn but not sent yet.
  useEffect(() => {
    const L = (window as any).L;
    if (!ready || !L || !pendingLayer.current) return;
    pendingLayer.current.clearLayers();
    const col = editing ? hopHex(editing.colour, c.primary) : hopHex(colour, c.primary);
    for (const line of pending) {
      L.polyline(line, editing
        ? { color: col, ...PLAN_STYLE, opacity: 0.8, lineCap: 'round', lineJoin: 'round', interactive: false }
        : { color: col, weight: 5, opacity: 0.9, dashArray: '8 8', lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(pendingLayer.current);
    }
  }, [pending, ready, editing, colour, c.primary]);

  const sendRequest = async () => {
    if (!pending.length) return;
    setBusy('request');
    try {
      await apiService.saveCoverage({ date, lines: pending, leader_id: leaderId, kind: 'request', colour });
      toast.success('Sent to your sector leader');
      setPending([]); setKind('move'); load();
    } catch (e: any) { showAlert('Could not send', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };
  const startEdit = (mk: any) => {
    setPending([]); setEditing(mk); chosen.current = true; setKind('edit');
    const L = (window as any).L;
    if (L && map.current && (mk.lines || []).length) map.current.fitBounds(L.latLngBounds((mk.lines || []).flat()), { padding: [30, 30], maxZoom: 18 });
  };
  const stopEdit = () => { setEditing(null); setPending([]); setKind('move'); };
  const sendEdit = async () => {
    if (!editing || !pending.length) return;
    setBusy('edit');
    try {
      await apiService.replaceStreets(editing.id, pending);
      toast.success('Updated map sent to their bunny hop');
      stopEdit(); load();
    } catch (e: any) { showAlert('Could not send', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };

  const clearRoute = () => {
    const col = data?.can_confirm || data?.can_plan_areas ? colour : (data?.my_colour || colour);
    const go = async () => {
      setBusy('route');
      try { await apiService.clearRoute(date, col, leaderId); toast.success('Route cleared'); load(); }
      catch (e: any) { showAlert('Could not clear', e?.response?.data?.detail || 'Try again.'); }
      finally { setBusy(null); }
    };
    showAlert('Clear the route?', `The ${hopLabel(col).toLowerCase()} hop's route and its flags come off the map.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: go },
    ]);
  };

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => map.current?.setView([p.coords.latitude, p.coords.longitude], 17),
      () => showAlert('Location', 'Allow location for the app to show where you are.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const answer = async (id: string, what: 'approve' | 'decline') => {
    setBusy(`${what}:${id}`);
    try {
      await (what === 'approve' ? apiService.approveStreets(id) : apiService.declineStreets(id));
      toast.success(what === 'approve' ? 'Approved: sent to their bunny hop' : 'Declined');
      load();
    } catch (e: any) { showAlert('Could not do that', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };
  const undo = async () => {
    if (pending.length) { setPending((p) => p.slice(0, -1)); return; }
    const id = undoStack[undoStack.length - 1];
    if (!id) return;
    setUndoStack((u) => u.slice(0, -1));
    try { await apiService.deleteCoverage(id); load(); }
    catch (e: any) { showAlert('Could not undo', e?.response?.data?.detail || 'Try again.'); }
  };
  const share = async () => {
    setBusy('share');
    try {
      const r = await apiService.shareSectorMap(date);
      toast.success(r.data?.sent ? `Sent to ${r.data.sent}` : 'Nobody else is in the sector yet');
      // Sent: the map's set, so one finger moves it from now on.
      setKind('move');
      load();
    } catch (e: any) { showAlert('Could not send', e?.response?.data?.detail || 'Try again.'); }
    finally { setBusy(null); }
  };
  const confirm = () => {
    const go = async () => {
      setBusy('confirm');
      try {
        const r = await apiService.confirmCoverage(date, leaderId);
        toast.success(r.data?.confirmed ? `Saved: ${r.data.confirmed} black line${r.data.confirmed === 1 ? '' : 's'} on the map` : 'Draw over the streets in black first (Mark done)');
        load();
      } catch (e: any) { showAlert('Could not confirm', e?.response?.data?.detail || 'Try again.'); }
      finally { setBusy(null); }
    };
    showAlert('Save the map?', "Everything drawn in black is saved as worked and goes on the Owner's territory map, and the coloured planned areas come off. Rub out anything that wasn't done first.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: go },
    ]);
  };

  if (Platform.OS !== 'web') return <Text style={s.muted}>The map opens in the installed web app.</Text>;
  if (!loading && !data?.sector) {
    return <Text style={s.muted}>The map shows once you're in a sector today, with its postcode saved.</Text>;
  }
  const shape = data?.shape;
  const drafts = data?.drafts || 0;
  const leads = !!data?.can_confirm;
  // Any Coach in the sector plans the hop areas too (the Owner, 18 Nov 2026).
  const plans = leads || !!data?.can_plan_areas;
  const swatches = (
    <View style={s.colours}>
      {HOP_COLOURS.map((h) => (
        <Pressable key={h.key} onPress={() => setColour(h.key)} accessibilityLabel={h.label} accessibilityState={{ selected: colour === h.key }}
          style={[s.swatchBtn, { backgroundColor: h.hex }, colour === h.key && s.swatchOn]} />
      ))}
    </View>
  );
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

      {!!data?.can_draw && leads && (
        <View style={s.tools}>
          <View style={s.seg}>
            {(([['move', 'Move map'], ['plan', 'Plan areas'], ['done', 'Mark done']] as [Kind, string][])
              .concat(data?.can_route ? [['route', 'Draw route']] : [])).map(([k, label]) => (
              <Pressable key={k} onPress={() => pick(k)} style={[s.segBtn, kind === k && s.segOn]} accessibilityRole="button" accessibilityState={{ selected: kind === k }}>
                <Text style={[s.segText, kind === k && { color: c.onPrimary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {(kind === 'plan' || kind === 'route') && swatches}
        </View>
      )}
      {!!data?.can_draw && !leads && (
        <View style={s.tools}>
          <View style={s.seg}>
            {((plans
              ? [['move', 'Move map'], ['plan', 'Plan areas'], ['done', 'Mark done'], ['request', 'Request more streets']]
              : [['move', 'Move map'], ['done', 'Mark done'], ['request', 'Request more streets']]) as [Kind, string][])
              .concat(data?.can_route ? [['route', 'Draw route']] : []).map(([k, label]) => (
              <Pressable key={k} onPress={() => pick(k)} style={[s.segBtn, kind === k && s.segOn]} accessibilityRole="button" accessibilityState={{ selected: kind === k }} testID={`map-kind-${k}`}>
                <Text style={[s.segText, kind === k && { color: c.onPrimary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {(kind === 'plan' || (kind === 'route' && plans)) && swatches}
        </View>
      )}
      {drawing && kind === 'route' && (
        <View style={s.tools}>
          <View style={s.seg}>
            {([['draw', 'Draw'], ['start', 'Start flag'], ['finish', 'Finish flag']] as [RouteTool, string][]).map(([k, label]) => (
              <Pressable key={k} onPress={() => setRouteTool(k)} style={[s.segBtn, routeTool === k && s.segOn]} accessibilityRole="button"
                accessibilityState={{ selected: routeTool === k }} testID={`route-tool-${k}`}>
                <Text style={[s.segText, routeTool === k && { color: c.onPrimary }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={clearRoute} disabled={!!busy} style={s.ghost} accessibilityRole="button" testID="route-clear">
            <Ionicons name="trash-outline" size={15} color={c.primary} />
            <Text style={s.ghostText}>Clear route</Text>
          </Pressable>
        </View>
      )}
      {drawing && (
        <View style={s.switches}>
          <Pressable onPress={() => setSnap(!snap)} style={s.switchRow} accessibilityRole="switch" accessibilityState={{ checked: snap }} testID="map-snap">
            <View style={[s.switch, snap && s.switchOn]}><View style={[s.knob, snap && s.knobOn]} /></View>
            <Text style={s.line}>Snap to streets</Text>
          </Pressable>
          {(kind === 'done' || kind === 'route') && (
            <Pressable onPress={() => setHalf(!half)} style={s.switchRow} accessibilityRole="switch" accessibilityState={{ checked: half }} testID="map-half">
              <View style={[s.switch, half && s.switchOn]}><View style={[s.knob, half && s.knobOn]} /></View>
              <Text style={s.line}>Half street</Text>
            </Pressable>
          )}
        </View>
      )}
      {!!data?.late && !!data?.can_draw && (
        <Text style={[s.small, { color: c.text }]}>Yesterday’s map: press Mark done and draw any streets you forgot. They go straight on the worked map in black, no need to save.</Text>
      )}
      {!!data?.can_draw && kind === 'move' && (
        <Text style={s.small}>
          {leads ? 'One finger moves the map. Press Plan areas or Mark done to draw.' : plans ? 'One finger moves the map. Press Plan areas to draw the hops\u2019 areas, Mark done to mark off your streets, or Request more streets to ask for more.' : 'One finger moves the map. Press Mark done to mark off your streets, or Request more streets to ask for more.'}
        </Text>
      )}
      {drawing && (
        <Text style={s.small}>
          {kind === 'route' ? (routeTool === 'draw'
              ? `Draw the ${hopLabel(plans ? colour : (myColour || colour)).toLowerCase()} hop's route with one finger, the way they'll walk it: arrows show the way it's drawn. ${half ? 'Half street is on: draw on the side of the road they’ll work. ' : ''}`
              : `Tap the map where the ${routeTool === 'start' ? 'start' : 'finish'} flag goes. `)
            : plans && kind === 'plan' ? `Draw the ${hopLabel(colour).toLowerCase()} area with one finger. `
            : !leads && kind === 'request' ? 'Draw the extra streets you’d like with one finger, then press Send request: it goes to your sector leader as one request. '
            : kind === 'edit' ? `Draw the streets you want them to have, in their colour. What they asked for shows in grey. Then press Send updated map. `
            : half ? 'Half street is on: draw along the side of the road you’ve done. '
            : 'Draw over the streets you’ve done in black with one finger, on top of the coloured area. '}
          {snap ? 'Lines snap to the streets. ' : 'Freehand: lines stay where you draw them. '}
          Two fingers move and zoom. Tap a line to remove it.
        </Text>
      )}
      {leads && (data?.requests || 0) > 0 && (
        <View style={s.requests}>
          <Text style={s.line}>📍 More streets asked for</Text>
          {(data.marks || []).filter((mk: any) => mk.status === 'requested').map((mk: any) => (
            <View key={mk.id} style={s.reqRow}>
              <View style={[s.dotSm, { backgroundColor: hopHex(mk.colour, c.primary) }]} />
              <Pressable style={{ flex: 1 }} onPress={() => { const L = (window as any).L; if (L && map.current) map.current.fitBounds(L.latLngBounds((mk.lines || []).flat()), { padding: [30, 30], maxZoom: 18 }); }}>
                <Text style={s.reqName}>{(mk.author_name || 'Someone').split(' ')[0]}{mk.colour ? ` · ${hopLabel(mk.colour)}` : ''}</Text>
                <Text style={s.small}>Tap to see it on the map</Text>
              </Pressable>
              <Pressable onPress={() => answer(mk.id, 'decline')} disabled={!!busy} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Decline</Text></Pressable>
              <Pressable onPress={() => startEdit(mk)} disabled={!!busy} style={s.ghost} accessibilityRole="button" testID={`req-edit-${mk.id}`}><Text style={s.ghostText}>Edit</Text></Pressable>
              <Pressable onPress={() => answer(mk.id, 'approve')} disabled={!!busy} style={s.btn} accessibilityRole="button" testID={`req-approve-${mk.id}`}>
                <Text style={s.btnText}>Approve</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {!leads && kind === 'request' && (
        <View style={s.row}>
          <Pressable onPress={sendRequest} disabled={!pending.length || !!busy} style={[s.btn, !pending.length && { opacity: 0.5 }]} accessibilityRole="button" testID="map-send-request">
            <Text style={s.btnText}>{busy === 'request' ? 'Sending…' : `Send request${pending.length ? ` (${pending.length} line${pending.length === 1 ? '' : 's'})` : ''}`}</Text>
          </Pressable>
          {pending.length > 0 && (
            <Pressable onPress={() => setPending([])} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Clear</Text></Pressable>
          )}
        </View>
      )}
      {leads && !!editing && (
        <View style={s.row}>
          <Pressable onPress={sendEdit} disabled={!pending.length || !!busy} style={[s.btn, !pending.length && { opacity: 0.5 }]} accessibilityRole="button" testID="map-send-edit">
            <Text style={s.btnText}>{busy === 'edit' ? 'Sending…' : `Send updated map to ${(editing.author_name || 'them').split(' ')[0]}`}</Text>
          </Pressable>
          <Pressable onPress={stopEdit} style={s.ghost} accessibilityRole="button"><Text style={s.ghostText}>Cancel</Text></Pressable>
        </View>
      )}

      <View style={[s.mapBox, { height }]}>
        <View ref={box} style={StyleSheet.absoluteFill} />
        {(!ready || loading) && !failed && <View style={s.overlay} pointerEvents="none"><ActivityIndicator color={c.primary} /></View>}
        {failed && <View style={s.overlay}><Text style={s.muted}>The map couldn't load. Check your signal and try again.</Text></View>}
        <Pressable onPress={locate} style={s.locate} accessibilityLabel="Show where I am" hitSlop={6}>
          <Ionicons name="locate" size={18} color={c.text} />
        </Pressable>
        {(undoStack.length > 0 || pending.length > 0) && (
          <Pressable onPress={undo} style={s.undo} accessibilityRole="button" accessibilityLabel="Undo the last line" testID="map-undo">
            <Ionicons name="arrow-undo" size={16} color={c.text} />
            <Text style={s.undoText}>Undo</Text>
          </Pressable>
        )}
      </View>

      <View style={s.legend}>
        {hops.map((h) => (
          <View key={h.colour} style={s.key}>
            <View style={[s.swatch, { backgroundColor: hopHex(h.colour), height: 6, opacity: 0.6 }]} />
            <Text style={s.small}>{hopLabel(h.colour)}{h.members.length ? `: ${h.members.map((n: string) => n.split(' ')[0]).join(' & ')}` : ''}</Text>
          </View>
        ))}
        <View style={s.key}><View style={[s.swatch, { backgroundColor: '#000' }]} /><Text style={s.small}>Done / worked</Text></View>
        {(data?.others || []).length > 0 && (
          <View style={s.key}><View style={[s.swatch, { backgroundColor: '#6b7280', opacity: 0.4, height: 6 }]} /><Text style={s.small}>Also here today: {data.others.map((n: string) => `${n.split(' ')[0]}’s sector`).join(', ')}</Text></View>
        )}
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
            <Text style={endOfDay ? s.btnDarkText : s.ghostText}>Save the map{drafts ? ` (${drafts} black line${drafts === 1 ? '' : 's'})` : ''}</Text>
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
    try { await apiService.saveHops(date, hops, data?.sector?.leader_id || null); toast.success('Bunny hops saved'); onSaved(); }
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
  tools: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  seg: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch', flexGrow: 1, flexShrink: 1, minWidth: 0, padding: 3, gap: 2, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  segBtn: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8 },
  segOn: { backgroundColor: c.primary },
  segText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  undo: { position: 'absolute', left: 10, bottom: 24, zIndex: 1000, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 38, borderRadius: 19, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  switches: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  switch: { width: 38, height: 22, borderRadius: 11, backgroundColor: c.border, padding: 2, justifyContent: 'center' },
  switchOn: { backgroundColor: c.primary },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  undoText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  colours: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  swatchBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: 'transparent' },
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
  requests: { gap: 6, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.surface },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: c.border },
  reqName: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  btnDark: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#000' },
  btnDarkText: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  ghostText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.primary },
});
