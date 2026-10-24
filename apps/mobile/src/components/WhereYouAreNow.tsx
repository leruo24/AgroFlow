// "Where you are now" on Home (B3-03): the stage, the next action, who acts next and the known
// date (or "Waiting for booking"), with "Your details: X of 4" and "Installation: <stage>" as two
// separate parts. Every fact comes from the server's journey; nothing is worked out here. Before
// migration 0058 the server has no journey and the old setup card shows instead.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { useI18n, type TranslationKey } from '@/i18n';
import { SetupCard } from '@/components/SetupCard';
import { HosepipeProgress } from '@/components/visual/SetupPresentation';
import { formatSast } from '@/lib/sastTime';
import type { JourneyState } from '@/hooks/useJourney';
import type { InstallationStatus, JourneyStage } from '@/services/agroFlowApi';

export function WhereYouAreNow({ state }: { state: JourneyState }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (state.status === 'unavailable') return <SetupCard />;
  if (state.status === 'loading') {
    return <View style={styles.card} testID="where-loading" accessibilityLiveRegion="polite">
      <Text style={styles.label}>{t('journey.loading')}</Text>
    </View>;
  }
  const j = state.journey;
  if (!j) {
    return <View style={styles.card} testID="where-error"><Text style={styles.label}>{t('journey.unavailable')}</Text></View>;
  }
  const w = j.whereYouAreNow;
  const details = j.setupProgress;
  // Live, with nothing left for the farmer: the card has done its job.
  if (j.installation.live && details.done >= details.total) return null;
  const who = t(`journey.who.${w.whoActsNext}` as TranslationKey);
  const date = w.knownDate ? formatSast(w.knownDate) ?? w.dateLabel : t(`journey.date.${w.stage}` as TranslationKey);
  const openHelp = j.helpRequests.filter(h => h.status === 'open').length;
  // RET-10: Account, Your details and Installation are three separate lines. The installation line
  // never names an account stage ("Installation: account active" was the retest's finding).
  const installation = j.installation.status ?? installationStatusOf(j.installation.stage);
  return <View style={styles.card} testID="where-you-are-now">
    <Text accessibilityRole="header" style={styles.title}>{t('journey.title')}</Text>
    {j.account ? <Text style={styles.label} testID="where-account">{t(`journey.account.${j.account.status}` as TranslationKey)}</Text> : null}
    <HosepipeProgress completed={details.done} installationStage={j.installation.stage}
      label={t('journey.details', { done: details.done, total: details.total })}
      installationText={t('journey.installation', { stage: t(`journey.install.${installation}` as TranslationKey) })}
      detailsTestID="where-details" installationTestID="where-installation" />
    <Text style={styles.next} testID="where-next">{t(`journey.next.${w.stage}` as TranslationKey, { done: details.done, total: details.total })}</Text>
    <Text style={styles.label}>{t('journey.whoNext', { who })}</Text>
    <Text style={styles.label} testID="where-date">{t('journey.when', { date })}</Text>
    {openHelp > 0 ? <Text style={styles.label}>{t('journey.helpOpen', { count: openHelp })}</Text> : null}
    {details.done < details.total ? <Pressable accessibilityRole="button" style={styles.button} testID="where-continue"
      onPress={() => router.push('/setup' as never)}>
      <Text style={styles.buttonText}>{t('journey.continue')}</Text>
    </Pressable> : null}
  </View>;
}

// The installation on its own, for a server that does not send installation.status yet: every
// stage before "ready for installation" is "not booked yet".
export function installationStatusOf(stage: JourneyStage): InstallationStatus {
  switch (stage) {
    case 'ready_for_installation': return 'waiting_for_booking';
    case 'visit_booked': return 'visit_booked';
    case 'installing': return 'installing';
    case 'commissioned': return 'commissioned';
    default: return 'not_booked';
  }
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: Spacing.three },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '700' },
    next: { color: colors.text, fontSize: Type.body, lineHeight: 22 },
    label: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    button: { minHeight: 48, borderRadius: Radius.sm, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
    buttonText: { color: colors.white, fontSize: Type.body, fontWeight: '700' },
  });
}
