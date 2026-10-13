// The Quality Bulletin: a one-page poster of the week's quality for the
// team's WhatsApp, built from the Quality screen's own data (GET /quality,
// the whole-office view): the office's numbers against the Owner's targets,
// the stars of the week, every team, and the one thing to work on.
// Shared as a PDF the same way as the other bulletins (deliverPdf).
import { POSTER } from './bulletinWeek';
import { ORG_NAME } from '../theme/brand';
import { formatMoney } from './appTime';

type Cell = { value: number | null; rag: 'green' | 'amber' | 'red' | null };
type Metrics = Record<string, Cell>;

// Status colours on the poster (the same green / amber / red as the screen).
const RAG = {
  green: { fg: '#166534', bg: '#dcfce7' },
  amber: { fg: '#92400e', bg: '#fef3c7' },
  red: { fg: '#991b1b', bg: '#fee2e2' },
  none: { fg: POSTER.muted, bg: POSTER.card },
};
const MIN_SALES_FOR_STAR = 3;

const esc = (t: string) => (t || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch));
const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export function fmtQuality(key: string, v: number | null | undefined): string {
  if (v == null) return '–';
  if (key === 'aov') return formatMoney(v, 2);
  if (key === 'sales') return String(v);
  if (key === 'drops') return v.toFixed(2);
  return `${Math.round(v * 10) / 10}%`;
}

const val = (m: Metrics | undefined, k: string) => (m?.[k]?.value ?? null) as number | null;

/** The stars of the week, among people with 3+ sales. */
export function qualityStars(rows: any[]) {
  const ok = rows.filter((r) => (val(r.metrics, 'sales') || 0) >= MIN_SALES_FOR_STAR);
  const best = (k: string, low = false) => {
    const have = ok.filter((r) => val(r.metrics, k) != null);
    if (!have.length) return null;
    return have.sort((a, b) => {
      const d = low ? val(a.metrics, k)! - val(b.metrics, k)! : val(b.metrics, k)! - val(a.metrics, k)!;
      return d || (val(b.metrics, 'sales') || 0) - (val(a.metrics, 'sales') || 0);
    })[0];
  };
  const clean = ok.filter((r) => val(r.metrics, 'fail_rate') === 0)
    .sort((a, b) => (val(b.metrics, 'sales') || 0) - (val(a.metrics, 'sales') || 0))[0] || null;
  return [
    { title: 'Top order value', row: best('aov'), key: 'aov' },
    { title: 'Most drop days', row: best('drops'), key: 'drops' },
    { title: 'Most sales, no fails', row: clean, key: 'sales' },
  ].filter((x) => x.row);
}

/** The office measure furthest from its target: the one to work on. */
export function qualityFocus(office: Metrics | undefined, measures: { key: string; label: string; target?: string }[]) {
  const order = { red: 0, amber: 1, green: 2 } as const;
  const scored = measures
    .filter((m) => m.target && office?.[m.key]?.rag)
    .sort((a, b) => order[office![a.key].rag!] - order[office![b.key].rag!]);
  const m = scored[0];
  if (!m || office![m.key].rag === 'green') return null;
  return { label: m.label, value: fmtQuality(m.key, val(office, m.key)), target: m.target! };
}

