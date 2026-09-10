import {
  StyleSheet,
} from 'react-native';

import type {
  AppColors,
} from '@/constants/colors';

export function createHomeStyles(
  colors: AppColors
) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 35,
    },

    topBar: {
      minHeight: 48,
      marginHorizontal: -18,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor:
        colors.surface,
    },

    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },

    logoMark: {
      fontSize: 18,
      color:
        colors.primaryDark,
    },

    brand: {
      fontSize: 22,
      fontWeight: '700',
      color:
        colors.text,
    },

    profileButton: {
      paddingVertical: 8,
      paddingLeft: 12,
    },

    profileText: {
      fontSize: 15,
      fontWeight: '700',
      color:
        colors.text,
    },

    headerDivider: {
      height: 1,
      marginHorizontal: -18,
      backgroundColor:
        colors.border,
    },

    farmHeader: {
      paddingTop: 10,
      paddingBottom: 8,
    },

    farmName: {
      fontSize: 20,
      fontWeight: '700',
      color:
        colors.text,
    },

    farmLocation: {
      marginTop: 4,
      fontSize: 12,
      color:
        colors.textSecondary,
    },

    weatherHero: {
      backgroundColor:
        colors.weatherBackground,
      borderWidth: 1,
      borderColor:
        colors.weatherBorder,
    },

    weatherHeader: {
      minHeight: 45,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor:
        colors.weatherBorder,
    },

    weatherCity: {
      fontSize: 13,
      fontWeight: '600',
      color:
        colors.text,
    },

    updatedText: {
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    weatherContent: {
      minHeight: 148,
      flexDirection: 'row',
    },

    weatherMain: {
      width: '49%',
      paddingHorizontal: 16,
      paddingVertical: 17,
      justifyContent: 'center',
      borderRightWidth: 1,
      borderRightColor:
        colors.weatherBorder,
    },

    temperature: {
      fontSize: 40,
      lineHeight: 45,
      fontWeight: '700',
      color:
        colors.text,
    },

    condition: {
      marginTop: 5,
      fontSize: 14,
      fontWeight: '700',
      color:
        colors.text,
    },

    feelsLike: {
      marginTop: 7,
      fontSize: 11,
      color:
        colors.textSecondary,
    },

    weatherDetails: {
      flex: 1,
    },

    weatherDetailRow: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor:
        colors.weatherBorder,
    },

    weatherDetailLast: {
      borderBottomWidth: 0,
    },

    weatherDetailLabel: {
      fontSize: 11,
      color:
        colors.text,
    },

    weatherDetailValue: {
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.text,
      textAlign: 'right',
    },

    weatherMessage: {
      minHeight: 150,
      padding: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },

    weatherLoading: {
      fontSize: 12,
      color:
        colors.textSecondary,
    },

    weatherUnavailable: {
      marginTop: 7,
      fontSize: 13,
      fontWeight: '600',
      color:
        colors.textSecondary,
    },

    dashboardButton: {
      height: 44,
      marginTop: 9,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor:
        colors.surfaceSecondary,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    dashboardButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color:
        colors.primaryDark,
    },

    dashboardArrow: {
      fontSize: 22,
      lineHeight: 22,
      color:
        colors.primaryDark,
    },

    sectionTitle: {
      marginTop: 22,
      marginBottom: 9,
      fontSize: 16,
      fontWeight: '700',
      color:
        colors.text,
    },

    statusGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 8,
    },

    statusCard: {
      width: '48.5%',
      minHeight: 66,
      paddingHorizontal: 12,
      paddingVertical: 10,
      justifyContent: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    statusValue: {
      fontSize: 18,
      fontWeight: '700',
      color:
        colors.text,
    },

    statusLabel: {
      marginTop: 3,
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    actionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 9,
    },

    actionCard: {
      width: '48.5%',
      height: 58,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderWidth: 1,
      borderColor:
        colors.primaryDark,
    },

    actionCardAqua: {
      backgroundColor:
        colors.primary,
      borderColor:
        colors.primaryDark,
    },

    actionCardSage: {
      backgroundColor:
        colors.primary,
      borderColor:
        colors.primaryDark,
    },

    actionTitle: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
      color:
        colors.white,
    },

    badge: {
      position: 'absolute',
      top: 6,
      right: 6,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.warning,
    },

    badgeText: {
      fontSize: 9,
      fontWeight: '700',
      color:
        colors.white,
    },

    activityHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    viewAll: {
      marginTop: 22,
      marginBottom: 9,
      fontSize: 11,
      fontWeight: '700',
      color:
        colors.primaryDark,
    },

    activityTable: {
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    activityRow: {
      minHeight: 56,
      paddingHorizontal: 12,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor:
        colors.border,
    },

    lastActivityRow: {
      borderBottomWidth: 0,
    },

    activityMain: {
      flex: 1,
    },

    activityTitle: {
      fontSize: 12,
      fontWeight: '600',
      color:
        colors.text,
    },

    activityZone: {
      marginTop: 3,
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    activityTime: {
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    emptyActivity: {
      minHeight: 60,
      alignItems: 'center',
      justifyContent: 'center',
    },

    emptyActivityText: {
      fontSize: 11,
      color:
        colors.textSecondary,
    },
  });
}