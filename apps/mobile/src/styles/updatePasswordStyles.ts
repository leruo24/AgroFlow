import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors } from '@/constants/colors';

export function createUpdatePasswordStyles(
  colors: AppColors
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    keyboardView: {
      flex: 1,
    },

    scrollContent: {
      flexGrow: 1,
    },

    container: {
      flex: 1,
      minHeight: 650,
      paddingHorizontal: 20,
      paddingTop: 70,
      paddingBottom: 24,
      backgroundColor:
        colors.background,
    },

    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 48,
    },

    brandMark: {
      width: 13,
      height: 28,
      marginRight: 9,
      backgroundColor:
        colors.primary,
    },

    brandName: {
      fontSize: Type.title,
      fontWeight: '700',
      color:
        colors.text,
    },

    brandSubtitle: {
      marginTop: 1,
      fontSize: Type.caption,
      color:
        colors.textSecondary,
    },

    title: {
      fontSize: Type.display,
      fontWeight: '700',
      color:
        colors.text,
    },

    description: {
      marginTop: 6,
      marginBottom: 22,
      maxWidth: 340,
      fontSize: Type.body,
      lineHeight: 19,
      color:
        colors.textSecondary,
    },

    errorBox: {
      marginBottom: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor:
        colors.errorBackground,
      borderRadius: Radius.sm,
    },

    errorText: {
      fontSize: Type.caption,
      lineHeight: 16,
      color:
        colors.error,
    },

    // No card around the form - inputs carry their own boundaries.
    form: {
      paddingTop: Spacing.one,
    },

    inputLabel: {
      marginBottom: 7,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    confirmLabel: {
      marginTop: 16,
      marginBottom: 7,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    input: {
      height: 52,
      paddingHorizontal: 12,
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      fontSize: Type.body,
      color:
        colors.text,
    },

    // Matches the app's single filled accent CTA treatment.
    primaryButton: {
      height: 56,
      marginTop: Spacing.four,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primaryDark,
      borderRadius: Radius.sm,
    },

    primaryButtonText: {
      fontSize: Type.body,
      fontWeight: '700',
      color:
        colors.white,
    },

    disabledButton: {
      opacity: 0.55,
    },

    footer: {
      marginTop: 'auto',
      paddingTop: 30,
      textAlign: 'center',
      fontSize: Type.caption,
      color:
        colors.textSecondary,
    },
  });
}
