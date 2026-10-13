// Quality: Acwyre's weekly quality report (Power BI), per BA, against the
// Owner's targets: £13+ order value, 2.5+ drop days, fails under 10%, 75%+
// taking The Round and 75%+ reaching their 4th week.
//   • The Owner (Admin) drops in a screenshot of the report page (or Excel
//     exports), checks who each row is, and saves the week.
//   • A BA sees their own numbers; a Coach their team; Admins and Coach+ the
//     whole office. For a week, 4 weeks, a month, 13 weeks or all time (the
//     running average), with week by week underneath.
// (backend routes/quality.py)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { apiService } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { toast } from '../src/utils/toast';
import { showAlert } from '../src/utils/showAlert';
import { formatMoney } from '../src/utils/appTime';
import { useTabBarClearance } from '../src/customization/CustomTabBar';

type Measure = { key: string; label: string; target?: string };
type Cell = { value: number | null; rag: 'green' | 'amber' | 'red' | null };

const fmt = (key: string, v: number | null | undefined) => {
  if (v == null) return '–';
  if (key === 'aov') return formatMoney(v, 2);
  if (key === 'sales') return String(v);
  if (key === 'drops') return v.toFixed(2);
  return `${Math.round(v * 10) / 10}%`;
};
// For fails, down is good.
const better = (key: string, now?: number | null, before?: number | null) =>
  now == null || before == null || now === before ? 0 : (key === 'fail_rate' ? (now < before ? 1 : -1) : (now > before ? 1 : -1));

const ukDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const isoFromUk = (t: string) => {
  const m = t.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

export default function QualityScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' && !(user as any)?.is_demo;
  const [view, setView] = useState('week');
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['quality', view, week || '', month || ''],
    queryFn: () => apiService.getQuality({ view, week, month }).then((r) => r.data),
    placeholderData: (prev: any) => prev,
  });
  const d = q.data;
  const measures: Measure[] = d?.measures || [];
  const multi = (d?.period_weeks || 1) > 1;
  const tone = (rag: Cell['rag']) =>
    rag === 'green' ? { bg: c.greenBg, fg: c.green } : rag === 'amber' ? { bg: c.yellowBg, fg: c.yellow } : rag === 'red' ? { bg: c.redBg, fg: c.red } : { bg: c.surface, fg: c.textMuted };

  // One line of the table: a name (or week) and a coloured pill per measure.
  const line = (key: string, label: string, metrics: Record<string, Cell>, opts: { bold?: boolean; sub?: boolean; onPress?: () => void; chevron?: boolean; isOpen?: boolean } = {}) => (
    <Pressable key={key} onPress={opts.onPress} disabled={!opts.onPress} style={[s.tr, opts.sub && s.subRow, opts.bold && s.totalRow]}>
      <View style={[s.nameCol, s.nameWrap]}>
        {opts.chevron ? <Ionicons name={opts.isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color={c.textMuted} /> : null}
        <Text style={[opts.sub ? s.subName : s.name, opts.bold && { fontFamily: fonts.bodyBold }]} numberOfLines={1}>{label}</Text>
      </View>
      {measures.map((m) => {
        const cell = metrics?.[m.key];
        const t = tone(cell?.rag ?? null);
        return (
          <View key={m.key} style={s.col}>
            <Text style={[s.pill, opts.bold && s.pillBold, opts.sub && s.pillSub, { backgroundColor: t.bg, color: t.fg }]}>{fmt(m.key, cell?.value)}</Text>
          </View>
        );
      })}
    </Pressable>
  );
  const header = (first: string) => (
    <View style={[s.tr, s.thRow]}>
      <Text style={[s.th, s.nameCol, { textAlign: 'left' }]}>{first}</Text>
      {measures.map((m) => (
        <View key={m.key} style={s.col}>
          <Text style={s.th}>{m.label}</Text>
          {m.target ? <Text style={s.thTarget}>{m.target}</Text> : null}
        </View>
      ))}
    </View>
  );
  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} style={[s.chip, on && { backgroundColor: c.primary, borderColor: c.primary }]}>
      <Text style={[s.chipText, on && { color: c.onPrimary }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={s.page} contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + clearance + 40 }]}>
      {isAdmin && <Upload onSaved={(w) => { setView('week'); setWeek(w); }} />}

      {q.isLoading ? <ActivityIndicator color={c.primary} style={{ marginTop: 30 }} /> : !d?.week_ending ? (
        <View style={s.card}>
          <Text style={s.h}>No quality report yet</Text>
          <Text style={s.muted}>{isAdmin ? 'Add this week’s screenshot above and everyone’s numbers will appear here.' : 'Your quality numbers will appear here once the Owner adds the weekly report.'}</Text>
        </View>
      ) : (
        <>
          <View style={s.views}>
            {(d.views || []).map((v: any) => chip(v.key, v.label, v.key === d.view, () => { setView(v.key); setOpen(null); }))}
          </View>
          {d.view === 'month' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.weeks}>
              {(d.months || []).map((m: any) => chip(m.month, m.label, m.month === d.month, () => setMonth(m.month)))}
            </ScrollView>
          ) : d.view !== 'all' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.weeks}>
              {(d.weeks || []).map((w: any) => chip(w.week_ending, d.view === 'week' ? w.label : `To ${w.label}`, w.week_ending === d.week_ending, () => setWeek(w.week_ending)))}
            </ScrollView>
          ) : null}

          {d.me && (
            <View style={s.card} testID="quality-me">
              <Text style={s.h}>Your quality · {d.label}</Text>
              {multi && <Text style={s.note}>Your average over {d.me.weeks} week{d.me.weeks === 1 ? '' : 's'} on the report (sales added up).</Text>}
              <View style={s.tiles}>
                {measures.map((m) => {
                  const cell: Cell | undefined = d.me.metrics[m.key];
                  const t = tone(cell?.rag ?? null);
                  const dir = better(m.key, cell?.value, d.me.prev?.[m.key]);
                  return (
                    <View key={m.key} style={[s.tile, { backgroundColor: t.bg }]}>
                      <Text style={s.tileLabel}>{m.label}</Text>
                      <View style={s.tileRow}>
                        <Text style={[s.tileValue, { color: t.fg }]}>{fmt(m.key, cell?.value)}</Text>
                        {dir !== 0 && <Ionicons name={dir > 0 ? 'arrow-up' : 'arrow-down'} size={14} color={dir > 0 ? c.green : c.red} />}
                      </View>
                      <Text style={s.tileTarget}>{m.target ? `Target ${m.target}` : ' '}</Text>
                    </View>
                  );
                })}
              </View>
              {d.view !== 'all' && <Text style={s.note}>Arrows compare with the {d.view === 'week' ? 'week' : d.view === 'month' ? 'month' : 'period'} before.</Text>}
              {d.me.metrics.fourth_week == null && <Text style={s.note}>4th week shows once those customers reach their 4th delivery.</Text>}
              {multi && d.me.history?.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  <View>
                    {header('Week by week')}
                    {d.me.history.map((h: any) => line(h.week_ending, h.label.replace(/ \d{4}$/, ''), h.metrics, { sub: true }))}
                  </View>
                </ScrollView>
              )}
            </View>
          )}

          {(d.team?.length > 0 || d.total) && (
            <View style={s.card} testID="quality-team">
              <Text style={s.h}>{d.total ? 'The office' : 'Your team'} · {d.label}</Text>
              {multi && <Text style={s.note}>Averages for the period. Tap a name to see their week by week.</Text>}
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View>
                  {header('BA')}
                  {(d.team || []).map((r: any) => {
                    const key = r.user_id || r.badge;
                    const isOpen = open === key;
                    return (
                      <View key={key}>
                        {line(key, `${r.name}${r.linked ? '' : ' ⚠︎'}`, r.metrics, multi ? { chevron: true, isOpen, onPress: () => setOpen(isOpen ? null : key) } : {})}
                        {isOpen && (r.history || []).map((h: any) => line(`${key}-${h.week_ending}`, h.label.replace(/ \d{4}$/, ''), h.metrics, { sub: true }))}
                      </View>
                    );
                  })}
                  {d.total && (
                    <View>
                      {line('office', 'Office', d.total, { bold: true, ...(multi ? { chevron: true, isOpen: open === 'office', onPress: () => setOpen(open === 'office' ? null : 'office') } : {}) })}
                      {open === 'office' && (d.total_history || []).map((h: any) => line(`office-${h.week_ending}`, h.label.replace(/ \d{4}$/, ''), h.metrics, { sub: true }))}
                    </View>
                  )}
                </View>
              </ScrollView>
              {(d.team || []).some((r: any) => !r.linked) && <Text style={s.note}>⚠︎ not linked to anyone in the app yet. Link them next time you add a report.</Text>}
            </View>
          )}
          {!d.me && !d.team?.length && !d.total && (
            <View style={s.card}><Text style={s.muted}>You're not on the report for {d.label}.</Text></View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── Admin: add a week's report ────────────────────────────────────────────
type Picked = { name: string; b64: string };

function Upload({ onSaved }: { onSaved: (week: string) => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [weekText, setWeekText] = useState('');
  const [links, setLinks] = useState<Record<string, string | null>>({});
  const [choosing, setChoosing] = useState<string | null>(null);

  const toB64 = (blob: Blob) => new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result || '').split(',')[1] || '');
    r.readAsDataURL(blob);
  });
  const read = async (files: { name: string; blob: Blob }[]) => {
    if (!files.length) return;
    setBusy('read');
    try {
      const picked: Picked[] = [];
      for (const f of files.slice(0, 6)) picked.push({ name: f.name, b64: await toB64(f.blob) });
      const r = await apiService.readQuality({ files: picked.map((p) => ({ filename: p.name, data_b64: p.b64 })) });
      setPreview(r.data);
      setWeekText(r.data.week_ending ? ukDate(r.data.week_ending) : '');
      setLinks(Object.fromEntries((r.data.rows || []).map((row: any) => [row.badge, row.user_id || null])));
      if (!(r.data.rows || []).length) showAlert('Nothing to read', 'No BA rows found. Try a screenshot that shows the tables with names down the left.');
    } catch (e: any) {
      showAlert('Could not read that', e?.response?.data?.detail || e?.message || 'Try again.');
    } finally { setBusy(null); }
  };
  const readRef = useRef(read);
  readRef.current = read;

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    const files = await Promise.all(res.assets.map(async (a) => ({ name: a.name || 'report.png', blob: await (await fetch(a.uri)).blob() })));
    read(files);
  };

  // Drop or paste (a screenshot straight from the clipboard works too).
  const drop = useRef<View>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = drop.current as unknown as HTMLElement | null;
    const take = (list?: FileList | null) => {
      const files = Array.from(list || []).map((f) => ({ name: f.name || 'screenshot.png', blob: f as Blob }));
      if (files.length) readRef.current(files);
      return files.length > 0;
    };
    const onOver = (e: DragEvent) => { e.preventDefault(); setOver(true); };
    const onLeave = () => setOver(false);
    const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files); };
    const onPaste = (e: ClipboardEvent) => { if (take(e.clipboardData?.files)) e.preventDefault(); };
    const stopPage = (e: DragEvent) => e.preventDefault();
    el?.addEventListener('dragover', onOver);
    el?.addEventListener('dragleave', onLeave);
    el?.addEventListener('drop', onDrop);
    window.addEventListener('dragover', stopPage);
    window.addEventListener('drop', stopPage);
    document.addEventListener('paste', onPaste);
    return () => {
      el?.removeEventListener('dragover', onOver);
      el?.removeEventListener('dragleave', onLeave);
      el?.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', stopPage);
      window.removeEventListener('drop', stopPage);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const save = async () => {
    const iso = isoFromUk(weekText);
    if (!iso) { showAlert('Week ending', 'Type the week ending as DD/MM/YYYY, e.g. 04/10/2026.'); return; }
    setBusy('save');
    try {
      const rows = (preview.rows || []).map((r: any) => ({ label: r.label, badge: r.badge, metrics: r.metrics, user_id: links[r.badge] || null }));
      const r = await apiService.importQuality({ week_ending: iso, rows, total: preview.total || {} });
      toast.success(`Saved ${r.data.rows} BAs for WE ${ukDate(iso)}`);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['quality'] });
      qc.invalidateQueries({ queryKey: ['coach-suggestions'] });
      onSaved(iso);
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally { setBusy(null); }
  };

  const people: { id: string; name: string }[] = preview?.people || [];
  const nameOf = (id?: string | null) => people.find((p) => p.id === id)?.name;
  const measures: { key: string; label: string }[] = preview?.measures || [];

  return (
    <View style={s.card} testID="quality-upload">
      <Text style={s.h}>Add this week's quality report</Text>
      {!preview ? (
        <>
          <Text style={s.muted}>Screenshot the Power BI page with everyone's rows showing, then drop it here or paste it (Ctrl/⌘ V). An Excel export works too.</Text>
          <View ref={drop} style={[s.drop, over && { borderColor: c.primary, backgroundColor: c.surface }]}>
            {busy === 'read' ? (
              <>
                <ActivityIndicator color={c.primary} />
                <Text style={s.muted}>Reading the numbers… (up to a minute)</Text>
              </>
            ) : (
              <>
                <Ionicons name="image-outline" size={26} color={c.primary} />
                <Text style={s.muted}>{over ? 'Drop it' : 'Drag the screenshot here, or paste it'}</Text>
                <Pressable onPress={pick} style={s.btn} accessibilityRole="button">
                  <Text style={s.btnText}>Choose screenshot</Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      ) : (
        <>
          <Text style={s.muted}>Check the numbers and who each row is, then save.{preview.existing ? ' This replaces the week already saved.' : ''}</Text>
          <View style={s.weekRow}>
            <Text style={s.label}>Week ending</Text>
            <TextInput value={weekText} onChangeText={setWeekText} placeholder="DD/MM/YYYY" placeholderTextColor={c.textMuted}
              style={s.input} inputMode="numeric" maxLength={10} />
          </View>
          {preview.fourth_week_due === false && <Text style={s.note}>4th week is 0% for everyone this week, so it's left blank until it's due.</Text>}
          {(preview.rows || []).map((r: any) => {
            const linked = links[r.badge];
            const bits = measures.filter((m) => r.metrics[m.key] != null).map((m) => `${m.label} ${fmt(m.key, r.metrics[m.key])}`);
            return (
              <View key={r.badge} style={s.prow}>
                <View style={s.prowHead}>
                  <Text style={s.name} numberOfLines={1}>{r.label}</Text>
                  <Pressable onPress={() => setChoosing(choosing === r.badge ? null : r.badge)} hitSlop={6}
                    style={[s.match, { backgroundColor: linked ? c.greenBg : c.yellowBg }]}>
                    <Text style={[s.matchText, { color: linked ? c.green : c.yellow }]} numberOfLines={1}>
                      {linked ? `→ ${nameOf(linked) || 'linked'}${r.matched_by === 'name' && linked === r.user_id ? ' (by name)' : ''}` : 'Link to…'}
                    </Text>
                  </Pressable>
                </View>
                <Text style={s.pline}>{bits.join(' · ') || 'No numbers read'}</Text>
                {choosing === r.badge && (
                  <View style={s.chooser}>
                    <Pressable onPress={() => { setLinks({ ...links, [r.badge]: null }); setChoosing(null); }} style={s.choice}>
                      <Text style={s.muted}>Not in the app</Text>
                    </Pressable>
                    {people.map((p) => (
                      <Pressable key={p.id} onPress={() => { setLinks({ ...links, [r.badge]: p.id }); setChoosing(null); }} style={s.choice}>
                        <Text style={[s.choiceText, p.id === linked && { color: c.primary }]}>{p.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <View style={s.actions}>
            <Pressable onPress={() => setPreview(null)} style={[s.btn, s.btnGhost]} accessibilityRole="button">
              <Text style={[s.btnText, { color: c.text }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={busy === 'save'} style={s.btn} accessibilityRole="button" testID="quality-save">
              {busy === 'save' ? <ActivityIndicator color={c.onPrimary} /> : <Text style={s.btnText}>Save week</Text>}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.surface },
  scroll: { padding: 16, gap: 12, maxWidth: 900, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 },
  h: { fontFamily: fonts.bodyBold, fontSize: 16, color: c.text },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  note: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.text },
  weeks: { gap: 8, paddingVertical: 2 },
  views: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 96, borderRadius: 12, padding: 10, gap: 2 },
  tileLabel: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.text },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tileValue: { fontFamily: fonts.bodyBold, fontSize: 20 },
  tileTarget: { fontFamily: fonts.body, fontSize: 11.5, color: c.textMuted },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: c.border },
  thRow: { borderTopWidth: 0, alignItems: 'flex-end' },
  totalRow: { borderTopWidth: 2, borderTopColor: c.borderDark },
  th: { fontFamily: fonts.bodyBold, fontSize: 12, color: c.text, textAlign: 'center' },
  thTarget: { fontFamily: fonts.body, fontSize: 11, color: c.textMuted, textAlign: 'center' },
  nameCol: { width: 130, paddingRight: 6, textAlign: 'left' },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  subRow: { borderTopWidth: 0, paddingVertical: 3 },
  subName: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted, paddingLeft: 16, flexShrink: 1 },
  pillSub: { fontSize: 12, paddingVertical: 2 },
  col: { width: 78, alignItems: 'center' },
  name: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text, flexShrink: 1 },
  pill: { fontFamily: fonts.bodySemibold, fontSize: 12.5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, overflow: 'hidden', textAlign: 'center', minWidth: 58 },
  pillBold: { fontFamily: fonts.bodyBold },
  drop: { alignItems: 'center', gap: 10, paddingVertical: 22, paddingHorizontal: 14, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: c.border },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: c.primary, minWidth: 110 },
  btnGhost: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.onPrimary },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.body, fontSize: 16, color: c.text, width: 140, backgroundColor: c.background },
  prow: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border },
  prowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  pline: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  match: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, maxWidth: '55%' },
  matchText: { fontFamily: fonts.bodySemibold, fontSize: 12.5 },
  chooser: { borderWidth: 1, borderColor: c.border, borderRadius: 10, maxHeight: 220, overflow: 'scroll' as any },
  choice: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  choiceText: { fontFamily: fonts.body, fontSize: 14, color: c.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 4 },
});
