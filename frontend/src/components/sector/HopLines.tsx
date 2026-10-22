/**
 * Bunny hops in Plan sectors, drawn like the office whiteboard: each line is
 * a hop with its own colour, one person on their own is a solo, and anyone
 * on a line can be marked a Shadow (out watching the hop: Bells reads SD,
 * not scored). Anyone not on a line is left for the sector leader to place.
 * The server assigns colours in line order (backend/core/hops.py).
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../theme/ThemeContext';
import { HOP_COLOURS } from '../../utils/hopColours';

export type HopLine = { member_ids: string[]; shadow_ids: string[] };

type Props = {
  members: string[];               // everyone in the sector, leader included
  lines: HopLine[];
  nameOf: (id: string) => string;
  onChange: (lines: HopLine[]) => void;
  disabled?: boolean;
};

const first = (n: string) => (n || '').trim().split(/\s+/)[0] || n;

export default function HopLines({ members, lines, nameOf, onChange, disabled }: Props) {
  const c = useColors();
  const s = styles(c);
  const [active, setActive] = useState(Math.max(0, lines.length - 1));
  const placed = new Set(lines.flatMap((l) => l.member_ids));
  const loose = members.filter((m) => !placed.has(m));
  const full = lines.length >= HOP_COLOURS.length;

  const set = (fn: (ls: HopLine[]) => HopLine[]) =>
    onChange(fn(lines.map((l) => ({ member_ids: [...l.member_ids], shadow_ids: [...l.shadow_ids] })))
      .filter((l) => l.member_ids.length > 0));
  const place = (uid: string) => {
    if (!lines.length || active >= lines.length) {
      if (full) return;
      onChange([...lines, { member_ids: [uid], shadow_ids: [] }]);
      setActive(lines.length);
      return;
    }
    set((ls) => ls.map((l, i) => (i === active ? { ...l, member_ids: [...l.member_ids, uid] } : l)));
  };
  const remove = (li: number, uid: string) => {
    const left = lines[li].member_ids.length - 1;
    set((ls) => ls.map((l, i) => (i === li ? { member_ids: l.member_ids.filter((m) => m !== uid), shadow_ids: l.shadow_ids.filter((m) => m !== uid) } : l)));
    if (left === 0) setActive(Math.max(0, li - 1));
  };
  const toggleShadow = (li: number, uid: string) =>
    set((ls) => ls.map((l, i) => (i !== li ? l : {
      ...l, shadow_ids: l.shadow_ids.includes(uid) ? l.shadow_ids.filter((m) => m !== uid) : [...l.shadow_ids, uid] })));
  const newLine = () => { if (!full) setActive(lines.length); };

  return (
    <View style={{ gap: 8 }}>
      {lines.map((l, li) => {
        const colour = HOP_COLOURS[li];
        const on = li === active;
        const workers = l.member_ids.filter((m) => !l.shadow_ids.includes(m)).length;
        return (
          <Pressable key={li} onPress={() => setActive(li)} disabled={disabled}
            style={[s.line, { borderLeftColor: colour?.hex }, on && !disabled && s.lineOn]} accessibilityLabel={`${colour?.label} line`}>
            <Text style={[s.lineLabel, { color: colour?.hex }]}>{colour?.label}{workers === 1 ? ' · solo' : ''}</Text>
            <View style={s.chips}>
              {l.member_ids.map((uid) => {
                const shadow = l.shadow_ids.includes(uid);
                return (
                  <View key={uid} style={[s.person, shadow && s.personShadow]}>
                    <Text style={s.personText}>{first(nameOf(uid))}{shadow ? ' (shadow)' : ''}</Text>
                    {!disabled && (
                      <>
                        <Pressable onPress={() => toggleShadow(li, uid)} hitSlop={6} accessibilityRole="button"
                          accessibilityLabel={shadow ? `${nameOf(uid)}: not a shadow` : `${nameOf(uid)}: shadow day`}>
                          <Text style={[s.sd, shadow && { color: c.onPrimary, backgroundColor: c.textMuted }]}>SD</Text>
                        </Pressable>
                        <Pressable onPress={() => remove(li, uid)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Take ${nameOf(uid)} off the line`}>
                          <Ionicons name="close" size={14} color={c.textMuted} />
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          </Pressable>
        );
      })}

      {!disabled && active >= lines.length && !full && (
        <View style={[s.line, s.lineOn, { borderLeftColor: HOP_COLOURS[lines.length]?.hex }]}>
          <Text style={[s.lineLabel, { color: HOP_COLOURS[lines.length]?.hex }]}>{HOP_COLOURS[lines.length]?.label} · tap names below</Text>
        </View>
      )}

      {!disabled && (
        <>
          {loose.length > 0 && <Text style={s.hint}>Tap to put on the {HOP_COLOURS[Math.min(active, HOP_COLOURS.length - 1)]?.label.toLowerCase()} line:</Text>}
          <View style={s.chips}>
            {loose.map((uid) => (
              <Pressable key={uid} onPress={() => place(uid)} style={s.loose} accessibilityRole="button">
                <Text style={s.looseText}>{first(nameOf(uid))}</Text>
              </Pressable>
            ))}
            {!full && lines.length > 0 && active < lines.length && (
              <Pressable onPress={newLine} style={s.newLine} accessibilityRole="button">
                <Ionicons name="add" size={14} color={c.primary} />
                <Text style={s.newLineText}>New line</Text>
              </Pressable>
            )}
          </View>
          {loose.length > 0 && lines.length > 0 && <Text style={s.hint}>Anyone not on a line is left for the sector leader.</Text>}
        </>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  line: { borderLeftWidth: 4, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: c.surface, gap: 6 },
  lineOn: { borderWidth: 1, borderColor: c.border },
  lineLabel: { fontFamily: fonts.bodySemibold, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  personShadow: { borderStyle: 'dashed' },
  personText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  sd: { fontFamily: fonts.bodySemibold, fontSize: 10, color: c.textMuted, borderWidth: 1, borderColor: c.border, borderRadius: 4, paddingHorizontal: 3, overflow: 'hidden' },
  loose: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, borderStyle: 'dashed' },
  looseText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.text },
  newLine: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6 },
  newLineText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: c.primary },
  hint: { fontFamily: fonts.body, fontSize: 12, color: c.textMuted },
});
