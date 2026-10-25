// The Kit tab's words. The server (KitHealth) decides each line's state from what the kit really
// reports; this only turns a line into a sentence in the farmer's language. Times are SAST.
import { Platform, Share } from 'react-native';
import { translate, type Language, type TranslationKey } from '@/i18n';
import { formatSast } from '@/lib/sastTime';
import type { KitLine } from '@/services/agroFlowApi';

// "just now", "12 min ago", "3 hours ago", "yesterday", "4 days ago": the kit screen's wording.
export function describeAgo(lang: Language, iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return translate(lang, 'sensor.justNow');
  if (minutes < 60) return translate(lang, 'sensor.minAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(lang, 'sensor.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? translate(lang, 'kit.yesterday') : translate(lang, 'sensor.daysAgo', { n: days });
}

export function kitLineText(lang: Language, line: KitLine, now = Date.now()): string {
  const key = (state: string) => `kitTab.line.${line.key}.${state}` as TranslationKey;
  switch (line.key) {
    case 'connection': {
      const when = describeAgo(lang, line.at, now);
      return when ? translate(lang, key(line.state), { when }) : translate(lang, 'kitTab.line.connection.never');
    }
    case 'pump':
      return translate(lang, key(line.state), { time: formatSast(line.at) ?? '' });
    case 'backlog':
      return translate(lang, key(line.state), { count: line.value ?? '0' });
    case 'firmware': {
      const [version, latest] = (line.value ?? '').split('|');
      return translate(lang, key(line.state), { version: version ?? '', latest: latest ?? '' });
    }
    case 'safety': {
      const [minutes, lost] = (line.value ?? '').split('|');
      return translate(lang, key(line.state), { minutes: minutes ?? '', lost: lost ?? '' });
    }
    default:
      return translate(lang, key(line.state));
  }
}

// Copy on the web (the browser's clipboard). A phone build has no clipboard module (adding one
// would need a new native build for phones already on 2.3.0, which take over-the-air updates),
// so it opens the share sheet, which has its own Copy. Returns 'copied', 'shared' or 'failed'.
export async function copyOrShare(text: string): Promise<'copied' | 'shared' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    await Share.share({ message: text });
    return 'shared';
  } catch {
    return 'failed';
  }
}
