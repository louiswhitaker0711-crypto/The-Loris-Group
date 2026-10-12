/**
 * Weekly sheet — the owner's printed weekly plan, on screen and in print.
 *
 * Top: the week's header rows (expectations, themes, competition,
 * concentration, news, social). Below: a Monday–Saturday grid with one row
 * per meeting or focus. Every box saves into the same weekly planner as the
 * day pages (Sectors = the day's Sector box, Customer Service = the Morning
 * Meeting's Customer Service box, and so on), so filling it in here or on a
 * day page is the same thing.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useColors, fonts } from '../../theme/ThemeContext';
import { APP_LOCALE } from '../../utils/appTime';
import { APP_NAME } from '../../theme/brand';
import { toast } from '../../utils/toast';

type Review = Record<string, any>;
type Days = Record<string, Record<string, string>>;

// Header rows, in the paper sheet's order.
export const SHEET_HEADER: { id: string; label: string }[] = [
  { id: 'expectations_1', label: 'Expectations' },
  { id: 'expectations_2', label: 'Expectations' },
  { id: 'leaders_theme', label: 'Coaches theme' },
  { id: 'topic_theme', label: 'Topic theme' },
  { id: 'cs_theme', label: 'Customer service theme' },
  { id: 'competition', label: 'Competition this week' },
  { id: 'concentration', label: 'Concentration' },
  { id: 'news', label: 'News' },
  { id: 'social', label: 'Social' },
];

// Grid rows → the day-box key each one saves into.
export const SHEET_ROWS: { key: string; label: string }[] = [
  { key: 'sector', label: 'Sectors' },
  { key: 'leaders_meeting', label: 'Coaches' },
  { key: 'stage1', label: 'Stage 1' },
  { key: 'stage2', label: 'Stage 2' },
  { key: 'sales_impact', label: 'Sales impact' },
  { key: 'morning_cs', label: 'Customer service' },
  { key: 'morning_news', label: 'News and Bells' },
  { key: 'morning_topic', label: 'Topic' },
  { key: 'product_coaching', label: 'Product coaching' },
  { key: 'appointments', label: 'Appointments' },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function headerValue(review: Review, id: string): string {
  if (id === 'concentration') return review?.concentration || '';
  if (id === 'social') return review?.team_management?.social || '';
  return review?.office_plan?.[id] || '';
}

export function headerPatch(review: Review, id: string, v: string): Review {
  if (id === 'concentration') return { concentration: v };
  if (id === 'social') return { team_management: { ...(review?.team_management || {}), social: v } };
  return { office_plan: { ...(review?.office_plan || {}), [id]: v } };
}

const esc = (s: any) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const br = (s: any) => esc(s).replaceAll('\n', '<br/>');

function weekLabel(weekEnding: string): string {
  const [y, m, d] = weekEnding.split('-').map(Number);
  if (!y) return weekEnding;
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function buildWeeklySheetHtml(review: Review, days: Days, weekEnding: string, ownerName: string): string {
  const head = SHEET_HEADER.map((h) => `<tr><th>${esc(h.label)}</th><td>${br(headerValue(review, h.id))}</td></tr>`).join('');
  const dayHead = DAYS.map((d) => `<th>${d}</th>`).join('');
  const rows = SHEET_ROWS.map((r) => `<tr>${DAYS.map((_, i) =>
    `<td><div class="lbl">${esc(r.label)}</div>${br(days?.[String(i)]?.[r.key])}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Weekly plan · ${esc(ownerName)} · w/e ${esc(weekLabel(weekEnding))}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; font-size: 9.5pt; margin: 0; }
  h1 { font-size: 12pt; margin: 0 0 6px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #222; vertical-align: top; padding: 3px 5px; }
  .head { width: 62%; margin-bottom: 8px; }
  .head th { width: 25%; text-transform: uppercase; font-size: 8pt; text-align: center; vertical-align: middle; }
  .head td { height: 20px; }
  .grid { width: 100%; table-layout: fixed; }
  .grid th { text-transform: uppercase; font-size: 8.5pt; }
  .grid td { height: 46px; }
  .lbl { text-transform: uppercase; font-size: 6.5pt; font-weight: 700; margin-bottom: 2px; }
</style></head><body>
<h1>${esc(APP_NAME)} · Weekly plan · ${esc(ownerName)} · week ending ${esc(weekLabel(weekEnding))}</h1>
<table class="head">${head}</table>
<table class="grid"><thead><tr>${dayHead}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

export async function printWeeklySheet(review: Review, days: Days, weekEnding: string, ownerName: string) {
  const html = buildWeeklySheetHtml(review, days, weekEnding, ownerName);
  try {
    await Print.printAsync({ html });
  } catch {
    toast.error('Could not print', 'Please try again.');
  }
}

export default function WeeklySheet({ review, days, canEdit, onReview, onDay, onPrint }: {
  review: Review;
  days: Days;
  canEdit: boolean;
  onReview: (patch: Review) => void;
  onDay: (day: number, key: string, v: string) => void;
  onPrint: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  return (
    <View>
      <View style={s.topRow}>
        <Text style={s.hint}>Your weekly sheet. Each box is the same box as on the day pages.</Text>
        <TouchableOpacity onPress={onPrint} style={s.printBtn} accessibilityRole="button" testID="weekly-sheet-print">
          <Ionicons name="print-outline" size={15} color={c.primary} />
          <Text style={s.printTxt}>Print</Text>
        </TouchableOpacity>
      </View>

      <View style={s.headTable}>
        {SHEET_HEADER.map((h, i) => (
          <View key={h.id} style={[s.headRow, i === SHEET_HEADER.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={s.headLabel}>{h.label}</Text>
            <TextInput
              style={s.headInput}
              value={headerValue(review, h.id)}
              onChangeText={(v) => onReview(headerPatch(review, h.id, v))}
              editable={canEdit}
              multiline
              placeholder={canEdit ? '…' : ''}
              placeholderTextColor={c.textMuted}
            />
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 6 }}>
        <View style={s.grid}>
          <View style={s.gridRow}>
            {DAYS.map((d) => (
              <View key={d} style={[s.dayHead, s.col]}><Text style={s.dayHeadTxt}>{d}</Text></View>
            ))}
          </View>
          {SHEET_ROWS.map((r) => (
            <View key={r.key} style={s.gridRow}>
              {DAYS.map((d, i) => (
                <View key={d} style={[s.cell, s.col]}>
                  <Text style={s.cellLabel}>{r.label}</Text>
                  <TextInput
                    style={s.cellInput}
                    value={days?.[String(i)]?.[r.key] || ''}
                    onChangeText={(v) => onDay(i, r.key, v)}
                    editable={canEdit}
                    multiline
                    accessibilityLabel={`${d} ${r.label}`}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const COL = 168;

const styles = (c: any) => StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  hint: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  printBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  printTxt: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  headTable: { borderWidth: 1, borderColor: c.borderDark || c.border, borderRadius: 12, overflow: 'hidden', backgroundColor: c.background, marginBottom: 14, maxWidth: 760 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border, minHeight: 40 },
  headLabel: { width: 128, paddingHorizontal: 10, paddingVertical: 10, fontFamily: fonts.bodySemibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: c.textSecondary, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border },
  headInput: { flex: 1, paddingHorizontal: 10, paddingVertical: 9, fontFamily: fonts.body, fontSize: 14, color: c.text, minHeight: 40 },
  grid: { borderWidth: 1, borderColor: c.borderDark || c.border, borderRadius: 12, overflow: 'hidden', backgroundColor: c.background },
  gridRow: { flexDirection: 'row' },
  col: { width: COL, borderRightWidth: 1, borderRightColor: c.border },
  dayHead: { paddingVertical: 8, alignItems: 'center', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  dayHeadTxt: { fontFamily: fonts.bodySemibold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: c.text },
  cell: { minHeight: 84, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  cellLabel: { fontFamily: fonts.bodySemibold, fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: c.textMuted },
  cellInput: { flex: 1, minHeight: 56, fontFamily: fonts.body, fontSize: 13, color: c.text, paddingTop: 2, textAlignVertical: 'top' },
});
