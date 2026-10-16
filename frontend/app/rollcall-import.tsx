/** Import roll call — fill Bells gaps from the office's old roll call
 *  spreadsheet (.xlsx, one tab per week, "WE 2792026"). Pick the file, choose
 *  how far back, preview who matched and how many days each week would fill,
 *  then import. The app wins: only days nobody has filled in are written.
 *  The sheet's colours: black No show, grey Not scheduled, yellow In office,
 *  red not a current BA (left alone); a number (0 too) is a day in the field. */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { APP_LOCALE } from '../src/utils/appTime';

type WeekPlan = { week_ending: string; rows: number; days: number; new_rows: number; people: { name: string; days: number }[] };
type Plan = {
  from_week: string; to_week: string; weeks_found: string[];
  weeks: WeekPlan[];
  matched: { sheet_name: string; app_name: string; how: string }[];
  unmatched: { sheet_name: string; why: string }[];
  total_days: number;
  applied?: { days_filled: number; rows_updated: number; rows_created: number };
};

const RANGES = [
  { key: 12, label: 'Last 12 weeks' },
  { key: 26, label: 'Last 6 months' },
  { key: 52, label: 'Last year' },
] as const;

/** The Sunday `weeks` weeks before last week, as YYYY-MM-DD. */
function fromWeek(weeks: number): string {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;            // 0 = Monday
  const lastSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow - 1);
  const d = new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate() - 7 * (weeks - 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "w/e 27 Sep" for a YYYY-MM-DD Sunday. */
function weLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return 'w/e ' + d.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function errText(e: any, fallback: string): string {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
}

export default function RollcallImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [file, setFile] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [range, setRange] = useState<number>(12);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Plan['applied'] | null>(null);

  const pick = async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
      multiple: false, copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const a: any = res.assets[0];
    setFile(Platform.OS === 'web' && a.file ? a.file : { uri: a.uri, name: a.name, type: a.mimeType });
    setFileName(a.name || 'roll call.xlsx');
    setPlan(null); setDone(null);
  };

  const run = async (apply: boolean) => {
    if (!file) return;
    setBusy(apply ? 'import' : 'preview'); setError(null);
    try {
      const res = await apiService.importRollcall(file, { from_week: fromWeek(range), apply });
      const data = res.data as Plan;
      if (apply) {
        setDone(data.applied || null);
        setPlan(null);
        qc.invalidateQueries({ queryKey: ['bells'] });
      } else {
        setPlan(data);
      }
    } catch (e: any) {
      setError(errText(e, apply ? "Couldn't import. Nothing was saved. Try again." : "Couldn't read that file. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const card = [styles.card, { backgroundColor: colors.background, borderColor: colors.border }];
  const muted = { color: colors.textMuted };
  const text = { color: colors.text };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
      <View style={card}>
        <Text style={[styles.title, text]}>Import your roll call</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Fills the gaps in Bells from your roll call spreadsheet. Anything already in the app stays as it is:
          only days nobody has filled in are written. In the sheet, a number (0 too) is a day in the field,
          black is No show, grey is Not scheduled, yellow is In office, and red rows are left alone.
        </Text>
      </View>

      <View style={card}>
        <Text style={[styles.h2, text]}>1. The file</Text>
        <Text style={[styles.small, muted]}>In Google Sheets: File → Download → Microsoft Excel (.xlsx).</Text>
        <Pressable onPress={pick} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button" testID="rollcall-pick">
          <Ionicons name="document-attach-outline" size={17} color={colors.onPrimary} />
          <Text style={[styles.btnText, { color: colors.onPrimary }]}>{file ? 'Choose a different file' : 'Choose the .xlsx file'}</Text>
        </Pressable>
        {fileName ? <Text style={[styles.small, text]} numberOfLines={1}>{fileName}</Text> : null}

        <Text style={[styles.h2, text, { marginTop: 10 }]}>2. How far back</Text>
        <View style={styles.chips}>
          {RANGES.map((r) => {
            const on = range === r.key;
            return (
              <Pressable key={r.key} onPress={() => { setRange(r.key); setPlan(null); }}
                style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}
                accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.text }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.small, muted]}>From {weLabel(fromWeek(range))} up to last week. This week is left to the app.</Text>

        <Pressable onPress={() => run(false)} disabled={!file || !!busy}
          style={[styles.btn, { borderWidth: 1, borderColor: colors.primary, opacity: !file || busy ? 0.5 : 1 }]}
          accessibilityRole="button" testID="rollcall-preview">
          {busy === 'preview' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="eye-outline" size={17} color={colors.primary} />}
          <Text style={[styles.btnText, { color: colors.primary }]}>{busy === 'preview' ? 'Reading the sheet… (up to a minute)' : '3. Preview'}</Text>
        </Pressable>
      </View>

      {error ? <View style={[card, { borderColor: colors.red }]}><Text style={[styles.body, { color: colors.red }]}>{error}</Text></View> : null}

      {done ? (
        <View style={[card, { borderColor: colors.green }]}>
          <Text style={[styles.h2, text]}>Imported</Text>
          <Text style={[styles.body, text]}>
            {done.days_filled} day{done.days_filled === 1 ? '' : 's'} filled in Bells
            ({done.rows_updated} existing week row{done.rows_updated === 1 ? '' : 's'}, {done.rows_created} new).
          </Text>
          <Text style={[styles.small, muted]}>Running it again only fills days that are still empty.</Text>
        </View>
      ) : null}

      {plan ? (
        <>
          <View style={card}>
            <Text style={[styles.h2, text]}>Preview: nothing saved yet</Text>
            <Text style={[styles.body, text]}>
              {plan.total_days} empty day{plan.total_days === 1 ? '' : 's'} would be filled across {plan.weeks_found.length} week{plan.weeks_found.length === 1 ? '' : 's'}.
            </Text>
            {plan.weeks.map((w) => (
              <View key={w.week_ending} style={[styles.row, { borderColor: colors.border }]}>
                <Text style={[styles.name, text, { flex: 1 }]}>{weLabel(w.week_ending)}</Text>
                <Text style={[styles.small, w.days ? text : muted]}>
                  {w.days ? `${w.days} day${w.days === 1 ? '' : 's'} · ${w.rows} people${w.new_rows ? ` (${w.new_rows} new row${w.new_rows === 1 ? '' : 's'})` : ''}` : 'nothing to fill'}
                </Text>
              </View>
            ))}
          </View>

          <View style={card}>
            <Text style={[styles.h2, text]}>Names matched ({plan.matched.length})</Text>
            {plan.matched.map((m) => (
              <View key={m.sheet_name} style={[styles.row, { borderColor: colors.border }]}>
                <Text style={[styles.small, text, { flex: 1 }]}>{m.sheet_name}</Text>
                <Ionicons name="arrow-forward" size={13} color={colors.textMuted} />
                <Text style={[styles.small, text, { flex: 1.4 }]}>{m.app_name}</Text>
              </View>
            ))}
            {plan.unmatched.length ? (
              <>
                <Text style={[styles.h2, { color: colors.red, marginTop: 8 }]}>Not matched, skipped ({plan.unmatched.length})</Text>
                {plan.unmatched.map((u) => (
                  <View key={u.sheet_name} style={[styles.row, { borderColor: colors.border }]}>
                    <Text style={[styles.small, text, { flex: 1 }]}>{u.sheet_name}</Text>
                    <Text style={[styles.small, muted]}>{u.why}</Text>
                  </View>
                ))}
                <Text style={[styles.small, muted]}>If one of these should be someone in the app, change their name in the sheet (or in the app) so the first names match, then preview again.</Text>
              </>
            ) : null}
          </View>

          <Pressable onPress={() => run(true)} disabled={!!busy || plan.total_days === 0}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: busy || plan.total_days === 0 ? 0.5 : 1 }]}
            accessibilityRole="button" testID="rollcall-import">
            {busy === 'import' ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="cloud-upload-outline" size={17} color={colors.onPrimary} />}
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>
              {busy === 'import' ? 'Importing…' : `Import ${plan.total_days} day${plan.total_days === 1 ? '' : 's'} into Bells`}
            </Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 20 },
  h2: { fontFamily: fonts.bodyBold, fontSize: 16 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontFamily: fonts.bodySemibold, fontSize: 14.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, marginTop: 6 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15 },
});
