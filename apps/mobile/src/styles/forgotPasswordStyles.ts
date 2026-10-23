import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors, Space } from '@/constants/colors';

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
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xl,
      backgroundColor:
        colors.background,
    },

    topBar: {
      minHeight: 48,
      justifyContent: 'center',
      marginBottom: Space.md,
    },

    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
    },

    backArrow: {
      marginRight: Space.xs,
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
      maxWidth: 330,
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
      marginTop: Space.xs,
      fontSize: Type.caption,
      lineHeight: 15,
      color:
        colors.textSecondary,
    },

    // Success is shown by the label colour and text, not a bordered panel.
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
      marginTop: Space.sm,
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
      paddingTop: Space.xxl,
      textAlign: 'center',
      fontSize: Type.caption,
      color:
        colors.textSecondary,
    },
  });
}
