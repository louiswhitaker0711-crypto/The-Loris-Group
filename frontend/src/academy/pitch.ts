/**
 * Learn your pitch — the Owner's pitch word for word (26 Oct 2026), each line
 * with why it's there (linked to the COD and product coaching) and how to
 * say it, plus the Check questions. Shown by app/pitch.tsx.
 */
export type PitchLine = { say: string; how: string; why: string; q?: string; tags: string[][] };
export type PitchStep = { n: number; t: string; job: string; c: string; lines: PitchLine[] };
export type PitchQ = { p: string; o: string[]; a: number; w: string };

export const PITCH: PitchStep[] = [
    {n:1,t:'Introduction',job:'7 seconds to make a good first impression',c:'--s1',lines:[
      {say:'Hiya, you alright?',how:'Big, genuine smile before the door’s even open. Upbeat and friendly, like you already know them. Stand back a step, open body language.',why:'Warm and casual. Smile, eye contact and enthusiasm before you say anything else: they decide in seven seconds whether to listen.',tags:[['5 Steps · Introduction'],['S.E.E.']]},
      {say:'Good, nothing serious, I’m with the milkman.',how:'Light and relaxed, with a little laugh in your voice on “nothing serious”. Show your badge on “milkman”.',why:'“Nothing serious” drops their guard straight away. “With the milkman” says who you are in words everyone understands.',tags:[['Icebreaker'],['Who we are']]},
      {say:'We do the deliveries to a load of your neighbours.',how:'Casual and matter-of-fact, like it’s old news. Nod or point down the street on “neighbours”.',why:'Their neighbours already use it, so it’s normal round here. This is social proof before you’ve explained anything.',tags:[['G.I.F.T.S · The Jones Theory','g']]}
    ]},
    {n:2,t:'Presentation',job:'Why we’re here, and qualify them',c:'--s2',lines:[
      {say:'Reason we’ve come round, we’ve got so popular we’re sending another van around.',how:'A bit of pride and excitement on “so popular”. Keep the energy up.',why:'Gives a positive reason you’re at the door. Popular means everyone else wants it, and another van means now.',tags:[['G.I.F.T.S · The Jones Theory','g'],['G.I.F.T.S · Sense of Urgency','g']]},
      {say:'Is it yourself that does the shopping?',how:'A real question: eye contact, then stop and wait. Nod while they answer, and say “Perfect” warmly, not rushed.',q:'Perfect.',why:'Qualifies them: you want the person who does the shopping, an A-customer. If it isn’t them, you know straight away.',tags:[['A-customer','q'],['Qualification','q']]},
      {say:'I’m guessing you use… milk?',how:'Pause before “milk”, eyebrows up, smiling. It’s a fun, obvious question, so play it that way.',q:'Aha. Perfect.',why:'The easiest yes there is, and it confirms they use the product. “Perfect” after each answer is your smile and agree, and every yes builds to the close.',tags:[['Agreements'],['Smile and agree']]}
    ]},
    {n:3,t:'Short story',job:'Paint the picture: the three reasons people sign up',c:'--s3',lines:[
      {say:'What we do, we get everything from the more local, independent farms.',how:'Slow down a touch and say it like you’re proud of it, so it lands.',why:'Supporting independent farmers: they’re paid fairly, and the milk is fresh, with no week-long supermarket supply chain.',tags:[['Supporting independent farmers']]},
      {say:'And we do everything in the glass bottles as well, like back in the day!',how:'Warm and nostalgic. Smile on “like back in the day!”',why:'Reducing plastic, the biggest reason customers sign up. “Like back in the day” adds nostalgia: the milkround is reassuringly familiar.',tags:[['Reducing plastic']]},
      {say:'And what we’ve put it on an app on your phone, so you can order whatever you need even the night before and we’ll drop it off on the doorstep the next morning!',how:'Upbeat and easy, like you’re sharing a handy tip. Hold up your phone or tablet.',why:'Modern convenience: order by 8pm the night before and it’s on the doorstep by 7:30am. No booking slots and no waiting in.',tags:[['Convenience']]},
      {say:'And like eggs and bread and juice and everything like that!',how:'Light and quick, like a list that could go on. A shrug and a smile on “everything like that”.',why:'Opens up a bigger order without asking for it. A bigger order means a better order value and more drop days, and customers who stay longer.',tags:[['Order value £13+','q'],['Drop days','q']]}
    ]},
    {n:4,t:'Close',job:'Give them the reason to start today',c:'--s4',lines:[
      {say:'What I’ve been doing today, we’re basically giving everyone a discount!',how:'Lean in slightly, like you’re letting them in on good news. Energy up.',why:'A reason to say yes now rather than “later”. Everyone likes a deal, and “today” makes it now.',tags:[['G.I.F.T.S · Greed','g'],['G.I.F.T.S · Sense of Urgency','g'],['G.I.F.T.S · Fear of loss','g']]},
      {say:'Just so while it’s a bit cheaper, you can see what you like in your routine, see how much you use, get it sorted for you and everything like that.',how:'Calmer and slower: helpful and reassuring. You’re sorting it for them, not pushing.',why:'Frames it as finding the right order for their routine, which is what keeps customers past week 4. That’s quality, not just a sale.',tags:[['4th-week rate','q'],['Quality']]},
      {say:'I’m assuming if you could get everything more local, glass bottles, delivered, I’m guessing you’d rather do that.',how:'Confident and warm, nodding as you say it. Let your voice go down at the end, a statement not a question. Then stop and say nothing until they answer.',why:'An assumptive close. It plays back everything they’ve already agreed with, so saying yes is the natural next step. Then stop talking and let them answer.',tags:[['5 Steps · Close'],['Agreements']]}
    ]}
  ];

export const PITCH_QUIZ: PitchQ[] = [
    {p:'“We do the deliveries to a load of your neighbours.” Which impulse is this?',o:['Greed','The Jones Theory','Indifference'],a:1,w:'The Jones Theory: the neighbours already have it, so it’s normal round here.'},
    {p:'Why ask “Is it yourself that does the shopping?”',o:['To fill the silence','To qualify them as the person who shops: an A-customer','To find out their name'],a:1,w:'It qualifies them. You want the person who does the shopping.'},
    {p:'What are the three reasons in the Short story?',o:['Price, speed, choice','Independent farms, glass bottles (less plastic), the app and doorstep delivery','Discounts, vans, neighbours'],a:1,w:'Supporting independent farmers, reducing plastic, and modern convenience.'},
    {p:'Why mention eggs, bread and juice?',o:['To open up a bigger order','Because milk isn’t enough to sign up','To fill time'],a:0,w:'A bigger order means a better order value and customers who stay longer.'},
    {p:'“I’m guessing you’d rather do that.” What kind of close is this?',o:['A question close','An assumptive close','A discount close'],a:1,w:'Assumptive: it plays back what they’ve agreed to, so yes is the natural answer.'},
    {p:'What comes straight after they say yes?',o:['Walk to the next door','The Rehash: payments, managing orders, cut-off and delivery times, bottles out','Another discount'],a:1,w:'The Rehash. It makes sure they know everything, which keeps them as a customer.'}
  ];

export const REHASH = ['Explain the payments and the discount period', 'Show them how to manage their regular order',
  'Order by 8pm the night before; delivery by 7:30am', 'Leave the empty bottles out'];
