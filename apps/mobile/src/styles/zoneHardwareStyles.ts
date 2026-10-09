import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Styles for the Kit screen.
// Status first, big and in words: a farmer opens this to find out whether the box in their
// field is talking to us, so the answer is one line in title type, not a coloured dot.
// Status never relies on colour alone: every state has its own words ("Online", "Offline,
// last seen ...", "Working", "Not responding"), so it reads correctly in sunlight, in
// greyscale and for colour-blind farmers.
export function createZoneHardwareStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },

    // Status
    statusCard: {
      gap: Spacing.one,
      padding: Spacing.three,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    statusCardOnline: { borderColor: colors.success, backgroundColor: colors.successBackground },
    statusCardOffline: { borderColor: colors.warning, backgroundColor: colors.warningBackground },

    statusHeadline: { fontSize: Type.title, fontWeight: '700', color: colors.text },
    statusDetail: { fontSize: Type.body, lineHeight: 22, color: colors.textSecondary },

    // Sections
    section: { gap: Spacing.two },
    sectionTitle: { fontSize: Type.title, fontWeight: '600', color: colors.text },

    // Hairline rows instead of boxed cards, the app's usual pattern for a list of facts (see
    // `divider` in constants/colors.ts).
    row: {
      ...sharedLayout.inlineRow,
      justifyContent: 'space-between',
      minHeight: 48,
      paddingVertical: Spacing.two,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      gap: Spacing.three,
    },
    rowLast: { borderBottomWidth: 0 },

    rowLabel: { flex: 1, fontSize: Type.body, color: colors.text },
    rowValue: { fontSize: Type.body, fontWeight: '600', color: colors.text, textAlign: 'right' },
    rowValueMuted: { fontSize: Type.body, color: colors.textSecondary, textAlign: 'right' },
    rowValueWarning: { fontSize: Type.body, fontWeight: '600', color: colors.warning, textAlign: 'right' },
    rowNote: { fontSize: Type.caption, lineHeight: 19, color: colors.textSecondary },

    // Change WiFi
    primaryButton: {
      ...sharedLayout.inlineRow,
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: Radius.sm,
      backgroundColor: colors.primaryDark,
    },
    primaryButtonBusy: { opacity: 0.6 },
    primaryButtonText: { fontSize: Type.body, fontWeight: '600', color: colors.white },

    // The instructions sheet
    sheetBody: { gap: Spacing.three, paddingBottom: Spacing.three },
    sheetIntro: { fontSize: Type.body, lineHeight: 23, color: colors.text },

    step: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
    stepNumber: {
      width: 26,
      height: 26,
      borderRadius: Radius.full,
      backgroundColor: colors.primaryDark,
      color: colors.white,
      fontSize: Type.caption,
      fontWeight: '700',
      textAlign: 'center',
      lineHeight: 26,
      overflow: 'hidden',
    },
    stepText: { flex: 1, fontSize: Type.body, lineHeight: 23, color: colors.text },

    // The network name and password must be typed exactly, so they stand apart from the
    // sentence around them.
    credential: {
      fontSize: Type.body,
      fontWeight: '700',
      color: colors.text,
    },
    credentialBlock: {
      gap: Spacing.one,
      padding: Spacing.three,
      borderRadius: Radius.sm,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    credentialLabel: { fontSize: Type.label, color: colors.textMuted, textTransform: 'uppercase' },

    // Messages
    offlineBlock: {
      gap: Spacing.two,
      padding: Spacing.three,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.warning,
      backgroundColor: colors.warningBackground,
    },
    offlineText: { fontSize: Type.body, lineHeight: 23, color: colors.text },
    offlineHint: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },

    error: { fontSize: Type.body, lineHeight: 22, color: colors.error },

    footnote: {
      fontSize: Type.label,
      lineHeight: 18,
      color: colors.textMuted,
    },
  });
}
