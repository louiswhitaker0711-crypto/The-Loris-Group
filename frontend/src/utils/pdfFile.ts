// Pick a PDF from the device as base64, and open a PDF we hold as base64.
// Same approach as the Coaching Library (see coaching.tsx), shared so other
// screens don't re-implement the web/native differences.
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFS from 'expo-file-system/legacy';
import { Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { openPdfWeb, reservePdfTab } from './openPdfWeb';

export type PickedPdf = { name: string; b64: string; size: number };

export async function pickPdf(): Promise<PickedPdf | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const f = res.assets[0];
  let b64 = '';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(f.uri)).blob();
    b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result || '').split(',')[1] || '');
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(blob);
    });
  } else {
    b64 = await LegacyFS.readAsStringAsync(f.uri, { encoding: 'base64' as any });
  }
  return { name: f.name || 'meeting.pdf', b64, size: f.size || 0 };
}

/** Call synchronously in the tap handler, before any await (web pop-up rules). */
export function reservePdfWindow() {
  return Platform.OS === 'web' ? reservePdfTab() : null;
}

/** Returns a problem string when nothing could be shown. */
export async function openPdfBase64(b64: string, fileName: string, reserved: Window | null): Promise<string | null> {
  if (Platform.OS === 'web') {
    return openPdfWeb(b64, 'application/pdf', fileName, reserved) || null;
  }
  const path = `${Paths.cache.uri}${Date.now()}-${fileName.replace(/[^\w.-]+/g, '_')}`.replace(/^file:\/\//, '');
  await LegacyFS.writeAsStringAsync(path, b64, { encoding: 'base64' as any });
  const uri = path.startsWith('/') ? `file://${path}` : path;
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileName });
    return null;
  }
  return "This device can't open PDFs here.";
}
