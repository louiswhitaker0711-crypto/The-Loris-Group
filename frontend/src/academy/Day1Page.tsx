/**
 * BA Academy Day 1 — the workbook page, in the Owner's running order
 * (26 Oct 2026): first week, marketing, our model, quiz, expectations,
 * break, progression, quiz, break, self-employed, payments, your worth,
 * quiz, FAQs. Pay figures come from the office's Rates, so they never go
 * out of date; the first pay date is worked out from today.
 */
import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors, fonts } from '../theme/ThemeContext';
import { apiService } from '../api/client';
import { normalizeFees, payDates, formatPayDate, DEFAULT_FEES } from '../pay/vertexPay';
import { addDays, todayISO } from '../utils/calendarDates';
import { formatMoney } from '../utils/appTime';
import { DAY1_QUIZZES, RECEIPTS } from './day1';
import { Section, Fill, Notes, Points, Panel, Two, Say, Rows, Figure, Break, QuizBlock, Ticks, P, B, H3, Label, useWbStyles } from './Workbook';
import { ModelDiagram, LadderDiagram } from './diagrams';

/** The Sunday that ends this Bells week (Mon–Sat working week). */
function weekEndingSunday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? 0 : 7 - dow);
}

const money = (n: number) => formatMoney(n, Number.isInteger(n) ? 0 : 2);

