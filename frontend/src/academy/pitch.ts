/**
 * Learn your pitch — the Owner's pitch word for word (updated 11 Nov 2026: indifferent delivery), each line
 * with why it's there (linked to the COD and product coaching) and how to
 * say it, plus the Check questions. Shown by app/pitch.tsx.
 */
export type PitchLine = { say: string; how: string; why: string; q?: string; tags: string[][] };
export type PitchStep = { n: number; t: string; job: string; c: string; lines: PitchLine[] };
export type PitchQ = { p: string; o: string[]; a: number; w: string };

export const PITCH: PitchStep[] = [
    {n:1,t:'Introduction',job:'7 seconds to make a good first impression',c:'--s1',lines:[
      {say:'Hiya, you alright?',how:'Calm, chilled and smiley, like you’re popping round to a neighbour. No big energy, no rush. Stand back a step, open body language.',why:'They decide in seven seconds whether to listen. Calm and friendly says you’re not there to push anything, so their guard stays down.',tags:[['5 Steps · Introduction'],['S.E.E.']]},
      {say:'Good, nothing serious, I’m with the milkman.',how:'Indifferent and matter-of-fact, still smiling. Say it like it’s the most normal thing in the world, never expecting a no. “Good” can be “lovely” or “amazing”, whatever comes naturally. Point to the logo on “milkman”.',why:'“Nothing serious” drops their guard. Indifference (you don’t need anything from them) makes it feel normal and obvious, not a sales pitch. “With the milkman” says who you are in words everyone understands.',tags:[['Icebreaker'],['Who we are'],['G.I.F.T.S · Indifference','g']]}
    ]},
    {n:2,t:'Presentation',job:'Why we’re here, and qualify them',c:'--s2',lines:[
      {say:'We do the deliveries to a load of your neighbours.',how:'Casual and matter-of-fact, like it’s old news. No pause after the intro: roll straight on. Nod down the street on “neighbours”.',why:'Their neighbours already use it, so it’s normal round here. This is social proof before you’ve explained anything.',tags:[['G.I.F.T.S · The Jones Theory','g']]},
      {say:'Basically so many of them have started using us, we’re just filling some more spaces on the route.',how:'Relaxed, almost a shrug, like it makes no difference to you either way, but still smiley and confident, like it’s good news. Point around on “route”. You’re just stating the obvious.',why:'A positive reason you’re at the door: it’s popular, so you’re adding people. “Filling some more spaces” is a gentle nudge that spaces fill up, without you pushing it.',tags:[['G.I.F.T.S · The Jones Theory','g'],['G.I.F.T.S · Sense of Urgency','g']]},
      {say:'Is it yourself that does the shopping?',how:'Easy and casual, like you already know the answer. Eye contact, then wait: the pause is where they agree. A relaxed “Perfect”, not rushed.',q:'Perfect.',why:'Qualifies them: you want the person who does the shopping, an A-customer. If it isn’t them, you know straight away.',tags:[['A-customer','q'],['Qualification','q']]},
      {say:'I’m guessing you use… milk?',how:'Pause before “milk”, eyebrows up, smiling. Say it like it’s the most obvious question in the world, then let them answer.',q:'Aha. Perfect.',why:'The easiest yes there is, and it confirms they use the product. “Perfect” after each answer is your smile and agree, and every yes builds to the close.',tags:[['Agreements'],['Smile and agree']]}
    ]},
    {n:3,t:'Short story',job:'Paint the picture: the three reasons people sign up',c:'--s3',lines:[
      {say:'So what we do, we use the more local, independent farmers, just so we can grab everything fresher for you, and we’re paying the farmers more.',how:'Calm and matter-of-fact, like it’s obvious. Don’t oversell it.',why:'Supporting independent farmers: they get paid more, and it’s fresher for the customer, with no long supermarket supply chain.',tags:[['Supporting independent farmers']]},
      {say:'And we do it in those little glass bottles, like back in the day.',how:'Warm and easy. Smile on “back in the day”.',why:'Reducing plastic, the biggest reason customers sign up. “Like back in the day” adds nostalgia: the milkround is reassuringly familiar.',tags:[['Reducing plastic']]},
      {say:'What we’ve done though is really clever, actually. We’ve got an app. So there’s about 250 products on there, we deliver 3 times a week…',how:'Relaxed, small nod on “really clever, actually”. Hold up your phone. Let “3 times a week…” trail off, like it’s no big deal.',why:'“Really clever, actually” makes it sound smart and obvious. 250 products opens up a bigger order without asking for it, and 3 deliveries a week plants spreading it across the week: better order value, more drop days, customers who stay longer.',tags:[['Convenience'],['Order value £13+','q'],['Drop days','q']]},
      {say:'You can order whatever you need, even 8pm the night before, and we’ll drop it on the doorstep the next morning.',how:'Easy and matter-of-fact.',why:'Modern convenience: order by 8pm the night before and it’s on the doorstep by 7:30am. No booking slots and no waiting in.',tags:[['Convenience']]},
      {say:'So it just saves you those random trips out, and you’re getting better quality stuff / not buying stuff you don’t need.',how:'Calm, nodding. Pick whichever ending fits them: “better quality stuff” or “not buying stuff you don’t need”.',why:'The payoff that makes it personal: saved time, plus either better quality or only buying what they use, with no impulse buys at the shop.',tags:[['Convenience']]},
      {say:'We’re basically bringing the farm shop to your door.',how:'Smile and a slight shrug: simple as that.',why:'One picture that sums up the whole thing, so it sticks.',tags:[['Supporting independent farmers'],['Convenience']]}
    ]},
    {n:4,t:'Close',job:'Give them the reason to start today',c:'--s4',lines:[
      {say:'We’ve got a discount as well. Just so you can see what it’s like in your routine.',how:'Casual, like it’s a little bonus, not big news. Energy stays calm: no leaning in, no hype.',why:'A reason to say yes now rather than “later”, framed as fitting it into their week rather than a deal.',tags:[['G.I.F.T.S · Greed','g'],['4th-week rate','q']]},
      {say:'Test the quality and see how you like the service.',how:'Relaxed and confident, like you already know they’ll like it.',why:'Puts the focus on the quality and the service, the things that keep customers past week 4. Confidence in the product is what makes it sound like a start, not a trial.',tags:[['Quality'],['4th-week rate','q']]},
      {say:'I’m assuming, like these guys, if everything was coming fresher and more local, on the door in the morning, you’d be happy with that as well?',how:'Confident and smiling, nodding as you say it. Point around on “these guys”. Let your voice go down at the end, a statement not a question. Then stop and say nothing until they answer.',why:'An assumptive close. It plays back everything they’ve already agreed with, with the neighbours as social proof, so saying yes is the natural next step.',tags:[['5 Steps · Close'],['Agreements'],['G.I.F.T.S · The Jones Theory','g']]}
    ]}
  ];

