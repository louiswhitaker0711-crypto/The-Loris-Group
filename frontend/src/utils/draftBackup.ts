/**
 * Unsaved notes kept on the phone (the Owner, 3 Nov 2026: a BA lost her
 * notes). Whatever is typed is written here straight away, so closing the
 * app, losing signal or the phone reloading the page mid-save never loses
 * it: the screen puts it back next time it opens. Cleared once the server
 * has it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'loris-draft:';

export type Backup<T> = { value: T; at: number; pending: boolean; open?: any };

export async function readBackup<T>(key: string): Promise<Backup<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Backup<T>) : null;
  } catch {
    return null;
  }
}

export function writeBackup<T>(key: string, value: T, pending = true, open?: any): void {
  try {
    AsyncStorage.setItem(PREFIX + key, JSON.stringify({ value, at: Date.now(), pending, open })).catch(() => {});
  } catch {}
}

export function clearBackup(key: string): void {
  try { AsyncStorage.removeItem(PREFIX + key).catch(() => {}); } catch {}
}

/** Run fn when the app goes to the background or the page is closing. */
export function onLeave(fn: () => void): () => void {
  const subs: (() => void)[] = [];
  try {
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      const vis = () => { if (document.visibilityState === 'hidden') fn(); };
      document.addEventListener('visibilitychange', vis);
      window.addEventListener('pagehide', fn);
      subs.push(() => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', fn); });
    }
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppState } = require('react-native');
    const sub = AppState.addEventListener('change', (s: string) => { if (s !== 'active') fn(); });
    subs.push(() => sub?.remove?.());
  } catch {}
  return () => subs.forEach((u) => u());
}
