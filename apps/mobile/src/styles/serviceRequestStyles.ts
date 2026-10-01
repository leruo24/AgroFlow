import { StyleSheet } from 'react-native';

import {
  Spacing,
  Type,
} from '@/constants/colors';

export function createServiceRequestStyles(
  colors: any
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },

    keyboardView: {
      flex: 1,
    },

    page: {
      flex: 1,
      backgroundColor: colors.background,
    },

    scrollContent: {
      paddingHorizontal: Spacing.four,
      paddingTop: Spacing.three,
      paddingBottom: Spacing.six,
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.four,
    },

    backButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Spacing.two,
    },

    backText: {
      fontSize: 34,
      lineHeight: 38,
      color: colors.text,
    },

    headerText: {
      flex: 1,
    },

    title: {
      fontSize: Type.title,
      fontWeight: '700',
      color: colors.text,
    },

    subtitle: {
      marginTop: Spacing.one,
      fontSize: Type.body,
      lineHeight: 21,
      color: colors.muted,
    },

    sectionTitle: {
      marginTop: Spacing.four,
      marginBottom: Spacing.two,
      fontSize: Type.label,
      fontWeight: '700',
      color: colors.text,
    },

    optionGroup: {
      gap: Spacing.two,
    },

    option: {
      minHeight: 64,
      padding: Spacing.three,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
      justifyContent: 'center',
    },

    farmOption: {
      minHeight: 64,
      padding: Spacing.three,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
      justifyContent: 'center',
    },

    optionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },

    optionTitle: {
      fontSize: Type.body,
      fontWeight: '600',
      color: colors.text,
    },

    optionDescription: {
      marginTop: 4,
      fontSize: Type.caption,
      lineHeight: 18,
      color: colors.muted,
    },

    loadingBox: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.three,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },

    loadingText: {
      marginLeft: Spacing.two,
      fontSize: Type.body,
      color: colors.muted,
    },

    infoBox: {
      padding: Spacing.three,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },

    infoText: {
      fontSize: Type.body,
      lineHeight: 21,
      color: colors.muted,
    },

    input: {
      minHeight: 48,
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
      fontSize: Type.body,
      color: colors.text,
    },

    notesInput: {
      minHeight: 120,
      paddingTop: Spacing.three,
    },

    helperText: {
      marginTop: Spacing.one,
      fontSize: Type.caption,
      lineHeight: 18,
      color: colors.muted,
    },

    cropGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.two,
    },

    cropOption: {
      minHeight: 48,
      paddingHorizontal: Spacing.three,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },

    cropSelected: {
      borderColor: colors.primary,
    },

    cropText: {
      fontSize: Type.body,
      color: colors.text,
    },

    submitButton: {
      minHeight: 52,
      marginTop: Spacing.five,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },

    submitButtonDisabled: {
      opacity: 0.6,
    },

    submitText: {
      fontSize: Type.body,
      fontWeight: '700',
      color: colors.white,
    },

    footerNote: {
      marginTop: Spacing.three,
      textAlign: 'center',
      fontSize: Type.caption,
      lineHeight: 18,
      color: colors.muted,
    },
  });
}