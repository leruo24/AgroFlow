import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HelpCircle } from 'lucide-react-native';

import { BlurSheet } from '@/components/BlurSheet';
import type { AppColors } from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import type { Explanation } from '@/services/agroFlowApi';
import { Space } from '@/constants/colors';
import { useI18n } from '@/i18n';

// "Why am I seeing this?" under every piece of advice, alert, badge and Drip message.
// The words come from the server (built by the same rule as the message) and are shown as
// they are: summary, what we used, the rule, how sure, what would change it. The technical
// line is never shown here. No explanation means no link, never a generic text.

// The English, for tests and older callers; the screens use t('why.link') (RET-06).
export const WHY_LINK_TEXT = 'Why am I seeing this?';

export function WhyLink({
  explanation,
  compact,
  onOpen,
}: {
  explanation?: Explanation | null;
  compact?: boolean;
  // Lets a host that hides itself on a timer (Drip) stay put while the sheet is open.
  onOpen?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  if (!explanation || !explanation.summary) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('why.link')}
        hitSlop={8}
        onPress={() => {
          onOpen?.();
          setOpen(true);
        }}
        style={[styles.link, compact && styles.linkCompact]}
      >
        <HelpCircle size={14} color={colors.primaryDark} strokeWidth={1.8} />
        <Text style={styles.linkText}>{t('why.link')}</Text>
      </Pressable>

      <WhySheet explanation={explanation} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function WhySheet({
  explanation,
  visible,
  onClose,
}: {
  explanation: Explanation;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <BlurSheet visible={visible} onClose={onClose} title={t('why.link')}>
      <View style={styles.body}>
        <Text style={styles.summary}>{explanation.summary}</Text>

        {explanation.facts?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.heading}>{t('why.used')}</Text>
            {explanation.facts.map((fact) => (
              <View key={`${fact.label}-${fact.value}`} style={styles.fact}>
                <Text style={styles.factLabel}>{fact.label}</Text>
                <Text style={styles.factValue}>{fact.value}</Text>
                <Text style={styles.factSource}>{fact.source}</Text>
              </View>
            ))}
          </View>
        )}

        {!!explanation.rule && (
          <View style={styles.section}>
            <Text style={styles.heading}>{t('why.rule')}</Text>
            <Text style={styles.text}>{explanation.rule}</Text>
          </View>
        )}

        {!!explanation.confidence && (
          <View style={styles.section}>
            <Text style={styles.heading}>{t('why.sure')}</Text>
            <Text style={styles.text}>{explanation.confidence}</Text>
          </View>
        )}

        {!!explanation.whatWouldChangeIt && (
          <View style={styles.section}>
            <Text style={styles.heading}>{t('why.change')}</Text>
            <Text style={styles.text}>{explanation.whatWouldChangeIt}</Text>
          </View>
        )}
      </View>
    </BlurSheet>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      marginTop: Space.xs,
      minHeight: 32,
      alignSelf: 'flex-start',
    },
    linkCompact: { marginTop: 2, minHeight: 28 },
    linkText: { color: colors.primaryDark, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
    body: { paddingHorizontal: Space.lg, paddingBottom: Space.sm, gap: Space.md },
    summary: { color: colors.text, fontSize: 16, fontWeight: '600', lineHeight: 22 },
    section: { gap: Space.xs },
    heading: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    text: { color: colors.text, fontSize: 15, lineHeight: 21 },
    fact: { paddingVertical: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    factLabel: { color: colors.textSecondary, fontSize: 13 },
    factValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
    factSource: { color: colors.textSecondary, fontSize: 12 },
  });
}
