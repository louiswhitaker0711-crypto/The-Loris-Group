/**
 * Earnings Calculator — what a BA's week is worth, and when it is paid.
 *
 * Tabs:
 *   This week — "Your earnings this week" (live total), "Build your week"
 *     (Silver / Gold / The Round steppers), the 4th-week rate (what the
 *     week's sign-ups earn again at week 4), the breakdown, and the pay dates.
 *   Quality — how quality pay works, the campaign's targets, and what counts
 *     as a fail.
 *   Rates — every rate and what it means. Admins edit them here.
 *
 * The formulas live in src/pay/vertexPay.ts (mirrored server-side in
 * backend/core/vertex_pay.py); every £ figure is the office's own
 * (GET /commission-fees). What a person types is remembered on their
 * device. The week starts from their Bells row until they change it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Platform, Pressable, Switch, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { useTabBarClearance } from '../../src/customization/CustomTabBar';
import { useColors, fonts } from '../../src/theme/ThemeContext';
import { brand } from '../../src/theme/brand';
import { apiService } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useActiveOffice } from '../../src/office/ActiveOfficeContext';
import { showAlert } from '../../src/utils/showAlert';
import { APP_LOCALE, formatMoney } from '../../src/utils/appTime';
import { DepthCard } from '../../src/components/ui/DepthCard';
import { SlidingSegments } from '../../src/components/ui/SlidingSegments';
import {
  DEFAULT_FEES, FEE_BOUNDS, TARGETS, TIER_RULES, VertexFees, normalizeFees, weekPay, retentionPay,
  payDates, formatPayDate,
} from '../../src/pay/vertexPay';

// ==================== TYPES ====================
type MySummary = {
  week_ending: string;
  has_entry: boolean;
  this_week: { standard: number; target: number; memberships?: number; sign_ups: number; days_worked: number; earnings: number };
  fees: Partial<VertexFees>;
};
type Counts = { silver: number; gold: number; round: number };

/** What the person types here, remembered per device (never sent anywhere). */
type Saved = {
  week?: Record<string, Counts>;       // by week_ending
  keep?: number;                       // 4th-week rate, %
};
const STORE_KEY = 'hub.earnings.v3';
type TabKey = 'week' | 'quality' | 'rates';

// The calculator's panels are dark in both themes.
const EC = {
  ink: brand.deep,
  surface: brand.forest,
  raised: '#10315d',
  line: 'rgba(34,208,236,0.16)',
  lime: brand.lime,
  green: '#0ea5d7',
  text: '#e7f0f9',
  muted: '#a8b6c7',
  red: '#f1928c',
  teal: '#4ade80',
  amber: brand.amber,
};

// ==================== HELPERS ====================
const pounds = (n: number) => formatMoney(Math.round(n));
/** £5 / £9.99 — pence only when there are any. */
const price = (n: number) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);

/** Counts smoothly towards a number (jumps straight there with reduced motion). */
function useCountUp(target: number): number {
  const reduce = Platform.OS === 'web' && typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduce ? target : 0);
  const cur = useRef(shown);
  const goal = useRef(target);
  goal.current = target;
  useEffect(() => {
    if (reduce) { cur.current = target; setShown(target); return; }
    let frame = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const k = 1 - Math.exp(-Math.min(64, now - last) / 110);
      last = now;
      const next = cur.current + (goal.current - cur.current) * k;
      const done = Math.abs(goal.current - next) < 0.5;
      cur.current = done ? goal.current : next;
      setShown(cur.current);
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);
  return shown;
}

