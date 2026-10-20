import { Platform, StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';

export function createDripHelperStyles(colors: AppColors) {
  return StyleSheet.create({
    // pointerEvents 'box-none' on the container lets taps through everywhere except the drop
    // and the bubble.
    container: {
      position: 'absolute',
      right: Spacing.three,
      alignItems: 'flex-end',
      gap: Spacing.two,
      maxWidth: '86%',
    },

    bubbleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.one,
    },

    bubble: {
      flexShrink: 1,
      paddingVertical: Spacing.two,
      paddingHorizontal: Spacing.three,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      // A soft shadow so the bubble looks like it floats above the page.
      ...Platform.select({
        web: { boxShadow: '0px 3px 8px rgba(0, 0, 0, 0.12)' },
        default: {
          shadowColor: colors.black,
          shadowOpacity: 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        },
      }),
    },
    bubbleText: {
      fontSize: Type.caption,
      lineHeight: 19,
      color: colors.text,
    },

    // A large target on purpose: a small close button on a floating element is easy to miss.
    close: {
      width: 28,
      height: 28,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },

    drop: {
      alignSelf: 'flex-end',
    },
  });
}
