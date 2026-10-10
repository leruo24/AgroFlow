import { StyleSheet } from 'react-native';
import { Radius, Spacing, type AppColors } from '@/constants/colors';

// Irrigation-only styles. Shared row/section/summary styles are in screenStyles.ts.
export function createIrrigationStyles(colors: AppColors) {
  return StyleSheet.create({
    secondaryButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.three },
  });
}
