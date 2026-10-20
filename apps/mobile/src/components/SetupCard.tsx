// Home's "Setup X/17 done — Continue": opens the setup wizard at the first step still to do,
// and is gone once setup is complete. It also carries the soil reminder: after a dry reading,
// the wet one is what it asks for next.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { Radius, Spacing, Type } from '@/constants/colors';
import { useI18n, type TranslationKey } from '@/i18n';
import { useSetup } from '@/hooks/useSetup';
import { doneCount, resumeStep, setupComplete } from '@/lib/setupProgress';

export function SetupCard() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { ready, facts } = useSetup();
  const styles = useMemo(() => StyleSheet.create({
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryDark, marginBottom: Spacing.three },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '700' },
    hint: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 22 },
    track: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
    button: { minHeight: 52, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: colors.white, fontSize: Type.body, fontWeight: '700' },
  }), [colors]);

  if (!ready || setupComplete(facts)) return null;

  const { done, total } = doneCount(facts);
  const step = resumeStep(facts);
  const wetDue = step === 'soil' ? facts.zones.find(z => z.hasKit && z.drySaved && !z.wetSaved) : undefined;
  const hint = wetDue ? t('setup.card.wet', { zone: wetDue.name })
    : t('setup.card.next', { task: t(`setup.task.${step}` as TranslationKey) });

  return <View style={styles.card} testID="setup-card">
    <Text style={styles.title}>{t('setup.card.title', { done, total })}</Text>
    <View style={styles.track}><View style={[styles.fill, { width: `${(done / total) * 100}%` }]} /></View>
    <Text style={styles.hint}>{hint}</Text>
    <Pressable accessibilityRole="button" style={styles.button} testID="setup-card-continue"
      onPress={() => router.push(`/setup?step=${step}` as never)}>
      <Text style={styles.buttonText}>{t('setup.card.continue')}</Text>
    </Pressable>
  </View>;
}
