import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';

// Styles for the Alerts section of the History screen.
// The filters are chips, not dropdowns: there are only a few options, and a chip shows the
// current choice without opening anything.
export function createAlertHistoryStyles(colors: AppColors) {
  return StyleSheet.create({
    filterGroup: { gap: Spacing.two, marginBottom: Spacing.two },
    filterLabel: {
      fontSize: Type.label,
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },

    chip: {
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      minHeight: 36,
      justifyContent: 'center',
    },
    // Selection is shown by border and text weight as well as the fill, so it works in
    // greyscale and sunlight.
    chipSelected: {
      borderWidth: 2,
      borderColor: colors.primaryDark,
      backgroundColor: colors.surfaceSecondary,
    },
    chipText: { fontSize: Type.caption, color: colors.textSecondary },
    chipTextSelected: { fontSize: Type.caption, fontWeight: '700', color: colors.text },

    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
    itemTitle: { flex: 1, fontSize: Type.body, fontWeight: '600', color: colors.text },

    // The status word ("New", "Seen", "Dismissed") is always written out, never colour alone.
    statusNew: {
      fontSize: Type.label,
      fontWeight: '700',
      color: colors.primaryDark,
    },
    statusSeen: { fontSize: Type.label, color: colors.textMuted },

    kindTag: {
      fontSize: Type.label,
      color: colors.textMuted,
      textTransform: 'uppercase',
    },
  });
}