export const PITCH_QUIZ: PitchQ[] = [
    {p:'“We do the deliveries to a load of your neighbours.” Which impulse is this?',o:['Greed','The Jones Theory','Indifference'],a:1,w:'The Jones Theory: the neighbours already have it, so it’s normal round here.'},
    {p:'Why ask “Is it yourself that does the shopping?”',o:['To fill the silence','To qualify them as the person who shops: an A-customer','To find out their name'],a:1,w:'It qualifies them. You want the person who does the shopping.'},
    {p:'What are the three reasons in the Short story?',o:['Price, speed, choice','Independent farms, glass bottles (less plastic), the app and doorstep delivery','Discounts, vans, neighbours'],a:1,w:'Supporting independent farmers, reducing plastic, and modern convenience.'},
    {p:'Why mention the 250 products on the app?',o:['To open up a bigger order','Because milk isn’t enough to sign up','To fill time'],a:0,w:'A bigger order means a better order value and customers who stay longer.'},
    {p:'“I’m assuming… you’d be happy with that as well?” What kind of close is this?',o:['A question close','An assumptive close','A discount close'],a:1,w:'Assumptive: it plays back what they’ve agreed to, so yes is the natural answer.'},
    {p:'What comes straight after they say yes?',o:['Walk to the next door','The Rehash: payments, managing orders, cut-off and delivery times, bottles out','Another discount'],a:1,w:'The Rehash. It makes sure they know everything, which keeps them as a customer.'}
  ];

export const REHASH = ['Explain the payments and the discount period', 'Show them how to manage their regular order',
  'Order by 8pm the night before; delivery by 7:30am', 'Leave the empty bottles out'];

/** The sign-up pitch and the rehash pitch (27 Oct 2026): what to say once
 * they've said yes, from the Owner's sign-up flow and rehash system. A first
 * draft in the Owner's words; he edits the wording in the app (Edit). */
