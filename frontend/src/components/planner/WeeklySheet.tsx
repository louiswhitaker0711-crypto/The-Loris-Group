/**
 * Weekly sheet — the owner's printed weekly plan, on screen and in print.
 *
 * Top: the week's header rows (expectations, themes, competition,
 * concentration, news, social). Below: a Monday–Saturday grid with one row
 * per meeting or focus. Every box saves into the same weekly planner as the
 * day pages (Sectors = the day's Sector box, Customer Service = the Morning
 * Meeting's Customer Service box, and so on), so filling it in here or on a
 * day page is the same thing.
 *
 * Rows, their order, names and times are each person's own (Edit rows,
 * saved by /weekly-planners/sheet-layout); the day pages follow the same
 * order. Nothing here changes the office timetable.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Pressable, Switch, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// One row of a person's layout: the day box it saves into, its name, an
// optional HH:MM time and whether it shows on the sheet.
export type SheetRow = { key: string; label: string; time: string; on_sheet: boolean; on_day?: boolean };
type Times = Record<string, Record<string, string>>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const rowTitle = (r: SheetRow) => (r.time ? `${r.time} · ${r.label}` : r.label);
// A day page's boxes: those shown on day pages, each with that day's own time
// (or the row's default), timed ones first in time order, the rest after in
// the person's own order.
export const dayOrder = (rows: SheetRow[], dayTimes: Record<string, string>) => {
  const list = rows.filter((r) => r.on_day !== false).map((row) => ({ row, time: dayTimes[row.key] || row.time }));
  const timed = list.filter((x) => x.time).sort((a, b) => a.time.localeCompare(b.time));
  return [...timed, ...list.filter((x) => !x.time)];
};

// A small HH:MM box: "1500" becomes "15:00"; only a whole valid time (or
// clearing it) is saved.
export function DayTimeInput({ value, onChange, label, compact }: {
  value: string; onChange: (v: string) => void; label: string; compact?: boolean;
}) {
  const c = useColors();
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const bad = !!text && !TIME_RE.test(text);
  return (
    <TextInput
      value={text}
      onChangeText={(raw) => {
        let t = raw.replace(/[^0-9:]/g, '').slice(0, 5);
        if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, t.length - 2).padStart(2, '0')}:${t.slice(-2)}`;
        setText(t);
        if (!t || TIME_RE.test(t)) onChange(t);
      }}
      placeholder="--:--"
      placeholderTextColor={c.textMuted}
      keyboardType="numbers-and-punctuation"
      accessibilityLabel={`${label} time for this day`}
      style={{
        width: compact ? 50 : 58, paddingVertical: compact ? 2 : 4, paddingHorizontal: 4, borderRadius: 6,
        borderWidth: 1, borderColor: bad ? c.red : c.border, backgroundColor: c.page,
        fontFamily: fonts.body, fontSize: compact ? 11.5 : 13, color: c.text, textAlign: 'center',
      }}
    />
  );
}

// Timed rows first, earliest first; untimed rows keep their order after them.
export const sortByTime = (rows: SheetRow[]) => {
  const timed = rows.filter((r) => r.time).sort((a, b) => a.time.localeCompare(b.time));
  return [...timed, ...rows.filter((r) => !r.time)];
};

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

export function buildWeeklySheetHtml(review: Review, days: Days, weekEnding: string, ownerName: string, layout: SheetRow[], times: Times = {}): string {
  const sheetRows = layout.filter((r) => r.on_sheet);
  const head = SHEET_HEADER.map((h) => `<tr><th>${esc(h.label)}</th><td>${br(headerValue(review, h.id))}</td></tr>`).join('');
  const dayHead = DAYS.map((d) => `<th>${d}</th>`).join('');
  const rows = sheetRows.map((r) => `<tr>${DAYS.map((_, i) =>
    `<td><div class="lbl">${esc(rowTitle({ ...r, time: times?.[String(i)]?.[r.key] || r.time }))}</div>${br(days?.[String(i)]?.[r.key])}</td>`).join('')}</tr>`).join('');
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

export async function printWeeklySheet(review: Review, days: Days, weekEnding: string, ownerName: string, layout: SheetRow[], times: Times = {}) {
  const html = buildWeeklySheetHtml(review, days, weekEnding, ownerName, layout, times);
  try {
    await Print.printAsync({ html });
  } catch {
    toast.error('Could not print', 'Please try again.');
  }
}

export default function WeeklySheet({ review, days, times, canEdit, layout, onSaveLayout, onReview, onDay, onTime, onPrint }: {
  review: Review;
  days: Days;
  times: Times;
  onTime: (day: number, key: string, v: string) => void;
  canEdit: boolean;
  layout: SheetRow[];
  onSaveLayout: (rows: SheetRow[]) => Promise<void>;
  onReview: (patch: Review) => void;
  onDay: (day: number, key: string, v: string) => void;
  onPrint: () => void;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [editing, setEditing] = useState(false);
  const sheetRows = layout.filter((r) => r.on_sheet);
  return (
    <View>
      <View style={s.topRow}>
        <Text style={s.hint}>Your weekly sheet. Each box is the same box as on the day pages.</Text>
        <TouchableOpacity onPress={() => setEditing(true)} style={s.printBtn} accessibilityRole="button" testID="weekly-sheet-rows">
          <Ionicons name="reorder-four-outline" size={15} color={c.primary} />
          <Text style={s.printTxt}>Edit rows</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onPrint} style={s.printBtn} accessibilityRole="button" testID="weekly-sheet-print">
          <Ionicons name="print-outline" size={15} color={c.primary} />
          <Text style={s.printTxt}>Print</Text>
        </TouchableOpacity>
      </View>
      {editing && (
        <RowEditor layout={layout} onClose={() => setEditing(false)} onSave={onSaveLayout} />
      )}

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
          {sheetRows.map((r) => (
            <View key={r.key} style={s.gridRow}>
              {DAYS.map((d, i) => (
                <View key={d} style={[s.cell, s.col]}>
                  <View style={s.cellHead}>
                    <Text style={[s.cellLabel, { flex: 1 }]} numberOfLines={1}>{r.label}</Text>
                    {canEdit ? (
                      <DayTimeInput compact value={times?.[String(i)]?.[r.key] || ''} onChange={(v) => onTime(i, r.key, v)} label={`${d} ${r.label}`} />
                    ) : (times?.[String(i)]?.[r.key] || r.time) ? (
                      <Text style={s.cellLabel}>{times?.[String(i)]?.[r.key] || r.time}</Text>
                    ) : null}
                  </View>
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

// Edit rows: order (up/down or sort by time), name, time, on the sheet or not.
function RowEditor({ layout, onClose, onSave }: {
  layout: SheetRow[];
  onClose: () => void;
  onSave: (rows: SheetRow[]) => Promise<void>;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<SheetRow[]>(() => layout.map((r) => ({ ...r })));
  const [saving, setSaving] = useState(false);
  const badTime = rows.some((r) => r.time && !TIME_RE.test(r.time));

  const set = (i: number, patch: Partial<SheetRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) => setRows((rs) => {
    const j = i + by;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const save = async () => {
    if (badTime) return;
    setSaving(true);
    try {
      await onSave(rows);
      onClose();
    } catch {
      toast.error('Could not save your rows', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[s.edRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={s.edHead}>
          <Text style={s.edTitle}>Your rows</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={s.edCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.hint}>
          Just for you. Set the order, the names and a usual time for each row (24-hour, like 10:30, or blank), and switch rows off the weekly sheet (Sheet) or the day pages (Day). To give a box a time on one day only, use the clock box on that day.
        </Text>
        <View style={s.edActions}>
          <TouchableOpacity onPress={() => setRows(sortByTime)} style={s.printBtn} accessibilityRole="button">
            <Ionicons name="time-outline" size={15} color={c.primary} />
            <Text style={s.printTxt}>Sort by time</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {rows.map((r, i) => {
            const timeBad = !!r.time && !TIME_RE.test(r.time);
            return (
              <View key={r.key} style={s.edRow}>
                <View style={s.edMove}>
                  <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} accessibilityLabel={`Move ${r.label} up`}>
                    <Ionicons name="chevron-up" size={20} color={i === 0 ? c.border : c.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => move(i, 1)} disabled={i === rows.length - 1} hitSlop={6} accessibilityLabel={`Move ${r.label} down`}>
                    <Ionicons name="chevron-down" size={20} color={i === rows.length - 1 ? c.border : c.primary} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  value={r.time}
                  onChangeText={(v) => set(i, { time: v.replace(/[^0-9:]/g, '').slice(0, 5) })}
                  placeholder="--:--"
                  placeholderTextColor={c.textMuted}
                  style={[s.edTime, timeBad && { borderColor: c.red }]}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel={`${r.label} time`}
                />
                <TextInput
                  value={r.label}
                  onChangeText={(v) => set(i, { label: v.slice(0, 40) })}
                  style={s.edLabel}
                  accessibilityLabel="Row name"
                />
                <View style={s.edSheet}>
                  <Text style={s.edSheetTxt}>Sheet</Text>
                  <Switch value={r.on_sheet} onValueChange={(v) => set(i, { on_sheet: v })} accessibilityLabel={`Show ${r.label} on the weekly sheet`} />
                </View>
                <View style={s.edSheet}>
                  <Text style={s.edSheetTxt}>Day</Text>
                  <Switch value={r.on_day !== false} onValueChange={(v) => set(i, { on_day: v })} accessibilityLabel={`Show ${r.label} on the day pages`} />
                </View>
              </View>
            );
          })}
        </ScrollView>
        {badTime ? <Text style={[s.hint, { color: c.red }]}>Times need to look like 09:30 or 13:30.</Text> : null}
        <Pressable onPress={save} disabled={saving || badTime} style={[s.edSave, (saving || badTime) && { opacity: 0.5 }]} accessibilityRole="button">
          {saving ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.edSaveTxt}>Save rows</Text>}
        </Pressable>
      </View>
    </Modal>
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
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cellLabel: { fontFamily: fonts.bodySemibold, fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: c.textMuted },
  edRoot: { flex: 1, backgroundColor: c.page, paddingHorizontal: 16 },
  edHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  edTitle: { fontFamily: fonts.display, fontSize: 20, color: c.text },
  edCancel: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  edActions: { flexDirection: 'row', gap: 8, marginVertical: 10 },
  edRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  edMove: { alignItems: 'center' },
  edTime: { width: 64, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, fontFamily: fonts.body, fontSize: 14, color: c.text, backgroundColor: c.background, textAlign: 'center' },
  edLabel: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.body, fontSize: 14, color: c.text, backgroundColor: c.background },
  edSheet: { alignItems: 'center' },
  edSheetTxt: { fontFamily: fonts.body, fontSize: 10, color: c.textMuted },
  edSave: { marginTop: 10, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: c.primary },
  edSaveTxt: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  cellInput: { flex: 1, minHeight: 56, fontFamily: fonts.body, fontSize: 13, color: c.text, paddingTop: 2, textAlignVertical: 'top' },
});
