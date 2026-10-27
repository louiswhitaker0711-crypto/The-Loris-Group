/**
 * BA Academy Day 2 — the workbook page, in the Owner's running order
 * (26–27 Oct 2026): sticky products, the sign-up process, The Round, then
 * the door pitch theory (introduction, body language, practise, code of
 * practice, G.I.F.T.S., who we can't sign up, the short story, convenience
 * and the close), each followed by that part of the pitch, then products,
 * quality, the rehash, Field IQ, the Law of Averages and the final quiz.
 * Each section ends with a short Check yourself, filled from memory with
 * the notes covered.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useColors, fonts } from '../theme/ThemeContext';
import { api } from '../api/client';
import { DAY2_QUIZZES, FINAL_QUIZ_URL, FIELD_IQ_URL } from './day2';
import { ALL_PITCH, withWords } from './pitch';
import { Section, Fill, Notes, Points, Panel, Two, Say, Break, QuizBlock, Teach, Check, P, B, H3, Label, useWbStyles } from './Workbook';

const openLink = (url: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  else void Linking.openURL(url);
};

export default function Day2Page() {
  const c = useColors();
  const s = useWbStyles();
  const [qa, qb, qc, qd] = DAY2_QUIZZES;

  return (
    <View>
      {/* 1 ─ Sticky products */}
      <Section id="sk" n={1} title="Sticky products" sub="What every week is built on">
        <Teach>
          <Panel label="Sticky products" hi>
            <Text style={[s.bold, { fontFamily: fonts.display, fontSize: 17 }]}>Milk · Eggs · Bread · Juice · Milkshakes · Butter · Yoghurt · Cheese</Text>
            <P muted small>The products customers reorder every week. They stay in the order, so the customer stays.</P>
          </Panel>
          <Points items={[
            ['Build the week on them:', 'start every order with the sticky products they already use'],
            ['Spread across the week:', 'we aim for 2.5 drop days on average'],
            ['Fewer fails:', 'an order they really use doesn’t get cancelled. We aim for fails under 10%'],
          ]} />
        </Teach>
        <Check>
          <Fill parts={['We aim for ', { id: 'st6', a: '2.5', w: 4 }, ' drop days on average and fails under ', { id: 'st7', a: '10%', w: 4 }, '.']} />
        </Check>
        <Notes id="nsk" />
      </Section>

      {/* 2 ─ Sign-up process */}
      <Section id="s1" n={2} title="The sign-up process" sub="Start, set the expectation, build the week, lock it in">
        <Teach>
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
            <P muted small>Add it to the basket, then repeat for every product, sticky products first.</P>
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
          <View style={{ gap: 8 }}>
            <H3>Need to know</H3>
            <Points items={[
              ['The discount:', '20% off for the first 2 weeks'],
              ['Payment:', 'the customer pays on the day, there and then, when they sign up'],
              ['Changes', 'can be made until 8pm the night before a delivery'],
              ['It’s an ongoing order:', 'they can manage, pause or cancel it in the app. If they ask, explain it honestly.'],
            ]} />
          </View>
        </Teach>
        <Check>
          <Fill parts={['To build the week, ask: what do you ', { id: 'o1', a: 'use', w: 6 }, ', how ', { id: 'o2', a: 'much', w: 6 }, ', and when do you next ', { id: 'o3', a: 'need it', w: 8 }, '?']} />
          <Fill parts={['The customer pays ', { id: 'd3', a: 'there and then', w: 12 }, ', on the day they sign up.']} />
        </Check>
        <PitchPart n={5} label="Your sign-up pitch" />
        <Notes id="n1" />
      </Section>

      {/* 3 ─ The Round */}
      <Section id="rd" n={3} title="The Round (membership)" sub="An optional benefit, explained clearly">
        <Teach>
          <Points items={[
            ['What it is:', 'The Modern Milkman’s membership club, paid monthly or yearly'],
            ['The big one:', 'the delivery fee is covered on every order. The price you see is the price you pay'],
            ['Member perks:', 'a welcome gift, Member’s Week offers, a monthly prize draw and a birthday gift'],
            ['The rules:', '18 or over; they can join during their first order with you; cancel any time in the app; 14-day cooling-off'],
          ]} />
          <Panel label="How we present it" hi>
            <Points items={['As an optional benefit that improves value, never as a must', 'Explain it clearly and let them choose. Never add it for them', 'Only where it suits them and they agree']} />
          </Panel>
          <P muted small>We aim for 75% or more of sign-ups taking The Round. Prices can change: check the app before you quote one.</P>
        </Teach>
        <Check>
          <Fill parts={['The Round covers the ', { id: 'rd1', a: 'delivery fee', w: 11 }, ' on every order, and I present it as an ', { id: 'q5x', a: 'optional benefit', w: 14 }, '.']} />
        </Check>
        <Notes id="nrd" />
      </Section>
      <QuizBlock quiz={qa} />

      {/* 4 ─ Introduction */}
      <Section id="s2" n={4} title="Introduction" sub="Seven seconds to make a good first impression">
        <Teach>
          <Minis items={[['Smile', 'Relaxes people, it’s positive, and they mirror it'], ['Eye contact', 'Engages them and shows confidence: it builds trust'], ['Enthusiasm', 'Shows passion for the product: sales is a transfer of enthusiasm']]} />
          <Points items={[['7 seconds', 'to make a good first impression'], ['S.E.E.:', 'smile, eye contact, enthusiasm'], ['Icebreaker:', 'get them talking and relaxed'], ['Make the customer feel good', '']]} />
        </Teach>
        <Check>
          <Fill parts={['S.E.E. stands for ', { id: 'i1', a: 'smile', w: 6 }, ', ', { id: 'i2', a: 'eye contact', w: 10 }, ' and ', { id: 'i3', a: 'enthusiasm', w: 10 }, '.']} />
        </Check>
        <PitchPart n={1} label="Your pitch · 1 Introduction" />
        <Notes id="n2" />
      </Section>

      {/* 5 ─ Body language */}
      <Section id="s3" n={5} title="Body language & tone" sub="How you say it counts for more than what you say">
        <Teach>
          <Minis items={[['70%', 'Body language: movements, face, arms'], ['23%', 'Tone of voice'], ['7%', 'The words']]} />
          <Say>“I didn’t say Simon stole my bag.” Say it seven times, stressing a different word each time. The meaning changes every time.</Say>
        </Teach>
        <Check>
          <Fill parts={['Body language is ', { id: 'b1', a: '70%', w: 4 }, ' of how you come across.']} />
        </Check>
        <Notes id="n3" />
      </Section>

      {/* 6 ─ Practise */}
      <Section id="s4" n={6} title="Let’s practise" sub="The introduction, out loud, in pairs" answers={false}>
        <P>Practise the introduction in pairs: one of you opens the door, the other says it. Smile, eye contact, enthusiasm. Swap after each go.</P>
        <Fill parts={['One thing I did well: ', { id: 'pr1', w: 20 }, '. One thing to work on: ', { id: 'pr2', w: 20 }, '.']} />
        <Notes id="n4" />
      </Section>

      {/* 7 ─ Code of practice */}
      <Section id="s5" n={7} title="Code of practice" sub="How we behave on every doorstep">
        <Teach>
          <Points items={[
            ['Say who you are', 'and that you’re there on behalf of The Modern Milkman'],
            ['“No Cold Calling” sign?', 'Respect it and don’t knock'],
            ['Told you’re in a no-cold-calling zone?', 'Apologise, leave the immediate area, and tell your Coach and the Owner'],
            ['Data protection:', 'details only go into the approved sign-up. Never photograph or note a customer’s details on your own phone'],
            ['Be honest:', 'never exaggerate savings or make claims that aren’t true'],
            ['No omissions:', 'leaving something out, like hiding a cost, is an omission and counts as misleading. Always explain the delivery fee clearly; The Round (membership) covers it on every order'],
            ['No pushy or aggressive selling', ''],
            ['If someone seems vulnerable,', 'put their wellbeing first'],
            ['Friends and family', 'only if they genuinely want it and are the account holder'],
            ['Visible ID and smart dress;', 'no swearing, smoking or vaping while you represent the brand. Lost your badge? Stop: you can’t speak to anyone without it'],
          ]} />
        </Teach>
        <Check>
          <Fill parts={['A customer’s details never go on my ', { id: 'c2', a: 'personal phone', w: 13 }, '.']} />
          <Fill parts={['Hiding a cost from the customer, like the delivery fee, is called an ', { id: 'c3', a: 'omission', w: 9 }, '.']} />
        </Check>
        <Notes id="n5" />
      </Section>
      <QuizBlock quiz={qb} />
      <Break />

      {/* 8 ─ G.I.F.T.S. */}
      <Section id="s6" n={8} title="Presentation: G.I.F.T.S." sub="The impulse factors that create interest">
        <Teach>
          <Minis items={[['Greed', 'Everyone likes a deal: the discount'], ['Indifference', 'Relaxed, no pressure: it’s their choice'], ['Fear of loss', 'The offer won’t be here for ever'], ['The Jones Theory', 'Their neighbours already have it'], ['Sense of urgency', 'Today, while we’re here']]} />
        </Teach>
        <Check>
          <Fill parts={['G.I.F.T.S. is ', { id: 'g1', a: 'Greed', w: 6 }, ', ', { id: 'g2', a: 'Indifference', w: 11 }, ', ', { id: 'g3', a: 'Fear of loss', w: 11 }, ', ', { id: 'g4', a: 'The Jones Theory', w: 14 }, ' and ', { id: 'g5', a: 'Sense of urgency', w: 14 }, '.']} />
        </Check>
        <PitchPart n={2} label="Your pitch · 2 Presentation" />
        <Notes id="n6" />
      </Section>

      {/* 9 ─ Who we can't sign up */}
      <Section id="s7" n={9} title="Who we can’t sign up" sub="And what an A-customer looks like">
        <Teach>
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
        </Teach>
        <Check>
          <Fill parts={['An A-customer is the person who does the ', { id: 'a1', a: 'shopping', w: 9 }, '. If someone is only signing up for the discount, I ', { id: 'a2', a: 'build value and check they really want it', w: 26 }, '.']} />
        </Check>
        <Notes id="n7" />
      </Section>

      {/* 10 ─ Short story */}
      <Section id="s8" n={10} title="Short story: the mission and reducing plastic" sub="Why it’s an easy sell, and the message that lands on most doorsteps">
        <Teach>
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
        </Teach>
        <Check>
          <Fill parts={['The biggest reason customers sign up is to reduce ', { id: 'm1', a: 'plastic', w: 8 }, '.']} />
        </Check>
        <Notes id="n8" />
      </Section>

      {/* 11 ─ Farmers */}
      <Section id="s9" n={11} title="Supporting independent farmers" sub="Why farms supply The Modern Milkman">
        <Teach>
          <View style={{ gap: 8 }}>
            <Label>Supermarket: up to a week to your fridge</Label>
            <Chain steps={['Farm', 'Tanker', 'Processor', 'Distributor', 'Shop', 'Home']} />
            <Label color={c.primary}>The Modern Milkman: same day, before 7:30am</Label>
            <Chain fast steps={['Farm: processed & bottled', 'Glass bottles', 'Milk float', 'Doorstep']} />
          </View>
        </Teach>
        <Check>
          <Fill parts={['Independent farmers are paid up to ', { id: 'f1', a: '4 times', w: 7 }, ' more by The Modern Milkman than by a supermarket.']} />
        </Check>
        <PitchPart n={3} label="Your pitch · 3 Short story" />
        <Notes id="n9" />
      </Section>

      {/* 12 ─ Convenience and the close */}
      <Section id="s10" n={12} title="Convenience, the close, then let’s practise" sub="Easier than any supermarket, and the reason to start today">
        <Teach>
          <Points items={['Order in the app or online, any time', 'Change it until 8pm the night before', 'On the doorstep by 7:30am: no slots, no waiting in', 'Milk, eggs, bread, juice and more in one order']} />
          <P>Then practise the <B>whole pitch</B> in pairs, introduction to close, and swap.</P>
        </Teach>
        <Check>
          <Fill parts={['Order by ', { id: 'v1', a: '8pm', w: 4 }, ' the night before; on the doorstep by 7:30am.']} />
        </Check>
        <PitchPart n={4} label="Your pitch · 4 Close" />
        <Notes id="n10" />
      </Section>
      <QuizBlock quiz={qc} />
      <Break />

      {/* 13 ─ Products */}
      <Section id="s11" n={13} title="Product knowledge" sub="Know what you’re selling">
        <Teach>
          <Minis items={[['1 pint', '0.56 litres'], ['2 pints', '1.13 litres'], ['4 pints', '2.27 litres'], ['6 pints', '3.4 litres']]} />
          <Panel label="Glass bottle tops">
            <Points items={[['Silver:', 'whole milk'], ['Red:', 'semi-skimmed'], ['Blue:', 'skimmed']]} />
          </Panel>
        </Teach>
        <Check>
          <Fill parts={['A red top is ', { id: 'p2', a: 'semi-skimmed', w: 11 }, ' milk.']} />
        </Check>
        <Notes id="n11" />
      </Section>

      {/* 14 ─ Quality */}
      <Section id="s12" n={14} title="Sales quality" sub="What good looks like, and keeping every sign-up">
        <Teach>
          <Panel label="The five quality numbers" hi>
            <Points items={[['£13+', 'average order value (the quality standard is £12+; we aim higher)'], ['2.5+', 'drop days a week'], ['Fails under 10%', ''], ['75%+', 'taking The Round'], ['75%+', 'still ordering in their 4th week']]} />
          </Panel>
          <Panel label="A fail pays nothing">
            <Points items={['Cancelled before the first delivery', 'First delivery more than 8 days away', 'A repeat order under £5 (the delivery fee doesn’t count)', 'No repeat weekly items']} />
            <P small><B>Want their first delivery more than 8 days away?</B> Don’t sign them up now: tell them to sign up online when they’re ready. Never change the start date without asking them.</P>
          </Panel>
        </Teach>
        <Check>
          <Fill parts={['The first delivery must be within ', { id: 'q2x', a: '8 days', w: 6 }, '. A repeat order under £', { id: 'q3x', a: '5', w: 3 }, ' is a fail.']} />
        </Check>
        <Notes id="n12" />
      </Section>

      {/* 15 ─ Rehash */}
      <Section id="s13" n={15} title="Rehash" sub="Remove every reason to cancel before it happens">
        <Teach>
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
        </Teach>
        <Check>
          <Fill parts={['The first 4 weeks: ', { id: 'r5', a: 'quality', w: 8 }, ', ', { id: 'r6', a: 'quantity', w: 9 }, ', ', { id: 'r7', a: 'addition', w: 9 }, ', ', { id: 'r8', a: 'routine', w: 8 }, '.']} />
        </Check>
        <PitchPart n={6} label="Your rehash pitch" />
        <Notes id="n13" />
      </Section>

      {/* 16 ─ Field IQ */}
      <Section id="fq" n={16} title="Field IQ" sub="The app you track your day in">
        <Teach>
          <Points items={[
            ['What it is:', 'the app you use to track your daily sign-ups, sales data and performance on the doors'],
            ['Download it now,', 'on iPhone or Android, so it’s ready'],
            ['Set up:', 'your team leader logs you in and sets up your profile on your first day on badge'],
          ]} />
          <Pressable onPress={() => openLink(FIELD_IQ_URL)} style={[x.dl, { borderColor: c.primary }]} accessibilityRole="link" testID="academy-field-iq">
            <Ionicons name="download-outline" size={18} color={c.primary} />
            <Text style={[x.dlText, { color: c.primary }]}>Download Field IQ</Text>
          </Pressable>
        </Teach>
        <Check>
          <Fill parts={['I’ll be set up on Field IQ on my ', { id: 'fq1', a: 'first day on badge', w: 16 }, '.']} />
        </Check>
        <Notes id="nfq" />
      </Section>

      {/* 17 ─ Law of Averages */}
      <Section id="s14" n={17} title="Law of Averages" sub="It’s a numbers game: more opportunities, more sign-ups">
        <Teach>
          <Minis items={[['120', 'doors'], ['70', 'spoken to'], ['25', 'pitched'], ['15', 'closed'], ['4+', 'sign-ups']]} />
        </Teach>
        <Check>
          <Fill parts={['A day is ', { id: 'la1', a: '120', w: 4 }, ' doors, 70 spoken to, ', { id: 'la3', a: '25', w: 3 }, ' pitched, 15 closed and ', { id: 'la5', a: '4+', w: 3 }, ' sign-ups.']} />
        </Check>
        <Notes id="n14" />
        <Notes id="questions" label="My questions for my Coach" placeholder="Write them down and we’ll answer them in the room" />
      </Section>
      <QuizBlock quiz={qd} />

      {/* Final quiz */}
      <View style={[x.final, { backgroundColor: c.ink }]}>
        <Text style={[s.label, { color: c.inkMuted }]}>Last thing today</Text>
        <Text style={[x.finalTitle, { color: c.inkText }]}>Your final quiz</Text>
        <Text style={[s.body, { color: c.inkMuted, textAlign: 'center' }]}>Quality, compliance and conduct. Use the same email address you signed up to the app with.</Text>
        <Pressable onPress={() => openLink(FINAL_QUIZ_URL)} style={[x.finalBtn, { backgroundColor: c.primary }]} accessibilityRole="link" testID="academy-final-quiz">
          <Text style={[x.finalBtnText, { color: c.onPrimary }]}>Open the final quiz</Text>
          <Ionicons name="open-outline" size={18} color={c.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/** One part of the pitch, word for word in the Owner's current wording,
 * after the theory it puts into practice. Opens Learn your pitch. */
function PitchPart({ n, label }: { n: number; label: string }) {
  const c = useColors();
  const s = useWbStyles();
  const { data } = useQuery({ queryKey: ['pitch'], queryFn: async () => (await api.get('/pitch')).data, retry: false, staleTime: 5 * 60 * 1000 });
  const step = withWords(ALL_PITCH, data?.words).find((b) => b.n === n);
  if (!step) return null;
  return (
    <View style={[x.pitch, { borderColor: c.yellow, backgroundColor: c.yellowBg }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="mic-outline" size={16} color={c.text} />
        <Text style={[s.label, { color: c.text, flex: 1 }]}>{label}</Text>
      </View>
      {step.lines.map((l, i) => (
        <Text key={i} style={[s.body, { fontFamily: fonts.bodySemibold }]}>
          {l.say}{l.q ? <Text style={[s.muted, { fontFamily: fonts.body }]}>{`  … ${l.q}`}</Text> : null}
        </Text>
      ))}
      <Pressable onPress={() => router.push('/pitch' as never)} hitSlop={6} accessibilityRole="link">
        <Text style={[s.label, { color: c.primary }]}>Why and how for each line → Learn your pitch</Text>
      </Pressable>
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
  pitch: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 12, padding: 14, gap: 8 },
  dl: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  dlText: { fontFamily: fonts.bodySemibold, fontSize: 15 },
});
