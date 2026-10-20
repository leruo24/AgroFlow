import { StyleSheet } from 'react-native';
import { Layout, Space, TypeScale, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Shared styles used by two or more screens (Alerts, History, Irrigation, and partly Home).
// Anything used by only one screen goes in that screen's own <name>Styles.ts (see
// homeStyles.ts and irrigationStyles.ts). The bottom padding is not here: each screen adds
// useBottomPadding() (hooks/useScreenPadding.ts) so the floating tab bar never covers the end.
export function createScreenStyles(colors: AppColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: Layout.gutter },
    // A section heading: 24 above it, 12 down to its first card.
    sectionTitle: { color: colors.text, fontSize: TypeScale.section, fontWeight: '600', marginTop: Layout.sectionGap, marginBottom: Layout.headingToCard },
    summary: { flexDirection: 'row', paddingVertical: Space.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    stat: { flex: 1, gap: Space.xs },
    statValue: { color: colors.text, fontSize: 24, fontWeight: '600' },
    caption: { color: colors.textSecondary, fontSize: TypeScale.label, lineHeight: 20 },
    row: { paddingVertical: Space.xl, gap: Space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    rowTop: { ...sharedLayout.inlineRow },
    title: { flex: 1, color: colors.text, fontSize: TypeScale.section, fontWeight: '600' },
    body: { color: colors.text, fontSize: TypeScale.body, lineHeight: 23 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space.md, marginVertical: Space.sm },
    metric: { width: '50%', paddingRight: Space.sm, gap: Space.xs },
    buttonText: { color: colors.primaryDark, fontSize: TypeScale.body, fontWeight: '600' },
  });
}
