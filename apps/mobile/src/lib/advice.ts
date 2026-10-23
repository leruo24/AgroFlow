// Today's advice in the farmer's language (AF-02). The API sends a stable code and its values
// (TodayAction.Code / Args, e.g. "water.now.minutes" with { minutes, litres }); the sentence is
// built here from the dictionary. When the code is unknown (an older server, or a new code this
// app does not know yet) the server's English sentence is shown, and the screen says it is in
// English: an identified fallback, never a silent one. Older history saved as English text is
// shown the same way.
import { translate, type Language, type TranslationKey } from '@/i18n';
import en from '@/i18n/en.json';

export type AdviceAction = { kind: string; text: string; code?: string | null; args?: Record<string, string> | null };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const SETUP_FIELDS = ['crop', 'planting_date', 'flow_rate', 'area', 'soil', 'calibration', 'kit'] as const;

const known = (key: string): key is TranslationKey => Object.prototype.hasOwnProperty.call(en.strings, key);

export function adviceText(lang: Language, action: AdviceAction): { text: string; english: boolean } {
  const code = action.code ?? '';
  const args = { ...(action.args ?? {}) } as Record<string, string>;
  if (code === 'soon.on' && args.weekday != null) {
    const day = WEEKDAYS[Number(args.weekday)];
    if (day) args.day = translate(lang, `advice.day.${day}` as TranslationKey);
  }
  if (code === 'setup.next') {
    const field = (SETUP_FIELDS as readonly string[]).includes(args.field ?? '') ? args.field : null;
    if (!field) return { text: action.text, english: lang !== 'en' };
    return { text: translate(lang, `advice.setup.${field}` as TranslationKey), english: false };
  }
  const key = `advice.${code}`;
  if (code && known(key)) return { text: translate(lang, key, args), english: false };
  return { text: action.text, english: lang !== 'en' };
}
