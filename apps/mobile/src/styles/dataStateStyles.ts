import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

export function createDataStateStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { paddingVertical: Spacing.four, gap: Spacing.two },
    heading: { ...sharedLayout.inlineRow },
    title: { fontSize: Type.body, fontWeight: '600', flex: 1, color: colors.text },
    description: { fontSize: Type.body, lineHeight: 23, color: colors.textSecondary },
    retry: {
      ...sharedLayout.inlineRow,
      alignSelf: 'flex-start',
      minHeight: 48,
      paddingHorizontal: Spacing.three,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.sm,
      marginTop: Spacing.two,
    },
    retryText: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600' },
  });
}
