import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HelpCircle } from 'lucide-react-native';

import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { BlurSheet } from '@/components/BlurSheet';
import { helpFor, type HelpScreen } from '@/constants/helpContent';
import { FieldGuide } from '@/components/visual/FieldGuide';
import { useAppPreferences } from '@/hooks/useAppPreferences';
import { useI18n } from '@/i18n';

type Props = {
  screen: HelpScreen;
};

// A small circled "?" for a screen's header. Tapping it opens a sheet explaining the page.
// Renders nothing when "Show page help" is off. The text lives in constants/helpContent.ts,
// so there is one file to edit.
export function HelpButton({ screen }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createHelpButtonStyles(colors), [colors]);
  const { preferences } = useAppPreferences();
  const [open, setOpen] = useState(false);

  if (!preferences.showPageHelp) return null;

  const topic = helpFor(screen);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('helpButton.label')}
        accessibilityHint={t('helpButton.hint')}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={styles.button}
      >
        <HelpCircle size={20} color={colors.textSecondary} strokeWidth={1.8} />
      </Pressable>

      <BlurSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={topic.title}
        maxHeightRatio={0.6}
      >
        <View style={styles.body}>
          {topic.body.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
          <FieldGuide />
        </View>
      </BlurSheet>
    </>
  );
}

function createHelpButtonStyles(colors: AppColors) {
  return StyleSheet.create({
    button: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { gap: Spacing.three, paddingBottom: Spacing.two },
    paragraph: { fontSize: Type.body, lineHeight: 23, color: colors.text },
  });
}
