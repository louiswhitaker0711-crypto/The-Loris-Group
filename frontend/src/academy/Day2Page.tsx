/**
 * BA Academy Day 2 — the workbook page, in the Owner's running order
 * (26 Oct 2026): the sign-up process first (start, set the expectation,
 * build the week, lock it in), then the introduction, body language,
 * practice, code of practice, G.I.F.T.S., who we can't sign up, the short
 * story, product and quality, the rehash, the Law of Averages, and finally
 * the external final quiz.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../theme/ThemeContext';
import { DAY2_QUIZZES, FINAL_QUIZ_URL } from './day2';
import { Section, Fill, Notes, Points, Panel, Two, Say, Break, QuizBlock, P, B, H3, Label, useWbStyles } from './Workbook';

export default function Day2Page() {
  const c = useColors();
  const s = useWbStyles();
  const [q1, q2, q3, q4, q5, q6, q7] = DAY2_QUIZZES;
  const openQuiz = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(FINAL_QUIZ_URL, '_blank', 'noopener');
    else void Linking.openURL(FINAL_QUIZ_URL);
  };

  return (
    <View>
      {/* 1 ─ Sign-up process */}
      <Section id="s1" n={1} title="The sign-up process" sub="Start, set the expectation, build the week, lock it in">
        <Panel label="The four steps" hi>
          <Steps items={['Start: postcode and delivery days', 'Set the expectation', 'Build the week', 'Lock it in']} />
        </Panel>
        <Two>
          <Panel label="1 · Start">
            <Points items={['Ask for their postcode', 'Show them their delivery days', 'Don’t make it a thing. Just do it.']} />
          </Panel>
          <Panel label="2 · Set the expectation">
            <P><B>“Let’s build a week of everything you already use.”</B></P>
            <P muted small>This sets the frame for the whole order.</P>
          </Panel>
        </Two>
        <Panel label="3 · Build the week">
          <Steps items={['What do you use?', 'How much?', 'When do you next need it?']} />
          <P muted small>Add it to the basket, then repeat for every product.</P>
          <Points items={[
            ['Sticky products:', 'milk, eggs, bread, juice, milkshakes, butter, yoghurt, cheese. These stay in the order, because customers reorder them every week.'],
            ['Why it matters:', 'a week built on sticky products is spread across the week, so we aim for 2.5 drop days on average and fails under 10%.'],
          ]} />
        </Panel>
        <Two>
          <Panel label="4 · Lock it in">
            <Points items={[['Read back the week:', 'every item, every day'], ['Price and agreement:', '“Everything for the week is…” Say it calmly, then pause.']]} />
          </Panel>
          <Panel label="Technique">
            <Points items={['They speak first', 'One item at a time', 'You drive the pace. You lead because it’s better for them.']} />
          </Panel>
        </Two>
        <Panel label="Coaching =" hi>
          <Text style={[s.bold, { fontFamily: fonts.display, fontSize: 18 }]}>Calm · Frame · Control</Text>
        </Panel>
        <Fill parts={['Step 1: ask for their ', { id: 'o0', a: 'postcode', w: 9 }, ' and show them their delivery days. Step 2: “Let’s build a week of everything you already ', { id: 'o4', a: 'use', w: 5 }, '.”']} />
        <Fill parts={['To build the week, ask: what do you ', { id: 'o1', a: 'use', w: 6 }, ', how ', { id: 'o2', a: 'much', w: 6 }, ', and when do you next ', { id: 'o3', a: 'need it', w: 8 }, '? Then repeat for every product.']} />
        <Fill parts={['Our sticky products: milk, ', { id: 'st2', a: 'eggs', w: 6 }, ', ', { id: 'st3', a: 'bread', w: 6 }, ', juice, ', { id: 'st4', a: 'milkshakes', w: 10 }, ', butter, yoghurt and ', { id: 'st5', a: 'cheese', w: 7 }, '. They stay in the order because customers ', { id: 'st1', a: 'reorder them every week', w: 18 }, '. We aim for ', { id: 'st6', a: '2.5', w: 4 }, ' drop days on average and fails under ', { id: 'st7', a: '10%', w: 4 }, '.']} />
        <Fill parts={['To lock it in, read back every ', { id: 'lk1', a: 'item', w: 5 }, ' and every ', { id: 'lk2', a: 'day', w: 4 }, ', say the price calmly, then ', { id: 'lk3', a: 'pause', w: 6 }, '.']} />
        <Fill parts={['When you’re building the order, they speak ', { id: 't1', a: 'first', w: 6 }, ', you go one ', { id: 't2', a: 'item', w: 5 }, ' at a time, and you drive the ', { id: 't3', a: 'pace', w: 5 }, '.']} />
        <View style={{ gap: 8 }}>
          <H3>Need to know</H3>
          <Points items={[
            ['The discount:', '20% off for the first 2 weeks'],
            ['Payment:', 'the customer pays on the day, there and then, when they sign up'],
            ['Changes', 'can be made until 8pm the night before a delivery'],
            ['It’s an ongoing order:', 'they can manage, pause or cancel it in the app. If they ask, explain it honestly.'],
          ]} />
        </View>
        <Fill parts={['The discount is ', { id: 'd1', a: '20%', w: 5 }, ' off for ', { id: 'd2', a: '2 weeks', w: 7 }, '. The customer pays ', { id: 'd3', a: 'there and then', w: 12 }, ', on the day they sign up. They can change their order until ', { id: 'd4', a: '8pm', w: 4 }, ' the night before.']} />
        <Notes id="n1" />
      </Section>
      <QuizBlock quiz={q1} />

      {/* 2 ─ Introduction */}
      <Section id="s2" n={2} title="Introduction" sub="Seven seconds to make a good first impression">
        <Minis items={[['Smile', 'Relaxes people, it’s positive, and they mirror it'], ['Eye contact', 'Engages them and shows confidence: it builds trust'], ['Enthusiasm', 'Shows passion for the product: sales is a transfer of enthusiasm']]} />
        <Points items={[['7 seconds', 'to make a good first impression'], ['S.E.E.:', 'smile, eye contact, enthusiasm'], ['Icebreaker:', 'get them talking and relaxed'], ['Make the customer feel good', '']]} />
        <Fill parts={['S.E.E. stands for ', { id: 'i1', a: 'smile', w: 6 }, ', ', { id: 'i2', a: 'eye contact', w: 10 }, ' and ', { id: 'i3', a: 'enthusiasm', w: 10 }, '. You have ', { id: 'i4', a: '7 seconds', w: 8 }, ' to make a first impression.']} />
        <Notes id="n2" />
      </Section>

      {/* 3 ─ Body language */}
      <Section id="s3" n={3} title="Body language & tone" sub="How you say it counts for more than what you say">
        <Minis items={[['70%', 'Body language: movements, face, arms'], ['23%', 'Tone of voice'], ['7%', 'The words']]} />
        <Say>“I didn’t say Simon stole my bag.” Say it seven times, stressing a different word each time. The meaning changes every time.</Say>
        <Fill parts={['Communication is ', { id: 'b1', a: '70%', w: 4 }, ' body language, ', { id: 'b2', a: '23%', w: 4 }, ' tone of voice and ', { id: 'b3', a: '7%', w: 3 }, ' words.']} />
        <Notes id="n3" />
      </Section>
      <QuizBlock quiz={q2} />

      {/* 4 ─ Practise */}
      <Section id="s4" n={4} title="Let’s practise" sub="The pitch, out loud, in pairs" answers={false}>
        <P>Practise the pitch from <B>Learn your pitch</B> in pairs: one of you opens the door, the other pitches. Swap after each go.</P>
        <Fill parts={['One thing I did well: ', { id: 'pr1', w: 20 }, '. One thing to work on: ', { id: 'pr2', w: 20 }, '.']} />
        <Notes id="n4" />
      </Section>

      {/* 5 ─ Code of practice */}
      <Section id="s5" n={5} title="Code of practice" sub="How we behave on every doorstep">
        <Points items={[
          ['Say who you are', 'and that you’re there on behalf of The Modern Milkman'],
          ['“No Cold Calling” sign?', 'Respect it and don’t knock'],
          ['Data protection:', 'details only go into the approved sign-up. Never photograph or note a customer’s details on your own phone'],
          ['Be honest:', 'never exaggerate savings or hide costs. Leaving something out is misleading too'],
          ['No pushy or aggressive selling', ''],
          ['If someone seems vulnerable,', 'put their wellbeing first'],
          ['Friends and family', 'only if they genuinely want it and are the account holder'],
          ['Visible ID and smart dress;', 'no swearing, smoking or vaping while you represent the brand'],
        ]} />
        <Fill parts={['If a house has a No Cold Calling sign, I ', { id: 'c1', a: 'don’t knock', w: 11 }, '. A customer’s details never go on my ', { id: 'c2', a: 'personal phone', w: 13 }, '.']} />
        <Notes id="n5" />
      </Section>
      <QuizBlock quiz={q3} />
      <Break />

      {/* 6 ─ G.I.F.T.S. */}
      <Section id="s6" n={6} title="Presentation: G.I.F.T.S." sub="The impulse factors that create interest">
        <Minis items={[['Greed', 'Everyone likes a deal: the discount'], ['Indifference', 'Relaxed, no pressure: it’s their choice'], ['Fear of loss', 'The offer won’t be here for ever'], ['The Jones Theory', 'Their neighbours already have it'], ['Sense of urgency', 'Today, while we’re here']]} />
        <Fill parts={['G.I.F.T.S. is ', { id: 'g1', a: 'Greed', w: 6 }, ', ', { id: 'g2', a: 'Indifference', w: 11 }, ', ', { id: 'g3', a: 'Fear of loss', w: 11 }, ', ', { id: 'g4', a: 'The Jones Theory', w: 14 }, ' and ', { id: 'g5', a: 'Sense of urgency', w: 14 }, '.']} />
        <Notes id="n6" />
      </Section>

      {/* 7 ─ Who we can't sign up */}
      <Section id="s7" n={7} title="Who we can’t sign up" sub="And what an A-customer looks like">
        <Two>
          <Panel label="We can’t sign up">
            <Points items={['Anyone under 18', 'Someone who doesn’t speak English well enough to understand', 'Someone with no internet, or who isn’t comfortable with the app', 'Anyone who may be vulnerable', 'An order under £5']} />
          </Panel>
          <Panel label="An A-customer" hi>
            <Points items={['Does the shopping: the decision maker', 'Has time to talk, order and rehash', 'Positive about the idea of a milkman', 'Uses the products: 4–10 pints of milk, juice and eggs every week', 'Happy using an app']} />
          </Panel>
        </Two>
        <Panel label="Red flags">
          <Points items={[
            'Only signing up for the discount, or “because you seem nice”',
            'Says they’ll cancel after the first delivery, or keeps asking how to stop it',
            'Going away soon: don’t sign them up now. Tell them to sign up on the website when they’re back, because a first delivery more than 8 days away is a fail',
            'Signing up for someone else, or a visiting family member',
            'Only wants a one-off order',
          ]} />
        </Panel>
        <Fill parts={['An A-customer is the person who does the ', { id: 'a1', a: 'shopping', w: 9 }, '. If someone is only signing up for the discount, I ', { id: 'a2', a: 'build value and check they really want it', w: 26 }, '.']} />
        <Notes id="n7" />
      </Section>
      <QuizBlock quiz={q4} />

      {/* 8 ─ Short story */}
      <Section id="s8" n={8} title="Short story: the mission and reducing plastic" sub="Why it’s an easy sell, and the message that lands on most doorsteps">
        <H3>The mission</H3>
        <Points items={[
          ['A milkround on a mission', 'to reduce plastic waste: glass bottles, and packaging that’s reusable, recyclable or home-compostable'],
          ['Inspired by Blue Planet:', 'set up in 2018 to cut the plastic in our homes, landfill and oceans'],
          ['Reassuringly familiar:', 'people know how a milkround works and enjoy waking up to it on the doorstep'],
          ['Modern convenience:', 'order in the app, on the doorstep before 7:30am, no delivery slots'],
        ]} />
        <H3>Reducing plastic</H3>
        <Points items={['Less than a third of all plastic in the UK is recycled', 'Glass bottles are collected, washed and reused', 'The biggest reason customers sign up is to cut plastic and help the planet']} />
        <Say>Passion is transferred: if you care about it, they will.</Say>
        <Fill parts={['The biggest reason customers sign up is to reduce ', { id: 'm1', a: 'plastic', w: 8 }, '.']} />
        <Notes id="n8" />
      </Section>

      {/* 9 ─ Farmers */}
      <Section id="s9" n={9} title="Supporting independent farmers" sub="Why farms supply The Modern Milkman">
        <View style={{ gap: 8 }}>
          <Label>Supermarket: up to a week to your fridge</Label>
          <Chain steps={['Farm', 'Tanker', 'Processor', 'Distributor', 'Shop', 'Home']} />
          <Label color={c.primary}>The Modern Milkman: same day, before 7:30am</Label>
          <Chain fast steps={['Farm: processed & bottled', 'Glass bottles', 'Milk float', 'Doorstep']} />
        </View>
        <Fill parts={['Independent farmers are paid up to ', { id: 'f1', a: '4 times', w: 7 }, ' more by The Modern Milkman than by a supermarket.']} />
        <Notes id="n9" />
      </Section>

      {/* 10 ─ Convenience */}
      <Section id="s10" n={10} title="Convenience, then let’s practise" sub="Easier than any supermarket">
        <Points items={['Order in the app or online, any time', 'Change it until 8pm the night before', 'On the doorstep by 7:30am: no slots, no waiting in', 'Milk, eggs, bread, juice and more in one order']} />
        <Fill parts={['Order by ', { id: 'v1', a: '8pm', w: 4 }, ' and it’s on the doorstep by ', { id: 'v2', a: '7:30am', w: 6 }, '.']} />
        <Notes id="n10" />
      </Section>
      <QuizBlock quiz={q5} />
      <Break />

      {/* 11 ─ Products */}
      <Section id="s11" n={11} title="Product knowledge" sub="Know what you’re selling">
        <Minis items={[['1 pint', '0.56 litres'], ['2 pints', '1.13 litres'], ['4 pints', '2.27 litres'], ['6 pints', '3.4 litres']]} />
        <Panel label="Glass bottle tops">
          <Points items={[['Silver:', 'whole milk'], ['Red:', 'semi-skimmed'], ['Blue:', 'skimmed']]} />
        </Panel>
        <Fill parts={['A silver top is ', { id: 'p1', a: 'whole', w: 6 }, ' milk, red is ', { id: 'p2', a: 'semi-skimmed', w: 11 }, ' and blue is ', { id: 'p3', a: 'skimmed', w: 8 }, '. 4 pints is about ', { id: 'p4', a: '2.27', w: 5 }, ' litres.']} />
        <Notes id="n11" />
      </Section>

      {/* 12 ─ Quality */}
      <Section id="s12" n={12} title="Sales quality" sub="What good looks like, and keeping every sign-up">
        <Panel label="The five quality numbers" hi>
          <Points items={[['£13+', 'average order value'], ['2.5+', 'drop days a week'], ['Fails under 10%', ''], ['75%+', 'taking The Round'], ['75%+', 'still ordering in their 4th week']]} />
        </Panel>
        <Panel label="A fail pays nothing">
          <Points items={['Cancelled before the first delivery', 'First delivery more than 8 days away', 'An order under £5', 'No repeat weekly items']} />
        </Panel>
        <Panel label="The Round">
          <P small>Present it as an optional benefit that adds value for the customer, never as a must.</P>
        </Panel>
        <Fill parts={['We aim for an average order value of £', { id: 'q1x', a: '13', w: 4 }, '+. The first delivery must be within ', { id: 'q2x', a: '8 days', w: 6 }, '. An order under £', { id: 'q3x', a: '5', w: 3 }, ' is a fail.']} />
        <Notes id="n12" />
      </Section>
      <QuizBlock quiz={q6} />

      {/* 13 ─ Rehash */}
      <Section id="s13" n={13} title="Rehash" sub="Remove every reason to cancel before it happens">
        <H3>Build control (1–4)</H3>
        <Two>
          <RehashStep n={1} title="Show their week (removes stress)" items={['Open their upcoming deliveries', 'Read out each day']} why="They can see what they’ve got: it’s set up, paid, sorted." />
          <RehashStep n={2} title="Change amounts (flexibility)" items={['Plus / minus items', 'Skip = miss a day', 'Remove = stop the repeat']} why="They don’t cancel, they adjust." />
        </Two>
        <Two>
          <RehashStep n={3} title="Pause, don’t cancel" items={['Show the calendar', 'Pause between dates']} why="Going away = pause, not cancel." />
          <RehashStep n={4} title="One-offs (add value)" items={['Add anything as a one-time order', 'Saves extra shop trips']} why="More convenient and more personal." />
        </Two>
        <H3>Lock it in (5–8)</H3>
        <Two>
          <RehashStep n={5} title="Payments (remove confusion)" items={['Show the receipts', 'Show the next payment']} why="No surprises = no cancellations." />
          <RehashStep n={6} title="Doorstep photo (no missed deliveries)" items={['Add a doorstep picture, so the milkman knows exactly where to go', 'If it’s slightly off the first 1–2 times, just bear with us']} />
        </Two>
        <Two>
          <RehashStep n={7} title="Set the expectation (4 weeks)" items={['Week 1 → Quality: try the taste', 'Week 2 → Quantity: adjust how much they use', 'Week 3 → Addition: add extras', 'Week 4 → Routine: fully set up']} why="“You’ll spend 4 weeks figuring it out.” Relate it to what they’ve ordered." />
          <RehashStep n={8} title="Thank and inspire" items={['Thank you so much', 'Farmers paid up to 4 times more', '150 million plastic bottles saved', 'Thank you from the turtles']} />
        </Two>
        <Panel label="Rehash =" hi>
          <Points items={['Removed every reason to cancel', 'Made them feel confident to adjust']} />
        </Panel>
        <Fill parts={['If they want less, they don’t cancel, they ', { id: 'r2', a: 'adjust', w: 7 }, '. If they’re going away, they ', { id: 'r3', a: 'pause', w: 6 }, ', not cancel.']} />
        <Fill parts={['Show them their receipts and next payment, because no surprises = no ', { id: 'r4', a: 'cancellations', w: 13 }, '.']} />
        <Fill parts={['The first 4 weeks: week 1 ', { id: 'r5', a: 'quality', w: 8 }, ', week 2 ', { id: 'r6', a: 'quantity', w: 9 }, ', week 3 ', { id: 'r7', a: 'addition', w: 9 }, ', week 4 ', { id: 'r8', a: 'routine', w: 8 }, '.']} />
        <Fill parts={['We add a doorstep photo so the milkman knows exactly ', { id: 'r9', a: 'where to go', w: 11 }, '.']} />
        <Notes id="n13" />
      </Section>
      <QuizBlock quiz={q7} />

      {/* 14 ─ Law of Averages */}
      <Section id="s14" n={14} title="Law of Averages" sub="It’s a numbers game: more opportunities, more sign-ups">
        <Minis items={[['120', 'doors'], ['70', 'spoken to'], ['25', 'pitched'], ['15', 'closed'], ['4+', 'sign-ups']]} />
        <Fill parts={['A day is ', { id: 'la1', a: '120', w: 4 }, ' doors, ', { id: 'la2', a: '70', w: 3 }, ' spoken to, ', { id: 'la3', a: '25', w: 3 }, ' pitched, ', { id: 'la4', a: '15', w: 3 }, ' closed and ', { id: 'la5', a: '4+', w: 3 }, ' sign-ups.']} />
        <Notes id="n14" />
        <Notes id="questions" label="My questions for my Coach" placeholder="Write them down and we’ll answer them in the room" />
      </Section>

      {/* Final quiz */}
      <View style={[x.final, { backgroundColor: c.ink }]}>
        <Text style={[s.label, { color: c.inkMuted }]}>Last thing today</Text>
        <Text style={[x.finalTitle, { color: c.inkText }]}>Your final quiz</Text>
        <Text style={[s.body, { color: c.inkMuted, textAlign: 'center' }]}>Quality, compliance and conduct. Use the same email address you signed up to the app with.</Text>
        <Pressable onPress={openQuiz} style={[x.finalBtn, { backgroundColor: c.primary }]} accessibilityRole="link" testID="academy-final-quiz">
          <Text style={[x.finalBtnText, { color: c.onPrimary }]}>Open the final quiz</Text>
          <Ionicons name="open-outline" size={18} color={c.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/** Numbered steps, one per row. */
function Steps({ items }: { items: string[] }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {items.map((t, i) => (
        <View key={i} style={[x.step, { borderColor: c.border, backgroundColor: c.background }]}>
          <View style={[x.stepN, { borderColor: c.primaryLight }]}><Text style={[x.stepNText, { color: c.primary }]}>{i + 1}</Text></View>
          <Text style={[x.stepText, { color: c.text }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** Small tiles: a big word or number over a line of explanation. */
function Minis({ items }: { items: [string, string][] }) {
  const c = useColors();
  const s = useWbStyles();
  return (
    <View style={x.minis}>
      {items.map(([big, sub]) => (
        <View key={big} style={[x.mini, { borderColor: c.border }]}>
          <Text style={[x.miniBig, { color: c.text }]}>{big}</Text>
          <Text style={[s.small, s.muted]}>{sub}</Text>
        </View>
      ))}
    </View>
  );
}

function Chain({ steps, fast }: { steps: string[]; fast?: boolean }) {
  const c = useColors();
  return (
    <View style={x.chain}>
      {steps.map((t, i) => (
        <React.Fragment key={t}>
          {i > 0 && <Ionicons name="arrow-forward" size={14} color={c.textMuted} />}
          <Text style={[x.link, fast ? { borderColor: c.primaryLight, color: c.primary, backgroundColor: c.primary + '12' } : { borderColor: c.border, color: c.text }]}>{t}</Text>
        </React.Fragment>
      ))}
    </View>
  );
}

function RehashStep({ n, title, items, why }: { n: number; title: string; items: string[]; why?: string }) {
  return (
    <Panel label={`${n} · ${title}`}>
      <Points items={items} />
      {!!why && <P muted small>{why}</P>}
    </Panel>
  );
}

const x = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  stepN: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepNText: { fontFamily: fonts.monoSemibold, fontSize: 12 },
  stepText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15 },
  minis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mini: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderRadius: 12, padding: 12, gap: 3 },
  miniBig: { fontFamily: fonts.display, fontSize: 20 },
  chain: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  link: { fontFamily: fonts.bodyMedium, fontSize: 13, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  final: { borderRadius: 16, padding: 22, gap: 10, alignItems: 'center', marginBottom: 16 },
  finalTitle: { fontFamily: fonts.display, fontSize: 26 },
  finalBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 13, marginTop: 6 },
  finalBtnText: { fontFamily: fonts.bodySemibold, fontSize: 16 },
});
