/**
 * PrimetimeBoard: the day's Primetime planned like the sectors (the Owner,
 * 29 Oct 2026). Each topic is a triangle: whoever is running it on top, the
 * topic in the middle, Watching on the left corner and Learning on the right.
 * Pitch practice is just a list. Everything is edited on one board and saved
 * at once (PUT /primetime/day).
 *
 * You place the people you plan for (your team; an Admin, anyone) plus anyone
 * who said they're free to work with. Other teams' people show on the board
 * but you can't move them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, LayoutChangeEvent } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiService, PrimetimeWeek } from '../../api/client';
import { useColors, fonts } from '../../theme/ThemeContext';
import { toast } from '../../utils/toast';
import { showAlert } from '../../utils/showAlert';

type Layout = 'triangle' | 'list';
type Board = { key: string; host_id: string; topic: string; layout: Layout; watching: string[]; learning: string[] };
type Corner = 'watching' | 'learning';
// What the picker is choosing: who runs a new one, who runs this one, or who goes in a corner.
type Pick = { kind: 'new'; layout: Layout } | { kind: 'host'; key: string } | { kind: 'corner'; key: string; corner: Corner } | null;

const first = (n: string) => (n || '').trim().split(' ')[0] || 'Someone';

export default function PrimetimeBoard({ data, week, dayIndex, office, canEdit }: {
  data: PrimetimeWeek;
  week: string;
  dayIndex: number;
  office?: string;
  canEdit: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const qc = useQueryClient();

  // In that day: on the plan and not Scheduled off / No show / Exited.
  const inToday = useMemo(() => (data.people || [])
    .filter((p) => (p.days_on_grid || []).includes(dayIndex) && !(p.absent_days || []).includes(dayIndex))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [data, dayIndex]);
  const nameOf = (id: string) => (data.people || []).find((p) => p.user_id === id)?.name
    || (data.entries || []).find((e) => e.subject_user_id === id)?.subject_name || '';
  // On the board: first names (with a last initial when two share one), like the whiteboard.
  const shortOf = (id: string) => {
    const full = nameOf(id).trim();
    const [f, ...rest] = full.split(/\s+/);
    if (!f) return full;
    const clash = (data.people || []).some((p) => p.user_id !== id && (p.name || '').trim().split(/\s+/)[0] === f);
    return clash && rest.length ? `${f} ${rest[rest.length - 1][0]}` : f;
  };
  const free = useMemo(() => new Set((data.entries || [])
    .filter((e) => e.day_index === dayIndex && e.mode === 'free').map((e) => e.subject_user_id)), [data, dayIndex]);
  const canPlace = (id: string) => canEdit && (!!(data.people || []).find((p) => p.user_id === id)?.can_edit || free.has(id));

  const fromServer = (): Board[] => (data.sessions || [])
    .filter((x) => x.day_index === dayIndex)
    .map((x) => ({
      key: x.session_id, host_id: x.host_user_id, topic: x.topic || '',
      layout: (x.layout === 'list' ? 'list' : 'triangle') as Layout,
      watching: x.attendees.filter((a) => a.mode === 'watching').map((a) => a.user_id),
      learning: x.attendees.filter((a) => a.mode !== 'watching').map((a) => a.user_id),
    }));
  const [board, setBoard] = useState<Board[]>(fromServer);
  const [dirty, setDirty] = useState(false);
  const [pick, setPick] = useState<Pick>(null);
  const [saving, setSaving] = useState(false);
  // Load from the server unless there are unsaved edits on the board.
  useEffect(() => { if (!dirty) setBoard(fromServer()); }, [data, dayIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty(false); setPick(null); }, [week, dayIndex]);

  const placedWhere = (id: string): string | null => {
    for (const b of board) {
      if (b.host_id === id) return `running ${b.topic || (b.layout === 'list' ? 'Pitch practice' : 'a topic')}`;
      if (b.watching.includes(id) || b.learning.includes(id)) return `with ${first(nameOf(b.host_id))}`;
    }
    return null;
  };
  const edit = (fn: (b: Board[]) => Board[]) => { setBoard((b) => fn(b.map((x) => ({ ...x, watching: [...x.watching], learning: [...x.learning] })))); setDirty(true); };
  // Out of every corner (moving someone takes them from wherever they were).
  const pull = (b: Board[], id: string) => b.map((x) => ({ ...x, watching: x.watching.filter((m) => m !== id), learning: x.learning.filter((m) => m !== id) }));

  const choose = (id: string) => {
    const p = pick;
    setPick(null);
    if (!p) return;
    if (p.kind === 'new') {
      edit((b) => [...pull(b, id), { key: `new:${id}:${Date.now()}`, host_id: id, topic: p.layout === 'list' ? 'Pitch practice' : '', layout: p.layout, watching: [], learning: [] }]);
    } else if (p.kind === 'host') {
      edit((b) => pull(b, id).map((x) => (x.key === p.key ? { ...x, host_id: id } : x)));
    } else {
      edit((b) => pull(b, id).map((x) => (x.key === p.key ? { ...x, [p.corner]: [...x[p.corner], id] } : x)));
    }
  };
  const removeFrom = (key: string, id: string) => edit((b) => b.map((x) => (x.key === key ? { ...x, watching: x.watching.filter((m) => m !== id), learning: x.learning.filter((m) => m !== id) } : x)));
  const removeSession = (key: string) => edit((b) => b.filter((x) => x.key !== key));
  const setTopic = (key: string, topic: string) => edit((b) => b.map((x) => (x.key === key ? { ...x, topic } : x)));

  const save = async () => {
    setSaving(true);
    try {
      const r = await apiService.savePrimetimeDay({
        week_ending: week, day_index: dayIndex, office,
        sessions: board.map((x) => ({ host_id: x.host_id, topic: x.topic.trim(), layout: x.layout, watching: x.watching, learning: x.learning })),
      });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['primetime-week'] });
      qc.invalidateQueries({ queryKey: ['primetime-home'] });
      qc.invalidateQueries({ queryKey: ['sector-primetime'] });
      const skipped = r.data?.skipped || [];
      if (skipped.length) showAlert('Saved, with one thing', `${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} on another Coach's team, so they stay where their Coach put them. Ask their Coach to move them.`);
      else toast.success('Primetime saved');
    } catch (e: any) {
      showAlert('Could not save', e?.response?.data?.detail || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  // The people the picker offers.
  const pickable = (() => {
    if (!pick) return [];
    const hosts = new Set(board.map((x) => x.host_id));
    const cur = pick.kind === 'new' ? null : board.find((x) => x.key === pick.key);
    return inToday.filter((p) => {
      if (!canPlace(p.user_id)) return false;
      if (pick.kind === 'corner') return !hosts.has(p.user_id) && !(cur?.watching.includes(p.user_id) || cur?.learning.includes(p.user_id));
      return !hosts.has(p.user_id);   // someone runs one thing at a time
    });
  })();
  const pickTitle = !pick ? '' : pick.kind === 'new' ? `Who's running ${pick.layout === 'list' ? 'Pitch practice' : 'it'}?`
    : pick.kind === 'host' ? 'Who’s running it?' : `Who's ${pick.corner}?`;
  const Picker = ({ here }: { here: (p: Pick) => boolean }) => (pick && here(pick) ? (
    <View style={s.picker}>
      <View style={s.rowBetween}>
        <Text style={s.pickTitle}>{pickTitle}</Text>
        <Pressable onPress={() => setPick(null)} hitSlop={8}><Text style={s.link}>Cancel</Text></Pressable>
      </View>
      {pickable.length === 0
        ? <Text style={s.small}>Nobody left to add.</Text>
        : (
          <View style={s.chips}>
            {pickable.map((p) => {
              const where = placedWhere(p.user_id);
              return (
                <Pressable key={p.user_id} onPress={() => choose(p.user_id)} style={[s.chip, !!where && s.chipElsewhere]} accessibilityRole="button">
                  <Text style={s.chipText}>{p.name}{where ? ` · ${where}` : ''}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
    </View>
  ) : null);

  const unplaced = inToday.filter((p) => !placedWhere(p.user_id));

  return (
    <View style={s.wrap}>
      {board.length === 0 && <Text style={s.muted}>Nothing planned yet. Add a topic: who's running it, the topic, then who's watching and who's learning.</Text>}

      {/* Triangles sit side by side on one line, like the whiteboard; they wrap
          only when the screen runs out of room. Pitch practice lists go under. */}
      {board.some((b) => b.layout !== 'list') && (
        <View style={s.triRow}>
          {board.filter((b) => b.layout !== 'list').map((b) => (
            <TriangleCard key={b.key} b={b} s={s} c={c} nameOf={shortOf} canPlace={canPlace} canEdit={canEdit}
              onHost={() => setPick({ kind: 'host', key: b.key })} onTopic={(t) => setTopic(b.key, t)}
              onAdd={(corner) => setPick({ kind: 'corner', key: b.key, corner })}
              onRemove={(id) => removeFrom(b.key, id)} onDelete={() => removeSession(b.key)}
              picker={<Picker here={(p) => !!p && p.kind !== 'new' && p.key === b.key} />} />
          ))}
        </View>
      )}
      {board.filter((b) => b.layout === 'list').map((b) => (
        <ListCard key={b.key} b={b} s={s} c={c} nameOf={shortOf} canPlace={canPlace} canEdit={canEdit}
          onHost={() => setPick({ kind: 'host', key: b.key })} onAdd={() => setPick({ kind: 'corner', key: b.key, corner: 'learning' })}
          onRemove={(id) => removeFrom(b.key, id)} onDelete={() => removeSession(b.key)}
          picker={<Picker here={(p) => !!p && p.kind !== 'new' && p.key === b.key} />} />
      ))}

      {canEdit && (
        <>
          <Picker here={(p) => !!p && p.kind === 'new'} />
          {!(pick && pick.kind === 'new') && (
            <View style={s.addRow}>
              <Pressable onPress={() => setPick({ kind: 'new', layout: 'triangle' })} style={s.add} accessibilityRole="button" testID="pt-add-topic">
                <Ionicons name="triangle-outline" size={17} color={c.primary} />
                <Text style={s.addText}>Add a topic</Text>
              </Pressable>
              <Pressable onPress={() => setPick({ kind: 'new', layout: 'list' })} style={s.add} accessibilityRole="button" testID="pt-add-pp">
                <Ionicons name="list-outline" size={17} color={c.primary} />
                <Text style={s.addText}>Pitch practice</Text>
              </Pressable>
            </View>
          )}
        </>
      )}

      {unplaced.length > 0 && (
        <Text style={s.small}>Not on Primetime yet: {unplaced.map((p) => first(p.name)).join(', ')}</Text>
      )}

      {dirty && (
        <Pressable onPress={save} disabled={saving} style={s.save} accessibilityRole="button" testID="pt-save">
          {saving ? <ActivityIndicator color={c.onPrimary} /> : <Ionicons name="save-outline" size={18} color={c.onPrimary} />}
          <Text style={s.saveText}>Save Primetime</Text>
        </Pressable>
      )}
    </View>
  );
}

