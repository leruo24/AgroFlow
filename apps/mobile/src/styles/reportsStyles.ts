import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors, Layout } from '@/constants/colors';
import { sharedLayout } from './shared';

// Styles for the Reports screen: a short request form, then the list of requests.
// The form uses chips instead of dropdowns, like the alert-history filters: three or four
// visible options per question, so it feels like three quick choices, not paperwork.
export function createReportsStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: Layout.gutter, gap: Spacing.three },

    group: { gap: Spacing.two },
    groupLabel: { fontSize: Type.label, color: colors.textMuted, textTransform: 'uppercase' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },

    chip: {
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      minHeight: 40,
      justifyContent: 'center',
    },
    chipSelected: {
      borderWidth: 2,
      borderColor: colors.primaryDark,
      backgroundColor: colors.surfaceSecondary,
    },
    chipText: { fontSize: Type.caption, color: colors.textSecondary },
    chipTextSelected: { fontSize: Type.caption, fontWeight: '700', color: colors.text },

    hint: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },

    dateRow: { flexDirection: 'row', gap: Spacing.two },
    dateField: { flex: 1, gap: Spacing.one },
    dateLabel: { fontSize: Type.label, color: colors.textMuted },
    dateInput: {
      minHeight: 44,
      paddingHorizontal: Spacing.three,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: Type.body,
    },

    submit: {
      ...sharedLayout.inlineRow,
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: Radius.sm,
      backgroundColor: colors.primaryDark,
      marginTop: Spacing.two,
    },
    submitBusy: { opacity: 0.6 },
    submitText: { fontSize: Type.body, fontWeight: '600', color: colors.white },

    sectionTitle: {
      fontSize: Type.title,
      fontWeight: '600',
      color: colors.text,
      marginTop: Spacing.four,
    },

    itemHeader: { ...sharedLayout.inlineRow, justifyContent: 'space-between' },
    itemTitle: { flex: 1, fontSize: Type.body, fontWeight: '600', color: colors.text },
    itemMeta: { fontSize: Type.caption, color: colors.textSecondary },

    // Status never relies on colour: each state has its own word.
    statusReady: { fontSize: Type.label, fontWeight: '700', color: colors.success },
    statusPreparing: { fontSize: Type.label, color: colors.textSecondary },
    statusFailed: { fontSize: Type.label, fontWeight: '700', color: colors.error },

    openButton: {
      alignSelf: 'flex-start',
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.primaryDark,
      marginTop: Spacing.one,
    },
    openButtonText: { fontSize: Type.caption, fontWeight: '600', color: colors.primaryDark },

    autoCard: {
      gap: Spacing.two,
      padding: Spacing.three,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    autoTitle: { fontSize: Type.body, fontWeight: '700', color: colors.text },
    autoBody: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },
    autoStop: {
      alignSelf: 'flex-start',
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    autoStopText: { fontSize: Type.caption, fontWeight: '600', color: colors.text },

    error: { fontSize: Type.body, lineHeight: 22, color: colors.error },
    message: { fontSize: Type.body, lineHeight: 22, color: colors.success },
  });
}
