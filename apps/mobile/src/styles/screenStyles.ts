import { StyleSheet } from 'react-native';
import { Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Shared styles used by two or more screens (Alerts, History, Irrigation, and partly Home).
// Anything used by only one screen goes in that screen's own <name>Styles.ts (see
// homeStyles.ts and irrigationStyles.ts).
export function createScreenStyles(colors: AppColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: Spacing.four, paddingBottom: 140 },
    sectionTitle: { color: colors.text, fontSize: Type.title, fontWeight: '600', marginTop: Spacing.four, marginBottom: Spacing.two },
    summary: { flexDirection: 'row', paddingVertical: Spacing.four, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    stat: { flex: 1, gap: Spacing.one },
    statValue: { color: colors.text, fontSize: 24, fontWeight: '600' },
    caption: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    row: { paddingVertical: Spacing.four, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    rowTop: { ...sharedLayout.inlineRow },
    title: { flex: 1, color: colors.text, fontSize: Type.title, fontWeight: '600' },
    body: { color: colors.text, fontSize: Type.body, lineHeight: 23 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginVertical: Spacing.two },
    metric: { flexGrow: 1, minWidth: '40%' },
    buttonText: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600' },
  });
}
