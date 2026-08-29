// Irrigation tab screen 
import {
  router,
} from 'expo-router';

import {
  useMemo,
} from 'react';

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

export default function IrrigationScreen() {
  const {
    zones,
    isZonesLoading,
    zonesError,
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
//summary of irrigation activity across all zones, including the number of active zones and scheduled zones
  const activeZones =
    zones.filter(
      (
        zone
      ) =>
        zone.irrigation.status ===
        'Active'
    ).length;

  const scheduledZones =
    zones.filter(
      (
        zone
      ) =>
        zone.irrigation.status ===
        'Scheduled'
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
            Irrigation
          </Text>

          <Text
            style={
              styles.subtitle
            }
          >
            Monitor and manage all irrigation zones across your farm.
          </Text>
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Irrigation Overview
        </Text>

        <View
          style={
            styles.overviewGrid
          }
        >
          <View
            style={
              styles.overviewCard
            }
          >
            <Text
              style={
                styles.overviewValue
              }
            >
              {
                zones.length
              }
            </Text>

            <Text
              style={
                styles.overviewLabel
              }
            >
              Total Zones
            </Text>
          </View>

          <View
            style={
              styles.overviewCard
            }
          >
            <Text
              style={
                styles.overviewValue
              }
            >
              {
                activeZones
              }
            </Text>

            <Text
              style={
                styles.overviewLabel
              }
            >
              Irrigating
            </Text>
          </View>

          <View
            style={
              styles.overviewCard
            }
          >
            <Text
              style={
                styles.overviewValue
              }
            >
              {
                scheduledZones
              }
            </Text>

            <Text
              style={
                styles.overviewLabel
              }
            >
              Scheduled
            </Text>
          </View>
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Irrigation Zones
        </Text>

        <View
          style={
            styles.zoneList
          }
        >
          {isZonesLoading && (
            <Text
              style={
                styles.stateText
              }
            >
              Loading zones...
            </Text>
          )}

          {!isZonesLoading &&
            zonesError && (
            <Text
              style={
                styles.errorText
              }
            >
              {zonesError}
            </Text>
          )}

          {!isZonesLoading &&
            !zonesError &&
            zones.length ===
              0 && (
            <Text
              style={
                styles.stateText
              }
            >
              No zones have been configured for this farm.
            </Text>
          )}

          {!isZonesLoading &&
            !zonesError &&
            zones.map(//zone list is created dynamically, one layout is created and reused however many zones there are in the farm, this is done by mapping through the zones array and creating a new layout for each zone
            (
              zone
            ) => {
              const soil =
                zone.sensors
                  .soilMoisture;

              const environment =
                zone.sensors
                  .temperatureHumidity;

              return (
                <TouchableOpacity
                  key={
                    String(
                      zone.id
                    )
                  }
                  style={
                    styles.zoneCard
                  }
                  activeOpacity={
                    0.75
                  }
                  onPress={() =>
                    router.push({//sends the selected zoneID to the zone page, this is done by using the router.push method and passing in the zone ID as a parameter
                      pathname:
                        '/zone/[id]',
                      params: {
                        id:
                          String(
                            zone.id
                          ),
                      },
                    })
                  }
                >
                  <View
                    style={
                      styles.zoneTop
                    }
                  >
                    <View
                      style={
                        styles.zoneHeading
                      }
                    >
                      <Text
                        style={
                          styles.zoneName
                        }
                      >
                        {
                          zone.name
                        }
                      </Text>

                    </View>

                    <Text
                      style={[
                        styles.irrigationStatus,

                        zone.irrigation
                          .status ===
                          'Active' &&
                          styles.statusActive,

                        zone.irrigation
                          .status ===
                          'Scheduled' &&
                          styles.statusScheduled,

                        zone.irrigation
                          .status ===
                          'Paused' &&
                          styles.statusPaused,
                      ]}
                    >
                      {
                        zone.irrigation
                          .status
                      }
                    </Text>
                  </View>

                  <View
                    style={
                      styles.readings
                    }
                  >
                    <View
                      style={
                        styles.readingColumn
                      }
                    >
                      <Text
                        style={
                          styles.label
                        }
                      >
                        Moisture
                      </Text>

                      <Text
                        style={
                          styles.value
                        }
                      >
                        {
                          soil.value
                        }
                        {
                          soil.unit
                        }
                      </Text>

                      <Text
                        style={
                          styles.smallText
                        }
                      >
                        {
                          soil.moistureStatus
                        }
                      </Text>
                    </View>

                    <View
                      style={
                        styles.readingColumn
                      }
                    >
                      <Text
                        style={
                          styles.label
                        }
                      >
                        Temperature
                      </Text>

                      <Text
                        style={
                          styles.value
                        }
                      >
                        {
                          environment.temperature
                        }
                        {
                          environment.temperatureUnit
                        }
                      </Text>
                    </View>

                    <View
                      style={
                        styles.readingColumn
                      }
                    >
                      <Text
                        style={
                          styles.label
                        }
                      >
                        Humidity
                      </Text>

                      <Text
                        style={
                          styles.value
                        }
                      >
                        {
                          environment.humidity
                        }
                        {
                          environment.humidityUnit
                        }
                      </Text>
                    </View>
                  </View>

                  {zone.alerts.length >
                    0 && (
                    <Text
                      style={
                        styles.alertText
                      }
                    >
                      {
                        zone.alerts.length
                      }{' '}
                      active alert
                      {
                        zone.alerts.length ===
                        1
                          ? ''
                          : 's'
                      }
                    </Text>
                  )}

                  {zone.irrigation
                    .override
                    .active && (
                    <Text
                      style={
                        styles.overrideText
                      }
                    >
                      Manual override active
                    </Text>
                  )}

                  <TouchableOpacity
                    style={
                      styles.manageButton
                    }
                    onPress={() =>
                      router.push({
                        pathname:
                          '/zone/[id]',
                        params: {
                          id:
                            String(
                              zone.id
                            ),
                        },
                      })
                    }
                    activeOpacity={
                      0.75
                    }
                  >
                    <Text
                      style={
                        styles.manageButtonText
                      }
                    >
                      Manage Zone
                    </Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
      marginTop: 5,
      fontSize: 12,
      lineHeight: 20,
      color:
        colors.navigationMuted,
    },

    sectionTitle: {
      marginTop: 5,
      marginBottom: 10,
      fontSize: 14,
      fontWeight: '700',
      color:
        colors.text,
    },

    overviewGrid: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 25,
    },

    overviewCard: {
      flex: 1,
      minHeight: 76,
      justifyContent: 'center',
      paddingHorizontal: 11,
      paddingVertical: 11,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    overviewValue: {
      fontSize: 21,
      fontWeight: '700',
      color:
        colors.secondaryDark,
    },

    overviewLabel: {
      marginTop: 4,
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    zoneList: {
      gap: 12,
    },

    stateText: {
      paddingVertical: 20,
      textAlign: 'center',
      fontSize: 13,
      color:
        colors.textSecondary,
    },

    errorText: {
      paddingVertical: 20,
      textAlign: 'center',
      fontSize: 13,
      color:
        colors.error,
    },

    zoneCard: {
      padding: 16,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
      borderRadius: 0,
      elevation: 0,
      shadowOpacity: 0,
    },

    zoneTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },

    zoneHeading: {
      flex: 1,
    },

    zoneName: {
      fontSize: 18,
      fontWeight: '700',
      color:
        colors.text,
    },

    irrigationStatus: {
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 0,
      backgroundColor:
        colors.surfaceSecondary,
      fontSize: 11,
      fontWeight: '700',
      color:
        colors.textSecondary,
    },

    statusActive: {
      color:
        colors.secondaryDark,
    },

    statusScheduled: {
      color:
        colors.primaryDark,
    },

    statusPaused: {
      color:
        colors.warning,
    },

    readings: {
      marginTop: 16,
      flexDirection: 'row',
      gap: 8,
    },

    readingColumn: {
      flex: 1,
      minHeight: 82,
      paddingHorizontal: 10,
      paddingVertical: 11,
      backgroundColor:
        colors.surfaceSecondary,
      borderWidth: 1,
      borderColor:
        colors.border,
      borderRadius: 0,
    },

    label: {
      fontSize: 10,
      color:
        colors.secondaryDark,
    },

    value: {
      marginTop: 4,
      fontSize: 17,
      fontWeight: '700',
      color:
        colors.text,
    },

    smallText: {
      marginTop: 2,
      fontSize: 9,
      color:
        colors.secondaryDark,
    },

    alertText: {
      marginTop: 12,
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.warning,
    },

    overrideText: {
      marginTop: 7,
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.warning,
    },

    manageButton: {
      height: 40,
      marginTop: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderRadius: 0,
    },

    manageButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color:
        colors.white,
    },
  });
}