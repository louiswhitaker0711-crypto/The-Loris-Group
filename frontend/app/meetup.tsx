/**
 * Meet-up planner (route: /meetup?id=…) — the Owner, 5 Nov 2026. Sent from
 * Admin → Meet-ups to the people going; on their Home from a week before.
 * Their numbers on hand, goals for the trip, the agenda (add your own
 * sessions, mark the ones you're going to), who to meet, questions, what to
 * work on, people met, notes (filed under Notes → Meet-ups) and "bring it
 * back" once the last day comes. Saves as you type.
 * (GET/PUT /meetups/{id}/me; the Owner reads it via GET /meetups/{id}/plans)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { newId, fmtDay, daysBetween } from '../src/utils/meetups';
import { onLeave } from '../src/utils/draftBackup';

type Item = { id: string; text: string; done?: boolean };
type Session = { id: string; day: string; time: string; title: string };
type Contact = { id: string; name: string; where: string; phone: string; notes: string; followed_up: boolean };
type NoteT = { id: string; title: string; body: string };
type Plan = {
  goals: Item[]; sessions: Session[]; picks: string[]; meet: Item[]; questions: Item[]; work_on: Item[];
  contacts: Contact[]; notes: NoteT[]; debrief: { takeaways: string[]; primetime: string; done: boolean };
};

export default function MeetupScreen() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tabClear = useTabBarClearance();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['meetup-me', id], enabled: !!id, queryFn: async () => (await api.get(`/meetups/${id}/me`)).data });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(false);
  const timer = useRef<any>(null);
  const latest = useRef<Plan | null>(null);
  latest.current = plan;

  useEffect(() => { if (q.data?.plan && !plan) setPlan(q.data.plan); }, [q.data]);

  const save = async () => {
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    setState('saving');
    try {
      await api.put(`/meetups/${id}/me`, latest.current);
      setState('saved');
      qc.invalidateQueries({ queryKey: ['meetups-mine'] });
      qc.invalidateQueries({ queryKey: ['notes-folder'] });
    } catch { dirty.current = true; setState('error'); }
  };
  const update = (fn: (p: Plan) => Plan) => {
    setPlan((p) => (p ? fn(p) : p));
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };
  useEffect(() => onLeave(() => { if (timer.current) clearTimeout(timer.current); save(); }), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); save(); }, []);

  if (q.isLoading || !plan) {
    return <View style={s.page}><Stack.Screen options={{ title: 'Meet-up' }} />
      {q.isError ? <Text style={[s.small, { textAlign: 'center', marginTop: 40 }]}>This meet-up isn’t available.</Text>
        : <ActivityIndicator color={c.primary} style={{ marginTop: 40 }} />}</View>;
  }
  const m = q.data.meetup;
  const n = q.data.numbers || {};
  const toGo = Math.round((new Date(`${m.start_date}T12:00:00Z`).getTime() - new Date(`${q.data.today}T12:00:00Z`).getTime()) / 86400000);
  const dates = daysBetween(m.start_date, m.end_date);
  const agenda: (Session & { own: boolean })[] = [
    ...(m.agenda || []).map((a: Session) => ({ ...a, own: false })),
    ...plan.sessions.map((a) => ({ ...a, own: true })),
  ].sort((a, b) => (a.day || '9').localeCompare(b.day || '9') || (a.time || '99').localeCompare(b.time || '99'));
  const statusText = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved yet, trying again when you type' : '';

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: m.name }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 40 + tabClear }]} keyboardShouldPersistTaps="handled">
        <View style={s.shell}>
          <View style={s.hero}>
            <Text style={s.heroK}>{fmtDay(m.start_date)}{m.end_date !== m.start_date ? ` – ${fmtDay(m.end_date)}` : ''}{m.place ? ` · ${m.place}` : ''}</Text>
            <Text style={s.heroT}>{m.name}</Text>
            <Text style={s.heroSub}>{toGo > 1 ? `${toGo} days to go` : toGo === 1 ? 'Tomorrow' : toGo === 0 ? 'Today' : q.data.debrief_open ? 'Bring it back: fill in what you learnt' : 'On now'}</Text>
            {!!statusText && <Text style={s.heroSave}>{statusText}</Text>}
          </View>

          <Section icon="stats-chart-outline" title="My numbers on hand" s={s} c={c}>
            <View style={s.grid}>
              <Stat label="Sign-ups, last 4 weeks" value={(n.weeks || []).map((w: any) => w.sign_ups).join(' · ') || '–'} s={s} />
              <Stat label="Gold · The Round" value={`${n.gold_pct ?? '–'}% · ${n.round_pct ?? '–'}%`} s={s} />
              <Stat label="Piece average" value={n.piece_average != null ? String(n.piece_average) : '–'} s={s} />
              <Stat label="A day: doors · spoken · pitched · closed" value={n.avg_per_day ? `${n.avg_per_day.doors_knocked ?? '–'} · ${n.avg_per_day.spoken_to ?? '–'} · ${n.avg_per_day.pitches_commenced ?? '–'} · ${n.avg_per_day.pitches_closed ?? '–'}` : '–'} s={s} />
            </View>
            {!!n.gap && <Text style={s.gap}><Ionicons name="locate-outline" size={14} color={c.text} />  Biggest gap: {n.gap.label}{n.gap.why ? ` (${n.gap.why})` : ''}</Text>}
            {!!n.cod_focus && <Text style={s.small}>This week’s COD focus: {n.cod_focus}</Text>}
            <Text style={s.small}>Aim your questions at what would move these.</Text>
          </Section>

          <Section icon="flag-outline" title="Goals for the trip" s={s} c={c}>
            <ItemList items={plan.goals} tick placeholder="What do you want to come back with?" s={s} c={c}
              onChange={(goals) => update((p) => ({ ...p, goals }))} />
          </Section>

          <Section icon="calendar-outline" title="Agenda" s={s} c={c}>
            {agenda.length === 0 && <Text style={s.small}>Add the sessions as you find out about them.</Text>}
            {agenda.map((a) => {
              const going = plan.picks.includes(a.id);
              return (
                <View key={a.id} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowT}>{a.title}</Text>
                    <Text style={s.small}>{[a.day && fmtDay(a.day), a.time].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Pressable onPress={() => update((p) => ({ ...p, picks: going ? p.picks.filter((x) => x !== a.id) : [...p.picks, a.id] }))}
                    style={[s.chip, going && s.chipOn]} accessibilityRole="button">
                    <Text style={[s.chipT, going && s.chipTOn]}>{going ? 'Going' : 'Go?'}</Text>
                  </Pressable>
                  {a.own && <Pressable hitSlop={8} onPress={() => update((p) => ({ ...p, sessions: p.sessions.filter((x) => x.id !== a.id), picks: p.picks.filter((x) => x !== a.id) }))} accessibilityLabel="Remove session">
                    <Ionicons name="close" size={18} color={c.textMuted} />
                  </Pressable>}
                </View>
              );
            })}
            <AddSession dates={dates} s={s} c={c} onAdd={(ses) => update((p) => ({ ...p, sessions: [...p.sessions, ses], picks: [...p.picks, ses.id] }))} />
          </Section>

          <Section icon="people-outline" title="Who I want to meet" s={s} c={c}>
            <ItemList items={plan.meet} placeholder="A person, an office, someone who’s done what you want to do" s={s} c={c} onChange={(meet) => update((p) => ({ ...p, meet }))} />
          </Section>
          <Section icon="help-circle-outline" title="Questions I have" s={s} c={c}>
            <ItemList items={plan.questions} placeholder="What do you want to ask?" s={s} c={c} onChange={(questions) => update((p) => ({ ...p, questions }))} />
          </Section>
          <Section icon="barbell-outline" title="Things I want to work on" s={s} c={c}>
            <ItemList items={plan.work_on} placeholder="A skill or a number you want to move" s={s} c={c} onChange={(work_on) => update((p) => ({ ...p, work_on }))} />
          </Section>

          <Section icon="id-card-outline" title="People I met" s={s} c={c}>
            {plan.contacts.map((ct) => (
              <View key={ct.id} style={s.contact}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput value={ct.name} onChangeText={(v) => update((p) => ({ ...p, contacts: p.contacts.map((x) => x.id === ct.id ? { ...x, name: v } : x) }))} placeholder="Name" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} />
                  <Pressable hitSlop={8} onPress={() => update((p) => ({ ...p, contacts: p.contacts.filter((x) => x.id !== ct.id) }))} accessibilityLabel="Remove contact" style={{ justifyContent: 'center' }}>
                    <Ionicons name="trash-outline" size={18} color={c.textMuted} />
                  </Pressable>
                </View>
                <TextInput value={ct.where} onChangeText={(v) => update((p) => ({ ...p, contacts: p.contacts.map((x) => x.id === ct.id ? { ...x, where: v } : x) }))} placeholder="Where they’re from" placeholderTextColor={c.textMuted} style={s.input} />
                <TextInput value={ct.phone} onChangeText={(v) => update((p) => ({ ...p, contacts: p.contacts.map((x) => x.id === ct.id ? { ...x, phone: v } : x) }))} placeholder="Number" keyboardType="phone-pad" placeholderTextColor={c.textMuted} style={s.input} />
                <TextInput value={ct.notes} onChangeText={(v) => update((p) => ({ ...p, contacts: p.contacts.map((x) => x.id === ct.id ? { ...x, notes: v } : x) }))} placeholder="What you talked about, what to send them" placeholderTextColor={c.textMuted} style={[s.input, { minHeight: 60 }]} multiline textAlignVertical="top" />
                <Pressable onPress={() => update((p) => ({ ...p, contacts: p.contacts.map((x) => x.id === ct.id ? { ...x, followed_up: !x.followed_up } : x) }))} style={s.tickRow} accessibilityRole="checkbox" accessibilityState={{ checked: ct.followed_up }}>
                  <Ionicons name={ct.followed_up ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={ct.followed_up ? c.green : c.textMuted} />
                  <Text style={s.small}>Followed up</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => update((p) => ({ ...p, contacts: [...p.contacts, { id: newId(), name: '', where: '', phone: '', notes: '', followed_up: false }] }))} style={s.addBtn} accessibilityRole="button">
              <Ionicons name="add" size={18} color={c.primary} /><Text style={s.addT}>Add someone</Text>
            </Pressable>
          </Section>

          <Section icon="document-text-outline" title="Notes" s={s} c={c}>
            <Text style={s.small}>These also file in Notes → Meet-ups → {m.name}.</Text>
            {plan.notes.map((nt) => (
              <View key={nt.id} style={s.contact}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput value={nt.title} onChangeText={(v) => update((p) => ({ ...p, notes: p.notes.map((x) => x.id === nt.id ? { ...x, title: v } : x) }))} placeholder="Title (a session, a person)" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} />
                  <Pressable hitSlop={8} onPress={() => update((p) => ({ ...p, notes: p.notes.filter((x) => x.id !== nt.id) }))} accessibilityLabel="Remove note" style={{ justifyContent: 'center' }}>
                    <Ionicons name="trash-outline" size={18} color={c.textMuted} />
                  </Pressable>
                </View>
                <TextInput value={nt.body} onChangeText={(v) => update((p) => ({ ...p, notes: p.notes.map((x) => x.id === nt.id ? { ...x, body: v } : x) }))} placeholder="Write it down…" placeholderTextColor={c.textMuted} style={[s.input, { minHeight: 120 }]} multiline textAlignVertical="top" />
              </View>
            ))}
            <Pressable onPress={() => update((p) => ({ ...p, notes: [...p.notes, { id: newId(), title: '', body: '' }] }))} style={s.addBtn} accessibilityRole="button">
              <Ionicons name="add" size={18} color={c.primary} /><Text style={s.addT}>Add a note</Text>
            </Pressable>
          </Section>

          <Section icon="arrow-undo-outline" title="Bring it back" s={s} c={c}>
            {!q.data.debrief_open ? (
              <Text style={s.small}>Opens on {fmtDay(m.end_date, true)}: your top 3 takeaways and a Primetime topic you’ll run.</Text>
            ) : (
              <>
                {[0, 1, 2].map((i) => (
                  <TextInput key={i} value={plan.debrief.takeaways[i] || ''} placeholder={`Takeaway ${i + 1}`} placeholderTextColor={c.textMuted} style={s.input}
                    onChangeText={(v) => update((p) => { const t = [...p.debrief.takeaways]; t[i] = v; return { ...p, debrief: { ...p.debrief, takeaways: t } }; })} />
                ))}
                <TextInput value={plan.debrief.primetime} placeholder="A Primetime topic I’ll run" placeholderTextColor={c.textMuted} style={s.input}
                  onChangeText={(v) => update((p) => ({ ...p, debrief: { ...p.debrief, primetime: v } }))} />
                <Pressable onPress={() => update((p) => ({ ...p, debrief: { ...p.debrief, done: !p.debrief.done } }))} style={[s.done, plan.debrief.done && { backgroundColor: c.green }]} accessibilityRole="button">
                  <Text style={s.doneT}>{plan.debrief.done ? 'Done · it’s off your Home' : 'Mark done'}</Text>
                </Pressable>
              </>
            )}
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ icon, title, children, s, c }: { icon: any; title: string; children: React.ReactNode; s: any; c: any }) {
  return (
    <View style={s.card}>
      <View style={s.secHead}><Ionicons name={icon} size={18} color={c.primary} /><Text style={s.secT}>{title}</Text></View>
      {children}
    </View>
  );
}

function Stat({ label, value, s }: { label: string; value: string; s: any }) {
  return <View style={s.stat}><Text style={s.statL}>{label}</Text><Text style={s.statV}>{value}</Text></View>;
}

function ItemList({ items, onChange, placeholder, tick, s, c }: { items: Item[]; onChange: (v: Item[]) => void; placeholder: string; tick?: boolean; s: any; c: any }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (!t) return; onChange([...items, { id: newId(), text: t, done: false }]); setDraft(''); };
  return (
    <View style={{ gap: 6 }}>
      {items.map((it) => (
        <View key={it.id} style={s.row}>
          {tick && <Pressable onPress={() => onChange(items.map((x) => x.id === it.id ? { ...x, done: !x.done } : x))} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: !!it.done }}>
            <Ionicons name={it.done ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={it.done ? c.green : c.textMuted} />
          </Pressable>}
          <TextInput value={it.text} onChangeText={(v) => onChange(items.map((x) => x.id === it.id ? { ...x, text: v } : x))} style={[s.rowInput, it.done && { textDecorationLine: 'line-through', color: c.textMuted }]} multiline />
          <Pressable hitSlop={8} onPress={() => onChange(items.filter((x) => x.id !== it.id))} accessibilityLabel="Remove"><Ionicons name="close" size={18} color={c.textMuted} /></Pressable>
        </View>
      ))}
      <View style={s.row}>
        <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={add} placeholder={placeholder} placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} returnKeyType="done" blurOnSubmit={false} />
        <Pressable onPress={add} style={s.plus} accessibilityLabel="Add"><Ionicons name="add" size={20} color={c.onPrimary} /></Pressable>
      </View>
    </View>
  );
}

function AddSession({ dates, onAdd, s, c }: { dates: string[]; onAdd: (x: Session) => void; s: any; c: any }) {
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(dates[0] || '');
  const [time, setTime] = useState('');
  const add = () => {
    if (!title.trim()) return;
    const t = /^\d{1,2}[:.]\d{2}$/.test(time.trim()) ? time.trim().replace('.', ':').padStart(5, '0') : '';
    onAdd({ id: newId(), title: title.trim(), day, time: t });
    setTitle(''); setTime('');
  };
  return (
    <View style={[s.contact, { marginTop: 6 }]}>
      <Text style={s.small}>Add a session</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {dates.map((d) => (
          <Pressable key={d} onPress={() => setDay(d)} style={[s.chip, day === d && s.chipOn]}><Text style={[s.chipT, day === d && s.chipTOn]}>{fmtDay(d)}</Text></Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={time} onChangeText={setTime} placeholder="10:00" placeholderTextColor={c.textMuted} style={[s.input, { width: 80 }]} />
        <TextInput value={title} onChangeText={setTitle} onSubmitEditing={add} placeholder="Session name" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} />
        <Pressable onPress={add} style={s.plus} accessibilityLabel="Add session"><Ionicons name="add" size={20} color={c.onPrimary} /></Pressable>
      </View>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 12 },
  hero: { backgroundColor: c.primary, borderRadius: 18, padding: 18, gap: 4 },
  heroK: { fontFamily: fonts.bodyMedium, fontSize: 13, color: c.onPrimary, opacity: 0.9 },
  heroT: { fontFamily: fonts.display, fontSize: 24, color: c.onPrimary },
  heroSub: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.onPrimary },
  heroSave: { fontFamily: fonts.body, fontSize: 12, color: c.onPrimary, opacity: 0.8 },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 16, gap: 8 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  secT: { fontFamily: fonts.displayMedium, fontSize: 16, color: c.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: c.surfaceAlt || c.surface, borderRadius: 12, padding: 10, gap: 2 },
  statL: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
  statV: { fontFamily: fonts.displayMedium, fontSize: 16, color: c.text },
  gap: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text, backgroundColor: c.yellowBg, borderRadius: 10, padding: 10, overflow: 'hidden' },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowT: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  rowInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: c.text, paddingVertical: 6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.background },
  plus: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipT: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.textSecondary },
  chipTOn: { color: c.onPrimary },
  contact: { borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 10, gap: 6 },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  addT: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  done: { minHeight: 44, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  doneT: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.onPrimary },
});
