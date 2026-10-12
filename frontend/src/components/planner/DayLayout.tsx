/**
 * Your day pages in the Planner: each person's own box order, names and
 * usual times (saved by /weekly-planners/sheet-layout), a time for one box on
 * one day (the clock box), and the Edit rows sheet. Nothing here changes the
 * office timetable; the office's weekly plan lives in Schedule → Agenda.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Pressable, Switch, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../theme/ThemeContext';
import { toast } from '../../utils/toast';

// One row of a person's layout: the day box it saves into, its name, an
// optional HH:MM usual time and whether it shows on the day pages.
export type SheetRow = { key: string; label: string; time: string; on_sheet: boolean; on_day?: boolean };

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


// Edit rows: order (up/down or sort by time), name, usual time, shown or not.
export function RowEditor({ layout, onClose, onSave }: {
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
          Just for you. Set the order, the names and a usual time for each box on your day pages (24-hour, like 10:30, or blank), and switch off any you don't use. To give a box a time on one day only, use the clock box on that day.
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
                  <Text style={s.edSheetTxt}>Show</Text>
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

const styles = (c: any) => StyleSheet.create({
  hint: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  printBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  printTxt: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
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
});
