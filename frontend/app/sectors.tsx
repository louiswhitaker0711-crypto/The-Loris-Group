// The Sectors board on its own page (also a view in the Performance Hub).
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectorsBoard } from '../src/components/sector/SectorsBoard';

export default function SectorsScreen() {
  const insets = useSafeAreaInsets();
  return <SectorsBoard bottomPad={insets.bottom + 40} />;
}