export const SIGNUP_PITCH: PitchStep = {n:5,t:'Sign-up pitch',job:'Start, set the expectation, build the week, lock it in',c:'--s5',lines:[
  {say:'Do you use iPhone or Android? If you go grab your phone, I’ll show you how it works.',how:'Relaxed and already moving forward, like it’s the obvious next step.',why:'Assumes the yes and gets the phone in their hand. That’s the start of the sign-up.',tags:[['5 Steps · Close'],['Sign-up']]},
  {say:'Pop your postcode in there… perfect, so these are your delivery days.',how:'Don’t make it a thing, just do it. Point at the screen.',why:'Step 1, Start: postcode and delivery days, so you know when their week is.',tags:[['Sign-up · Start','q']]},
  {say:'Let’s build a week of everything you already use.',how:'Calm and certain. You’re leading.',why:'Step 2, Set the expectation: it frames the whole order around what they really use.',tags:[['Sign-up · Set the expectation','q']]},
  {say:'So what milk do you use? How much do you go through? And when do you next need it?',how:'One item at a time. They speak first; you drive the pace.',why:'Step 3, Build the week: the three questions, repeated for every product.',tags:[['Sign-up · Build the week','q'],['Order value £13+','q']]},
  {say:'And eggs? Bread? Juice?',how:'Light and quick, then wait for the answer each time.',why:'Sticky products: the ones they reorder every week. Spread across the week, aiming for 2.5 drop days.',tags:[['Sticky products','q'],['Drop days','q']]},
  {say:'So that’s Tuesday…, Thursday…, Saturday… Everything for the week is…',how:'Read back every item and every day. Say the price calmly, then pause.',why:'Step 4, Lock it in: no surprises, and they agree the week before they pay.',tags:[['Sign-up · Lock it in','q']]},
]};
export const REHASH_PITCH: PitchStep = {n:6,t:'Rehash pitch',job:'Remove every reason to cancel before it happens',c:'--s6',lines:[
  {say:'Let me show you your week. So Tuesday you’ve got…, Thursday…, Saturday…',how:'Open their upcoming deliveries and read out each day.',why:'1 · Show their week: removes stress. It’s set up, paid, sorted.',tags:[['Rehash · Build control']]},
  {say:'If you want more or less, just tap plus or minus. Skip misses a day, and remove stops it repeating.',how:'Show them on their phone as you say it.',why:'2 · Change amounts: they don’t cancel, they adjust.',tags:[['Rehash · Build control']]},
  {say:'Going away? Pop the dates in here and it pauses. No need to cancel.',how:'Show the calendar.',why:'3 · Pause, don’t cancel.',tags:[['Rehash · Build control']]},
  {say:'Anything extra, like something for the weekend, add it as a one-off. Saves you a trip to the shop.',how:'Easy and helpful.',why:'4 · One-offs: more convenient and more personal.',tags:[['Rehash · Build control']]},
  {say:'Here’s your receipt, and this is where your next payment shows.',how:'Show the receipt in the app.',why:'5 · Payments: no surprises means no cancellations.',tags:[['Rehash · Lock it in']]},
  {say:'Pop a photo of your doorstep on, so the milkman knows exactly where to leave it. If it’s a bit off the first time or two, just bear with us.',how:'Help them take it there and then.',why:'6 · Doorstep photo: no missed deliveries.',tags:[['Rehash · Lock it in']]},
  {say:'You’ll spend about 4 weeks figuring it out: week 1 the taste, week 2 how much you use, week 3 adding extras, and by week 4 it’s routine.',how:'Relate it to what they’ve ordered.',why:'7 · Set the expectation: quality, quantity, addition, routine.',tags:[['Rehash · Lock it in'],['4th-week rate','q']]},
  {say:'Thank you so much! You’re helping farmers get paid up to 4 times more, and saving plastic bottles. The turtles say thank you!',how:'Big smile. Mean it.',why:'8 · Thank and inspire: they finish feeling good about it.',tags:[['Rehash · Lock it in']]},
]};
/** Everything on the pitch screen: the door pitch, then the sign-up and rehash pitches. */
export const ALL_PITCH: PitchStep[] = [...PITCH, SIGNUP_PITCH, REHASH_PITCH];

/** A line's id for saved wording and progress. The door pitch (steps 1–4) was
 * rewritten on 11 Nov 2026, so its ids carry "v2": wording edits saved against
 * the old lines no longer land on the wrong new lines. */
export function lineId(n: number, i: number): string {
  return n <= 4 ? `L${n}-${i}v2` : `L${n}-${i}`;
}

/** The office's own wording (GET /pitch → words) over the original lines. */
export function withWords(steps: PitchStep[], words: Record<string, string> | null | undefined): PitchStep[] {
  const w = words || {};
  return steps.map((b) => ({
    ...b,
    lines: b.lines.map((l, i) => ({ ...l, say: w[lineId(b.n, i)] || l.say, q: l.q ? (w[`${lineId(b.n, i)}q`] || l.q) : l.q })),
  }));
}
