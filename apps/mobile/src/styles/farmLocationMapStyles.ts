import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

export function createFarmLocationMapStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { paddingVertical: Spacing.three, borderBottomWidth: 1, borderBottomColor: colors.divider },
    row: { ...sharedLayout.inlineRow, minHeight: 48 },
    rowText: { flex: 1, fontSize: Type.body, color: colors.text },
    mapWrapper: { borderRadius: Radius.md, overflow: 'hidden', marginTop: Spacing.two },
    zoomControls: { position: 'absolute', right: 8, top: 8, backgroundColor: colors.surface, borderRadius: Radius.sm },
    zoomButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    unavailableText: { color: colors.textSecondary, fontSize: Type.caption },
  });
}
