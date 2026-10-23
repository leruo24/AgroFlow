import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors, Space } from '@/constants/colors';

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
      paddingHorizontal: Space.lg,
      paddingTop: 70,
      paddingBottom: Space.xl,
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
      marginRight: Space.sm,
      backgroundColor:
        colors.action,
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
      marginTop: Space.xs,
      marginBottom: Space.xl,
      maxWidth: 340,
      fontSize: Type.body,
      lineHeight: 19,
      color:
        colors.textSecondary,
    },

    errorBox: {
      marginBottom: Space.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
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

    // No card around the form; the inputs have their own borders.
    form: {
      paddingTop: Spacing.one,
    },

    inputLabel: {
      marginBottom: Space.sm,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    confirmLabel: {
      marginTop: Space.lg,
      marginBottom: Space.sm,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    input: {
      height: 52,
      paddingHorizontal: Space.md,
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      fontSize: Type.body,
      color:
        colors.text,
    },

    // Same filled accent button as the rest of the app.
    primaryButton: {
      height: 56,
      marginTop: Spacing.four,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.action,
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
      paddingTop: Space.xxl,
      textAlign: 'center',
      fontSize: Type.caption,
      color:
        colors.textSecondary,
    },
  });
}
