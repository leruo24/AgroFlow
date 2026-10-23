import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors, Space, Layout } from '@/constants/colors';

export function createSettingsStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    page: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      marginBottom: Space.xl,
      paddingHorizontal: Space.lg,
      paddingTop: Space.xl,
      paddingBottom: Space.xs,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: Type.display,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      marginTop: 3,
      fontSize: Type.caption,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    scrollContent: {
      paddingHorizontal: Layout.gutter,
      paddingBottom: 140,
    },
    sectionTitle: {
      marginTop: Space.xs,
      marginBottom: Space.sm,
      fontSize: Type.body,
      fontWeight: '700',
      color: colors.text,
    },
    sectionCard: { marginBottom: Spacing.three },
    settingRow: {
      minHeight: 54,
      paddingHorizontal: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    selectedRow: {},
    settingTitle: {
      fontSize: Type.body,
      fontWeight: '600',
      color: colors.text,
    },
    currentTheme: {
      marginBottom: Space.lg,
      fontSize: Type.caption,
      color: colors.secondaryDark,
    },
    // Radius.full, not Radius.sm: these are circular radio buttons.
    radio: {
      width: 20,
      height: 20,
      borderRadius: Radius.full,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: {
      borderColor: colors.primary,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: Radius.full,
      backgroundColor: colors.action,
    },
    notificationRow: {
      minHeight: 70,
      paddingHorizontal: 0,
      paddingVertical: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    notificationText: {
      flex: 1,
    },
    settingDescription: {
      marginTop: Space.xs,
      fontSize: Type.caption,
      lineHeight: 16,
      color: colors.text,
    },
    note: {
      marginTop: 2,
      marginBottom: Space.lg,
      fontSize: Type.caption,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    profileButton: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    profileText: {
      fontSize: Type.body,
      fontWeight: '600',
      color: colors.text,
    },
    // Unlink Telegram stops every message until the farmer connects again, so it reads as a warning.
    dangerText: {
      fontSize: Type.body,
      fontWeight: '600',
      color: colors.error,
    },
    arrow: {
      fontSize: Type.title,
      color: colors.text,
    },

    // A status word plus the chevron, on the trailing edge of a row.
    rowTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
    },

    // Connected / Not connected shows the word as well as the colour. "Not connected" is not
    // an error and must not look like a red one.
    statusConnected: {
      fontSize: Type.caption,
      fontWeight: '600',
      color: colors.success,
    },
    statusNotConnected: {
      fontSize: Type.caption,
      color: colors.textSecondary,
    },
  });
}
