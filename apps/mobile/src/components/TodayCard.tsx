import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createTodayStyles } from '@/styles/todayStyles';
import { WhyLink } from '@/components/WhySheet';
import { ManualLogSheet } from '@/components/ManualLogSheet';
import type { AdviceProvenance, TodayZone } from '@/services/agroFlowApi';
import { useI18n, type TranslationKey } from '@/i18n';
import { adviceOverLimit, zoneMaxRunMinutes } from '@/lib/runLimit';
import { adviceText } from '@/lib/advice';
import { confidenceText } from '@/lib/confidenceText';
import { useSimpleView } from '@/components/visual/AppearanceControls';

const LEVEL_LABEL: Record<'high' | 'medium' | 'low', TranslationKey> = {
  high: 'today.confHigh', medium: 'today.confMedium', low: 'today.confLow',
};

type Props = {
  zone: TodayZone;
  onLogged: () => void;
};

// AF-18: which crop model and which days of weather the advice used, and when it was worked out,
// so a September gap in an October card is explained, not a mystery.
export function provenanceText(t: (k: TranslationKey, p?: Record<string, string | number>) => string, p: AdviceProvenance): string {
  const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '');
  const at = new Date(p.calculatedAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = [
    p.cropModelLabel ? (p.cropModelIsDefault ? t('today.provenance.cropModel', { model: p.cropModelLabel }) : t('today.provenance.crop', { model: p.cropModelLabel })) : t('today.provenance.noCrop'),
    p.weatherFrom ? t('today.provenance.weather', { from: day(p.weatherFrom), to: day(p.weatherTo) }) : t('today.provenance.noWeather'),
  ];
  if (p.missingWeatherDays.length) parts.push(t('today.provenance.missing', { days: p.missingWeatherDays.map(day).join(', ') }));
  parts.push(t('today.provenance.at', { at }));
  return parts.join(' · ');
}

// One card per zone: today's action, how sure we are, and an "I watered" button.
// The wording comes from the server; nothing is calculated on the phone.
export function TodayCard({ zone, onLogged }: Props) {
  const { simple } = useSimpleView();
  const { colors } = useTheme();
  const { t, lang } = useI18n();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const advice = adviceText(lang, zone.action);
  const [sheet, setSheet] = useState<'water' | 'feel' | null>(null);

  const actionStyle =
    zone.action.kind === 'water' ? styles.actionWater : zone.action.kind === 'kit' ? styles.actionKit : null;

  return (
    <View style={styles.card} testID={`today-${zone.zoneId}`}>
      <Text style={styles.zoneName}>{zone.name}</Text>
      {/* The advice in the farmer's language from its code (AF-02); the server's English only as a marked fallback. */}
      <Text style={[styles.action, actionStyle, simple && { fontSize: 24, lineHeight: 34 }]}>{advice.text}</Text>
      {advice.english ? <Text style={styles.provenance} testID={`today-english-${zone.zoneId}`}>{t('advice.englishOnly')}</Text> : null}
      {/* Longer than one run can be: say so instead of cutting the advice short. */}
      {adviceOverLimit(zone.recommendedMinutes, zone.maxRunMinutes) ? (
        <Text style={styles.overLimit} testID={`today-over-limit-${zone.zoneId}`}>
          {t('today.overLimit', { recommended: zone.recommendedMinutes ?? 0, max: zoneMaxRunMinutes(zone.maxRunMinutes) })}
        </Text>
      ) : null}
      <WhyLink explanation={zone.why} compact />
      {zone.provenance ? <Text style={styles.provenance} testID={`today-provenance-${zone.zoneId}`}>{provenanceText(t, zone.provenance)}</Text> : null}

      {zone.confidence && (
        <View
          style={styles.badgeRow}
          accessibilityLabel={t('today.confidenceA11y', { level: t(LEVEL_LABEL[zone.confidence.level]), reason: confidenceText(t, zone.confidence) })}
        >
          <Text style={styles.badge}>{t(LEVEL_LABEL[zone.confidence.level])}</Text>
          <WhyLink explanation={zone.confidenceExplanation} compact />
        </View>
      )}

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={() => setSheet('water')} style={styles.button}>
          <Text style={styles.buttonText}>{t('today.iWatered')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setSheet('feel')} style={styles.ghost}>
          <Text style={styles.ghostText}>{t('today.soilFeel')}</Text>
        </Pressable>
        {/* What a zone's advice still lacks is now the setup wizard's job: Home shows one
            "Setup 4/6 done — Continue" card instead of a Finish setup button on each zone. */}
      </View>

      <ManualLogSheet
        zoneId={zone.zoneId}
        zoneName={zone.name}
        mode={sheet}
        onClose={() => setSheet(null)}
        onSaved={onLogged}
      />
    </View>
  );
}
