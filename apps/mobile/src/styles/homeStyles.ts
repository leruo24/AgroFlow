import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';

// Home-only styles. Shared row/section/summary styles are in screenStyles.ts; these two
// are only used here (the filled button and its secondary nav rows).
export function createHomeStyles(colors: AppColors) {
  return StyleSheet.create({
    // The one filled accent element per screen, the main action. Everything else stays neutral
    // (see docs/ui_reference).
    primaryAction: { minHeight: 56, paddingHorizontal: Spacing.three, borderRadius: Radius.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: colors.primaryDark, marginBottom: Spacing.two },
    primaryActionText: { flex: 1, color: colors.white, fontSize: Type.body, fontWeight: '600' },
    // Secondary navigation rows: icon, label, optional detail, chevron, hairline divider. No
    // fill, border or radius.
    actionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    actionText: { flex: 1, color: colors.text, fontSize: Type.body, fontWeight: '500' },
    tankCard: { paddingVertical: Spacing.three, gap: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    tankEstimate: { color: colors.text, fontSize: Type.title, lineHeight: 25, fontWeight: '600' },
    tankLink: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600', paddingVertical: Spacing.two },
  });
}