function Name({ id, nameOf, s, onRemove, removable }: { id: string; nameOf: (id: string) => string; s: any; onRemove: () => void; removable: boolean }) {
  return (
    <Pressable onPress={removable ? onRemove : undefined} disabled={!removable} style={s.person}
      accessibilityRole={removable ? 'button' : undefined} accessibilityLabel={removable ? `Take ${nameOf(id)} off` : nameOf(id)}>
      <Text style={s.personText} numberOfLines={1}>{nameOf(id)}</Text>
      {removable && <Ionicons name="close" size={12} style={s.personX} />}
    </Pressable>
  );
}

function TriangleCard({ b, s, c, nameOf, canPlace, canEdit, onHost, onTopic, onAdd, onRemove, onDelete, picker }: {
  b: Board; s: any; c: any; nameOf: (id: string) => string; canPlace: (id: string) => boolean; canEdit: boolean;
  onHost: () => void; onTopic: (t: string) => void; onAdd: (corner: Corner) => void; onRemove: (id: string) => void; onDelete: () => void;
  picker: React.ReactNode;
}) {
  const [w, setW] = useState(0);
  // A small triangle: the topic sits in its wide lower half and wraps to two lines.
  const tw = Math.min(w, 150);
  const h = Math.round(Math.min(tw * 0.5, 72));
  const x0 = (w - tw) / 2;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const mine = canEdit && canPlace(b.host_id);
  const corner = (k: Corner, label: string) => (
    <View style={[s.corner, k === 'learning' && { alignItems: 'flex-end' }]}>
      <Text style={s.cornerHead}>{label}</Text>
      {b[k].map((id) => <Name key={id} id={id} nameOf={nameOf} s={s} removable={canPlace(id)} onRemove={() => onRemove(id)} />)}
      {canEdit && (
        <Pressable onPress={() => onAdd(k)} style={s.addPerson} accessibilityRole="button" accessibilityLabel={`Add someone ${k}`}>
          <Ionicons name="add" size={14} color={c.primary} />
          <Text style={s.addPersonText}>Add</Text>
        </Pressable>
      )}
    </View>
  );
  return (
    <View style={[s.card, s.triCard]}>
      {canEdit && mine && (
        <Pressable onPress={onDelete} hitSlop={8} style={s.remove} accessibilityRole="button" accessibilityLabel="Remove this topic">
          <Ionicons name="trash-outline" size={16} color={c.textMuted} />
        </Pressable>
      )}
      {/* Top of the triangle: who's running it. */}
      <View style={{ alignItems: 'center', gap: 3 }}>
        <Text style={s.cornerHead}>Running it</Text>
        <Pressable onPress={mine ? onHost : undefined} disabled={!mine} style={s.host} accessibilityRole={mine ? 'button' : undefined}>
          <Text style={s.hostText} numberOfLines={1}>{nameOf(b.host_id) || 'Pick someone'}</Text>
          {mine && <Ionicons name="swap-horizontal" size={13} color={c.onPrimary} />}
        </Pressable>
      </View>
      <View onLayout={onLayout} style={{ height: h || 64, marginTop: 2 }}>
        {w > 0 && (
          <Svg width={w} height={h} style={StyleSheet.absoluteFill as any}>
            <Polygon points={`${x0 + tw / 2},2 ${x0 + tw - 2},${h - 2} ${x0 + 2},${h - 2}`} fill={c.surface} stroke={c.primary} strokeWidth={2} strokeLinejoin="round" />
          </Svg>
        )}
        {/* The middle: the topic, two lines at most, inside the triangle. */}
        {w > 0 && (
          <View style={[s.topicWrap, { left: x0 + tw * 0.18, width: tw * 0.64, top: h * 0.42, height: h * 0.54 }]}>
            {mine
              ? <TextInput value={b.topic} onChangeText={(t) => onTopic(t.replace(/\n/g, ' '))} placeholder="Topic" placeholderTextColor={c.textMuted}
                  style={s.topicInput} maxLength={60} multiline numberOfLines={2} blurOnSubmit accessibilityLabel="Topic" />
              : <Text style={s.topicText} numberOfLines={2}>{b.topic || 'Topic'}</Text>}
          </View>
        )}
      </View>
      {/* The bottom corners: Watching on the left, Learning on the right. */}
      <View style={s.corners}>
        {corner('watching', 'Watching')}
        {corner('learning', 'Learning')}
      </View>
      {picker}
    </View>
  );
}

