/**
 * Admin → Meet-ups (route: /meetups-admin) — the Owner, 5 Nov 2026. Make a
 * meet-up (name, place, dates, who's going, any agenda you have), send it
 * out, and see everyone's planner: goals, who they want to meet, questions,
 * people met, notes and what they're bringing back.
 * (GET/POST/PUT/DELETE /meetups, POST /meetups/{id}/send, GET /meetups/{id}/plans)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useColors, fonts } from '../src/theme/ThemeContext';
import { api } from '../src/api/client';
import { useTabBarClearance } from '../src/customization/CustomTabBar';
import { toast } from '../src/utils/toast';
import DateField from '../src/components/ui/DateField';
import { fmtDay, newId } from '../src/utils/meetups';

type Session = { id: string; day: string; time: string; title: string };
type Meetup = { id: string; name: string; place: string; start_date: string; end_date: string; agenda: Session[];
  attendee_ids: string[]; sent_at: string | null;
  people: { user_id: string; name: string; done: number; of: number; contacts: number; opened: boolean; debrief_done: boolean }[] };
type Draft = { id?: string; name: string; place: string; start_date: string; end_date: string; agenda: Session[]; attendee_ids: string[] };

const errText = (e: any, fallback: string) => (typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : fallback);
const confirm = (title: string, msg: string): Promise<boolean> => {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${msg}`));
  return new Promise((res) => Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Yes', style: 'destructive', onPress: () => res(true) }]));
};

export default function MeetupsAdmin() {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tabClear = useTabBarClearance();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['meetups-admin'], queryFn: async () => (await api.get('/meetups')).data });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['meetups-admin'] });

  const saveDraft = async (sendToo: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { ...draft, end_date: draft.end_date || draft.start_date };
      const r = draft.id ? await api.put(`/meetups/${draft.id}`, body) : await api.post('/meetups', body);
      if (sendToo) await api.post(`/meetups/${r.data.meetup.id}/send`);
      toast.success(sendToo ? 'Sent out' : 'Saved');
      setDraft(null);
      refresh();
    } catch (e) { toast.error('Couldn’t save', errText(e, 'Try again.')); }
    finally { setBusy(false); }
  };
  const send = async (m: Meetup) => {
    try { await api.post(`/meetups/${m.id}/send`); toast.success('Sent out'); refresh(); }
    catch (e) { toast.error('Couldn’t send', errText(e, 'Try again.')); }
  };
  const remove = async (m: Meetup) => {
    if (!(await confirm(`Delete ${m.name}?`, 'Everyone’s planner and notes for it go too.'))) return;
    try { await api.delete(`/meetups/${m.id}`); toast.success('Deleted'); refresh(); }
    catch (e) { toast.error('Couldn’t delete', errText(e, 'Try again.')); }
  };

  if (viewing) return <PlansView id={viewing} onBack={() => setViewing(null)} />;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: 'Meet-ups' }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 40 + tabClear }]} keyboardShouldPersistTaps="handled">
        <View style={s.shell}>
          {draft ? (
            <Editor draft={draft} setDraft={setDraft} people={q.data?.people || []} busy={busy} onSave={saveDraft} onCancel={() => setDraft(null)} />
          ) : (
            <>
              <Pressable onPress={() => setDraft({ name: '', place: '', start_date: '', end_date: '', agenda: [], attendee_ids: [] })} style={s.primary} accessibilityRole="button" testID="meetups-new">
                <Ionicons name="add" size={18} color={c.onPrimary} /><Text style={s.primaryT}>New meet-up</Text>
              </Pressable>
              <Text style={s.small}>It goes on the Home of the people going from a week before it starts, and comes off once they’ve done their debrief.</Text>
              {q.isLoading && <ActivityIndicator color={c.primary} />}
              {(q.data?.meetups || []).map((m: Meetup) => (
                <View key={m.id} style={s.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.title}>{m.name}</Text>
                      <Text style={s.small}>{fmtDay(m.start_date)}{m.end_date !== m.start_date ? ` – ${fmtDay(m.end_date)}` : ''}{m.place ? ` · ${m.place}` : ''}</Text>
                    </View>
                    <Text style={[s.badge, m.sent_at ? s.badgeOn : null]}>{m.sent_at ? 'Sent' : 'Not sent'}</Text>
                  </View>
                  {m.people.map((p) => (
                    <View key={p.user_id} style={s.row}>
                      <Text style={s.rowT}>{p.name}</Text>
                      <Text style={s.small}>{!m.sent_at ? '' : p.debrief_done ? 'Debrief done' : !p.opened ? 'Not opened yet' : `${p.done}/${p.of} · ${p.contacts} met`}</Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {m.sent_at
                      ? <Btn label="View their planners" icon="eye-outline" onPress={() => setViewing(m.id)} s={s} c={c} />
                      : <Btn label="Send out" icon="paper-plane-outline" onPress={() => send(m)} s={s} c={c} />}
                    <Btn label="Edit" icon="create-outline" onPress={() => setDraft({ id: m.id, name: m.name, place: m.place, start_date: m.start_date, end_date: m.end_date, agenda: m.agenda || [], attendee_ids: m.attendee_ids })} s={s} c={c} />
                    <Btn label="Delete" icon="trash-outline" onPress={() => remove(m)} s={s} c={c} />
                  </View>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Btn({ label, icon, onPress, s, c }: { label: string; icon: any; onPress: () => void; s: any; c: any }) {
  return <Pressable onPress={onPress} style={s.btn} accessibilityRole="button"><Ionicons name={icon} size={16} color={c.primary} /><Text style={s.btnT}>{label}</Text></Pressable>;
}

function Editor({ draft, setDraft, people, busy, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; people: { id: string; name: string }[]; busy: boolean; onSave: (send: boolean) => void; onCancel: () => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const [find, setFind] = useState('');
  const [sTitle, setSTitle] = useState('');
  const [sTime, setSTime] = useState('');
  const [sDay, setSDay] = useState('');
  const set = (k: keyof Draft, v: any) => setDraft({ ...draft, [k]: v });
  const shown = people.filter((p) => draft.attendee_ids.includes(p.id) || (find.trim().length > 0 && p.name.toLowerCase().includes(find.trim().toLowerCase())));
  const addSession = () => {
    if (!sTitle.trim()) return;
    const t = /^\d{1,2}[:.]\d{2}$/.test(sTime.trim()) ? sTime.trim().replace('.', ':').padStart(5, '0') : '';
    set('agenda', [...draft.agenda, { id: newId(), title: sTitle.trim(), time: t, day: sDay || draft.start_date }]);
    setSTitle(''); setSTime('');
  };
  return (
    <View style={s.card}>
      <Text style={s.title}>{draft.id ? 'Edit meet-up' : 'New meet-up'}</Text>
      <TextInput value={draft.name} onChangeText={(v) => set('name', v)} placeholder="Name (Budapest BA Meet-up)" placeholderTextColor={c.textMuted} style={s.input} />
      <TextInput value={draft.place} onChangeText={(v) => set('place', v)} placeholder="Where" placeholderTextColor={c.textMuted} style={s.input} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><DateField label="Starts" value={draft.start_date} onChange={(v) => setDraft({ ...draft, start_date: v, end_date: draft.end_date && draft.end_date >= v ? draft.end_date : v })} /></View>
        <View style={{ flex: 1 }}><DateField label="Ends" value={draft.end_date} minDate={draft.start_date || undefined} onChange={(v) => set('end_date', v)} /></View>
      </View>

      <Text style={s.label}>Who’s going</Text>
      <TextInput value={find} onChangeText={setFind} placeholder="Find someone" placeholderTextColor={c.textMuted} style={s.input} />
      {shown.map((p) => {
        const on = draft.attendee_ids.includes(p.id);
        return (
          <Pressable key={p.id} onPress={() => set('attendee_ids', on ? draft.attendee_ids.filter((x) => x !== p.id) : [...draft.attendee_ids, p.id])} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? c.primary : c.textMuted} />
            <Text style={s.rowT}>{p.name}</Text>
          </Pressable>
        );
      })}

      <Text style={s.label}>Agenda (optional; they can add sessions themselves)</Text>
      {draft.agenda.map((a) => (
        <View key={a.id} style={s.row}>
          <Text style={s.rowT}>{a.title}</Text>
          <Text style={s.small}>{[a.day && fmtDay(a.day), a.time].filter(Boolean).join(' · ')}</Text>
          <Pressable hitSlop={8} onPress={() => set('agenda', draft.agenda.filter((x) => x.id !== a.id))} accessibilityLabel="Remove session"><Ionicons name="close" size={18} color={c.textMuted} /></Pressable>
        </View>
      ))}
      {!!draft.start_date && (
        <>
          <DateField label="Day" value={sDay || draft.start_date} minDate={draft.start_date} maxDate={draft.end_date || draft.start_date} onChange={setSDay} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={sTime} onChangeText={setSTime} placeholder="10:00" placeholderTextColor={c.textMuted} style={[s.input, { width: 80 }]} />
            <TextInput value={sTitle} onChangeText={setSTitle} onSubmitEditing={addSession} placeholder="Session" placeholderTextColor={c.textMuted} style={[s.input, { flex: 1 }]} />
            <Pressable onPress={addSession} style={s.plus} accessibilityLabel="Add session"><Ionicons name="add" size={20} color={c.onPrimary} /></Pressable>
          </View>
        </>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <Pressable onPress={onCancel} style={[s.btn, { flex: 1, justifyContent: 'center' }]}><Text style={s.btnT}>Cancel</Text></Pressable>
        <Pressable onPress={() => onSave(false)} disabled={busy} style={[s.btn, { flex: 1, justifyContent: 'center' }]}><Text style={s.btnT}>Save</Text></Pressable>
      </View>
      <Pressable onPress={() => onSave(true)} disabled={busy} style={s.primary} accessibilityRole="button" testID="meetups-send">
        {busy ? <ActivityIndicator color={c.onPrimary} /> : <><Ionicons name="paper-plane-outline" size={17} color={c.onPrimary} /><Text style={s.primaryT}>Save and send out</Text></>}
      </Pressable>
    </View>
  );
}

function PlansView({ id, onBack }: { id: string; onBack: () => void }) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const tabClear = useTabBarClearance();
  const q = useQuery({ queryKey: ['meetup-plans', id], queryFn: async () => (await api.get(`/meetups/${id}/plans`)).data });
  const [who, setWho] = useState(0);
  const m = q.data?.meetup;
  const person = q.data?.people?.[who];
  const p = person?.plan || {};
  const list = (title: string, items?: { text: string; done?: boolean }[]) => (
    <View style={s.card}>
      <Text style={s.label}>{title}</Text>
      {items?.length ? items.map((x, i) => <Text key={i} style={s.body}>{x.done ? '✓ ' : '• '}{x.text}</Text>) : <Text style={s.small}>Nothing yet</Text>}
    </View>
  );
  const sessions = [...(m?.agenda || []), ...(p.sessions || [])].filter((x: Session) => (p.picks || []).includes(x.id));
  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: m?.name || 'Meet-up' }} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 40 + tabClear }]}>
        <View style={s.shell}>
          <Pressable onPress={onBack} hitSlop={6}><Text style={s.back}>‹ Meet-ups</Text></Pressable>
          {q.isLoading ? <ActivityIndicator color={c.primary} /> : (
            <>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {(q.data?.people || []).map((x: any, i: number) => (
                  <Pressable key={x.user_id} onPress={() => setWho(i)} style={[s.chip, who === i && s.chipOn]}><Text style={[s.chipT, who === i && s.chipTOn]}>{x.name}</Text></Pressable>
                ))}
              </View>
              {!person?.opened && <Text style={s.small}>{person?.name} hasn’t opened their planner yet.</Text>}
              {list('Goals for the trip', p.goals)}
              <View style={s.card}>
                <Text style={s.label}>Sessions they’re going to</Text>
                {sessions.length ? sessions.map((x: Session) => <Text key={x.id} style={s.body}>• {[x.day && fmtDay(x.day), x.time].filter(Boolean).join(' ')} {x.title}</Text>) : <Text style={s.small}>Nothing yet</Text>}
              </View>
              {list('Who they want to meet', p.meet)}
              {list('Questions', p.questions)}
              {list('Things to work on', p.work_on)}
              <View style={s.card}>
                <Text style={s.label}>People they met</Text>
                {p.contacts?.length ? p.contacts.map((x: any) => (
                  <View key={x.id} style={{ gap: 1 }}>
                    <Text style={s.rowT}>{x.name || 'No name'}{x.where ? ` · ${x.where}` : ''}{x.followed_up ? '  ✓ followed up' : ''}</Text>
                    {!!x.phone && <Text style={s.small}>{x.phone}</Text>}
                    {!!x.notes && <Text style={s.body}>{x.notes}</Text>}
                  </View>
                )) : <Text style={s.small}>Nobody yet</Text>}
              </View>
              <View style={s.card}>
                <Text style={s.label}>Notes</Text>
                {p.notes?.length ? p.notes.map((x: any) => (
                  <View key={x.id}><Text style={s.rowT}>{x.title || 'Note'}</Text><Text style={s.body}>{x.body}</Text></View>
                )) : <Text style={s.small}>No notes yet</Text>}
              </View>
              <View style={s.card}>
                <Text style={s.label}>What they’re bringing back</Text>
                {(p.debrief?.takeaways || []).filter(Boolean).map((t: string, i: number) => <Text key={i} style={s.body}>{i + 1}. {t}</Text>)}
                {!!p.debrief?.primetime && <Text style={s.rowT}>Primetime topic: {p.debrief.primetime}</Text>}
                {!(p.debrief?.takeaways || []).some(Boolean) && !p.debrief?.primetime && <Text style={s.small}>Opens on the last day</Text>}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.page || c.surface },
  content: { padding: 16 },
  shell: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 12 },
  card: { backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 18, padding: 16, gap: 8 },
  title: { fontFamily: fonts.displayMedium, fontSize: 17, color: c.text },
  label: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.text, marginTop: 4 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: c.text },
  back: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  rowT: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: c.text },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 16, color: c.text, backgroundColor: c.background },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: c.primary },
  primaryT: { fontFamily: fonts.bodySemibold, fontSize: 15, color: c.onPrimary },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 40 },
  btnT: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  plus: { width: 42, height: 42, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  badge: { fontFamily: fonts.bodySemibold, fontSize: 12, color: c.textSecondary, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  badgeOn: { color: c.sgreenInk || c.text, backgroundColor: c.sgreenBg || c.greenBg, borderColor: 'transparent' },
  chip: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipT: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: c.textSecondary },
  chipTOn: { color: c.onPrimary },
});
