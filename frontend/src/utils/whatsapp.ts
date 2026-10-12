// Send text to WhatsApp, or copy it. wa.me opens the WhatsApp app (phone) or
// WhatsApp Web, with the message ready to send to a chosen chat or group.
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export async function openInWhatsApp(text: string): Promise<void> {
  await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
}

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
