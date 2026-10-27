/**
 * BA Academy Day 2: the workbook's sections and quizzes, in the Owner's
 * running order (26–27 Oct 2026): sticky products, the sign-up process (start,
 * set the expectation, build the week, lock it in), The Round, then the door
 * pitch theory with the matching part of the pitch after each, quality, the
 * rehash, Field IQ and the Law of Averages, and finally the external final
 * quiz. The screen lays the content out (Day2Page.tsx); this file holds what
 * both the screen and the Owner's class card need.
 *
 * 27 Oct 2026 rework: fewer gaps (a short Check yourself at the end of each
 * section, filled from memory), 4 quizzes instead of 7 with 4 options each and
 * believable wrong answers, testing what the final Form doesn't (the pitch,
 * the sign-up, sticky products, The Round, the rehash). New quiz ids (qa–qd)
 * so answers to the old quizzes never score against new questions.
 *
 * Field ids are saved on the server the same way as Day 1 (see day1.ts).
 * Don't rename an id once people have used it.
 */
import type { Quiz, WorkbookState } from './day1';

/** The Owner's final quiz (Microsoft Forms), opened from the end of Day 2. */
export const FINAL_QUIZ_URL = 'https://forms.cloud.microsoft/e/dF555jSN2L';
/** Field IQ download (Campaign Knowledge → Field IQ). */
export const FIELD_IQ_URL = 'https://www.tfo.group/fieldiqdownload';

export const DAY2_SECTIONS: { id: string; title: string; short: string }[] = [
  { id: 'sk', title: 'Sticky products', short: 'Sticky products' },
  { id: 's1', title: 'The sign-up process', short: 'Sign-up' },
  { id: 'rd', title: 'The Round (membership)', short: 'The Round' },
  { id: 's2', title: 'Introduction', short: 'Introduction' },
  { id: 's3', title: 'Body language & tone', short: 'Body language' },
  { id: 's4', title: 'Let’s practise', short: 'Practise' },
  { id: 's5', title: 'Code of practice', short: 'Code of practice' },
  { id: 's6', title: 'Presentation: G.I.F.T.S.', short: 'G.I.F.T.S.' },
  { id: 's7', title: 'Who we can’t sign up', short: 'Who we can’t' },
  { id: 's8', title: 'Short story: the mission and reducing plastic', short: 'Short story' },
  { id: 's9', title: 'Supporting independent farmers', short: 'Farmers' },
  { id: 's10', title: 'Convenience, the close, then let’s practise', short: 'Close' },
  { id: 's11', title: 'Product knowledge', short: 'Products' },
  { id: 's12', title: 'Sales quality', short: 'Quality' },
  { id: 's13', title: 'Rehash', short: 'Rehash' },
  { id: 'fq', title: 'Field IQ', short: 'Field IQ' },
  { id: 's14', title: 'Law of Averages', short: 'Law of Averages' },
];

