import { StyleSheet } from 'react-native';
import { Type, Radius, Spacing, type AppColors } from '@/constants/colors';

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
      marginBottom: 22,
      paddingHorizontal: 18,
      paddingTop: 24,
      paddingBottom: 6,
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
      paddingHorizontal: Spacing.four,
      paddingBottom: 140,
    },
    sectionTitle: {
      marginTop: 6,
      marginBottom: 10,
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
      marginBottom: 18,
      fontSize: Type.caption,
      color: colors.secondaryDark,
    },
    // Radius.full, not Radius.sm - these are circular radio controls, and a
    // mechanical token swap had turned them into rounded squares.
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
      backgroundColor: colors.primary,
    },
    notificationRow: {
      minHeight: 70,
      paddingHorizontal: 0,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    notificationText: {
      flex: 1,
    },
    settingDescription: {
      marginTop: 4,
      fontSize: Type.caption,
      lineHeight: 16,
      color: colors.text,
    },
    note: {
      marginTop: 2,
      marginBottom: 18,
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

    // Connected / Not connected. Carries the WORD as well as the colour -
    // "Not connected" is not a failure and must not read as a red error, and
    // neither state may depend on colour alone to be understood.
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
