/**
 * BA Academy Day 2: the workbook's sections and quizzes, in the Owner's
 * running order (26 Oct 2026). It starts with the sign-up process (start,
 * set the expectation, build the week, lock it in) and finishes with the
 * external final quiz. The screen lays the content out (Day2Page.tsx); this
 * file holds what both the screen and the Owner's class card need.
 *
 * Field ids are saved on the server the same way as Day 1 (see day1.ts).
 * Don't rename an id once people have used it.
 */
import type { Quiz, WorkbookState } from './day1';

/** The Owner's final quiz (Microsoft Forms), opened from the end of Day 2. */
export const FINAL_QUIZ_URL = 'https://forms.cloud.microsoft/e/dF555jSN2L';

export const DAY2_SECTIONS: { id: string; title: string; short: string }[] = [
  { id: 's1', title: 'The sign-up process', short: 'Sign-up' },
  { id: 's2', title: 'Introduction', short: 'Introduction' },
  { id: 's3', title: 'Body language & tone', short: 'Body language' },
  { id: 's4', title: 'Let’s practise', short: 'Practise' },
  { id: 's5', title: 'Code of practice', short: 'Code of practice' },
  { id: 's6', title: 'Presentation: G.I.F.T.S.', short: 'G.I.F.T.S.' },
  { id: 's7', title: 'Who we can’t sign up', short: 'Who we can’t' },
  { id: 's8', title: 'Short story: the mission and reducing plastic', short: 'Short story' },
  { id: 's9', title: 'Supporting independent farmers', short: 'Farmers' },
  { id: 's10', title: 'Convenience, then let’s practise', short: 'Convenience' },
  { id: 's11', title: 'Product knowledge', short: 'Products' },
  { id: 's12', title: 'Sales quality', short: 'Quality' },
  { id: 's13', title: 'Rehash', short: 'Rehash' },
  { id: 's14', title: 'Law of Averages', short: 'Law of Averages' },
];