// ==================== SCREEN ====================
export default function EarningsScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tabBarClearance = useTabBarClearance();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<TabKey>('week');

  const summaryQ = useQuery({
    queryKey: ['bells-my-summary', 12],
    queryFn: () => apiService.getMyBellsSummary(12).then((r) => r.data as MySummary),
    staleTime: 1000 * 30,
  });
  const settingsQ = useQuery({
    queryKey: ['app-settings', user?.office_id],
    queryFn: () => apiService.getSettings(user?.office_id).then((r) => r.data),
    staleTime: 1000 * 60,
  });
  const summary = summaryQ.data;
  const fees = useMemo(() => normalizeFees(summary?.fees), [summary?.fees]);

  const [saved, setSaved] = useState<Saved>({});
  const loaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) setSaved(JSON.parse(raw) || {});
      } catch {}
      loaded.current = true;
    })();
  }, []);
  const update = useCallback((patch: Partial<Saved>) => {
    setSaved((prev) => {
      const next = { ...prev, ...patch };
      if (loaded.current) AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const { officeId: activeOfficeId } = useActiveOffice();
  const ratesOffice = activeOfficeId || user?.office_id;
  const hidden = !isAdmin && settingsQ.data?.pay_tab_visible === false;
  const tabs = [{ key: 'week', label: 'This week' }, { key: 'quality', label: 'Quality' }, { key: 'rates', label: 'Rates' }];

  if (summaryQ.isLoading || settingsQ.isLoading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading the Earnings Calculator" />
      </View>
    );
  }
  if (hidden) {
    return (
      <View style={[styles.container, { padding: 16, paddingTop: 24 }]}>
        <DepthCard style={styles.card} index={0}>
          <Text style={styles.cardTitle}>The Earnings Calculator is switched off for your office</Text>
          <Text style={styles.body}>Your office admin has turned it off for now. Ask them about your earnings.</Text>
        </DepthCard>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <SlidingSegments items={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} testID="pay-tabs" />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance + 20 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          {summaryQ.isError && (
            <DepthCard style={styles.card}>
              <Text style={styles.body}>Couldn't load your Bells numbers just now. You can still build your week by hand.</Text>
            </DepthCard>
          )}
          {tab === 'week' && (
            <WeekCalculator
              fees={fees}
              weekEnding={summary?.week_ending || ''}
              bells={{
                silver: summary?.this_week.standard ?? 0,
                gold: summary?.this_week.target ?? 0,
                round: summary?.this_week.memberships ?? 0,
              }}
              hasBells={!!summary?.has_entry}
              saved={saved}
              update={update}
            />
          )}
          {tab === 'quality' && <QualityGuide fees={fees} />}
          {tab === 'rates' && (isAdmin ? <RatesEditor officeId={ratesOffice} /> : <RatesGuide fees={fees} />)}
        </View>
      </ScrollView>
    </View>
  );
}

// ==================== THIS WEEK ====================
function WeekCalculator({ fees, weekEnding, bells, hasBells, saved, update }: {
  fees: VertexFees; weekEnding: string; bells: Counts; hasBells: boolean;
  saved: Saved; update: (p: Partial<Saved>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const edited = saved.week?.[weekEnding];
  const calc: Counts = edited ?? bells;
  const keep = Math.round(saved.keep ?? TARGETS.fourthWeekPct);

  const pay = weekPay({ silver: calc.silver, gold: calc.gold, memberships: calc.round }, fees);
  const later = retentionPay(calc.silver, calc.gold, keep, fees);
  const total = pay.upFront + later.total;
  const shownTotal = useCountUp(total);
  const onTarget = keep >= TARGETS.fourthWeekPct;
  const dates = payDates(weekEnding);

  const setCount = (key: keyof Counts, value: number) => {
    const next = { ...calc, [key]: Math.max(0, Math.min(999, value)) };
    // A membership is an add-on to a sign-up, so there can't be more of them.
    next.round = Math.min(next.round, next.silver + next.gold);
    update({ week: { ...(saved.week || {}), [weekEnding]: next } });
  };

  const tiers: { key: keyof Counts; title: string; description: string }[] = [
    { key: 'silver', title: 'Silver', description: `Order of ${price(TIER_RULES.silverFrom)} to ${price(TIER_RULES.goldFrom - 0.01)} · ${pounds(fees.fee_standard)} up front` },
    { key: 'gold', title: 'Gold', description: `Order of ${price(TIER_RULES.goldFrom)} or more · ${pounds(fees.fee_target)} up front` },
    { key: 'round', title: 'The Round', description: `Sign-ups that took the membership · ${pounds(fees.fee_membership)} each` },
  ];
  const barTotal = Math.max(1, total);

  return (
    <View testID="earnings-calculator">
      <Text style={[styles.lede, { marginBottom: 12 }]}>See what your week is worth as you go.</Text>

      {/* Your earnings this week */}
      <View style={styles.hero}>
        <View pointerEvents="none" style={styles.heroRing} />
        <Text style={[styles.kicker, { color: EC.lime }]}>Weekly estimate / live</Text>
        <Text style={styles.heroTitle}>Your earnings this week</Text>
        <Text style={styles.heroTotal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
          accessibilityLabel={`Estimated earnings ${pounds(total)}`} testID="value-weekly-earnings">
          {pounds(shownTotal)}
        </Text>
        <View style={styles.heroBottom}>
          <Text style={styles.heroMeta}>
            <Text style={styles.heroMetaStrong}>{pay.signUps}</Text> {pay.signUps === 1 ? 'sign-up' : 'sign-ups'}
            {pay.memberships > 0 ? ` · ${pay.memberships} in The Round` : ''}
          </Text>
          <Text style={styles.heroMeta}>
            <Text style={styles.heroMetaStrong}>{pounds(pay.upFront)}</Text> up front · <Text style={styles.heroMetaStrong}>{pounds(later.total)}</Text> at week 4
          </Text>
        </View>
      </View>

      {/* 01 / Build your week */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.kicker}>01 / Sign-ups</Text>
            <Text style={styles.panelTitle}>Build your week</Text>
          </View>
          <Text style={styles.panelAside}>BA fee per sign-up</Text>
        </View>
        {tiers.map(({ key, title, description }, i) => (
          <View key={key} style={[styles.signupRow, i % 2 === 1 && styles.signupRowAlt]} testID={`row-signup-${key}`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.signupTitle}>{title}</Text>
              <Text style={styles.signupSub}>{description}</Text>
            </View>
            <Stepper label={key === 'round' ? 'The Round members' : `${title} sign-ups`} value={calc[key]} onChange={(v) => setCount(key, v)} testKey={key} />
          </View>
        ))}
        {hasBells && (
          <View style={styles.bellsRow}>
            <Ionicons name="notifications-outline" size={13} color={EC.muted} />
            <Text style={styles.bellsText}>
              {edited
                ? `Bells has you on ${bells.silver} Silver, ${bells.gold} Gold and ${bells.round} in The Round this week.`
                : 'Started from your Bells row for this week. Change any number to plan ahead.'}
            </Text>
            {edited ? (
              <Pressable onPress={() => { const w = { ...(saved.week || {}) }; delete w[weekEnding]; update({ week: w }); }} hitSlop={8}>
                <Text style={styles.bellsLink}>Use Bells</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {/* 02 / Week 4 */}
      <View style={[styles.panel, !onTarget && { borderColor: 'rgba(241,146,140,0.5)' }]}>
        <View style={styles.rateHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kicker}>02 / Week 4</Text>
            <Text style={styles.panelTitle}>Customers still ordering in week 4</Text>
          </View>
          <Text style={[styles.bigRate, !onTarget && { color: EC.red }]}>{keep}<Text style={styles.bigRateUnit}>%</Text></Text>
        </View>
        <View style={styles.sliderWrap}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={keep}
            onValueChange={(v) => update({ keep: Math.round(v) })}
            minimumTrackTintColor={onTarget ? EC.lime : EC.red}
            maximumTrackTintColor="rgba(231,240,249,0.18)"
            thumbTintColor={onTarget ? EC.lime : EC.red}
            accessibilityLabel="Customers still ordering in week 4, percent"
            testID="input-fourth-week-rate"
          />
          <Scale gate={TARGETS.fourthWeekPct} label={`${TARGETS.fourthWeekPct}% target`} />
          <Text style={[styles.rateNote, styles.rateNoteClear]} testID="status-retention">
            {pay.signUps === 0
              ? `Each customer still ordering in their 4th week pays again: ${pounds(fees.retention_standard)} for a Silver, ${pounds(fees.retention_target)} for a Gold.`
              : `At ${keep}%, ${later.silverKept} of your Silver and ${later.goldKept} of your Gold reach week 4: +${pounds(later.total)}.`}
          </Text>
        </View>
      </View>

      {/* The breakdown */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.kicker}>Your numbers / explained</Text>
            <Text style={styles.panelTitle}>The breakdown</Text>
          </View>
          <Text style={styles.panelAside}>Weekly estimate</Text>
        </View>
        <View style={styles.breakdown}>
          <Line label={`Silver sign-ups (${calc.silver})`} value={pounds(pay.silverFees)} testID="value-silver-fees" />
          <Line label={`Gold sign-ups (${calc.gold})`} value={pounds(pay.goldFees)} testID="value-gold-fees" />
          <Line label={`The Round (${pay.memberships})`} value={pounds(pay.membershipFees)} tone="teal" testID="value-membership-fees" />
          <Line label={`Week 4 payments, at ${keep}%`} value={pounds(later.total)} tone="amber" testID="value-retention" />
          <Line label="Estimated total" value={pounds(total)} total testID="value-breakdown-total" />
        </View>
        <View style={styles.composition}>
          <View style={styles.compositionLabel}>
            <Text style={styles.compositionText}>Where your earnings come from</Text>
            <Text style={styles.compositionText}>Estimated {pounds(total)}</Text>
          </View>
          <View style={styles.track} accessibilityRole="image"
            accessibilityLabel={`Sign-up fees ${pounds(pay.signUpFees)}, The Round ${pounds(pay.membershipFees)}, week 4 payments ${pounds(later.total)}`}>
            {pay.signUpFees > 0 && <View style={{ flex: pay.signUpFees / barTotal, backgroundColor: EC.lime }} />}
            {pay.membershipFees > 0 && <View style={{ flex: pay.membershipFees / barTotal, backgroundColor: EC.teal }} />}
            {later.total > 0 && <View style={{ flex: later.total / barTotal, backgroundColor: EC.amber }} />}
            {total === 0 && <View style={{ flex: 1 }} />}
          </View>
          <View style={styles.key}>
            <KeyDot colour={EC.lime} text="Sign-ups" />
            <KeyDot colour={EC.teal} text="The Round" />
            <KeyDot colour={EC.amber} text="Week 4" />
          </View>
        </View>
      </View>

      {/* When it's paid */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.kicker}>03 / Pay dates</Text>
            <Text style={styles.panelTitle}>When this week is paid</Text>
          </View>
          {weekEnding ? <Text style={styles.panelAside}>Week ending {formatPayDate(weekEnding, APP_LOCALE)}</Text> : null}
        </View>
        <View style={styles.breakdown}>
          <Line label="Sign-up fees" value={formatPayDate(dates.signUps, APP_LOCALE) || 'The Wednesday 11 days after the week ends'} testID="value-pay-date-signups" />
          <Line label="The Round" value={formatPayDate(dates.memberships, APP_LOCALE) || 'A week after the sign-up fees'} tone="teal" testID="value-pay-date-round" />
          <Line label="Week 4 payments" value={dates.retention ? `around ${formatPayDate(dates.retention, APP_LOCALE)}` : 'About 8 weeks after the week ends'} tone="amber" testID="value-pay-date-retention" />
        </View>
        <Text style={styles.payNote}>
          Sign-up fees wait for the orders to be delivered and not cancelled. The Round has a 14-day cooling-off period, so it is paid a week later. For a week 4 payment the customer needs 4 weeks of deliveries within 6 weeks, then it is processed and paid.
        </Text>
      </View>

      <Text style={styles.foot}>
        A sign-up that fails pays nothing: cancelled before the first delivery, a first delivery more than {TIER_RULES.maxDaysToFirstDelivery} days away, an order under {price(TIER_RULES.silverFrom)}, or no repeat items on it.
      </Text>
      <Text style={styles.foot}>These figures are based on the numbers you enter. Check them against Field IQ.</Text>
    </View>
  );
}

// ==================== QUALITY ====================
function QualityGuide({ fees }: { fees: VertexFees }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const targets: { label: string; value: string; sub: string }[] = [
    { label: 'Average order value', value: `${price(TARGETS.orderValue)}+`, sub: 'repeat weekly items, before delivery' },
    { label: 'Drop days', value: `${TARGETS.dropDays}+`, sub: 'delivery days a week, on average' },
    { label: 'Fails', value: `under ${TARGETS.failPct}%`, sub: 'of your sign-ups' },
    { label: 'The Round', value: `${TARGETS.memberPct}%+`, sub: 'of your sign-ups take the membership' },
    { label: '4th week', value: `${TARGETS.fourthWeekPct}%+`, sub: 'of customers still ordering in week 4' },
  ];
  const fails = [
    'The customer cancels before their first delivery.',
    `The first delivery is set more than ${TIER_RULES.maxDaysToFirstDelivery} days away.`,
    `The order is under ${price(TIER_RULES.silverFrom)}.`,
    'There are no repeat items on the order (one-off items only).',
  ];
  return (
    <View testID="quality-guide">
      <View style={styles.header}>
        <Text style={styles.eyebrow}>My tools</Text>
        <Text style={styles.h1}>Quality</Text>
        <Text style={styles.lede}>
          Half of what a sign-up is worth comes from the customer staying. These are the numbers the campaign looks at.
        </Text>
      </View>

      {/* How it works */}
      <View style={styles.how}>
        <View style={styles.howHead}>
          <Ionicons name="information-circle-outline" size={16} color={colors.text} />
          <Text style={styles.howTitle}>How quality pays</Text>
        </View>
        <Text style={styles.howText}>
          If a customer you sign up is still ordering in their 4th week, you earn {pounds(fees.retention_standard)} for a Silver and {pounds(fees.retention_target)} for a Gold, on top of the up-front fee. The customer needs 4 weeks of deliveries within 6 weeks; the payment follows about 8 weeks after the sign-up.
        </Text>
      </View>

      {/* Targets */}
      <View style={styles.summary}>
        {targets.map((t) => (
          <View key={t.label} style={styles.summaryTile}>
            <Text style={styles.summaryLabel}>{t.label}</Text>
            <Text style={styles.summaryValue}>{t.value}</Text>
            <Text style={styles.summarySub}>{t.sub}</Text>
          </View>
        ))}
      </View>

      {/* Fails */}
      <DepthCard style={styles.card}>
        <Text style={styles.cardTitle}>What counts as a fail</Text>
        <Text style={[styles.fieldHint, { marginTop: -6, marginBottom: 6 }]}>A fail pays nothing, up front or at week 4.</Text>
        {fails.map((f) => (
          <View key={f} style={styles.failRow}>
            <Ionicons name="close-circle-outline" size={16} color={colors.red} />
            <Text style={styles.failText}>{f}</Text>
          </View>
        ))}
      </DepthCard>

      <Text style={styles.foot}>Your own quality figures come from the campaign's reports. Ask your coach for them.</Text>
    </View>
  );
}

// ==================== RATES ====================
type RateField = { key: keyof VertexFees; label: string; unit: '£'; help: string };
const RATE_GROUPS: Array<{ title: string; hint: string; fields: RateField[]; adminOnly?: boolean }> = [
  {
    title: 'Sign-up fees',
    hint: 'What a BA earns up front for each sign-up, by the value of the customer\'s repeat weekly order.',
    fields: [
      { key: 'fee_standard', label: 'Silver', unit: '£', help: 'BA fee for each sign-up with an order of £5.00 to £9.99.' },
      { key: 'fee_target', label: 'Gold', unit: '£', help: 'BA fee for each sign-up with an order of £10 or more.' },
    ],
  },
  {
    title: 'The Round',
    hint: 'The membership can be taken with a Silver or a Gold sign-up, or not at all.',
    fields: [
      { key: 'fee_membership', label: 'Per member', unit: '£', help: 'Added for each sign-up that takes The Round.' },
    ],
  },
  {
    title: 'Week 4 payments',
    hint: 'Paid for each customer still ordering in their 4th week (4 weeks of deliveries within 6 weeks).',
    fields: [
      { key: 'retention_standard', label: 'Silver at week 4', unit: '£', help: 'Paid for each Silver customer who reaches week 4.' },
      { key: 'retention_target', label: 'Gold at week 4', unit: '£', help: 'Paid for each Gold customer who reaches week 4.' },
    ],
  },
  {
    title: 'Office (MC) fees',
    hint: 'What the office is paid for each sign-up. Only Admins see this, here and in the MC fees column on Bells.',
    adminOnly: true,
    fields: [
      { key: 'fee_mc', label: 'MC fee per sign-up', unit: '£', help: 'What the office is paid for every sign-up, whatever the tier.' },
    ],
  },
];
const ALL_FIELDS = RATE_GROUPS.flatMap((g) => g.fields);
const showValue = (_f: RateField, v: number) => formatMoney(v);

/** Everyone else: the office's rates and what each one means (read-only). */
function RatesGuide({ fees }: { fees: VertexFees }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <DepthCard style={styles.card} index={0}>
      <Text style={styles.cardTitle}>Your office's rates</Text>
      {RATE_GROUPS.filter((g) => !g.adminOnly).map((g) => (
        <View key={g.title} style={styles.rateGroup}>
          <Text style={styles.cardLabel}>{g.title}</Text>
          <Text style={[styles.fieldHint, { marginBottom: 4 }]}>{g.hint}</Text>
          {g.fields.map((f) => (
            <View key={f.key} style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <Text style={styles.fieldHint}>{f.help}</Text>
              </View>
              <Text style={styles.guideValue}>{showValue(f, fees[f.key])}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text style={styles.note}>Only the Owner changes these. The calculator uses them straight away.</Text>
    </DepthCard>
  );
}

function RatesEditor({ officeId }: { officeId?: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();

  const feesQ = useQuery({
    queryKey: ['commission-fees', officeId],
    queryFn: () => apiService.getCommissionFees(officeId).then((r) => r.data),
    enabled: !!officeId,
  });
  const settingsQ = useQuery({
    queryKey: ['app-settings', officeId],
    queryFn: () => apiService.getSettings(officeId).then((r) => r.data),
    enabled: !!officeId,
  });
  const fees = useMemo(() => normalizeFees(feesQ.data), [feesQ.data]);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const values: Record<string, string> = draft ?? Object.fromEntries(Object.entries(fees).map(([k, v]) => [k, String(v)]));

  const invalid = ALL_FIELDS.filter((f) => {
    const n = Number(values[f.key]);
    const [lo, hi] = FEE_BOUNDS[f.key];
    return values[f.key] === '' || !Number.isFinite(n) || n < lo || n > hi;
  });

  const saveMut = useMutation({
    mutationFn: (body: Partial<VertexFees>) => apiService.updateCommissionFees(body, officeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-fees'] });
      queryClient.invalidateQueries({ queryKey: ['bells-my-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bells'] });
      setDraft(null);
      showAlert('Saved', 'Rates updated for this office.');
    },
    onError: (e: any) => showAlert('Not saved', e?.response?.data?.detail || 'Could not update the rates.'),
  });
  const visibilityMut = useMutation({
    mutationFn: (visible: boolean) => apiService.updateSettings({ pay_tab_visible: visible }, officeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
    onError: () => showAlert('Not saved', 'Could not change the setting.'),
  });

  if (feesQ.isLoading) {
    return <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} accessibilityLabel="Loading the rates" />;
  }

  const visible = settingsQ.data?.pay_tab_visible !== false;
  const save = () => {
    if (invalid.length) {
      showAlert('Check the rates', `${invalid.map((f) => f.label).join(', ')}: enter a number in range.`);
      return;
    }
    saveMut.mutate(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, Number(values[f.key])])) as Partial<VertexFees>);
  };

  return (
    <>
      <DepthCard style={styles.card} index={0}>
        <View style={styles.fieldRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Earnings Calculator visible to the team</Text>
            <Text style={styles.fieldHint}>When off, only admins can see it{feesQ.data?.office_name ? ` in ${feesQ.data.office_name}` : ''}</Text>
          </View>
          <Switch
            value={visible}
            onValueChange={(v) => visibilityMut.mutate(v)}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.background}
            accessibilityLabel="Earnings Calculator visible to the team"
          />
        </View>
      </DepthCard>

      <DepthCard style={styles.card}>
        <Text style={styles.cardTitle}>Rates{feesQ.data?.office_name ? ` · ${feesQ.data.office_name}` : ''}</Text>
        {RATE_GROUPS.map((g) => (
          <View key={g.title} style={styles.rateGroup}>
            <Text style={styles.cardLabel}>{g.title}</Text>
            <Text style={[styles.fieldHint, { marginBottom: 4 }]}>{g.hint}</Text>
            {g.fields.map((f) => {
              const bad = invalid.some((x) => x.key === f.key);
              return (
                <View key={f.key} style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{f.label}</Text>
                    <Text style={styles.fieldHint}>{f.help}</Text>
                  </View>
                  {/* Fixed prefix/suffix slots keep every input in one column. */}
                  <Text style={styles.prefix}>£</Text>
                  <TextInput
                    style={[styles.smallInput, bad && { borderColor: colors.red }]}
                    value={values[f.key]}
                    onChangeText={(v) => setDraft({ ...values, [f.key]: v.replace(/[^0-9.]/g, '').slice(0, 7) })}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel={`${g.title}: ${f.label}`}
                    testID={`rate-${f.key}`}
                  />
                  <Text style={styles.suffix} />
                </View>
              );
            })}
          </View>
        ))}

        <View style={styles.actions}>
          <Pressable
            style={[styles.primaryBtn, (!draft || saveMut.isPending) && styles.btnDisabled]}
            disabled={!draft || saveMut.isPending}
            onPress={save}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>{saveMut.isPending ? 'Saving…' : 'Save rates'}</Text>
          </Pressable>
          {draft && (
            <Pressable style={styles.secondaryBtn} onPress={() => setDraft(null)} accessibilityRole="button">
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={styles.linkBtn}
          onPress={() => setDraft({
            ...Object.fromEntries(Object.entries(DEFAULT_FEES).map(([k, v]) => [k, String(v)])),
            // The office's own fee has no standard figure: keep what is there.
            fee_mc: values.fee_mc,
          })}
        >
          <Ionicons name="refresh" size={14} color={colors.text} />
          <Text style={styles.linkBtnText}>Fill in the standard rates</Text>
        </Pressable>
        <Text style={styles.note}>
          Standard: Silver £12 and Gold £20 up front, £8 for The Round, then £5 for a Silver and £8 for a Gold at week 4. Bells' fee estimates and everyone's Earnings Calculator use these straight away.
        </Text>
      </DepthCard>
    </>
  );
}

// ==================== SUB-COMPONENTS ====================
function Stepper({ label, value, onChange, testKey }: { label: string; value: number; onChange: (v: number) => void; testKey: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stepper} accessibilityLabel={`${label} quantity`}>
      <Pressable onPress={() => onChange(value - 1)} disabled={value <= 0} style={[styles.stepBtn, value <= 0 && { opacity: 0.35 }]}
        accessibilityLabel={`Decrease ${label}`} testID={`button-decrease-${testKey}`}>
        <Ionicons name="remove" size={18} color={EC.text} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${label} count`} testID={`value-count-${testKey}`}>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)} style={styles.stepBtn}
        accessibilityLabel={`Increase ${label}`} testID={`button-increase-${testKey}`}>
        <Ionicons name="add" size={18} color={EC.text} />
      </Pressable>
    </View>
  );
}

/** 0% · the gate, sitting under its point on the slider · 100% */
function Scale({ gate, label }: { gate: number; label: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.scale}>
      <Text style={styles.scaleText}>0%</Text>
      <View pointerEvents="none" style={[styles.scaleGate, { left: `${gate}%` as any }]}>
        <View style={styles.scaleTick} />
        <Text style={[styles.scaleText, { color: EC.lime }]} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.scaleText}>100%</Text>
    </View>
  );
}

function Gate({ met, text }: { met: boolean; text: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.gate, met && styles.gateMet]}>
      <Ionicons name={met ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={met ? EC.lime : EC.muted} />
      <Text style={[styles.gateText, met && { color: EC.text }]}>{text}</Text>
    </View>
  );
}

function Line({ label, value, tone, total, testID }: { label: string; value: string; tone?: 'red' | 'teal' | 'amber'; total?: boolean; testID?: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const c = tone === 'red' ? EC.red : tone === 'teal' ? EC.teal : tone === 'amber' ? EC.amber : EC.text;
  return (
    <View style={[styles.line, total && styles.lineTotal]}>
      <Text style={[styles.lineLabel, total && styles.lineLabelTotal, tone && { color: c }]}>{label}</Text>
      <Text style={[styles.lineValue, total && styles.lineValueTotal, tone && { color: c }]} testID={testID}>{value}</Text>
    </View>
  );
}

function KeyDot({ colour, text }: { colour: string; text: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.keyItem}>
      <View style={[styles.keyDot, { backgroundColor: colour }]} />
      <Text style={styles.compositionText}>{text}</Text>
    </View>
  );
}

// ==================== STYLES ====================
const createStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  tabRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, maxWidth: 852, width: '100%', alignSelf: 'center' },
  content: { padding: 16 },
  column: { width: '100%', maxWidth: 820, alignSelf: 'center' },

  // Page head (on the page field, so theme colours)
  header: { marginBottom: 16 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: colors.textSecondary },
  h1: { fontFamily: fonts.display, fontSize: 30, lineHeight: 35, letterSpacing: -0.8, color: colors.text, marginTop: 6 },
  lede: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: colors.textSecondary, marginTop: 5 },
  foot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 4, marginBottom: 6 },

  // Hero
  hero: { overflow: 'hidden', borderRadius: 24, padding: 26, backgroundColor: EC.ink, borderWidth: 1, borderColor: 'rgba(34,208,236,0.22)',
    boxShadow: '0 22px 45px -28px rgba(11,27,47,0.55)' } as any,
  heroRing: { position: 'absolute', width: 280, height: 280, right: -78, top: -92, borderRadius: 140, borderWidth: 1,
    borderColor: 'rgba(34,208,236,0.14)', boxShadow: '0 0 0 42px rgba(34,208,236,0.04), 0 0 0 88px rgba(34,208,236,0.025)' } as any,
  kicker: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: EC.green },
  heroTitle: { fontFamily: fonts.display, fontSize: 22, color: '#dfe8f1', marginTop: 14 },
  heroTotal: { fontFamily: fonts.display, fontSize: 76, lineHeight: 86, letterSpacing: -3.5, color: EC.lime, fontVariant: ['tabular-nums'] as any },
  heroBottom: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, rowGap: 6, marginTop: 16, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: 'rgba(34,208,236,0.18)' },
  heroMeta: { fontFamily: fonts.body, fontSize: 12.5, color: '#b8c5d6' },
  heroMetaStrong: { fontFamily: fonts.bodyBold, color: EC.text },

  // Panels
  panel: { marginTop: 14, borderRadius: 19, overflow: 'hidden', backgroundColor: EC.surface, borderWidth: 1, borderColor: EC.line },
  panelHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 15 },
  panelTitle: { fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: EC.text, marginTop: 5 },
  panelAside: { fontFamily: fonts.body, fontSize: 11.5, color: EC.muted },
  signupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 84, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: EC.line },
  signupRowAlt: { backgroundColor: 'rgba(34,208,236,0.03)' },
  signupTitle: { fontFamily: fonts.display, fontSize: 26, color: EC.text },
  fieldTitle: { fontFamily: fonts.display, fontSize: 17, color: EC.text },
  signupSub: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, color: EC.muted, marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 4, borderRadius: 14, backgroundColor: EC.ink, borderWidth: 1, borderColor: 'rgba(34,208,236,0.22)' },
  stepBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: EC.raised },
  stepValue: { minWidth: 46, textAlign: 'center', fontFamily: fonts.display, fontSize: 22, color: EC.text, fontVariant: ['tabular-nums'] as any },
  bellsRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: EC.line },
  bellsText: { flex: 1, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, color: EC.muted },
  bellsLink: { fontFamily: fonts.bodySemibold, fontSize: 12, color: EC.lime },

  rateHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  rateEntry: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 13, backgroundColor: EC.ink, borderWidth: 1, borderColor: 'rgba(34,208,236,0.22)' },
  rateInput: { width: 62, height: 46, textAlign: 'center', fontFamily: fonts.display, fontSize: 21, color: EC.text, outlineStyle: 'none' } as any,
  rateUnit: { fontFamily: fonts.bodySemibold, fontSize: 15, color: EC.muted },
  sliderWrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18 },
  slider: { width: '100%', height: 40 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', height: 30 },
  scaleText: { fontFamily: fonts.mono, fontSize: 10, color: EC.muted },
  scaleGate: { position: 'absolute', top: -6, width: 120, marginLeft: -60, alignItems: 'center' },
  scaleTick: { width: 2, height: 8, borderRadius: 1, backgroundColor: EC.lime, marginBottom: 2 },
  rateNote: { fontFamily: fonts.bodySemibold, fontSize: 12.5, lineHeight: 18, color: '#ffd9d6', backgroundColor: 'rgba(241,146,140,0.12)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 6, overflow: 'hidden' },
  rateNoteClear: { color: EC.lime, backgroundColor: 'rgba(34,208,236,0.10)' },
  rateNoteIdle: { color: EC.text, backgroundColor: 'rgba(231,240,249,0.07)' },

  gates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6, borderTopWidth: 1, borderTopColor: EC.line },
  gate: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(231,240,249,0.16)' },
  gateMet: { borderColor: 'rgba(34,208,236,0.5)', backgroundColor: 'rgba(34,208,236,0.08)' },
  gateText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: EC.muted },
  monthLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  monthLineText: { flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: EC.muted },

  breakdown: { paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: EC.line },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: EC.line },
  lineTotal: { borderBottomWidth: 0, paddingTop: 15 },
  lineLabel: { fontFamily: fonts.body, fontSize: 14, color: EC.muted },
  lineLabelTotal: { fontFamily: fonts.bodyBold, fontSize: 15, color: EC.text },
  lineValue: { fontFamily: fonts.bodySemibold, fontSize: 16, color: EC.text, fontVariant: ['tabular-nums'] as any },
  lineValueTotal: { fontFamily: fonts.display, fontSize: 26, color: EC.lime },
  composition: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20 },
  compositionLabel: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  compositionText: { fontFamily: fonts.body, fontSize: 11.5, color: EC.muted },
  track: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(231,240,249,0.10)' },
  key: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 9 },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 9, height: 9, borderRadius: 5 },

  // Quality
  how: { borderRadius: 16, padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  howHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  howTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  howText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19.5, color: colors.textSecondary },
  chip: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  chipPass: { backgroundColor: EC.lime },
  chipFail: { backgroundColor: 'rgba(241,146,140,0.22)' },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 11.5 },
  bigRate: { fontFamily: fonts.display, fontSize: 52, letterSpacing: -2, color: EC.lime, fontVariant: ['tabular-nums'] as any },
  bigRateUnit: { fontSize: 22, letterSpacing: 0 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6, padding: 11, borderRadius: 10, backgroundColor: 'rgba(241,146,140,0.12)' },
  warnText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 12.5, lineHeight: 18, color: '#ffd9d6' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, marginBottom: 14 },
  summaryTile: { flexGrow: 1, flexBasis: 150, padding: 15, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  summaryBig: { flexBasis: 220, backgroundColor: EC.ink, borderColor: 'rgba(34,208,236,0.22)' },
  summaryLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.textMuted },
  summaryValue: { fontFamily: fonts.display, fontSize: 32, letterSpacing: -1, color: colors.text, marginTop: 4, fontVariant: ['tabular-nums'] as any },
  summarySub: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 170 },
  bar: { flex: 1, minWidth: 0, alignItems: 'center', height: '100%' },
  barValue: { fontFamily: fonts.mono, fontSize: 9, color: colors.textSecondary, height: 14 },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', borderRadius: 6, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barFill: { width: '100%', minHeight: 0, borderRadius: 6, backgroundColor: colors.primary },
  barLabel: { fontFamily: fonts.mono, fontSize: 8.5, color: colors.textMuted, marginTop: 5 },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  startLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  startMonth: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.text, minWidth: 66, textAlign: 'center' },
  navBtn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border },
  trTotal: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: colors.text },
  th: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },
  td: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textSecondary, fontVariant: ['tabular-nums'] as any },
  tdStrong: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] as any },
  cMonth: { width: 74 },
  cIn: { width: 56 },
  cQual: { flex: 1, textAlign: 'center' },
  cPaid: { width: 74 },
  cPay: { width: 84, textAlign: 'right' },
  cellInput: { height: 34, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, textAlign: 'center',
    fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },

  payNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17.5, color: EC.muted, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18 },
  failRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  failText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19.5, color: colors.text },

  // Rates + shared cards
  card: { borderRadius: 20, padding: 16, marginBottom: 12 },
  cardLabel: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.textMuted, marginBottom: 6 },
  cardTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.text, marginBottom: 12 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 10 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  fieldLabel: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },
  fieldHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16.5, color: colors.textMuted, marginTop: 2 },
  guideValue: { fontFamily: fonts.monoSemibold, fontSize: 15, color: colors.text, minWidth: 64, textAlign: 'right' },
  smallInput: { width: 76, height: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    textAlign: 'center', fontFamily: fonts.monoSemibold, fontSize: 16, color: colors.text },
  prefix: { fontFamily: fonts.monoSemibold, fontSize: 15, color: colors.textSecondary, width: 14, textAlign: 'right' },
  suffix: { fontFamily: fonts.monoSemibold, fontSize: 13, color: colors.textSecondary, minWidth: 22 },
  rateGroup: { marginTop: 10, marginBottom: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  primaryBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 14, backgroundColor: colors.ink },
  primaryBtnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.inkText },
  btnDisabled: { opacity: 0.45 },
  secondaryBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  secondaryBtnText: { fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.text },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 12, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  linkBtnText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.text },
});
