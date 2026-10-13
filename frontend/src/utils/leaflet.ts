// Leaflet 1.9.4 from our own /vendor/leaflet (unmodified release, no CDN),
// loaded once on first use. Web only.
let loading: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    // Wait for the stylesheet and the script, so the map sizes itself right.
    let left = 2;
    const one = () => { left -= 1; if (left === 0) resolve(w.L); };
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    css.onload = one;
    css.onerror = one;            // works without its styles, just less tidy
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = one;
    js.onerror = () => { loading = null; reject(new Error('Map could not load')); };
    document.head.appendChild(js);
  });
  return loading;
}

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Where a postcode is (postcodes.io, open data): full postcode, else district. */
export async function placePostcode(pc: string): Promise<{ lat: number; lng: number; zoom: number } | null> {
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
  } catch { /* offline */ }
  return null;
}

export const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
