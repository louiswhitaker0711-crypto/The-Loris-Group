/**
 * The office's own ID badge maker (BADGE_MAKER_URL in theme/brand.ts), opened
 * in a new tab. When it is set, every badge button in the app opens it instead
 * of the built-in Badge Studio.
 */
import { Linking, Platform } from 'react-native';
import { BADGE_MAKER_URL } from '../theme/brand';

export const usesExternalBadgeMaker = !!BADGE_MAKER_URL;

export function openBadgeMaker(): void {
  if (!BADGE_MAKER_URL) return;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(BADGE_MAKER_URL, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(BADGE_MAKER_URL).catch(() => {});
}
