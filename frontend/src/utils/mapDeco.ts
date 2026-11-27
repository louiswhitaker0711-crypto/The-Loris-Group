// Map decorations that depend on the zoom (the Owner, 26 Nov 2026):
//   • Half street lines sit a few pixels to one side of the road (the side
//     they were drawn on, left or right of the way they were drawn).
//   • A bunny hop's route: a thin line in the hop's colour with arrows the
//     way it was drawn, a start flag and a finish flag.
// Pixel offsets and arrow spacing are worked out at the current zoom and
// redrawn whenever the zoom changes. One decoration layer per map.

export type DecoItem =
  | { type: 'line'; latlngs: number[][]; color: string; weight: number; opacity: number; offsetPx?: number; arrows?: boolean; dash?: string }
  | { type: 'flag'; at: number[]; which: 'start' | 'finish' };

export const HALF_OFFSET_PX = 7;
const ARROW_EVERY_PX = 70;

type Pt = { x: number; y: number };

function offsetPts(pts: Pt[], px: number): Pt[] {
  if (!px || pts.length < 2) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    // The normal to the LEFT of the way it was drawn (screen y points down).
    const norm = (a: Pt, b: Pt) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      return { x: dy / l, y: -dx / l };
    };
    const n1 = i > 0 ? norm(pts[i - 1], pts[i]) : null;
    const n2 = i < pts.length - 1 ? norm(pts[i], pts[i + 1]) : null;
    let nx = (n1?.x || 0) + (n2?.x || 0), ny = (n1?.y || 0) + (n2?.y || 0);
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) { nx = (n2 || n1)!.x; ny = (n2 || n1)!.y; } else { nx /= l; ny /= l; }
    // Keep corners tidy: don't push a sharp corner miles out.
    const cos = n1 && n2 ? Math.max(0.5, nx * n1.x + ny * n1.y) : 1;
    out.push({ x: pts[i].x + (nx * px) / cos, y: pts[i].y + (ny * px) / cos });
  }
  return out;
}

