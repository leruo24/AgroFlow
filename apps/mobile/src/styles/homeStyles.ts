import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';

// Home-specific styles only. Shared row/section/summary primitives live in
// screenStyles.ts - these two are used by exactly one screen (the single
// filled CTA and its secondary nav rows), so they stay here rather than
// pretending to be shared vocabulary.
export function createHomeStyles(colors: AppColors) {
  return StyleSheet.create({
    // The single filled accent element per screen - the one dominant action.
    // Everything else stays neutral, per docs/ui_reference.
    primaryAction: { minHeight: 56, paddingHorizontal: Spacing.three, borderRadius: Radius.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: colors.primaryDark, marginBottom: Spacing.two },
    primaryActionText: { flex: 1, color: colors.white, fontSize: Type.body, fontWeight: '600' },
    // Secondary navigation rows: icon, label, optional detail, chevron,
    // hairline divider. No fill, no border, no radius.
    actionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    actionText: { flex: 1, color: colors.text, fontSize: Type.body, fontWeight: '500' },
  });
}
