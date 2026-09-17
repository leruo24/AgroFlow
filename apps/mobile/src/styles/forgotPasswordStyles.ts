import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors } from '@/constants/colors';

export function createForgotPasswordStyles(
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
      paddingTop: 12,
      paddingBottom: 24,
      backgroundColor:
        colors.background,
    },

    topBar: {
      minHeight: 48,
      justifyContent: 'center',
      marginBottom: 12,
    },

    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
    },

    backArrow: {
      marginRight: 5,
      fontSize: Type.display,
      lineHeight: 30,
      color:
        colors.text,
    },

    backText: {
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 45,
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
      marginTop: 6,
      maxWidth: 330,
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

    infoBox: {
      marginTop: Spacing.four,
      paddingTop: Spacing.three,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor:
        colors.divider,
    },

    infoTitle: {
      fontSize: Type.caption,
      fontWeight: '700',
      color:
        colors.text,
    },

    infoText: {
      marginTop: 4,
      fontSize: Type.caption,
      lineHeight: 15,
      color:
        colors.textSecondary,
    },

    // Success reads through the label colour and copy, not a bordered panel.
    successBox: {
      marginBottom: Spacing.three,
      paddingVertical: Spacing.three,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor:
        colors.divider,
    },

    successLabel: {
      fontSize: Type.caption,
      fontWeight: '700',
      color:
        colors.secondaryDark,
    },

    successEmail: {
      marginTop: 7,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    secondaryButton: {
      height: 48,
      marginTop: Spacing.two,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor:
        colors.border,
      borderRadius: Radius.sm,
    },

    secondaryButtonText: {
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.primaryDark,
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