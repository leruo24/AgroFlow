import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Styles for the Soil type screen.
// The three cards are large: this is a once-a-season choice made standing in a field, often
// one-handed, so each card is a big target with room for two lines of plain explanation.
export function createZoneSoilStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },

    hint: { fontSize: Type.body, lineHeight: 23, color: colors.textSecondary },
    hintStrong: { fontWeight: '600', color: colors.text },

    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.three,
      padding: Spacing.three,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      minHeight: 96,
    },
    // The selected card has a thicker brand-coloured border and a check icon, so selection
    // never relies on colour alone.
    cardSelected: {
      borderWidth: 2,
      borderColor: colors.primaryDark,
      backgroundColor: colors.surfaceSecondary,
    },

    cardBody: { flex: 1, gap: Spacing.one },
    cardHeading: { ...sharedLayout.inlineRow, justifyContent: 'space-between' },
    cardTitle: { fontSize: Type.title, fontWeight: '600', color: colors.text },
    cardFeel: { fontSize: Type.body, lineHeight: 22, color: colors.text },
    cardMeans: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },

    saveButton: {
      ...sharedLayout.inlineRow,
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: Radius.sm,
      backgroundColor: colors.primaryDark,
      marginTop: Spacing.two,
    },
    saveButtonBusy: { opacity: 0.6 },
    saveButtonText: { fontSize: Type.body, fontWeight: '600', color: colors.white },

    message: { fontSize: Type.body, color: colors.success },
    error: { fontSize: Type.body, color: colors.error },

    sourceNote: {
      fontSize: Type.label,
      lineHeight: 18,
      color: colors.textMuted,
      marginTop: Spacing.three,
    },
  });
}
