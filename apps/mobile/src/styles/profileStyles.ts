import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors } from '@/constants/colors';

export function createProfileStyles(
  colors: AppColors
) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    page: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    scrollContent: {
      paddingHorizontal: Spacing.four,
      paddingBottom: 140,
    },

    topBar: {
      minHeight: 54,
      marginBottom: 16,
      paddingTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor:
        colors.background,
    },

    profileErrorBox: {
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor:
        colors.errorBackground,
      borderRadius: Radius.sm,
    },

    profileErrorText: {
      fontSize: Type.caption,
      lineHeight: 15,
      color:
        colors.error,
    },

    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    backArrow: {
      marginRight: 5,
      fontSize: Type.display,
      lineHeight: 30,
      color:
        colors.navigationText,
    },

    backText: {
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.navigationText,
    },

    editButton: {
      height: 48,
      paddingHorizontal: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primaryDark,
      borderRadius: Radius.sm,
    },

    editButtonText: {
      fontSize: Type.caption,
      fontWeight: '700',
      color:
        colors.white,
    },

    cancelTopButton: {
      height: 48,
      paddingHorizontal: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.navigation,
      borderWidth: 1,
      borderColor:
        colors.navigationMuted,
      borderRadius: Radius.md,
    },

    cancelTopText: {
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.navigationText,
    },

    header: {
      marginTop: 16,
      marginBottom: 24,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
      borderRadius: Radius.none,
    },

    initialsBox: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderRadius: Radius.full,
    },

    initials: {
      fontSize: Type.title,
      fontWeight: '700',
      color:
        colors.white,
    },

    headerText: {
      flex: 1,
      marginLeft: 13,
    },

    name: {
      fontSize: Type.title,
      fontWeight: '700',
      color:
        colors.text,
    },

    role: {
      marginTop: 4,
      fontSize: Type.caption,
      color:
        colors.textSecondary,
    },

    sectionTitle: {
      marginTop: 6,
      marginBottom: 10,
      fontSize: Type.body,
      fontWeight: '700',
      color:
        colors.text,
    },

    sectionCard: {
      marginBottom: 22,
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
      borderRadius: Radius.none,
      overflow: 'hidden',
    },

    infoRow: {
      minHeight: 50,
      paddingHorizontal: 13,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor:
        colors.border,
    },

    lastInfoRow: {
      borderBottomWidth: 0,
    },

    infoLabel: {
      flex: 1,
      fontSize: Type.caption,
      color:
        colors.textSecondary,
    },

    infoValue: {
      flex: 1.5,
      fontSize: Type.caption,
      fontWeight: '600',
      textAlign: 'right',
      color:
        colors.text,
    },

    formCard: {
      padding: 14,
      marginBottom: 10,
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
      borderRadius: Radius.none,
    },

    inputGroup: {
      marginBottom: 15,
    },

    lastInputGroup: {
      marginBottom: 0,
    },

    inputLabel: {
      marginBottom: 6,
      fontSize: Type.caption,
      fontWeight: '600',
      color:
        colors.text,
    },

    input: {
      height: 48,
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

    readOnlyInput: {
      opacity: 0.65,
      color:
        colors.textSecondary,
    },

    saveButton: {
      height: 48,
      marginBottom: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primaryDark,
      borderRadius: Radius.sm,
    },

    saveButtonText: {
      fontSize: Type.caption,
      fontWeight: '700',
      color:
        colors.white,
    },

    disabledButton: {
      opacity: 0.55,
    },

    logoutButton: {
      height: 48,
      marginTop: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.error,
      borderRadius: Radius.md,
    },

    changePasswordButton: {
      height: 48,
      marginTop: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.primary,
      borderRadius: Radius.md,
    },

    changePasswordText: {
      fontSize: Type.caption,
      fontWeight: '700',
      color:
        colors.primary,
    },

    logoutText: {
      fontSize: Type.caption,
      fontWeight: '700',
      color:
        colors.error,
    },
  });
}
