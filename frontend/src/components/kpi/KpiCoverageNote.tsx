/**
 * Bells vs the KPIs (the Owner's call, 22 Oct 2026).
 *
 * Bells is the true count of sign-ups; the KPI figures come only from the
 * people whose numbers are in and count. When they differ, show one quiet
 * line: "KPIs from 15 · 1 missing: Example". Coaches and Admins get names
 * from the server; a BA gets the count. No nudge goes to anyone.
 *
 * `coverage` is the `coverage` object on /owneriq/summary and /averages.
 */
import React from 'react';
import { Text, StyleSheet, TextStyle, StyleProp } from 'react-native';
import { useColors, fonts } from '../../theme/ThemeContext';

export type KpiCoverage = {
  bells_sales: number;
  kpi_sales: number;
  missing_count: number;
  missing: { name?: string; sales: number; reason: 'not posted' | "didn't count" }[];
  names_shown: boolean;
  differs: boolean;
} | null | undefined;

const firstName = (n?: string) => (n || '').trim().split(/\s+/)[0] || '';

/** The words, for places that build their own line (and for tests). */
export function coverageText(c: KpiCoverage): string | null {
  if (!c || !c.differs) return null;
  const parts = [`KPIs from ${c.kpi_sales}`];
  if (c.missing_count > 0) {
    const counted = c.missing.filter((m) => m.reason === "didn't count").length;
    let who = `${c.missing_count} missing`;
    if (c.names_shown) {
      const names = c.missing.map((m) => firstName(m.name) + (m.reason === "didn't count" ? ' (didn’t count)' : '')).filter(Boolean);
      if (names.length) who += `: ${names.join(', ')}`;
    } else if (counted) {
      who += ` (${counted} didn’t count)`;
    }
    parts.push(who);
  }
  return parts.join(' · ');
}

export function KpiCoverageNote({ coverage, style, onAccent }: { coverage: KpiCoverage; style?: StyleProp<TextStyle>; onAccent?: boolean }) {
  const colors = useColors();
  const text = coverageText(coverage);
  if (!text) return null;
  return (
    <Text style={[s.note, { color: onAccent ? colors.onPrimary : colors.textMuted }, style]} numberOfLines={2}
      accessibilityLabel={`${coverage?.bells_sales} sign-ups on Bells. ${text}`}>
      {text}
    </Text>
  );
}

const s = StyleSheet.create({
  note: { fontFamily: fonts.body, fontSize: 11, marginTop: 4 },
});
