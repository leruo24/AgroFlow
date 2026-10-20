import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors, Space } from '@/constants/colors';

export function createLoginStyles(
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
      backgroundColor:
        colors.background,
    },

    scrollContent: {
      flexGrow: 1,
    },

    container: {
      flex: 1,
      minHeight: 650,
      paddingHorizontal: Space.lg,
      paddingTop: Space.xl,
      paddingBottom: Space.xl,
      backgroundColor:
        colors.background,
    },

    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 55,
    },

    brandMark: {
      width: 13,
      height: 28,
      marginRight: Space.sm,
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
        colors.text,
    },

    heading: {
      marginBottom: Space.xl,
    },

    title: {
      fontSize: Type.display,
      fontWeight: '700',
      color:
        colors.text,
    },

    description: {
      marginTop: Space.xs,
      fontSize: Type.body,
      color:
        colors.text,
    },

    // A tint without an outline, so the error does not rely on colour alone without a heavy box.
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

    inputGroup: {
      marginBottom: Space.lg,
    },

    inputLabel: {
      marginBottom: Space.sm,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    passwordLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    forgotText: {
      marginBottom: Space.sm,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.primaryDark,
    },

    input: {
      height: 52,
      paddingHorizontal: Space.md,
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      borderRadius: Radius.sm,
      fontSize: Type.body,
      color:
        colors.text,
    },

    passwordInput: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      borderRadius: Radius.sm,
    },

    passwordTextInput: {
      flex: 1,
      height: '100%',
      paddingHorizontal: Space.md,
      fontSize: Type.body,
      color:
        colors.text,
    },

    showButton: {
      height: '100%',
      paddingHorizontal: Space.md,
      alignItems: 'center',
      justifyContent: 'center',
    },

    showButtonText: {
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.primaryDark,
    },

    // Same filled accent button as Home (screenStyles primaryAction): primaryDark fill,
    // Radius.sm, no outline.
    loginButton: {
      height: 56,
      marginTop: Spacing.two,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primaryDark,
      borderRadius: Radius.sm,
    },

    loginButtonDisabled: {
      opacity: 0.55,
    },

    loginButtonText: {
      fontSize: Type.body,
      fontWeight: '700',
      color:
        colors.white,
    },

    footer: {
      marginTop: 'auto',
      paddingTop: Space.xxl,
      textAlign: 'center',
      fontSize: Type.caption,
      color:
        colors.text,
    },
  });
}