function ListCard({ b, s, c, nameOf, canPlace, canEdit, onHost, onAdd, onRemove, onDelete, picker }: {
  b: Board; s: any; c: any; nameOf: (id: string) => string; canPlace: (id: string) => boolean; canEdit: boolean;
  onHost: () => void; onAdd: () => void; onRemove: (id: string) => void; onDelete: () => void; picker: React.ReactNode;
}) {
  // Like the whiteboard: "Pitch practice", then "Val — Tom".
  const mine = canEdit && canPlace(b.host_id);
  return (
    <View style={s.card}>
      <View style={s.rowBetween}>
        <Text style={s.listTitle}>{b.topic || 'Pitch practice'}</Text>
        {mine && (
          <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove Pitch practice">
            <Ionicons name="trash-outline" size={15} color={c.textMuted} />
          </Pressable>
        )}
      </View>
      <View style={s.ppLine}>
        <Pressable onPress={mine ? onHost : undefined} disabled={!mine} accessibilityRole={mine ? 'button' : undefined}
          accessibilityLabel={`${nameOf(b.host_id)} is running it${mine ? ', tap to change' : ''}`}>
          <Text style={s.ppHost}>{nameOf(b.host_id)}</Text>
        </Pressable>
        <Text style={s.ppDash}>{'\u2014'}</Text>
        {b.learning.map((id) => <Name key={id} id={id} nameOf={nameOf} s={s} removable={canPlace(id)} onRemove={() => onRemove(id)} />)}
        {canEdit && (
          <Pressable onPress={onAdd} style={s.addPerson} accessibilityRole="button" accessibilityLabel="Add someone to Pitch practice">
            <Ionicons name="add" size={13} color={c.primary} />
            <Text style={s.addPersonText}>Add</Text>
          </Pressable>
        )}
      </View>
      {picker}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  wrap: { gap: 10 },
  triRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' },
  triCard: { flexGrow: 1, flexBasis: 150, minWidth: 150, maxWidth: 210, paddingHorizontal: 8, paddingVertical: 8 },
  card: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 10, gap: 5 },
  remove: { position: 'absolute', top: 8, right: 8, zIndex: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  host: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4, maxWidth: 220 },
  hostText: { fontFamily: fonts.bodyBold, fontSize: 12, color: c.onPrimary },
  topicWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  topicInput: { width: '100%', height: 30, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 11.5, lineHeight: 14, color: c.text, padding: 0, overflow: 'hidden' },
  topicText: { textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 11.5, lineHeight: 14, color: c.text },
  corners: { flexDirection: 'row', gap: 6 },
  corner: { flex: 1, gap: 4, alignItems: 'flex-start' },
  cornerHead: { fontFamily: fonts.bodySemibold, fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: c.primary },
  person: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, maxWidth: '100%' },
  personText: { fontFamily: fonts.bodySemibold, fontSize: 11.5, color: c.text, flexShrink: 1 },
  personX: { color: c.textMuted },
  addPerson: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: c.primary },
  addPersonText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: c.primary },
  listTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.text },
  ppLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  ppHost: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.primary },
  ppDash: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.textMuted },
  picker: { marginTop: 6, padding: 10, borderRadius: 12, backgroundColor: c.surface, gap: 8 },
  pickTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: c.text },
  link: { fontFamily: fonts.bodySemibold, fontSize: 14, color: c.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  chipElsewhere: { opacity: 0.6 },
  chipText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  addRow: { flexDirection: 'row', gap: 8 },
  add: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary },
  addText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: c.primary },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 12, backgroundColor: c.primary },
  saveText: { fontFamily: fonts.bodyBold, fontSize: 15, color: c.onPrimary },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: c.textMuted },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: c.textMuted },
});
