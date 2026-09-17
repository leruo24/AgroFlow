import { StyleSheet } from 'react-native';
import { Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

export function createFarmSelectorStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: Spacing.two },
    label: { color: colors.textSecondary, fontSize: Type.label, fontWeight: '600', letterSpacing: 1 },
    trigger: { ...sharedLayout.inlineRow, minHeight: 56 },
    triggerText: { flex: 1, color: colors.text, fontSize: Type.title, fontWeight: '600' },
    option: { ...sharedLayout.inlineRow, minHeight: 64, padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: colors.divider },
    optionTextColumn: { flex: 1 },
    optionName: { color: colors.text, fontSize: Type.body, fontWeight: '600' },
    optionNameSelected: { color: colors.primaryDark },
    optionLocation: { color: colors.textSecondary, fontSize: Type.caption, marginTop: Spacing.one },
    cancel: { minHeight: 52, justifyContent: 'center', alignItems: 'center' },
    cancelText: { color: colors.text, fontSize: Type.body },
  });
}
