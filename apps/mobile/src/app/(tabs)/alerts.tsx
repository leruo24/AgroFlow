// Alerts tab screen 
import {
  useMemo,
} from 'react';

import {
  useRouter,
} from 'expo-router';

import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import type {
  AppColors,
} from '@/constants/colors';

import {
  useAgroFlow,
} from '@/context/AgroFlowContext';

import {
  useTheme,
} from '@/context/ThemeContext';

export default function AlertsScreen() {
  const router =
    useRouter();

  const {
    alerts,
    markAlertAsRead,
  } = useAgroFlow();

  const {
    colors,
  } = useTheme();

  const styles =
    useMemo(
      () =>
        createStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const unreadCount =//calculating unread alerts by filtering the alerts array to count how many alerts have the read property set to false. This count is stored in the unreadCount variable and is used to display the number of unread alerts in the UI.
    alerts.filter(
      (
        alert
      ) =>
        !alert.read
    ).length;

  return (
    <SafeAreaView
      style={
        styles.safeArea
      }
      edges={[
        'top',
      ]}
    >
      <ScrollView
        style={
          styles.page
        }
        showsVerticalScrollIndicator={
          false
        }
        stickyHeaderIndices={[]}
        contentContainerStyle={
          styles.scrollContent
        }
      >
        <View
          style={
            styles.header
          }
        >
          <Text
            style={
              styles.title
            }
          >
            Alerts
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            Monitor important farm and irrigation events.
          </Text>
        </View>

        <View
          style={
            styles.summaryRow
          }
        >
          <View
            style={
              styles.summaryCard
            }
          >
            <Text
              style={
                styles.summaryValue
              }
            >
              {
                alerts.length
              }
            </Text>

            <Text
              style={
                styles.summaryLabel
              }
            >
              Total Alerts
            </Text>
          </View>

          <View
            style={
              styles.summaryCard
            }
          >
            <Text
              style={
                styles.summaryValue
              }
            >
              {
                unreadCount
              }
            </Text>

            <Text
              style={
                styles.summaryLabel
              }
            >
              Unread
            </Text>
          </View>
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Farm Alerts
        </Text>

        {alerts.length ===
        0 ? (
          <View
            style={
              styles.emptyCard
            }
          >
            <Text
              style={
                styles.emptyTitle
              }
            >
              No alerts
            </Text>

            <Text
              style={
                styles.emptyText
              }
            >
              Farm and irrigation alerts will appear here.
            </Text>
          </View>
        ) : (
          <View
            style={
              styles.alertList
            }
          >
            {alerts.map(
              (
                alert
              ) => {
                const alertColor =
                  getAlertColor(
                    alert.type,
                    colors
                  );

                return (
                  <TouchableOpacity
                    key={
                      alert.id
                    }
                    style={[
                      styles.alertCard,

                      {
                        borderLeftColor:
                          alertColor,
                      },

                      !alert.read &&
                        styles.unreadCard,
                    ]}
                    activeOpacity={
                      0.75
                    }
                    onPress={() => {//changes alert state to read when tapped, this is done by calling the markAlertAsRead function from the AgroFlowContext and passing in the alert ID as a parameter. This updates the alert's read property to true, indicating that the alert has been read by the user.
                      if (
                        !alert.read
                      ) {
                        markAlertAsRead(
                          alert.id
                          );
                      }

                      if (
                        alert.zoneId
                      ) {
                        router.push({
                          pathname:
                            '/zone/[id]',
                          params: {
                            id:
                              alert.zoneId,
                          },
                        });
                      }
                    }}
                  >
                    <View
                      style={
                        styles.alertTop
                      }
                    >
                      <Text
                        style={
                          styles.alertTitle
                        }
                      >
                        {
                          alert.title
                        }
                      </Text>

                      <Text
                        style={[
                          styles.alertType,

                          {
                            color:
                              alertColor,
                          },
                        ]}
                      >
                        {formatAlertType(
                          alert.type
                        )}
                      </Text>
                    </View>

                    <Text
                      style={
                        styles.alertMessage
                      }
                    >
                      {
                        alert.message
                      }
                    </Text>

                    <View
                      style={
                        styles.alertMeta
                      }
                    >
                      <Text
                        style={
                          styles.zoneText
                        }
                      >
                        {alert.zone
                          ? alert.zone
                          : 'Farm'}
                      </Text>

                      <Text
                        style={
                          styles.timeText
                        }
                      >
                        {formatAlertTime(
                          alert.timestamp
                        )}
                      </Text>
                    </View>

                    {!alert.read && (
                      <Text
                        style={
                          styles.unreadText
                        }
                      >
                        {alert.zoneId
                          ? 'Tap to view zone'
                          : 'Tap to mark as read'}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getAlertColor(
  type: string,
  colors: AppColors
) {
  if (
    type ===
    'critical'
  ) {
    return colors.error;
  }

  if (
    type ===
    'warning'
  ) {
    return colors.warning;
  }

  if (
    type ===
    'success'
  ) {
    return colors.secondaryDark;
  }

  return colors.primaryDark;
}

function formatAlertType(
  type: string
) {
  if (
    type ===
    'critical'
  ) {
    return 'Critical';
  }

  if (
    type ===
    'warning'
  ) {
    return 'Warning';
  }

  if (
    type ===
    'success'
  ) {
    return 'Resolved';
  }

  return 'Info';
}

function formatAlertTime(
  timestamp: string
) {
  const date =
    new Date(
      timestamp
    );

  return date.toLocaleString(
    'en-ZA',
    {
      day:
        'numeric',
      month:
        'short',
      hour:
        '2-digit',
      minute:
        '2-digit',
    }
  );
}

function createStyles(
  colors: AppColors
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor:
        colors.navigation,
    },

    page: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 35,
    },

    header: {
      marginHorizontal: -18,
      marginBottom: 16,
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 6,
      backgroundColor:
        colors.navigation,
    },

    title: {
      fontSize: 20,
      fontWeight: '700',
      color:
        colors.navigationText,
    },

    subtitle: {
      marginTop: 3,
      fontSize: 12,
      lineHeight: 17,
      color:
        colors.navigationMuted,
    },

    summaryRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 25,
    },

    summaryCard: {
      flex: 1,
      minHeight: 76,
      padding: 12,
      justifyContent: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    summaryValue: {
      fontSize: 21,
      fontWeight: '700',
      color:
        colors.secondaryDark,
    },

    summaryLabel: {
      marginTop: 4,
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    sectionTitle: {
      marginBottom: 10,
      fontSize: 16,
      fontWeight: '700',
      color:
        colors.text,
    },

    alertList: {
      gap: 12,
    },

    alertCard: {
      padding: 14,
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
      borderLeftWidth: 4,
    },

    unreadCard: {
      backgroundColor:
        colors.surfaceSecondary,
    },

    alertTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },

    alertTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color:
        colors.text,
    },

    alertType: {
      fontSize: 10,
      fontWeight: '700',
    },

    alertMessage: {
      marginTop: 7,
      fontSize: 12,
      lineHeight: 18,
      color:
        colors.text,
    },

    alertMeta: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },

    zoneText: {
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.text,
    },

    timeText: {
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    unreadText: {
      marginTop: 8,
      fontSize: 9,
      color:
        colors.primaryDark,
    },

    emptyCard: {
      padding: 18,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    emptyTitle: {
      fontSize: 14,
      fontWeight: '700',
      color:
        colors.text,
    },

    emptyText: {
      marginTop: 5,
      fontSize: 11,
      color:
        colors.textSecondary,
    },
  });
}
