/**
 * BA Academy Day 1 — the workbook's sections and quizzes, in the Owner's
 * running order (26 Oct 2026). The screen (app/academy/[day].tsx) lays the
 * content out; this file holds what both the screen and the Owner's class
 * card need: the section ids and titles, and the quiz questions.
 *
 * Field ids saved on the server (routes/academy.py): `b-<id>` for a gap,
 * `n<section>` for a notes box, `questions` for "My questions for my Coach",
 * `r<i>` for a receipts tick. Don't rename an id once people have used it:
 * their answers are saved under it.
 */

export type QuizQ = { p: string; o: string[]; a: number; w: string };
export type Quiz = { id: string; title: string; qs: QuizQ[] };

export const DAY1_SECTIONS: { id: string; title: string; short: string }[] = [
  { id: 's1', title: 'Your first week', short: 'First week' },
  { id: 's2', title: 'Indirect vs direct marketing', short: 'Marketing' },
  { id: 's3', title: 'Our model', short: 'Our model' },
  { id: 's4', title: 'What you can expect from us, and what we expect from you', short: 'Expectations' },
  { id: 's5', title: 'Opportunity & progression', short: 'Progression' },
  { id: 's6', title: 'Self-employed', short: 'Self-employed' },
  { id: 's7', title: 'Payments & incentives', short: 'Payments' },
  { id: 's8', title: 'Your worth to Modern Milkman', short: 'Your worth' },
  { id: 's9', title: 'Frequently asked questions', short: 'FAQs' },
];

export const DAY1_QUIZZES: Quiz[] = [
  {
    id: 'q1', title: 'Quiz 1 · Marketing and our model', qs: [
      { p: 'Which of these is direct marketing?', o: ['TV advert', 'Billboard', 'Face to face', 'Radio'], a: 2,
        w: 'Face to face is direct: we speak to the customer and set everything up for them.' },
      { p: 'Roughly how many adverts do we see a day?', o: ['250', '2,500', '25,000'], a: 1,
        w: 'About 2,500, which is why indirect adverts get lost.' },
      { p: 'Which is the most important link in our model?', o: ['Client → marketing company', 'Marketing company → Brand Ambassador', 'Brand Ambassador → customer'], a: 2,
        w: 'Brand Ambassador → customer, because that’s where the revenue is made.' },
    ],
  },
  {
    id: 'q2', title: 'Quiz 2 · Progression', qs: [
      { p: 'Most businesses move people up based on…', o: ['Performance', 'Seniority: age and experience'], a: 1,
        w: 'Seniority, which makes it slow and hard to move up.' },
      { p: 'We move people up based on…', o: ['How long you’ve been here', 'Performance and hitting the criteria'], a: 1,
        w: 'Performance. Hit the criteria and you move forward, like sport.' },
      { p: 'What’s the first step on the ladder?', o: ['6–9 day evaluation', 'Leader', 'Team Leader'], a: 0,
        w: 'Your 6–9 day evaluation, which ends on field day 6.' },
    ],
  },
  {
    id: 'q3', title: 'Quiz 3 · Money', qs: [
      { p: 'A Gold sign-up is a repeat order of…', o: ['£5–£9.99', '£10 or more'], a: 1,
        w: '£10 or more. It earns the Gold fee, plus the week-4 payment if they’re still ordering.' },
      { p: 'When do you get your first pay?', o: ['11 days after this Saturday', 'At the end of the month', 'The day after you sign someone up'], a: 0,
        w: '11 days after this Saturday, then weekly.' },
      { p: 'Who sorts out your tax?', o: ['The office', 'You'], a: 1,
        w: 'You do: register with HMRC, get your UTR and keep your receipts.' },
      { p: 'When are incentives paid?', o: ['Straight away', 'Once you’ve completed your 6–9 day evaluation'], a: 1,
        w: 'Only once you’ve completed your 6–9 day evaluation.' },
    ],
  },
];

export const RECEIPTS = ['Travel', 'Accommodation', 'Entertainment', 'Food away from home', 'Utilities', 'Electronics',
  'Furniture', 'Mobile phone bill', 'Stationery', 'Software', 'Accounting costs'];

export type WorkbookState = {
  fields: Record<string, string>;
  done: Record<string, boolean>;
  quiz: Record<string, Record<string, number>>;
};

export const emptyState = (): WorkbookState => ({ fields: {}, done: {}, quiz: {} });

/** Sections done + quizzes finished, out of the total, for one Day 1 workbook. */
export function day1Progress(s: Pick<WorkbookState, 'done' | 'quiz'> | null | undefined) {
  const done = s?.done || {};
  const quiz = s?.quiz || {};
  const sections = DAY1_SECTIONS.filter((x) => done[x.id]).length;
  const quizzes = DAY1_QUIZZES.filter((q) => Object.keys(quiz[q.id] || {}).length === q.qs.length).length;
  const total = DAY1_SECTIONS.length + DAY1_QUIZZES.length;
  return { done: sections + quizzes, total, sections, quizzes };
}

/** "2/3" for each quiz answered in full, else null. */
export function quizScores(quiz: Record<string, Record<string, number>> | null | undefined) {
  return DAY1_QUIZZES.map((q) => {
    const a = (quiz || {})[q.id] || {};
    if (Object.keys(a).length < q.qs.length) return { id: q.id, score: null as number | null, of: q.qs.length };
    return { id: q.id, score: q.qs.filter((x, i) => a[String(i)] === x.a).length, of: q.qs.length };
  });
}
