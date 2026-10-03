import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';

// Styles for the Alerts section of the History screen.
//
// The filters are chips rather than dropdowns: there are only a few options
// per row, and a chip shows the current choice without being opened. On a
// phone in a field, a dropdown is two taps and a modal to answer "am I
// looking at 7 days or 30?".
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
    // Selection is carried by the border weight and the text weight as well
    // as the fill, so it survives greyscale and sunlight.
    chipSelected: {
      borderWidth: 2,
      borderColor: colors.primaryDark,
      backgroundColor: colors.surfaceSecondary,
    },
    chipText: { fontSize: Type.caption, color: colors.textSecondary },
    chipTextSelected: { fontSize: Type.caption, fontWeight: '700', color: colors.text },

    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
    itemTitle: { flex: 1, fontSize: Type.body, fontWeight: '600', color: colors.text },

    // The status word. Never colour alone - "New", "Seen" and "Dismissed" are
    // spelled out, because the difference between them is the whole point of
    // the column.
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
