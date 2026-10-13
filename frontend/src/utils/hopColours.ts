// Bunny hop colours on the sector map (the server's HOP_COLOURS, same order).
// Named colours the team talks about ("work the red area"), so they're fixed
// rather than themed.
export const HOP_COLOURS: { key: string; label: string; hex: string }[] = [
  { key: 'red', label: 'Red', hex: '#e11d48' },
  { key: 'blue', label: 'Blue', hex: '#2563eb' },
  { key: 'green', label: 'Green', hex: '#16a34a' },
  { key: 'purple', label: 'Purple', hex: '#9333ea' },
  { key: 'orange', label: 'Orange', hex: '#ea580c' },
];
export const hopHex = (key?: string | null, fallback = '#334155') => HOP_COLOURS.find((h) => h.key === key)?.hex || fallback;
export const hopLabel = (key?: string | null) => HOP_COLOURS.find((h) => h.key === key)?.label || '';