export function buildQualityBulletinHtml(d: any): string {
  const P = POSTER;
  const measures: { key: string; label: string; target?: string }[] = d.measures || [];
  const office: Metrics = d.box?.metrics || d.total || {};
  const everyone = [...(d.me ? [d.me] : []), ...(d.team || [])];
  const look = (c?: Cell) => RAG[(c?.rag || 'none') as keyof typeof RAG];

  const tiles = measures.filter((m) => office[m.key]?.value != null).map((m) => {
    const c = office[m.key];
    const k = look(c);
    const fails = m.key === 'fail_rate' && val(office, 'fails') != null
      ? `<div style="font-size:9pt;color:${k.fg};margin-top:2pt;">${val(office, 'fails')} fail${val(office, 'fails') === 1 ? '' : 's'} of ${val(office, 'signups')} sign-ups</div>` : '';
    return `<div style="flex:1;min-width:92pt;background:${k.bg};border-radius:10pt;padding:10pt 12pt;">
      <div style="font-family:${P.mono};font-size:8pt;letter-spacing:0.6pt;text-transform:uppercase;color:${P.ink};">${esc(m.label)}</div>
      <div style="font-size:24pt;font-weight:900;color:${k.fg};line-height:1.15;">${esc(fmtQuality(m.key, c.value))}</div>
      ${fails}
      <div style="font-size:8.5pt;color:${P.muted};margin-top:2pt;">${m.target ? `Target ${esc(m.target)}` : '&nbsp;'}</div>
    </div>`;
  }).join('');

  const stars = qualityStars(everyone).map((st) => `
    <div style="flex:1;min-width:150pt;background:${P.card};border:1pt solid ${P.rule};border-radius:10pt;padding:10pt 12pt;">
      <div style="font-family:${P.mono};font-size:8pt;letter-spacing:0.6pt;text-transform:uppercase;color:${P.mid};">⭐ ${esc(st.title)}</div>
      <div style="font-size:16pt;font-weight:900;color:${P.ink};margin-top:3pt;">${esc(st.row.name)}</div>
      <div style="font-size:10pt;color:${P.muted};">${esc(fmtQuality(st.key, val(st.row.metrics, st.key)))}${st.key === 'sales' ? ' sales, 0 fails' : ` · ${val(st.row.metrics, 'sales')} sales`}</div>
    </div>`).join('');

  const cols = ['sales', 'aov', 'drops', 'fail_rate'].filter((k) => measures.some((m) => m.key === k));
  const label = (k: string) => measures.find((m) => m.key === k)?.label || k;
  const cell = (m: Metrics, k: string, bold = false) => {
    const lk = k === 'sales' ? RAG.none : look(m?.[k]);
    const extra = k === 'fail_rate' && val(m, 'fails') != null ? `<div style="font-size:7.5pt;color:${P.muted};font-weight:400;">${val(m, 'fails')} fail${val(m, 'fails') === 1 ? '' : 's'}</div>` : '';
    return `<td style="text-align:center;padding:4pt 3pt;"><div style="display:inline-block;min-width:44pt;padding:3pt 6pt;border-radius:6pt;background:${k === 'sales' ? 'transparent' : lk.bg};color:${k === 'sales' ? P.ink : lk.fg};font-weight:${bold ? 900 : 700};font-size:10pt;">${esc(fmtQuality(k, val(m, k)))}</div>${extra}</td>`;
  };
  const teams: any[] = d.teams || [];
  const teamRows = (teams.length >= 2 ? teams : []).map((g) => {
    const name = g.key === 'mini' ? 'Mini' : (g.team_name || `${first(g.leader_name)}'s team`);
    return `<tr style="border-top:1pt solid ${P.rule};"><td style="padding:5pt 4pt;font-weight:800;color:${P.ink};font-size:10.5pt;padding-left:${4 + 12 * (g.depth || 0)}pt;">${esc(name)}${g.includes?.length ? `<div style="font-size:7.5pt;color:${P.muted};font-weight:400;">incl. ${esc(g.includes.join(', '))}</div>` : ''}</td>${cols.map((k) => cell(g.metrics, k, true)).join('')}</tr>`;
  }).join('');
  const peopleRows = everyone
    .slice()
    .sort((a, b) => (val(b.metrics, 'sales') || 0) - (val(a.metrics, 'sales') || 0))
    .map((r) => `<tr style="border-top:1pt solid ${P.rule};"><td style="padding:4pt;color:${P.ink};font-size:10pt;">${esc(r.name)}</td>${cols.map((k) => cell(r.metrics, k)).join('')}</tr>`)
    .join('');
  const head = `<tr><th style="text-align:left;font-family:${P.mono};font-size:7.5pt;color:${P.muted};padding:2pt 4pt;">&nbsp;</th>${cols.map((k) => `<th style="font-family:${P.mono};font-size:7.5pt;color:${P.muted};text-transform:uppercase;padding:2pt;">${esc(label(k))}</th>`).join('')}</tr>`;

  const focus = qualityFocus(office, measures);
  const section = (t: string) => `<div style="font-family:${P.mono};font-size:9pt;letter-spacing:1pt;text-transform:uppercase;color:${P.mid};font-weight:700;margin:16pt 0 8pt;">${esc(t)}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:${P.paper};font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table{border-collapse:collapse;width:100%;}</style></head>
  <body><div style="width:612pt;box-sizing:border-box;padding:26pt 28pt 22pt;background:${P.paper};">
    <div style="background:${P.forest};color:${P.paper};border-radius:14pt;padding:16pt 18pt;">
      <div style="font-family:${P.mono};font-size:9pt;letter-spacing:1.2pt;color:${P.lime};text-transform:uppercase;">${esc(ORG_NAME)}</div>
      <div style="font-family:${P.font};font-size:30pt;font-weight:900;line-height:1.05;margin-top:4pt;">Quality Bulletin</div>
      <div style="font-family:${P.mono};font-size:10pt;letter-spacing:0.8pt;margin-top:6pt;text-transform:uppercase;">${esc(d.label || '')}</div>
    </div>
    ${section('The office')}
    <div style="display:flex;flex-wrap:wrap;gap:8pt;">${tiles}</div>
    ${focus ? `<div style="margin-top:10pt;background:${P.card};border-left:4pt solid ${P.amber};border-radius:6pt;padding:9pt 12pt;font-size:11pt;color:${P.ink};"><b>This week's focus: ${esc(focus.label.toLowerCase())}.</b> We're at ${esc(focus.value)} against ${esc(focus.target)}.</div>` : ''}
    ${stars ? section('Stars of the week') + `<div style="display:flex;flex-wrap:wrap;gap:8pt;">${stars}</div><div style="font-size:8pt;color:${P.muted};margin-top:4pt;">With ${MIN_SALES_FOR_STAR} or more sales.</div>` : ''}
    ${teamRows ? section('Teams') + `<table>${head}${teamRows}</table>` : ''}
    ${peopleRows ? section('Every BA') + `<table>${head}${peopleRows}</table>` : ''}
  </div></body></html>`;
}
