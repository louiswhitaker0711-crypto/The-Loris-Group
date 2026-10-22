/**
 * The postcode box for a sector, with an optional second postcode for two
 * joined maps. The value in and out is one string ("DN4 1 + DN4 2"); see
 * src/utils/postcodes.ts.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, fonts } from '../../theme/ThemeContext';
import { splitPostcodes, joinPostcodes } from '../../utils/postcodes';

type Props = {
  value: string;
  onChange: (v: string) => void;
  inputStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  placeholder?: string;
  autoFocus?: boolean;
  editable?: boolean;
  testID?: string;
};

export default function PostcodePair({ value, onChange, inputStyle, style, placeholder = 'e.g. DN4 1', autoFocus, editable = true, testID }: Props) {
  const c = useColors();
  // Keep what's being typed as typed (spaces included); join only on the way out.
  const parts = splitPostcodes(value);
  const [first, setFirst] = useState(parts[0] || '');
  const [second, setSecond] = useState(parts[1] || '');
  const [showSecond, setShowSecond] = useState(parts.length > 1);
  const emit = (a: string, b: string) => onChange(joinPostcodes([a, b]));

  return (
    <View style={[{ gap: 6 }, style]}>
      <TextInput value={first} editable={editable} autoFocus={autoFocus} autoCapitalize="characters" maxLength={10}
        onChangeText={(v) => { const x = v.toUpperCase(); setFirst(x); emit(x, second); }}
        placeholder={placeholder} placeholderTextColor={c.textMuted} style={inputStyle}
        accessibilityLabel="Postcode" testID={testID} />
      {showSecond ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily: fonts.bodySemibold, color: c.textMuted }}>+</Text>
          <TextInput value={second} editable={editable} autoCapitalize="characters" maxLength={10}
            onChangeText={(v) => { const x = v.toUpperCase(); setSecond(x); emit(first, x); }}
            placeholder="Second postcode" placeholderTextColor={c.textMuted} style={[inputStyle, { flex: 1 }]}
            accessibilityLabel="Second postcode" testID={testID ? `${testID}-2` : undefined} />
          {editable && (
            <Pressable onPress={() => { setSecond(''); setShowSecond(false); emit(first, ''); }} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Remove the second postcode">
              <Ionicons name="close-circle" size={18} color={c.textMuted} />
            </Pressable>
          )}
        </View>
      ) : editable && (
        <Pressable onPress={() => setShowSecond(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
          hitSlop={6} accessibilityRole="button" testID={testID ? `${testID}-add` : undefined}>
          <Ionicons name="add-circle-outline" size={15} color={c.primary} />
          <Text style={{ fontFamily: fonts.bodySemibold, fontSize: 12, color: c.primary }}>Add a second postcode (joined maps)</Text>
        </Pressable>
      )}
    </View>
  );
}
