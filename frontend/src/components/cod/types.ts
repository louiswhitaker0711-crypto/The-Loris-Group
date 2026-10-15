/**
 * COD — Cycle of Development. Shared types + stage identity for the
 * Leadership Hub (app/coaching.tsx) and the reader (app/cod/[id].tsx).
 *
 * The four stages ARE the cycle: sell → own your head → coach others →
 * run a team → (develop the next seller). Stage colors come straight from
 * brand tokens so light/dark both read on-brand.
 */
import { brand } from '../../theme/brand';

export type Impact = {
  id: string;
  title: string;
  summary: string;
  body: string;
  key_takeaways: string[];
  stage: number;
  category: string;
  source: string;
  order?: number;
};

export type StageMeta = {
  label: string;   // "Stage 1 · Sales Mechanics"
  short: string;   // "Sales Mechanics"
  color: string;   // brand token
  icon: string;    // Ionicons name
  tagline: string; // one line under the section header
};

export const STAGE_META: Record<number, StageMeta> = {
  // Names follow the Owner's COD sheet (stageOrder.ts). 3+ is stored as 5 and
  // Stage 5 (Business Owner) as 6.
  1: { label: 'Stage 1 · Foundation', short: 'Foundation', color: brand.green, icon: 'flash', tagline: 'Win the door — systems for the pitch itself.' },
  2: { label: 'Stage 2 · Self Management', short: 'Self Management', color: brand.limeDark, icon: 'sparkles', tagline: 'Own your head — habits that survive a bad day.' },
  3: { label: 'Stage 3 · Leader', short: 'Leader', color: brand.rose, icon: 'people', tagline: 'Turn your game into someone else’s game.' },
  5: { label: 'Stage 3+ · Sector/Site Leader', short: 'Sector Leader', color: brand.cyan, icon: 'navigate', tagline: 'Develop your leaders and build the team.' },
  4: { label: 'Stage 4 · Team Builder', short: 'Team Builder', color: brand.yellow, icon: 'trophy', tagline: 'Build the machine that builds people.' },
  6: { label: 'Stage 5 · Business Owner', short: 'Business Owner', color: brand.limeDark, icon: 'business', tagline: 'Run your own business.' },
};

export const stageMeta = (s: number): StageMeta =>
  STAGE_META[s] || { label: `Stage ${s}`, short: `Stage ${s}`, color: brand.limeDark, icon: 'bulb', tagline: '' };

export const CATEGORY_LABEL: Record<string, string> = {
  mindset: 'Mindset',
  skill: 'Skill',
  communication: 'Communication',
  objection_handling: 'Objections',
  leadership: 'Leadership',
  coaching_others: 'Coaching',
  self_development: 'Self Dev',
  product: 'Campaign',
  strategy: 'Strategy',
  team_development: 'Team Dev',
  general: 'General',
};

// ── Quiz contract (mirrors routes/modules.py module-quiz shapes) ────────────
export type ImpactQuiz = {
  quiz_id: string;
  questions: Array<{ id: string; question: string; choices: string[] }>;
};

export type ImpactQuizResult = {
  score: number;
  total: number;
  passed: boolean;
  results: Array<{ id: string; correct: number; chosen: number; ok: boolean }>;
};

/**
 * The quiz-state endpoint backs the hub's "passed" ticks. The backend is
 * built in parallel against the same contract, so parse defensively —
 * accept an id array, a row array, or an id→state map. Anything unexpected
 * degrades to "no ticks", never a crash.
 */
export function normalizePassedIds(data: any): Set<string> {
  const out = new Set<string>();
  if (!data || typeof data !== 'object') return out;
  const arr = Array.isArray(data) ? data
    : Array.isArray(data.passed_ids) ? data.passed_ids
    : Array.isArray(data.passed) ? data.passed
    : Array.isArray(data.states) ? data.states
    : null;
  if (arr) {
    for (const row of arr) {
      if (typeof row === 'string') { out.add(row); continue; }
      if (row && typeof row === 'object') {
        const id = (row as any).impact_id || (row as any).id;
        const passed = (row as any).passed ?? (row as any).quiz_passed;
        if (id && passed !== false) out.add(String(id));
      }
    }
    return out;
  }
  const map = data.passed && typeof data.passed === 'object' ? data.passed : null;
  if (map) {
    for (const [k, v] of Object.entries(map)) {
      if (v && (typeof v !== 'object' || (v as any).passed !== false)) out.add(k);
    }
  }
  return out;
}

// Local fallback tick store — keeps the hub honest even if the quiz-state
// endpoint isn't live yet (backend ships in parallel).
export const LOCAL_PASSED_KEY = 'cg1.cod.passedLocal';
