//dynamic expo route page where same file handles  differents zones based on the zone id of the desired zone
import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import {
  useMemo,
  useState,
} from 'react';

import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
//ensures the content does not overflow the phone's system areas
import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import type {//describes color properties
  AppColors,
} from '@/constants/colors';

import {//gives access to shared agroflowdata
  useAgroFlow,
} from '@/context/AgroFlowContext';

import {//provides light theme/dark theme colors
  useTheme,
} from '@/context/ThemeContext';

export default function ZoneControlScreen() {
  const {//retrieves the zone ID from the URL parameters using the useLocalSearchParams hook, which is used to identify the specific irrigation zone to display and control
    id,
  } =
    useLocalSearchParams<{
      id?:
        | string
        | string[];
    }>();

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

  const {//gets data from agroflow context
    zones,
    startIrrigation,
    stopIrrigation,
    enableManualOverride,
    endManualOverride,
    setOverrideSchedule,
  } = useAgroFlow();

  const [//local screen state
    scheduleModalVisible,
    setScheduleModalVisible,
  ] =
    useState(false);

  const [
    scheduleDate,
    setScheduleDate,
  ] =
    useState('');

  const [
    scheduleTime,
    setScheduleTime,
  ] =
    useState('');

  const [
    scheduleDuration,
    setScheduleDuration,
  ] =
    useState('20');

  const routeId =
    Array.isArray(
      id
    )
      ? id[0]
      : id;

  const zone =
    zones.find(//searches for the shared zone data in the zones array using the zone ID retrieved from the URL parameters. If a matching zone is found, it is stored in the zone variable for further use in the component.
      (
        item
      ) =>
        item.id ===
        routeId
    );

  if (
    !zone
  ) {
    return (
      <SafeAreaView
        style={
          styles.container
        }
      >
        <View
          style={
            styles.notFound
          }
        >
          <Text
            style={
              styles.notFoundTitle
            }
          >
            Zone not found
          </Text>

          <Text
            style={
              styles.notFoundText
            }
          >
            The selected irrigation zone could not be found.
          </Text>

          <TouchableOpacity
            style={
              styles.primaryButton
            }
            onPress={() =>
              router.back()
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Go Back
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
//reading the hardware state, the UI is working with hardware rather than unrelated frontened data
  const selectedZone =
    zone;

  const soil =
    selectedZone
      .sensors
      .soilMoisture;

  const environment =
    selectedZone
      .sensors
      .temperatureHumidity;

  const schedule =
    selectedZone
      .irrigation
      .schedule;

  const automation =
    selectedZone
      .irrigation
      .automation;

  const override =
    selectedZone
      .irrigation
      .override;

  const isOverrideActive =//determines what controls are displayed to the farmer based on whether manual override is active or not. If manual override is active, the user can start/stop irrigation and set a temporary schedule. If manual override is not active, the user can enable manual override.
    override.active;

  const isIrrigating =
    selectedZone
      .irrigation
      .status ===
    'Active';

  const temporarySchedule =
    override.temporarySchedule;

  function handleEnableOverride() {
    Alert.alert(
      'Enable Manual Override?',
      'Automatic irrigation control will be temporarily suspended.',
      [
        {
          text:
            'Cancel',
          style:
            'cancel',
        },
        {
          text:
            'Enable',
          onPress:
            () =>
              enableManualOverride(//enabling manual override for the selected zone, this is done by calling the enableManualOverride function from the AgroFlowContext and passing in the selected zone ID as a parameter
                selectedZone.id
              ),
        },
      ]
    );
  }

  function handleEndOverride() {
    Alert.alert(
      'End Manual Override?',
      'The zone will return to automatic irrigation control.',
      [
        {
          text:
            'Cancel',
          style:
            'cancel',
        },
        {
          text:
            'End Override',
          onPress:
            () =>
              endManualOverride(
                selectedZone.id
              ),
        },
      ]
    );
  }

  function handleStart() {
    Alert.alert(
      'Start Irrigation?',
      `Start irrigation for ${selectedZone.name}?`,
      [
        {
          text:
            'Cancel',
          style:
            'cancel',
        },
        {
          text:
            'Start',
          onPress:
            () =>
              startIrrigation(
                selectedZone.id
              ),
        },
      ]
    );
  }

  function handleStop() {
    Alert.alert(
      'Stop Irrigation?',
      `Stop irrigation for ${selectedZone.name}?`,
      [
        {
          text:
            'Cancel',
          style:
            'cancel',
        },
        {
          text:
            'Stop',
          style:
            'destructive',
          onPress:
            () =>
              stopIrrigation(
                selectedZone.id
              ),
        },
      ]
    );
  }

  function openScheduleModal() {//farmer can set a temporary irrigation schedule while manual override is active, this is done by opening a modal where the farmer can input the date, time and duration of the temporary schedule
    if (
      temporarySchedule
    ) {
      setScheduleDate(
        temporarySchedule.date
      );

      setScheduleTime(
        temporarySchedule.time
      );

      setScheduleDuration(
        String(
          temporarySchedule
            .durationMinutes
        )
      );
    } else {
      setScheduleDate(
        ''
      );

      setScheduleTime(
        schedule.startTime
      );

      setScheduleDuration(
        String(
          schedule.durationMinutes
        )
      );
    }

    setScheduleModalVisible(
      true
    );
  }

  function saveOverrideSchedule() {
    const date =
      scheduleDate.trim();

    const time =
      scheduleTime.trim();

    const duration =
      Number(
        scheduleDuration
      );

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(//validates the date input to ensure it follows the YYYY-MM-DD format. If the input does not match this format, an alert is displayed to inform the user of the invalid date format.
        date
      )
    ) {
      Alert.alert(
        'Invalid Date',
        'Enter the date as YYYY-MM-DD.'
      );

      return;
    }

    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(//validates the time input to ensure it follows the HH:MM format (24-hour clock). If the input does not match this format, an alert is displayed to inform the user of the invalid time format.
        time
      )
    ) {
      Alert.alert(
        'Invalid Time',
        'Enter the time as HH:MM.'
      );

      return;
    }

    if (
      !Number.isFinite(//validates the duration input to ensure it is a finite number greater than 0. If the input is not a valid number or is less than or equal to 0, an alert is displayed to inform the user of the invalid duration.
        duration
      ) ||
      duration <=
        0
    ) {
      Alert.alert(
        'Invalid Duration',
        'Enter a valid duration.'
      );

      return;
    }

    setOverrideSchedule(
      selectedZone.id,
      date,
      time,
      duration
    );

    setScheduleModalVisible(
      false
    );
  }

  return (
    <SafeAreaView
      style={
        styles.container
      }
      edges={[
        'top',
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={
          styles.scrollContent
        }
      >
        <TouchableOpacity
          style={
            styles.backButton
          }
          onPress={() =>
            router.back()
          }
          activeOpacity={
            0.7
          }
        >
          <Text
            style={
              styles.backArrow
            }
          >
            ‹
          </Text>

          <Text
            style={
              styles.backText
            }
          >
            Irrigation
          </Text>
        </TouchableOpacity>

        <View
          style={
            styles.header
          }
        >
          <View
            style={
              styles.headerTop
            }
          >
            <Text
              style={
                styles.zoneName
              }
            >
              {
                selectedZone.name
              }
            </Text>

            <Text
              style={
                styles.zoneStatus
              }
            >
              {
                selectedZone
                  .irrigation
                  .status
              }
            </Text>
          </View>

          <View
            style={
              styles.zoneDetails
            }
          >
            <Text
              style={
                styles.zoneSubtitle
              }
            >
              {
                selectedZone.location
              }
            </Text>

            <Text
              style={
                styles.zoneSubtitle
              }
            >
              {
                selectedZone.crop
              }
            </Text>

            <Text
              style={
                styles.zoneSubtitle
              }
            >
              {
                selectedZone.size.value
              }{' '}
              {
                selectedZone.size.unit
              }
            </Text>
          </View>
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Sensor Readings
        </Text>

        <View
          style={
            styles.readingGrid
          }
        >
          <View
            style={
              styles.readingCard
            }
          >
            <Text
              style={
                styles.readingValue
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
                styles.readingLabel
              }
            >
              Soil Moisture
            </Text>

            <Text
              style={
                styles.readingStatus
              }
            >
              {
                soil.moistureStatus
              }
            </Text>
          </View>

          <View
            style={
              styles.readingCard
            }
          >
            <Text
              style={
                styles.readingValue
              }
            >
              {
                environment.temperature
              }
              {
                environment.temperatureUnit
              }
            </Text>

            <Text
              style={
                styles.readingLabel
              }
            >
              Temperature
            </Text>
          </View>

          <View
            style={
              styles.readingCard
            }
          >
            <Text
              style={
                styles.readingValue
              }
            >
              {
                environment.humidity
              }
              {
                environment.humidityUnit
              }
            </Text>

            <Text
              style={
                styles.readingLabel
              }
            >
              Humidity
            </Text>
          </View>

          <View
            style={
              styles.readingCard
            }
          >
            <Text
              style={
                styles.readingValue
              }
            >
              {
                automation.moistureThreshold
              }
              %
            </Text>

            <Text
              style={
                styles.readingLabel
              }
            >
              Moisture Threshold
            </Text>
          </View>
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Irrigation Control
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <InfoRow
            label="Irrigation"
            value={
              selectedZone
                .irrigation
                .status
            }
          />

          <InfoRow
            label="Relay"
            value={
              selectedZone
                .relay
                .status
            }
          />

          <InfoRow
            label="Water Pump"
            value={
              selectedZone
                .pump
                .status
            }
          />

          <InfoRow
            label="Control Mode"
            value={
              isOverrideActive
                ? 'Manual Override'
                : 'Automatic'
            }
            last
          />

          <View
            style={
              styles.controlArea
            }
          >
            {!isOverrideActive ? (
              <TouchableOpacity
                style={
                  styles.primaryButton
                }
                onPress={
                  handleEnableOverride
                }
                activeOpacity={
                  0.75
                }
              >
                <Text
                  style={
                    styles.primaryButtonText
                  }
                >
                  Enable Manual Override
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,

                    isIrrigating &&
                      styles.stopButton,
                  ]}
                  onPress={
                    isIrrigating
                      ? handleStop
                      : handleStart
                  }
                  activeOpacity={
                    0.75
                  }
                >
                  <Text
                    style={
                      styles.primaryButtonText
                    }
                  >
                    {isIrrigating
                      ? 'Stop Irrigation'
                      : 'Start Irrigation'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={
                    styles.secondaryButton
                  }
                  onPress={
                    openScheduleModal
                  }
                  activeOpacity={
                    0.75
                  }
                >
                  <Text
                    style={
                      styles.secondaryButtonText
                    }
                  >
                    {temporarySchedule
                      ? 'Change Override Schedule'
                      : 'Create Override Schedule'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={
                    styles.warningButton
                  }
                  onPress={
                    handleEndOverride
                  }
                  activeOpacity={
                    0.75
                  }
                >
                  <Text
                    style={
                      styles.warningButtonText
                    }
                  >
                    End Manual Override
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Automatic Schedule
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <InfoRow
            label="Schedule"
            value={
              schedule.enabled
                ? 'Enabled'
                : 'Disabled'
            }
          />

          <InfoRow
            label="Days"
            value={
              schedule.days.join(
                ', '
              )
            }
          />

          <InfoRow
            label="Start Time"
            value={
              schedule.startTime
            }
          />

          <InfoRow
            label="Duration"
            value={`${schedule.durationMinutes} min`}
            last
          />
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Automation Rules
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <InfoRow
            label="Automation"
            value={
              automation.enabled
                ? 'Enabled'
                : 'Disabled'
            }
          />

          <InfoRow
            label="Moisture Threshold"
            value={`${automation.moistureThreshold}%`}
          />

          <InfoRow
            label="Weather Adjustment"
            value={
              automation.weatherAdjustment
                ? 'Enabled'
                : 'Disabled'
            }
            last
          />
        </View>

        {temporarySchedule && (
          <>
            <Text
              style={
                styles.sectionTitle
              }
            >
              Override Schedule
            </Text>

            <View
              style={
                styles.overrideSchedule
              }
            >
              <InfoRow
                label="Date"
                value={
                  temporarySchedule.date
                }
              />

              <InfoRow
                label="Time"
                value={
                  temporarySchedule.time
                }
              />

              <InfoRow
                label="Duration"
                value={`${temporarySchedule.durationMinutes} min`}
                last
              />
            </View>
          </>
        )}

        <Text
          style={
            styles.sectionTitle
          }
        >
          Water Usage
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <InfoRow
            label="Used Today"
            value={`${selectedZone.water.usedTodayLitres} L`}
          />

          <InfoRow
            label="Latest Cycle"
            value={`${selectedZone.water.latestCycleLitres} L`}
          />

          <InfoRow
            label="Flow Rate"
            value={`${selectedZone.water.flowRateLpm} L/min`}
            last
          />
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          System Status
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <InfoRow
            label="Soil Moisture Sensor"
            value={
              soil.status
            }
          />

          <InfoRow
            label="Temperature & Humidity Sensor"
            value={
              environment.status
            }
          />

          <InfoRow
            label="Relay"
            value={
              selectedZone
                .relay
                .status
            }
          />

          <InfoRow
            label="Water Pump"
            value={
              selectedZone
                .pump
                .status
            }
            last
          />
        </View>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Weather
        </Text>

        <View
          style={
            styles.weatherCard
          }
        >
          <Text
            style={
              styles.weatherTitle
            }
          >
            {selectedZone
              .weather
              .rainExpected
              ? 'Rain Expected'
              : 'No Rain Expected'}
          </Text>

          <Text
            style={
              styles.weatherMessage
            }
          >
            {
              selectedZone
                .weather
                .message
            }
          </Text>

          <View
            style={
              styles.weatherRow
            }
          >
            <Text
              style={
                styles.infoLabel
              }
            >
              Weather Adjustment
            </Text>

            <Text
              style={
                styles.infoValue
              }
            >
              {automation
                .weatherAdjustment
                ? 'Enabled'
                : 'Disabled'}
            </Text>
          </View>
        </View>

        {selectedZone
          .alerts
          .length >
          0 && (
          <>
            <Text
              style={
                styles.sectionTitle
              }
            >
              Zone Alerts
            </Text>

            <View
              style={
                styles.alertList
              }
            >
              {selectedZone
                .alerts
                .map(
                  (
                    zoneAlert
                  ) => (
                    <View
                      key={
                        zoneAlert.id
                      }
                      style={
                        styles.alertCard
                      }
                    >
                      <Text
                        style={
                          styles.alertType
                        }
                      >
                        {
                          zoneAlert.type
                        }
                      </Text>

                      <Text
                        style={
                          styles.alertMessage
                        }
                      >
                        {
                          zoneAlert.message
                        }
                      </Text>
                    </View>
                  )
                )}
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={
          scheduleModalVisible
        }
        transparent
        animationType="fade"
        onRequestClose={() =>
          setScheduleModalVisible(
            false
          )
        }
      >
        <View
          style={
            styles.modalOverlay
          }
        >
          <View
            style={
              styles.modalCard
            }
          >
            <View
              style={
                styles.modalHeader
              }
            >
              <Text
                style={
                  styles.modalTitle
                }
              >
                Override Schedule
              </Text>

              <TouchableOpacity
                onPress={() =>
                  setScheduleModalVisible(
                    false
                  )
                }
              >
                <Text
                  style={
                    styles.closeText
                  }
                >
                  ×
                </Text>
              </TouchableOpacity>
            </View>

            <Text
              style={
                styles.inputLabel
              }
            >
              Date
            </Text>

            <TextInput
              value={
                scheduleDate
              }
              onChangeText={
                setScheduleDate
              }
              placeholder="YYYY-MM-DD"
              placeholderTextColor={
                colors.textMuted
              }
              style={
                styles.input
              }
              autoCapitalize="none"
            />

            <Text
              style={
                styles.inputLabel
              }
            >
              Time
            </Text>

            <TextInput
              value={
                scheduleTime
              }
              onChangeText={
                setScheduleTime
              }
              placeholder="HH:MM"
              placeholderTextColor={
                colors.textMuted
              }
              style={
                styles.input
              }
              autoCapitalize="none"
            />

            <Text
              style={
                styles.inputLabel
              }
            >
              Duration
            </Text>

            <TextInput
              value={
                scheduleDuration
              }
              onChangeText={
                setScheduleDuration
              }
              placeholder="Minutes"
              placeholderTextColor={
                colors.textMuted
              }
              keyboardType="number-pad"
              style={
                styles.input
              }
            />

            <Text
              style={
                styles.modalNote
              }
            >
              This schedule only applies while manual override is active.
            </Text>

            <TouchableOpacity
              style={
                styles.primaryButton
              }
              onPress={
                saveOverrideSchedule
              }
            >
              <Text
                style={
                  styles.primaryButtonText
                }
              >
                Save Schedule
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.cancelButton
              }
              onPress={() =>
                setScheduleModalVisible(
                  false
                )
              }
            >
              <Text
                style={
                  styles.cancelButtonText
                }
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
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

  return (
    <View
      style={[
        styles.infoRow,

        last &&
          styles.lastInfoRow,
      ]}
    >
      <Text
        style={
          styles.infoLabel
        }
      >
        {
          label
        }
      </Text>

      <Text
        style={
          styles.infoValue
        }
      >
        {
          value
        }
      </Text>
    </View>
  );
}

function createStyles(//receives color info and creates screen styles 
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
      paddingTop: 8,
      paddingBottom: 40,
    },

    backButton: {
      height: 38,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
    },

    backArrow: {
      marginRight: 6,
      fontSize: 28,
      lineHeight: 30,
      color:
        colors.text,
    },

    backText: {
      fontSize: 12,
      fontWeight: '600',
      color:
        colors.text,
    },

    header: {
      padding: 14,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    headerTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },

    zoneName: {
      flex: 1,
      fontSize: 28,
      fontWeight: '700',
      color:
        colors.text,
    },

    zoneStatus: {
      fontSize: 11,
      fontWeight: '700',
      color:
        colors.text,
    },

    zoneDetails: {
      marginTop: 12,
      gap: 4,
    },

    zoneSubtitle: {
      fontSize: 12,
      color:
        colors.text,
    },

    sectionTitle: {
      marginTop: 24,
      marginBottom: 10,
      fontSize: 16,
      fontWeight: '700',
      color:
        colors.text,
    },

    readingGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 8,
    },

    readingCard: {
      width: '48.5%',
      minHeight: 78,
      padding: 12,
      justifyContent: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
    },

    readingValue: {
      fontSize: 19,
      fontWeight: '700',
      color:
        colors.text,
    },

    readingLabel: {
      marginTop: 4,
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    readingStatus: {
      marginTop: 3,
      fontSize: 9,
      fontWeight: '600',
      color:
        colors.secondaryDark,
    },

    sectionCard: {
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    infoRow: {
    minHeight: 47,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 15,
    },
    
    infoLabel: {
      flex: 1,
      fontSize: 10,
      color:
        colors.text,
    },

    infoValue: {
      flex: 1,
      fontSize: 10,
      fontWeight: '600',
      textAlign: 'right',
      color:
        colors.text,
    },
    lastInfoRow: {
    borderBottomWidth: 0,
    },
    controlArea: {
      padding: 13,
    },

    primaryButton: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderWidth: 1,
      borderColor:
        colors.primaryDark,
    },

    primaryButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color:
        colors.white,
    },

    stopButton: {
      backgroundColor:
        colors.error,
      borderColor:
        colors.error,
    },

    secondaryButton: {
      height: 42,
      marginTop: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.lightBlue,
      borderWidth: 1,
      borderColor:
        colors.weatherBorder,
    },

    secondaryButtonText: {
      fontSize: 11,
      fontWeight: '700',
      color:
        colors.primaryDark,
    },

    warningButton: {
      height: 42,
      marginTop: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.warningBackground,
      borderWidth: 1,
      borderColor:
        colors.warning,
    },

    warningButtonText: {
      fontSize: 11,
      fontWeight: '700',
      color:
        colors.warning,
    },

    overrideSchedule: {
      backgroundColor:
        colors.warningBackground,
      borderWidth: 1,
      borderColor:
        colors.warning,
    },

    weatherCard: {
      padding: 14,
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
    },

    weatherTitle: {
      fontSize: 13,
      fontWeight: '700',
      color:
        colors.text,
    },

    weatherMessage: {
      marginTop: 6,
      fontSize: 11,
      lineHeight: 17,
      color:
        colors.text,
    },

    weatherRow: {
      marginTop: 12,
      paddingTop: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 0,
    },

    alertList: {
      gap: 8,
    },

    alertCard: {
      padding: 13,
      backgroundColor:
        colors.surface,
      borderWidth: 0,
      borderColor:
        colors.border,
    },

    alertType: {
      fontSize: 9,
      fontWeight: '700',
      color:
        colors.text,
    },

    alertMessage: {
      marginTop: 4,
      fontSize: 11,
      lineHeight: 16,
      color:
        colors.text,
    },

    modalOverlay: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      backgroundColor:
        'rgba(0, 0, 0, 0.35)',
    },

    modalCard: {
      padding: 18,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    modalHeader: {
      marginBottom: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color:
        colors.text,
    },

    closeText: {
      paddingHorizontal: 8,
      fontSize: 28,
      color:
        colors.text,
    },

    inputLabel: {
      marginBottom: 6,
      fontSize: 10,
      fontWeight: '600',
      color:
        colors.textSecondary,
    },

    input: {
      height: 44,
      marginBottom: 14,
      paddingHorizontal: 12,
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      fontSize: 12,
      color:
        colors.text,
    },

    modalNote: {
      marginBottom: 15,
      fontSize: 10,
      lineHeight: 15,
      color:
        colors.textSecondary,
    },

    cancelButton: {
      height: 40,
      marginTop: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },

    cancelButtonText: {
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.textSecondary,
    },

    notFound: {
      flex: 1,
      paddingHorizontal: 25,
      alignItems: 'center',
      justifyContent: 'center',
    },

    notFoundTitle: {
      fontSize: 20,
      fontWeight: '700',
      color:
        colors.text,
    },

    notFoundText: {
      marginTop: 6,
      marginBottom: 20,
      textAlign: 'center',
      fontSize: 12,
      color:
        colors.textSecondary,
    },
  });
}