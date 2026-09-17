import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors } from '@/constants/colors';

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
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 24,
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
        colors.text,
    },

    heading: {
      marginBottom: 22,
    },

    title: {
      fontSize: Type.display,
      fontWeight: '700',
      color:
        colors.text,
    },

    description: {
      marginTop: 5,
      fontSize: Type.body,
      color:
        colors.text,
    },

    // Tint without an outline: still a non-colour-only affordance for the
    // error, without the heavy bordered container the rest of the app dropped.
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

    // No card around the form - the inputs carry their own boundaries, so
    // wrapping them in a second bordered surface was a nested container.
    form: {
      paddingTop: Spacing.one,
    },

    inputGroup: {
      marginBottom: 18,
    },

    inputLabel: {
      marginBottom: 7,
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
      marginBottom: 7,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.primaryDark,
    },

    input: {
      height: 52,
      paddingHorizontal: 12,
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
      paddingHorizontal: 12,
      fontSize: Type.body,
      color:
        colors.text,
    },

    showButton: {
      height: '100%',
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },

    showButtonText: {
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.primaryDark,
    },

    // Matches the single filled accent CTA used on Home (screenStyles
    // primaryAction): primaryDark fill, Radius.sm, no outline.
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
      paddingTop: 30,
      textAlign: 'center',
      fontSize: Type.caption,
      color:
        colors.text,
    },
  });
}