export const DAY2_QUIZZES: Quiz[] = [
  {
    id: 'qa', title: 'Quiz 1 · Sticky products, the sign-up and The Round', qs: [
      { p: 'A customer says they go through 6 pints of milk a week. What do you ask next?', o: ['“How about we start you on 2 and see how it goes?”', '“When do you next need it?”', '“Shall I add The Round?”', '“Do you want eggs as well?”'], a: 1,
        w: 'What do you use, how much, when do you next need it, for every product. Never start them on less than they use.' },
      { p: 'Which of these is NOT one of our sticky products?', o: ['Butter', 'Milkshakes', 'A one-off birthday cake', 'Yoghurt'], a: 2,
        w: 'Sticky products are the ones they reorder every week: milk, eggs, bread, juice, milkshakes, butter, yoghurt, cheese.' },
      { p: 'You’ve read back the week and said the price. What now?', o: ['Explain the price again so it doesn’t sound expensive', 'Offer to take something off', 'Pause and let them answer', 'Move straight on to the rehash'], a: 2,
        w: 'Say it calmly, then pause.' },
      { p: 'What does The Round cover?', o: ['The first order only', 'A free pint every week', 'The 20% discount', 'The delivery fee on every order'], a: 3,
        w: 'The Round is the membership: the delivery fee is covered on every order, plus member perks.' },
      { p: 'A customer isn’t sure about The Round. You…', o: ['Explain what it gives them and let them choose', 'Add it anyway: they can cancel in the app', 'Tell them they need it for the discount', 'Leave it out and don’t mention it'], a: 0,
        w: 'It’s an optional benefit. Explain it clearly and let them choose; never add it for them.' },
      { p: 'Who speaks first when you’re building the order?', o: ['You, so you keep control', 'The customer', 'Whoever’s holding the phone', 'It doesn’t matter'], a: 1,
        w: 'They speak first, one item at a time, and you drive the pace.' },
    ],
  },
  {
    id: 'qb', title: 'Quiz 2 · Introduction and code of practice', qs: [
      { p: 'The door opens. What comes before you say anything?', o: ['Holding up your badge', 'The discount', 'Asking if they do the shopping', 'A smile, eye contact and enthusiasm'], a: 3,
        w: 'S.E.E. first: they decide in about 7 seconds whether to listen.' },
      { p: 'How is communication split?', o: ['7% body language, 23% tone, 70% words', '70% body language, 23% tone, 7% words', '50% words, 50% tone', '23% body language, 70% tone, 7% words'], a: 1,
        w: '70% body language, 23% tone of voice, 7% the words.' },
      { p: 'Why do we say “nothing serious” in the opener?', o: ['To drop their guard straight away', 'To explain the offer', 'To fill time while they decide', 'Because the client tells us to'], a: 0,
        w: 'It relaxes them straight away, so they listen.' },
      { p: 'Someone tells you you’re in a no-cold-calling zone. You…', o: ['Finish this street, then move', 'Only skip their house', 'Leave the immediate area and tell your Coach and the Owner', 'Ask them to prove it'], a: 2,
        w: 'Apologise, leave the immediate area, and tell your Coach and the Owner so it can be checked.' },
      { p: 'Leaving out the delivery fee when you explain the price is…', o: ['Fine if they don’t ask', 'An omission, which counts as misleading', 'Only a problem on orders under £5', 'Up to you'], a: 1,
        w: 'Hiding a cost is an omission. Always explain the delivery fee.' },
    ],
  },
  {
    id: 'qc', title: 'Quiz 3 · The pitch: presentation, short story and close', qs: [
      { p: '“We’ve got so popular we’re sending another van round.” Which two G.I.F.T.S. is that?', o: ['Greed and Indifference', 'The Jones Theory and Sense of urgency', 'Fear of loss and Greed', 'Indifference and Sense of urgency'], a: 1,
        w: 'Everyone else has it (The Jones Theory), and another van means now (Sense of urgency).' },
      { p: 'A man says his wife does the shopping and she’s at work. You…', o: ['Sign him up: he can tell her later', 'Ask for her phone number', 'Sign up with her card details', 'Don’t sign him up: leave a good impression and come back when she’s in'], a: 3,
        w: 'Only sign up the person who does the shopping: the decision maker.' },
      { p: 'What’s the biggest reason customers sign up?', o: ['The 20% discount', 'Fresher milk', 'Cutting plastic and helping the planet', 'Not having to go to the shop'], a: 2,
        w: 'Reducing plastic. Passion is transferred: if you care about it, they will.' },
      { p: 'How much more are independent farmers paid by The Modern Milkman than by a supermarket?', o: ['Up to 4 times more', 'Twice as much', 'The same', '10% more'], a: 0,
        w: 'Up to 4 times more.' },
      { p: '“I’m guessing you’d rather do that.” What kind of close is it?', o: ['A question close', 'An assumptive close', 'A discount close', 'A trial close'], a: 1,
        w: 'Assumptive: it plays back everything they’ve agreed with. Then stop talking and let them answer.' },
    ],
  },
  {
    id: 'qd', title: 'Quiz 4 · Products, quality, rehash and Field IQ', qs: [
      { p: 'A red glass bottle top is…', o: ['Whole milk', 'Skimmed', 'Semi-skimmed', 'Oat drink'], a: 2,
        w: 'Silver is whole, red is semi-skimmed, blue is skimmed.' },
      { p: 'A repeat order comes to £4.80, and the delivery fee takes it over £5. Is it a fail?', o: ['No: it’s over £5 with the fee', 'Yes: the delivery fee doesn’t count', 'Only if they cancel', 'Only if it’s a Silver'], a: 1,
        w: 'The repeat weekly items must come to £5 or more without the delivery fee.' },
      { p: 'In the first 4 weeks, week 2 is about…', o: ['Quality', 'Routine', 'Quantity', 'Addition'], a: 2,
        w: 'Week 1 quality, week 2 quantity, week 3 addition, week 4 routine.' },
      { p: 'Why add a doorstep photo in the rehash?', o: ['For our records', 'To prove we were there', 'It’s optional, so skip it', 'So the milkman knows exactly where to leave it'], a: 3,
        w: 'No missed deliveries.' },
      { p: 'When are you set up on Field IQ?', o: ['On your first day on badge, with your team leader', 'Today, in the office', 'After your evaluation', 'You set it up yourself whenever'], a: 0,
        w: 'Download it before, and you’re set up on your first day on badge.' },
      { p: 'A full day is 120 doors, 70 spoken to, 25 pitched, 15 closed and…', o: ['2 sign-ups', '4+ sign-ups', '8 sign-ups', '10 sign-ups'], a: 1,
        w: 'The Law of Averages: 4 or more sign-ups.' },
    ],
  },
];

export function day2Progress(s: Pick<WorkbookState, 'done' | 'quiz'> | null | undefined) {
  const done = s?.done || {};
  const quiz = s?.quiz || {};
  const sections = DAY2_SECTIONS.filter((x) => done[x.id]).length;
  const quizzes = DAY2_QUIZZES.filter((q) => Object.keys(quiz[q.id] || {}).length === q.qs.length).length;
  const total = DAY2_SECTIONS.length + DAY2_QUIZZES.length;
  return { done: sections + quizzes, total, sections, quizzes };
}
