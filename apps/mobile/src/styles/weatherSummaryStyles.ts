import { StyleSheet } from 'react-native';
import { Spacing, Type, type AppColors } from '@/constants/colors';

export function createWeatherSummaryStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { paddingVertical: Spacing.four, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: Spacing.two },
    headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
    temperature: { fontSize: Type.display, color: colors.text, fontWeight: '700' },
    condition: { flex: 1, color: colors.textSecondary, fontSize: Type.body },
    detail: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 21 },
    fallback: { color: colors.warning, fontSize: Type.caption, lineHeight: 21 },
    updated: { color: colors.textSecondary, fontSize: Type.caption },
  });
}