export default function Day1Page() {
  const c = useColors();
  const s = useWbStyles();
  const { width } = useWindowDimensions();
  const narrow = width < 560;
  const feesQ = useQuery({
    queryKey: ['commission-fees', 'academy'],
    queryFn: async () => normalizeFees((await apiService.getCommissionFees()).data),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const f = feesQ.data || DEFAULT_FEES;
  const sunday = weekEndingSunday(todayISO());
  const saturday = addDays(sunday, -1);
  const payDay = formatPayDate(payDates(sunday).signUps);
  const satLabel = formatPayDate(saturday);
  const silverTotal = f.fee_standard + f.retention_standard;
  const goldTotal = f.fee_target + f.retention_target;
  const [q1, q2, q3] = DAY1_QUIZZES;

  return (
    <View>
      {/* 1 ─ First week */}
      <Section id="s1" n={1} title="Your first week" sub="What the next 8 days look like, and what we look for in you">
        <View>
          {WEEK.map((w, i) => (
            <View key={i} style={[x.weekRow, { borderTopColor: c.border }, i === 0 && { borderTopWidth: 0 }]}>
              <View style={{ width: 62 }}>
                <Text style={[x.weekDay, { color: i === 0 ? c.primary : c.text }]}>{w.day}</Text>
                <Text style={[s.label, { letterSpacing: 0.3, textTransform: 'none', fontSize: 11.5 }]}>{w.phase}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={s.bold}>{w.title}</Text>
                <P muted small>{w.what}</P>
                {!!w.chips && (
                  <View style={x.chips}>
                    {w.chips.map((t) => <Text key={t} style={[x.chip, { borderColor: c.primaryLight, color: c.primary }]}>{t}</Text>)}
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
        <Panel label="What we look for" hi>
          <Fill parts={['The three things we look for in people are ', { id: 'v1', a: 'work ethic', w: 11 }, ', ', { id: 'v2', a: 'willingness to learn', w: 14 }, ' and a ', { id: 'v3', a: 'good attitude', w: 11 }, '.']} />
        </Panel>
        <View style={{ gap: 8 }}>
          <H3>Our expectations for these two days</H3>
          <Points items={[
            ['Be present.', 'No distractions. The more notes you take, the longer you keep the information, and one day you’ll be teaching it to others.'],
            ['Participate.', 'If something isn’t clear, ask. Someone else in the room probably has the same question.'],
            ['Have fun.', ''],
          ]} />
        </View>
        <Notes id="n1" />
      </Section>

      {/* 2 ─ Marketing */}
      <Section id="s2" n={2} title="Indirect vs direct marketing" sub="Why brands pay for people on the doorstep">
        <Two>
          <Panel label="Indirect">
            <P muted small>TV, radio, billboards, internet, social media, newspapers, sponsorships</P>
            <Label color={c.sgreenInk}>Good</Label>
            <Points items={['Huge audience', 'Professional, and the brand controls its image', 'Brand awareness and trust']} />
            <Label color={c.red}>Bad</Label>
            <Points items={['Costly, and the return can’t be measured', 'We see thousands of adverts a day', 'Can’t be tailored to the person', 'The customer has to do the work', 'Lots of competition']} />
          </Panel>
          <Panel label="Direct (us)" hi>
            <P muted small>Face to face, phone, messaging, retail</P>
            <Label color={c.sgreenInk}>Good</Label>
            <Points items={['Guaranteed, measurable return', 'Personal, with a longer-lasting message', 'No competition on the doorstep', 'The customer does nothing: we set it all up for them']} />
            <Label color={c.red}>Bad</Label>
            <Points items={['Takes time', 'The brand doesn’t control the message, so how we treat people matters']} />
          </Panel>
        </Two>
        <Fill parts={['We specialise in ', { id: 'm1', a: 'direct', w: 8 }, ' marketing. We see about ', { id: 'm2', a: '2,500', w: 7 }, ' adverts a day. Every customer, ', { id: 'm3', a: 'yes or no', w: 9 }, ', is left with a positive impression of the brand.']} />
        <Say>I know how you’ll react to a yes. I’m more interested in how you react to a no.</Say>
        <Notes id="n2" />
      </Section>

      {/* 3 ─ Our model */}
      <Section id="s3" n={3} title="Our model" sub="Who does what, and where the money is made">
        <Figure caption="The client pays the marketing company, the marketing company pays you, and you sign up the customer.">
          <ModelDiagram company="Ginger Leeds" />
        </Figure>
        <Fill parts={['The most important link is ', { id: 'o1', a: 'Brand Ambassador', w: 15 }, ' → ', { id: 'o2', a: 'Customer', w: 9 }, ', because that’s where the ', { id: 'o3', a: 'revenue', w: 8 }, ' is generated.']} />
        <Notes id="n3" />
      </Section>

      <QuizBlock quiz={q1} />

      {/* 4 ─ Expectations */}
      <Section id="s4" n={4} title="What you can expect from us, and what we expect from you" sub="Both sides of the deal" answers={false}>
        <Two>
          <Panel label="From us">
            <Points items={[
              ['Product coaching', 'so you can represent Modern Milkman fully and accurately'],
              ['Sales coaching', 'at every stage, including how to coach others'],
              ['Environment & core values', 'where you can grow'],
              ['Mentoring:', 'someone looks after you for your first two months'],
              ['Progression', 'as we open more offices'],
              ['International networking', 'with offices abroad'],
            ]} />
          </Panel>
          <Panel label="From you">
            <Points items={[
              ['100% effort.', 'You get what you put in.'],
              ['Proactive about your development.', 'Be a great student.'],
              ['Reliability', 'and being a team player'],
              ['Set goals', 'and progress fast'],
              ['Positive', 'with the team and on the doorstep'],
              ['Push boundaries.', 'The 31st time feels easier than the 1st.'],
            ]} />
          </Panel>
        </Two>
        <Fill parts={['The expectation I’ll find hardest is ', { id: 'e1', w: 18 }, ', and I’ll work on it by ', { id: 'e2', w: 18 }, '.']} />
        <Notes id="n4" />
      </Section>

      <Break />

      {/* 5 ─ Progression */}
      <Section id="s5" n={5} title="Opportunity & progression" sub="Why we run like sport">
        <Text style={[s.body, { fontSize: 16 }]}>Most businesses run on <B>seniority</B>. We run like <B>sport</B>: you’re picked on how you perform, not how long you’ve been there.</Text>
        <View style={[x.cmp, { borderColor: c.border }]}>
          {!narrow && (
            <View style={[x.cmpRow, { backgroundColor: c.surface }]}>
              <View style={x.cmpK} />
              <View style={x.cmpCell}><Label>Most businesses</Label></View>
              <View style={[x.cmpCell, { backgroundColor: c.primary + '12' }]}><Label color={c.primary}>Us</Label></View>
            </View>
          )}
          {COMPARE.map(([k, them, us], i) => (
            <View key={k} style={[narrow ? x.cmpRowNarrow : x.cmpRow, { borderTopColor: c.border }, (i > 0 || !narrow) && { borderTopWidth: 1 }]}>
              {narrow ? (
                <View style={[x.cmpKNarrow, { backgroundColor: c.surface }]}><Label>{k}</Label></View>
              ) : (
                <View style={x.cmpK}><Text style={s.bold}>{k}</Text></View>
              )}
              <View style={narrow ? x.cmpPair : { flex: 2, flexDirection: 'row' }}>
                <View style={x.cmpCell}>
                  {narrow && <Label>Most businesses</Label>}
                  <P muted small>{them}</P>
                </View>
                <View style={[x.cmpCell, { backgroundColor: c.primary + '12' }]}>
                  {narrow && <Label color={c.primary}>Us</Label>}
                  <P small>{us}</P>
                </View>
              </View>
            </View>
          ))}
        </View>
        <Figure caption="Each step is earned by hitting its criteria, not by time served.">
          <LadderDiagram />
        </Figure>
        <Fill parts={['Most businesses move people up on ', { id: 'p1', a: 'seniority', w: 10 }, '. We move people up on ', { id: 'p2', a: 'performance', w: 11 }, '. My first step is my ', { id: 'p3', a: '6–9 day evaluation', w: 15 }, '.']} />
        <Fill parts={['In 6 months I want to be ', { id: 'p4', w: 20 }, '.']} />
        <Notes id="n5" />
      </Section>

      <QuizBlock quiz={q2} />

      <Break />

      {/* 6 ─ Self-employed */}
      <Section id="s6" n={6} title="Self-employed" sub="Running your own business, and sorting your tax">
        <View style={[x.video, { borderColor: c.border }]}>
          <View style={[x.play, { backgroundColor: c.ink }]}><Text style={{ color: c.inkText, fontSize: 14 }}>▶</Text></View>
          <P muted>Video shown in the room</P>
        </View>
        <Two>
          <Panel label="For you"><Points items={['You run your own business', 'Flexibility']} /></Panel>
          <Panel label="Why the UK wants it"><Points items={['You find your own work', 'You’re more likely to create opportunities for others']} /></Panel>
        </Two>
        <View style={{ gap: 8 }}>
          <H3>Set yourself up</H3>
          <Points items={[
            ['Register as self-employed', 'on HMRC.gov.uk and get your UTR (Unique Taxpayer Reference)'],
            ['Once a year', 'you file a self assessment, online yourself or through an accountant'],
          ]} />
        </View>
        <View style={{ gap: 8 }}>
          <H3>Keep your receipts</H3>
          <Ticks items={RECEIPTS} prefix="r" />
        </View>
        <Panel label="Example · rounded figures">
          <Rows rows={[
            ['You make this year', '£30,000'],
            ['Your expenses', '− £10,000'],
            ['Tax-free allowance', '− £12,500'],
            ['Profit you’re taxed on', <Fill key="t" parts={['£', { id: 't1', a: '7,500', w: 7 }]} />],
          ]} />
        </Panel>
        <Notes id="n6" />
      </Section>

      {/* 7 ─ Payments */}
      <Section id="s7" n={7} title="Payments & incentives" sub="How and when you get paid">
        <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 10 }}>
          <Tier label="Silver · order £5–£9.99" big={money(silverTotal)} split={`${money(f.fee_standard)} on sign-up + ${money(f.retention_standard)} if they’re still ordering in week 4`} />
          <Tier label="Gold · order £10+" big={money(goldTotal)} split={`${money(f.fee_target)} on sign-up + ${money(f.retention_target)} if they’re still ordering in week 4`} gold />
          <Tier label="The Round" big={`+${money(f.fee_membership)}`} split="on top, when the customer takes The Round" />
        </View>
        <P muted small>The order value is the customer’s repeat weekly items. A sign-up pays nothing if they cancel before their first delivery, the first delivery is more than 8 days away, the order is under £5, or there are no repeat items.</P>
        <Panel label="Incentives">
          <Rows rows={[['3rd Gold sale', '£75'], ['8th Gold sale', '£75'], ['15th Gold sale', '£75'], ['25th Gold sale', '£75'], ['10 in a week', '£100']]} />
          <P muted small>Incentives are only paid once you’ve completed your 6–9 day evaluation.</P>
        </Panel>
        <View style={{ gap: 8 }}>
          <H3>When you get paid</H3>
          <View style={x.payTl}>
            <PayStep top="Mon–Sat" sub="you work" />
            <PayStep top={satLabel} sub="week ends" />
            <PayStep top={payDay} sub="+11 days, paid" good />
          </View>
          <P muted small>You’re paid weekly, 11 days after the Saturday that ends your week. Fees for The Round follow a week later.</P>
        </View>
        <Fill parts={['A Gold is a repeat order of £', { id: 'y1', a: '10', w: 4 }, ' or more. If a Gold customer is still ordering in week 4, I get another ', { id: 'y2', a: money(f.retention_target), w: 4 }, '. My first pay day is ', { id: 'y3', a: payDay, w: 12 }, '.']} />
        <Notes id="n7" />
      </Section>

      {/* 8 ─ Your worth */}
      <Section id="s8" n={8} title="Your worth to Modern Milkman" sub="Know what you bring them, and you’ll walk up to every door with confidence">
        <Rows rows={[
          ['Average customer spend', '£11 a week'],
          ['Average customer stays', '20 weeks'],
          ['£11 × 20 weeks', <Fill key="w1" parts={['£', { id: 'w1', a: '220', w: 5 }]} />],
          ['Minus the £49 marketing fee', <Fill key="w2" parts={['£', { id: 'w2', a: '171', w: 5 }, ' per customer']} />],
          ['× 5 sign-ups a day × 5 days × 50 weeks', '£213,750'],
          ['× 40 BAs in one office', <Text key="t" style={[s.bold, { fontFamily: fonts.display, fontSize: 18 }]}>£8.5m a year</Text>],
        ]} />
        <Fill parts={['One Brand Ambassador is worth about £', { id: 'w3', a: '213k', w: 6 }, ' a year to Modern Milkman.']} />
        <Notes id="n8" />
      </Section>

      <QuizBlock quiz={q3} />

      {/* 9 ─ FAQs */}
      <Section id="s9" n={9} title="Frequently asked questions" sub="Tap a question for the answer" answers={false} footNote="Last section today">
        <View>{faqs(payDay).map(([q, a], i) => <Faq key={i} q={q} a={a} first={i === 0} />)}</View>
        <Notes id="questions" label="My questions for my Coach" placeholder="Write them down and we’ll answer them in the room" />
      </Section>
    </View>
  );
}

const WEEK: { day: string; phase: string; title: string; what: string; chips?: string[] }[] = [
  { day: 'Mon', phase: 'Academy', title: 'BA Academy Day 1', what: 'How the business works, who we represent, quality, and how you get paid.' },
  { day: 'Tue', phase: 'Academy', title: 'BA Academy Day 2', what: 'Product knowledge, the 5 Steps, who not to sign up, and the sign-up process.' },
  { day: 'Wed', phase: 'Field 1', title: 'Shadow day', what: 'You watch a bunny hop pitch and learn the law of averages. No sales goal, just learning.', chips: ['learning goals only'] },
  { day: 'Thu', phase: 'Field 2', title: 'First day on badge', what: 'Your first closes, the app and The Round, and your first rehash.', chips: ['120 doors', '70 spoken to', '25 pitched', '15 closed', '4+ sign-ups'] },
  { day: 'Fri', phase: 'Field 3', title: 'Sharpen the pitch', what: 'G.I.F.T.S, refining your pitch, stronger conversion.' },
  { day: 'Sat', phase: 'Field 4', title: 'Handling objections', what: 'The objection cycle, reading the map yourself, 1–2 sign-ups on your own.' },
  { day: 'Mon', phase: 'Field 5', title: 'Independent growth', what: 'The full cycle solo and harder objections.' },
  { day: 'Tue', phase: 'Field 6', title: 'Your evaluation', what: 'Repeat the full day on your own, coach yourself, and get the outcome of your 6–9 day evaluation.' },
];

const COMPARE: [string, string, string][] = [
  ['Who moves up', 'Whoever is oldest or has been there longest', 'Whoever hits the criteria'],
  ['How fast', 'Years, waiting for someone above you to leave', 'As fast as your results take you'],
  ['The people above you', 'Settled and comfortable, so they stay put', 'They move up by coaching you up'],
  ['When a role opens', 'Moving one person up means moving the whole chain below, which costs time and money. So they recruit from outside, or move the person running the Leeds Tesco over to Bradford and make a role redundant.', 'We keep opening offices, so there are always new roles to step into'],
  ['What you earn', 'Set by your role, however hard you work', 'Set by what you produce, and uncapped'],
];

const faqs = (payDay: string): [string, string][] => [
  ['What if I don’t sign up any customers?', 'You’re paid per sign-up, so no sign-ups means no pay. It rarely happens: you’re offering milk, eggs and bread delivered to the door before 7:30am, and you won’t be on your own while you learn. If you have a quiet day, your Coach goes through your numbers with you (doors, spoken to, pitched, closed) and finds the step to work on. Most quiet days come from knocking too few doors, not a bad pitch.'],
  ['When do I get my first earnings?', `Your first week ends this Saturday, and you’re paid 11 days later, on ${payDay}. After that you’re paid every week. Fees for The Round follow a week later, and the week-4 payment for each customer still ordering comes once they reach it.`],
  ['What if I don’t pass my evaluation?', 'Your 6–9 day evaluation looks at whether you can represent Modern Milkman well: how you treat customers, the quality of your sign-ups, your attitude, and how you take coaching. If it isn’t a fit, incentives aren’t paid and you return all merchandise. People who turn up every day, listen, and put the coaching into practice pass.'],
  ['Who takes care of my taxes?', 'You do, because you’re self-employed. Register with HMRC as self-employed when you start and you’ll get your UTR. Keep every receipt for things you buy for work, and put some of each week’s earnings aside for your tax bill. Once a year you file a self assessment, online yourself or through an accountant.'],
  ['What if I’m ill or going on holiday?', 'Tell your Coach as early as you can, before the day, not on the morning. You’re self-employed, so you don’t need permission, but sectors are planned around who’s in and the team is counting on you. Reliability is one of the things we look at.'],
  ['Do I pay for my own travel?', 'Day to day, yes: getting to the office and out to your sector is on you. Keep your receipts and check with HMRC or an accountant what you can claim. When there’s an international event, the company pays.'],
];

function Faq({ q, a, first }: { q: string; a: string; first: boolean }) {
  const s = useWbStyles();
  const c = useColors();
  const [open, setOpen] = React.useState(false);
  return (
    <View style={[{ paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: c.border, gap: 6 }]}>
      <Text onPress={() => setOpen((o) => !o)} style={[s.bold, { fontSize: 15 }]} accessibilityRole="button">
        {q}<Text style={{ color: c.primary, fontFamily: fonts.mono }}>{open ? '  –' : '  +'}</Text>
      </Text>
      {open && <P muted>{a}</P>}
    </View>
  );
}

function Tier({ label, big, split, gold }: { label: string; big: string; split: string; gold?: boolean }) {
  const c = useColors();
  const s = useWbStyles();
  return (
    <View style={[x.tier, { borderColor: gold ? c.yellow : c.border, backgroundColor: gold ? c.yellowBg : 'transparent' }]}>
      <Label>{label}</Label>
      <Text style={[x.tierBig, { color: c.text }]}>{big}</Text>
      <Text style={[s.small, s.muted]}>{split}</Text>
    </View>
  );
}

function PayStep({ top, sub, good }: { top: string; sub: string; good?: boolean }) {
  const c = useColors();
  const s = useWbStyles();
  return (
    <View style={[x.payStep, { borderColor: good ? c.sgreen : c.border, backgroundColor: good ? c.sgreenBg : 'transparent' }]}>
      <Text style={[s.bold, { fontFamily: fonts.display, fontSize: 15, textAlign: 'center' }]}>{top}</Text>
      <Text style={[s.small, s.muted, { textAlign: 'center' }]}>{sub}</Text>
    </View>
  );
}

const x = StyleSheet.create({
  weekRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderTopWidth: 1 },
  weekDay: { fontFamily: fonts.monoSemibold, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  chip: { fontFamily: fonts.mono, fontSize: 11, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  cmp: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  cmpRow: { flexDirection: 'row' },
  cmpRowNarrow: {},
  cmpK: { width: 130, padding: 10 },
  cmpKNarrow: { paddingHorizontal: 10, paddingVertical: 7 },
  cmpPair: { flexDirection: 'row' },
  cmpCell: { flex: 1, padding: 10, gap: 3, minWidth: 0 },
  video: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12 },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tier: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  tierBig: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  payTl: { flexDirection: 'row', gap: 8 },
  payStep: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, gap: 2 },
});
