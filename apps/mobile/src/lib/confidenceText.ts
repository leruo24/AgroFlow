// RET-06: the advice confidence reason in the farmer's language. The server sends the English
// (reason) and a stable code with its args (ConfidenceRules.Confidence.Code/Args); the sentence
// is built here from the string catalogue. An unknown code, or an older server with no code,
// shows the English reason as it is.
import type { TranslationKey } from '@/i18n';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
export type ConfidenceLike = { level: 'high' | 'medium' | 'low'; reason: string; code?: string; args?: Record<string, string> };

const BECAUSE = new Set(['kit_quiet', 'kit_never', 'planting_date', 'flow_rate', 'area', 'soil', 'calibration', 'crop']);

export function confidenceText(t: T, c: ConfidenceLike): string {
  const level = t(`confidence.level.${c.level}` as TranslationKey);
  switch (c.code) {
    case 'no_crop':
    case 'no_weather':
    case 'all_agree':
    case 'sensor_disagree':
      return t(`confidence.${c.code}` as TranslationKey);
    case 'partial': {
      const basis = c.args?.basis === 'own_check' ? 'own_check' : c.args?.basis === 'weather' ? 'weather' : null;
      const because = c.args?.because;
      if (!basis || !because) break;
      if (because === 'own_check') return t('confidence.sentence.basisOnly', { level, basis: t(`confidence.basis.${basis}` as TranslationKey) });
      if (because === 'no_readings') return t('confidence.sentence.basisOnly', { level, basis: t('confidence.because.no_readings') });
      if (!BECAUSE.has(because)) break;
      return t('confidence.sentence.full', {
        level,
        basis: t(`confidence.basis.${basis}` as TranslationKey),
        because: t(`confidence.because.${because}` as TranslationKey, { date: c.args?.date ?? '' }),
      });
    }
  }
  return c.reason;
}
