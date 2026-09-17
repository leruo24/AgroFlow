import { StyleSheet } from 'react-native';
import { Spacing, Type, type AppColors } from '@/constants/colors';

export function createScreenHeaderStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.four },
    titleColumn: { flex: 1 },
    title: { color: colors.text, fontSize: Type.display, fontWeight: '700' },
    subtitle: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 22, marginTop: Spacing.two },
  });
}