const chevron = (color: string, deg: number) =>
  `<svg width="18" height="18" viewBox="-9 -9 18 18" style="transform:rotate(${deg}deg);display:block">`
  + `<path d="M-3 -5 L3 0 L-3 5" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="M-3 -5 L3 0 L-3 5" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const FLAG_START = `<svg width="30" height="34" viewBox="0 0 30 34" style="display:block">`
  + `<line x1="6" y1="31" x2="6" y2="4" stroke="#2C2C2A" stroke-width="2"/>`
  + `<path d="M6 4 L24 9 L6 14 Z" fill="#3B6D11" stroke="#fff" stroke-width="1"/>`
  + `<circle cx="6" cy="31" r="3.5" fill="#3B6D11" stroke="#fff" stroke-width="1.5"/></svg>`;
const FLAG_FINISH = `<svg width="30" height="34" viewBox="0 0 30 34" style="display:block">`
  + `<line x1="6" y1="31" x2="6" y2="4" stroke="#2C2C2A" stroke-width="2"/>`
  + `<rect x="6" y="4" width="16" height="10" fill="#fff" stroke="#2C2C2A" stroke-width="1"/>`
  + `<rect x="6" y="4" width="4" height="5" fill="#2C2C2A"/><rect x="14" y="4" width="4" height="5" fill="#2C2C2A"/>`
  + `<rect x="10" y="9" width="4" height="5" fill="#2C2C2A"/><rect x="18" y="9" width="4" height="5" fill="#2C2C2A"/>`
  + `<circle cx="6" cy="31" r="3.5" fill="#2C2C2A" stroke="#fff" stroke-width="1.5"/></svg>`;

function draw(L: any, m: any, layer: any, items: DecoItem[]) {
  layer.clearLayers();
  for (const it of items) {
    if (it.type === 'flag') {
      L.marker(it.at, {
        interactive: false, keyboard: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: '', html: it.which === 'start' ? FLAG_START : FLAG_FINISH, iconSize: [30, 34], iconAnchor: [6, 31] }),
      }).addTo(layer);
      continue;
    }
    if ((it.latlngs || []).length < 2) continue;
    const px: Pt[] = it.latlngs.map((p) => m.latLngToLayerPoint(p));
    const pts = offsetPts(px, it.offsetPx || 0);
    const lls = pts.map((p) => m.layerPointToLatLng(p));
    L.polyline(lls, { color: it.color, weight: it.weight, opacity: it.opacity, dashArray: it.dash, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
    if (!it.arrows) continue;
    // Arrows along the line, every so often, pointing the way it was drawn.
    let next = ARROW_EVERY_PX / 2;
    let run = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (seg > 0 && next <= run + seg) {
        const t = (next - run) / seg;
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        L.marker(m.layerPointToLatLng(at), {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: '', html: chevron(it.color, deg), iconSize: [18, 18], iconAnchor: [9, 9] }),
        }).addTo(layer);
        next += ARROW_EVERY_PX;
      }
      run += seg;
    }
  }
}

/** Show these decorations on the map (replacing what was there). */
export function setDeco(L: any, m: any, items: DecoItem[]) {
  if (!L || !m) return;
  if (!m._lorisDeco) {
    const layer = L.layerGroup().addTo(m);
    const deco = { layer, items: [] as DecoItem[] };
    const redraw = () => draw(L, m, deco.layer, deco.items);
    m.on('zoomend viewreset', redraw);
    m._lorisDeco = deco;
  }
  m._lorisDeco.items = items;
  draw(L, m, m._lorisDeco.layer, items);
}

/** The signed pixel offset for a half street line. */
export const halfOffset = (mk: any) => (mk?.half ? (mk.side === 'right' ? -HALF_OFFSET_PX : HALF_OFFSET_PX) : 0);

/** A mark that needs the decoration layer rather than a plain line. */
export const isDeco = (mk: any) => !mk?.other && (mk?.status === 'route' || !!mk?.half);

/**
 * Decorations for a sector's marks: half street lines (in `style(mk)`), and
 * each hop's route with arrows and its two flags. `routes` are the flags
 * placed by hand; otherwise a route starts where it was first drawn and
 * finishes where it was last drawn.
 */
export function decoFor(marks: any[], routes: any[], style: (mk: any) => { color: string; weight: number; opacity: number }, hex: (c: string) => string): DecoItem[] {
  const items: DecoItem[] = [];
  for (const mk of marks) {
    if (!isDeco(mk) || mk.status === 'route') continue;
    const st = style(mk);
    for (const line of mk.lines || []) {
      // Half street: a thinner line on the side that's done, and a faint
      // dotted line on the side that's left (the Owner, 27 Nov 2026).
      items.push({ type: 'line', latlngs: line, color: st.color, weight: 3.5, opacity: Math.max(0.85, st.opacity), offsetPx: halfOffset(mk) });
      items.push({ type: 'line', latlngs: line, color: st.color, weight: 2.5, opacity: 0.4, offsetPx: -halfOffset(mk), dash: '2 7' });
    }
  }
  const byColour: Record<string, any[]> = {};
  for (const mk of marks) if (mk.status === 'route' && !mk.other) (byColour[mk.colour || ''] ||= []).push(mk);
  for (const [colour, list] of Object.entries(byColour)) {
    list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    for (const mk of list) {
      for (const line of mk.lines || []) {
        items.push({ type: 'line', latlngs: line, color: hex(colour), weight: 4, opacity: 0.9, offsetPx: halfOffset(mk), arrows: true });
      }
    }
    const flags = (routes || []).find((r) => r.colour === colour) || {};
    const lines = list.flatMap((mk) => mk.lines || []);
    const first = lines[0]?.[0];
    const lastLine = lines[lines.length - 1];
    const last = lastLine?.[lastLine.length - 1];
    const start = flags.start || first;
    const finish = flags.finish || last;
    if (start) items.push({ type: 'flag', at: start, which: 'start' });
    if (finish) items.push({ type: 'flag', at: finish, which: 'finish' });
  }
  return items;
}
