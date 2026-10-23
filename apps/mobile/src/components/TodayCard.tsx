import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createTodayStyles } from '@/styles/todayStyles';
import { WhyLink } from '@/components/WhySheet';
import { ManualLogSheet } from '@/components/ManualLogSheet';
import type { TodayZone } from '@/services/agroFlowApi';
import { useI18n, type TranslationKey } from '@/i18n';
import { adviceOverLimit, zoneMaxRunMinutes } from '@/lib/runLimit';
import { useSimpleView } from '@/components/visual/AppearanceControls';

const LEVEL_LABEL: Record<'high' | 'medium' | 'low', TranslationKey> = {
  high: 'today.confHigh', medium: 'today.confMedium', low: 'today.confLow',
};

type Props = {
  zone: TodayZone;
  onLogged: () => void;
};

// One card per zone: today's action, how sure we are, and an "I watered" button.
// The wording comes from the server; nothing is calculated on the phone.
export function TodayCard({ zone, onLogged }: Props) {
  const { simple } = useSimpleView();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const [sheet, setSheet] = useState<'water' | 'feel' | null>(null);

  const actionStyle =
    zone.action.kind === 'water' ? styles.actionWater : zone.action.kind === 'kit' ? styles.actionKit : null;

  return (
    <View style={styles.card} testID={`today-${zone.zoneId}`}>
      <Text style={styles.zoneName}>{zone.name}</Text>
      <Text style={[styles.action, actionStyle, simple && { fontSize: 24, lineHeight: 34 }]}>{zone.action.text}</Text>
      {/* Longer than one run can be: say so instead of cutting the advice short. */}
      {adviceOverLimit(zone.recommendedMinutes, zone.maxRunMinutes) ? (
        <Text style={styles.overLimit} testID={`today-over-limit-${zone.zoneId}`}>
          {t('today.overLimit', { recommended: zone.recommendedMinutes ?? 0, max: zoneMaxRunMinutes(zone.maxRunMinutes) })}
        </Text>
      ) : null}
      <WhyLink explanation={zone.why} compact />

      {zone.confidence && (
        <View
          style={styles.badgeRow}
          accessibilityLabel={t('today.confidenceA11y', { level: t(LEVEL_LABEL[zone.confidence.level]), reason: zone.confidence.reason })}
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
