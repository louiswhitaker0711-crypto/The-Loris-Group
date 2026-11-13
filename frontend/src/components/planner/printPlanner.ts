/**
 * Monthly Planner — Print/PDF helper.
 *
 * Builds a print-ready HTML document from the live planner draft and uses
 * expo-print + expo-sharing to either spawn the device's print sheet (web)
 * or generate a PDF and trigger the native share sheet (iOS/Android).
 *
 * Layout target: A4, 14pt body, sectioned (Header → Goals → Targets →
 * Monthly Planning → Learning → Budget → SWOT → Gap Analysis). Mirrors the
 * on-screen sections so coaches can review printed copies that match the app.
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { APP_LOCALE, formatMoney } from '../../utils/appTime';

// ── Helpers ──────────────────────────────────────────────────────────────
const escapeHtml = (s: any): string =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const nl2br = (s: any): string => escapeHtml(s).replaceAll('\n', '<br/>');

const fmtMoney = (n: any): string => {
  const v = Number(n);
  if (!isFinite(v) || v === 0) return '—';
  return formatMoney(v);
};

const fmtNum = (n: any): string => {
  const v = Number(n);
  if (!isFinite(v) || v === 0) return '—';
  return v.toLocaleString(APP_LOCALE);
};

const prettyMonth = (m: string): string => {
  if (!m) return '';
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleString(APP_LOCALE, { month: 'long', year: 'numeric' });
};

// ── HTML section builders ────────────────────────────────────────────────
const goalCell = (label: string, value: string) => `
  <div class="goal-cell">
    <div class="goal-label">${escapeHtml(label)}</div>
    <div class="goal-value">${value ? nl2br(value) : '<span class="muted">—</span>'}</div>
  </div>
`;

// v2 goals (structured KPIs + Rocks). Legacy planners use the 6-cell grid.
// Goals as in the app: KPIs above Rocks, each by 1 month / 3 months.
const TERM_PDF: Record<string, string> = { short: '1 month', medium: '3 months', long: '6 months' };
const goalsV2Html = (goals: any): string => {
  const area = (x: any) => (x.area === 'personal' ? 'Personal' : 'Business');
  const block = (title: string, list: any[], row: (x: any) => string, head: string) => {
    const terms = ['short', 'medium', ...(list.some((x) => x.horizon === 'long') ? ['long'] : [])];
    const body = terms.map((t) => {
      const items = list.filter((x) => x && x.name && (x.horizon || 'short') === t);
      return `<tr><td colspan="4" style="background:#f4f8fc;font-weight:800">${TERM_PDF[t]}</td></tr>`
        + (items.length ? items.map(row).join('') : '<tr><td colspan="4" class="muted">—</td></tr>');
    }).join('');
    return `<div class="subsection"><h3>${title}</h3><table class="data"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  };
  const kpis = block('KPIs · the numbers', goals.kpis || [], (k) => `
      <tr><td>${k.smart_ok ? '✓ ' : ''}${escapeHtml(k.name)}</td><td class="r">${k.target ? escapeHtml(String(k.target)) : '—'}</td><td>${area(k)}</td><td>${k.reward ? escapeHtml(k.reward) : '—'}</td></tr>`,
    '<tr><th>KPI</th><th class="r">Target</th><th>Business / Personal</th><th>Reward</th></tr>');
  const rocks = block("Rocks · did I / didn't I", goals.rocks || [], (r) => `
      <tr><td>${r.done ? '✓ ' : ''}${escapeHtml(r.name)}</td><td></td><td>${area(r)}</td><td>${r.reward ? escapeHtml(r.reward) : '—'}</td></tr>`,
    '<tr><th>Rock</th><th></th><th>Business / Personal</th><th>Reward</th></tr>');
  return `
    <section>
      <h2>Goals</h2>
      ${kpis}
      ${rocks}
      ${goals.vision ? `<p class="meta" style="margin-top:8px"><strong>6-month vision:</strong> ${escapeHtml(goals.vision)}</p>` : ''}
    </section>`;
};



const planningTable = (title: string, rows: any[]) => {
  const body = (rows || []).filter((r) => r && (r.topic || r.who || r.when))
    .map((r) => `
      <tr>
        <td>${escapeHtml(r.topic || '')}</td>
        <td>${escapeHtml(r.who || '')}</td>
        <td>${escapeHtml(r.when || '')}</td>
        <td class="ck">${r.completed ? '✓' : '·'}</td>
      </tr>`).join('');
  if (!body) return '';
  return `
    <div class="subsection">
      <h3>${escapeHtml(title)}</h3>
      <table class="data">
        <thead><tr><th>Topic / Action</th><th>Who</th><th>When</th><th class="ck">Done</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
};

const budgetTable = (title: string, rows: any[]) => {
  const items = (rows || []).filter((r) => r && (r.label || r.amount));
  if (!items.length) return '';
  const total = items.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
  const body = items.map((r) => `
    <tr>
      <td>${escapeHtml(r.label || '')}</td>
      <td class="r">${fmtMoney(r.amount)}</td>
      <td class="r">${fmtNum(r.sales)}</td>
    </tr>`).join('');
  return `
    <div class="subsection">
      <h3>${escapeHtml(title)}</h3>
      <table class="data">
        <thead><tr><th>Line item</th><th class="r">Amount</th><th class="r">Sign-ups</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td class="r"><strong>${fmtMoney(total)}</strong></td><td></td></tr></tfoot>
      </table>
    </div>`;
};

const swotQuadrant = (label: string, value: string, helpful: boolean) => `
  <div class="swot-cell ${helpful ? 'helpful' : 'unhelpful'}">
    <div class="swot-label">${escapeHtml(label)}</div>
    <div class="swot-value">${value ? nl2br(value) : '<span class="muted">—</span>'}</div>
  </div>
`;

// ── Main HTML builder ────────────────────────────────────────────────────
export interface PlannerHtmlOpts {
  ownerName: string;
  month: string;        // YYYY-MM
  draft: any;           // shape from /api/monthly-planners/{month}
  traits: string[];     // Leader Gap Analysis topics
  fieldTraits?: string[]; // Gap Analysis topics
  showGap: boolean;
  growth?: any;         // /monthly-planners/{month}/growth (sign-ups, KPIs, new starts)
}

export function buildPlannerHtml({ ownerName, month, draft, traits, fieldTraits, showGap, growth }: PlannerHtmlOpts): string {
  const goals = draft?.goals || {};
  const planning = draft?.monthly_planning || {};
  const learning = draft?.learning || {};
  const budget = draft?.budget || {};
  const swot = draft?.swot || {};
  const gapScores = draft?.gap_analysis?.scores || {};
  const fieldScores = draft?.gap_analysis?.field_scores || {};
  const focus = draft?.focus || {};
  const kpiGoals = draft?.kpi_goals || {};
  const targets = draft?.targets || {};
  const today = new Date().toLocaleDateString(APP_LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });

  const goalsIsV2 = goals && (goals.version === 2 || Array.isArray(goals.kpis));
  const goalsHtml = goalsIsV2 ? goalsV2Html(goals) : `
    <section>
      <h2>Goals</h2>
      <div class="goal-grid">
        ${goalCell('Short Term · Business', goals.short_business)}
        ${goalCell('Short Term · Personal', goals.short_personal)}
        ${goalCell('Medium Term · Business', goals.medium_business)}
        ${goalCell('Medium Term · Personal', goals.medium_personal)}
        ${goalCell('Long Term · Business', goals.long_business)}
        ${goalCell('Long Term · Personal', goals.long_personal)}
      </div>
    </section>`;

  const targetsHtml = (Number(targets.monthly_sales) > 0 || Number(targets.personal_best) > 0) ? `
    <section>
      <h2>Monthly Sign Up Focus</h2>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Monthly Sign Up Focus</div><div class="kpi-value">${fmtNum(targets.monthly_sales)}</div></div>
        <div class="kpi"><div class="kpi-label">Personal Best Target</div><div class="kpi-value">${fmtNum(targets.personal_best)}</div></div>
      </div>
    </section>` : '';

  const salesImpacts = planning.sales_impacts || {};
  const planningHtml = `
    <section>
      <h2>Monthly Planning</h2>
      ${(salesImpacts.coach_others || salesImpacts.still_to_master) ? `
        <div class="subsection">
          <h3>Sign Up Impacts</h3>
          <div class="goal-grid">
            ${goalCell('I can coach others on…', salesImpacts.coach_others)}
            ${goalCell('Still need to master…', salesImpacts.still_to_master)}
          </div>
        </div>` : ''}
      ${planningTable('Development – COD', planning.development)}
      ${planningTable('Recruitment', planning.recruitment)}
      ${planningTable('Travelling and Networking Calls', planning.networking)}
    </section>`;

  const learningItems = (learning.items || []).filter((it: any) => it && (it.topic || it.mentor || it.notes));
  const learningHtml = (learning.summary || learningItems.length) ? `
    <section>
      <h2>What I'm learning &amp; who from</h2>
      ${learning.summary ? `<p>${nl2br(learning.summary)}</p>` : ''}
      ${learningItems.length ? `
        <table class="data">
          <thead><tr><th>Topic</th><th>Mentor</th><th>Notes</th></tr></thead>
          <tbody>
            ${learningItems.map((it: any) => `
              <tr>
                <td>${escapeHtml(it.topic || '')}</td>
                <td>${escapeHtml(it.mentor || '')}</td>
                <td>${escapeHtml(it.notes || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : ''}
    </section>` : '';

  const budgetHtml = `
    <section>
      <h2>Budget Calculator</h2>
      ${budget.sale_value ? `<p class="meta">Sign-up value: <strong>${fmtMoney(budget.sale_value)}</strong></p>` : ''}
      ${budgetTable('Needs', budget.needs)}
      ${budgetTable('Wants', budget.wants)}
      ${(Number(budget.breakeven_week) > 0) ? `
        <div class="kpi-row">
          <div class="kpi big">
            <div class="kpi-label">Breakeven: sign-ups a week</div>
            <div class="kpi-value">${fmtNum(budget.breakeven_week)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">With wants: sign-ups a week</div>
            <div class="kpi-value">${fmtNum(budget.total_sales_required)}</div>
          </div>
        </div>` : ''}
    </section>`;

  const swotHtml = `
    <section>
      <h2>SWOT Analysis <span class="muted" style="font-size:9.5pt">(completed quarterly)</span></h2>
      <div class="swot-grid">
        ${swotQuadrant('Strengths', swot.strengths, true)}
        ${swotQuadrant('Weaknesses', swot.weaknesses, false)}
        ${swotQuadrant('Opportunities', swot.opportunities, true)}
        ${swotQuadrant('Threats', swot.threats, false)}
      </div>
    </section>`;

  const gapTable = (title: string, list: string[], sc: Record<string, number>, pageBreak: boolean) => {
    if (!list || !list.length) return '';
    const rows = list.map((t) => {
      const score = Number(sc[t] || 0);
      const filled = '●'.repeat(score) + '○'.repeat(Math.max(0, 5 - score));
      return `
      <tr>
        <td>${escapeHtml(t)}</td>
        <td class="dots">${filled}</td>
        <td class="r">${score || '—'}</td>
      </tr>`;
    }).join('');
    return `
    <section${pageBreak ? ' class="page-break"' : ''}>
      <h2>${escapeHtml(title)}</h2>
      <table class="data">
        <thead><tr><th>Topic</th><th>Score (1-5)</th><th class="r">#</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  };
  const gapHtml = showGap
    ? gapTable('Gap Analysis', fieldTraits || [], fieldScores, true) + gapTable('Leader Gap Analysis', traits || [], gapScores, false)
    : '';

  const boxes = (count: number, ticked: number[]) => {
    const on = new Set(ticked || []);
    return `<div class="boxes">${Array.from({ length: count }, (_, i) => i + 1)
      .map((n) => `<span class="box${on.has(n) ? ' on' : ''}">${on.has(n) ? '✓' : n}</span>`).join('')}</div>`;
  };
  const signUps = Number(growth?.sign_ups || 0);
  const focusHtml = `
    <section class="page-break">
      <h2>Monthly Sign Up Focus</h2>
      ${boxes(100, Array.from({ length: Math.min(100, signUps) }, (_, i) => i + 1))}
      <h2>Recruitment &amp; PR Focus</h2>
      <h3>Monthly Recruitment Focus</h3>
      ${boxes(30, focus.recruitment || [])}
      <h3>Monthly PR Focus</h3>
      ${boxes(30, focus.pr || [])}
    </section>`;

  const growthLabels: Record<string, string> = {
    shadowers: 'Number of shadowers taken', sign_ups: 'Total number of sign-ups',
    new_starts: 'Number of new starts attended', prs: 'Number of PRs attended',
  };
  const kpiRows = (growth?.kpis || []) as any[];
  const byKey: Record<string, any> = Object.fromEntries(kpiRows.map((r) => [r.key, r]));
  const newStarts = (growth?.new_starts || []) as any[];
  const growthHtml = `
    <section>
      <h2>Recruitment, Sign Ups &amp; Growth</h2>
      <table class="data">
        <thead><tr><th>KPI</th><th class="r">Monthly goal</th><th class="r">So far</th><th class="ck">Hit</th></tr></thead>
        <tbody>${Object.keys(growthLabels).map((k) => {
          const r = byKey[k] || {};
          const goal = Number(kpiGoals[k] || 0);
          const actual = Number(r.actual || 0);
          const hit = goal > 0 && actual >= goal ? 'Yes' : (r.hit === false ? 'No' : '');
          return `<tr><td>${growthLabels[k]}</td><td class="r">${goal || ''}</td><td class="r">${actual}</td><td class="ck">${hit}</td></tr>`;
        }).join('')}</tbody>
      </table>
      <h3>New Starts Due</h3>
      ${newStarts.length ? `
      <table class="data">
        <thead><tr><th>Name</th><th>Start date</th><th class="r">Sign-ups in 1st 3 days</th><th class="ck">Completed 6 days</th></tr></thead>
        <tbody>${newStarts.map((r) => `<tr><td>${escapeHtml(r.name || '')}</td><td>${escapeHtml(String(r.start_date || '').split('-').reverse().join('/'))}</td><td class="r">${r.sign_ups_first_3 ?? ''}</td><td class="ck">${r.completed_6 ? '✓' : `${r.field_days_done || 0}/6`}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted">No new starts due this month.</p>'}
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Monthly Planner — ${escapeHtml(ownerName)} — ${escapeHtml(prettyMonth(month))}</title>
  <style>
    @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #040b15; font-size: 11.5pt; line-height: 1.45; }
    header { border-bottom: 2px solid #225bc3; padding-bottom: 10px; margin-bottom: 18px; }
    header .h-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
    header h1 { font-size: 20pt; margin: 0; color: #040b15; }
    header .month { font-size: 11pt; color: #3b4e66; font-weight: 600; }
    header .printed { font-size: 9pt; color: #6a7b90; text-align: right; }
    h2 { font-size: 13pt; margin: 18px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #d3e0ed; color: #040b15; }
    h3 { font-size: 11pt; margin: 12px 0 6px; color: #184589; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    section { break-inside: avoid; }
    .page-break { break-before: page; }
    .muted { color: #6a7b90; }
    .meta { font-size: 10pt; color: #3b4e66; margin: 0 0 8px; }
    .goal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .goal-cell { border: 1px solid #d3e0ed; border-radius: 8px; padding: 10px 12px; background: #f4f8fc; min-height: 60px; }
    .goal-label { font-size: 9.5pt; color: #6a7b90; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .goal-value { font-size: 11pt; color: #040b15; }
    .subsection { margin-top: 8px; }
    table.data { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table.data th, table.data td { border: 1px solid #d3e0ed; padding: 6px 8px; text-align: left; vertical-align: top; }
    table.data th { background: #f4f8fc; font-size: 9.5pt; color: #3b4e66; text-transform: uppercase; letter-spacing: .04em; }
    table.data tfoot td { background: #e4eef8; }
    table.data .r { text-align: right; }
    table.data .ck { text-align: center; width: 50px; }
    table.data .dots { font-family: -apple-system, "Helvetica Neue", monospace; letter-spacing: 2px; color: #225bc3; width: 100px; }
    .kpi-row { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
    .kpi { flex: 1; min-width: 170px; border: 1px solid #d3e0ed; border-radius: 10px; padding: 10px 14px; background: #f4f8fc; }
    .kpi.big { flex: 1; background: #eaf2fa; border-color: #2dd7f2; }
    .kpi-label { font-size: 9.5pt; color: #6a7b90; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .kpi-value { font-size: 22pt; font-weight: 800; color: #040b15; font-variant-numeric: tabular-nums; }
    .swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .swot-cell { border-radius: 8px; padding: 10px 12px; min-height: 80px; }
    .swot-cell.helpful { background: #ecfdf5; border: 1px solid #a7f3d0; }
    .swot-cell.unhelpful { background: #fef2f2; border: 1px solid #fecaca; }
    .swot-label { font-size: 10pt; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; color: #040b15; }
    .swot-value { font-size: 10.5pt; color: #0c2340; }
    p { margin: 0 0 8px; }
    .boxes { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 10px; }
    .box { width: 9%; aspect-ratio: 1; border: 1px solid #d3e0ed; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 8.5pt; color: #6a7b90; }
    .box.on { background: #225bc3; border-color: #225bc3; color: #fff; font-weight: 800; }
  </style>
</head>
<body>
  <header>
    <div class="h-row">
      <div>
        <h1>${escapeHtml(ownerName)}</h1>
        <div class="month">${escapeHtml(prettyMonth(month))} · Monthly Goal Planner</div>
      </div>
      <div class="printed">Printed ${escapeHtml(today)}</div>
    </div>
  </header>

  ${goalsHtml}
  ${targetsHtml}
  ${planningHtml}
  ${learningHtml}
  ${budgetHtml}
  ${swotHtml}
  ${gapHtml}
  ${focusHtml}
  ${growthHtml}
</body>
</html>`;
}

// ── Public: trigger Print/Share PDF ───────────────────────────────────────
export async function printOrSharePlanner(opts: PlannerHtmlOpts): Promise<void> {
  const html = buildPlannerHtml(opts);
  const fileName = `Monthly_Planner_${opts.ownerName.replaceAll(/\s+/g, '_')}_${opts.month}`;

  if (Platform.OS === 'web') {
    // On web, expo-print falls back to window.print(); easier: open a tab w/ the HTML.
    try {
      // Use printAsync — on web it writes the HTML into a hidden iframe and calls .print()
      await Print.printAsync({ html });
      return;
    } catch {
      // Last-ditch fallback for web — pop the HTML into a new window.
      try {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
          // Don't auto-print — let the user choose; they can hit Cmd/Ctrl+P.
        }
      } catch {/* swallow — caller toasts */}
      return;
    }
  }

  // Native: produce PDF, then push through the share sheet.
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    // ⚠️ iOS quirk: Sharing.shareAsync's Promise can stay pending forever
    // when the user cancels the share sheet. Return as soon as we hand off
    // so the caller's busy-state machinery never gets stuck. Silently
    // swallow — cancel is not a failure.
    Sharing.shareAsync(uri, {
      UTI: 'com.adobe.pdf',
      mimeType: 'application/pdf',
      dialogTitle: `Share ${fileName}`,
    }).catch(() => {});
  } else {
    // Fall back to the native print dialog.
    await Print.printAsync({ uri }).catch(() => {});
  }
}