export const DAY2_QUIZZES: Quiz[] = [
  {
    id: 'q1', title: 'Quiz 1 · The sign-up process', qs: [
      { p: 'What are the three questions when you build the order?', o: ['Name, address, email', 'What do you use, how much, when do you next need it', 'Milk, eggs or bread'], a: 1,
        w: 'What do you use, how much, and when do you next need it. Then repeat for every product.' },
      { p: 'What do you say to set the expectation?', o: ['“Let’s build a week of everything you already use.”', '“What’s your budget?”', '“Do you want the cheapest option?”'], a: 0,
        w: 'It sets the frame: a week of everything they already use.' },
      { p: 'You tell them the price for the week. Then you…', o: ['Keep talking to fill the silence', 'Pause', 'Offer a cheaper order straight away'], a: 1,
        w: 'Say it calmly, then pause.' },
      { p: 'Why do we build the order around sticky products like milk, eggs and bread?', o: ['They’re the cheapest', 'Customers reorder them every week, which keeps them ordering', 'They’re the newest products'], a: 1,
        w: 'Sticky products get reordered every week, so the order lasts.' },
      { p: 'On average, how many drop days a week do we aim for?', o: ['1', '2.5', '5'], a: 1,
        w: 'We aim for 2.5 drop days on average, with fails under 10%.' },
      { p: 'When does the customer pay?', o: ['On the day, there and then', 'At the end of the month', 'After their first delivery'], a: 0,
        w: 'They pay on the day, there and then, when they sign up.' },
      { p: 'A customer asks if they can cancel. You…', o: ['Change the subject', 'Explain clearly and honestly that they can manage, pause or cancel in the app', 'Tell them not to worry'], a: 1,
        w: 'Always be honest about how the subscription works.' },
    ],
  },
  {
    id: 'q2', title: 'Quiz 2 · Introduction and body language', qs: [
      { p: 'What does S.E.E. stand for?', o: ['Smile, eye contact, enthusiasm', 'Sell, explain, end', 'Speak, engage, enjoy'], a: 0, w: 'Smile, eye contact, enthusiasm.' },
      { p: 'How much of communication is body language?', o: ['7%', '23%', '70%'], a: 2, w: '70% body language, 23% tone, 7% words.' },
      { p: 'How long do you have to make a first impression?', o: ['7 seconds', '30 seconds', '2 minutes'], a: 0, w: 'About 7 seconds.' },
    ],
  },
  {
    id: 'q3', title: 'Quiz 3 · Code of practice', qs: [
      { p: 'A house has a “No Cold Calling” sign. You…', o: ['Knock anyway', 'Respect it and don’t knock', 'Leave a leaflet'], a: 1, w: 'Respect the sign.' },
      { p: 'Which is a data protection breach?', o: ['Entering details into the sign-up', 'Photographing a customer’s details on your own phone', 'Confirming the delivery address'], a: 1, w: 'Details only go into the approved sign-up.' },
      { p: 'Which is misleading?', o: ['Explaining delivery days', 'Exaggerating savings or hiding costs', 'Talking about plastic'], a: 1, w: 'Never exaggerate, and never leave out costs.' },
      { p: 'Which of these is an omission?', o: ['Hiding the delivery fee', 'Explaining the subscription', 'Talking through the terms'], a: 0, w: 'Leaving out a cost, like the delivery fee, is an omission.' },
    ],
  },
  {
    id: 'q4', title: 'Quiz 4 · G.I.F.T.S. and customers', qs: [
      { p: '“Your neighbours already have it” is which impulse?', o: ['Greed', 'The Jones Theory', 'Indifference'], a: 1, w: 'The Jones Theory.' },
      { p: 'Who is the best customer?', o: ['Someone signing up only for the discount', 'The person who does the shopping and uses the products every week', 'A visiting family member'], a: 1, w: 'The decision maker who uses the products: an A-customer.' },
      { p: 'Who can’t we sign up?', o: ['Someone under 18', 'A pensioner who’s happy with the app', 'Someone who works nights'], a: 0, w: 'Under 18s can’t sign up. There’s no upper age limit.' },
    ],
  },
  {
    id: 'q5', title: 'Quiz 5 · The short story', qs: [
      { p: 'What’s the biggest reason customers sign up?', o: ['The discount', 'Reducing plastic and helping the planet', 'The milk float'], a: 1, w: 'Reducing plastic.' },
      { p: 'How much more are independent farmers paid by The Modern Milkman?', o: ['The same', 'Up to 4 times more', 'Half as much'], a: 1, w: 'Up to 4 times more than from a supermarket.' },
      { p: 'Order by…, on the doorstep by…', o: ['8pm · 7:30am', '6pm · 9am', 'Midnight · noon'], a: 0, w: 'Order by 8pm the night before, delivered by 7:30am.' },
    ],
  },
  {
    id: 'q6', title: 'Quiz 6 · Product and quality', qs: [
      { p: 'What average order value do we aim for?', o: ['£8+', '£10+', '£13+'], a: 2, w: '£13 or more.' },
      { p: 'Which of these is a fail?', o: ['The customer changes their items', 'A first delivery 12 days away', 'The customer takes The Round'], a: 1, w: 'A first delivery more than 8 days away is a fail.' },
      { p: 'A customer wants their first delivery in 12 days. You…', o: ['Sign them up anyway', 'Move the date to within 8 days without asking', 'Tell them to sign up online later'], a: 2, w: 'Over 8 days is a fail, and never change the date without asking.' },
      { p: 'How do you present The Round (membership)?', o: ['As a must', 'As an optional benefit that adds value', 'As a trial'], a: 1, w: 'Optional, and only where it suits them and they agree.' },
      { p: 'A red bottle top is…', o: ['Whole milk', 'Semi-skimmed', 'Skimmed'], a: 1, w: 'Silver whole, red semi-skimmed, blue skimmed.' },
    ],
  },
  {
    id: 'q7', title: 'Quiz 7 · Rehash', qs: [
      { p: 'A customer says they’re away for a week next month. You…', o: ['Show them how to pause between dates', 'Tell them to cancel and sign up again', 'Say nothing'], a: 0, w: 'Going away = pause, not cancel.' },
      { p: 'In the first 4 weeks, week 2 is about…', o: ['Quality', 'Quantity', 'Routine'], a: 1, w: 'Week 1 quality, week 2 quantity, week 3 addition, week 4 routine.' },
      { p: 'Why add a doorstep photo?', o: ['For our records', 'So the milkman knows exactly where to go', 'It’s optional, so skip it'], a: 1, w: 'No missed deliveries.' },
      { p: 'What is the rehash for?', o: ['Upselling', 'Removing every reason to cancel before it happens', 'Filling time'], a: 1, w: 'Remove every reason to cancel, and make them confident to adjust.' },
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
