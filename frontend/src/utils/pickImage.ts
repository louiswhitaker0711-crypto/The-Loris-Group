/**
 * Take a photo or choose one from the library: one picker for everywhere a
 * photo goes in (the Owner, 13 Nov 2026). Resolves with the picked image, or
 * null if they cancel.
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { showAlert } from './showAlert';
import { api } from '../api/client';

type Opts = { title?: string; message?: string; square?: boolean; quality?: number };

async function fromCamera(o: Opts) {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) { showAlert('Camera access needed', 'Allow camera access in your settings to take a photo.'); return null; }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: o.quality ?? 0.85,
    ...(o.square ? { allowsEditing: true, aspect: [1, 1] as [number, number] } : {}) });
  return res.canceled ? null : res.assets?.[0] || null;
}

async function fromLibrary(o: Opts) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) { showAlert('Photo access needed', 'Allow photo access in your settings to pick a photo.'); return null; }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: o.quality ?? 0.85,
    ...(o.square ? { allowsEditing: true, aspect: [1, 1] as [number, number] } : {}) });
  return res.canceled ? null : res.assets?.[0] || null;
}

export function pickImage(o: Opts = {}): Promise<ImagePicker.ImagePickerAsset | null> {
  return new Promise((resolve) => {
    const go = (f: (o: Opts) => Promise<ImagePicker.ImagePickerAsset | null>) => () => {
      f(o).then(resolve).catch(() => resolve(null));
    };
    showAlert(o.title || 'Add a photo', o.message, [
      { text: 'Take photo', onPress: go(fromCamera) },
      { text: 'Choose from library', onPress: go(fromLibrary) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

/** Pick (camera or library), shrink, and upload a photo for a note. Returns its URL. */
export async function pickNotePhoto(): Promise<string | null> {
  const a = await pickImage();
  if (!a?.uri) return null;
  const wide = (a.width || 0) >= (a.height || 0);
  const resize = Math.max(a.width || 0, a.height || 0) > 1600 ? [{ resize: wide ? { width: 1600 } : { height: 1600 } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, resize as any, { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!out.base64) return null;
  const { data } = await api.post('/notes/photo', { image: `data:image/jpeg;base64,${out.base64}` }, { timeout: 60_000 });
  return data?.url || null;
}
