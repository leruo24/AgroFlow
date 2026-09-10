// Dynamic Expo route: the same screen manages every irrigation zone using its route ID.
import {
  ArrowLeft,
} from 'lucide-react-native';

import {
  router,
  useLocalSearchParams,
} from 'expo-router';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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

const SCHEDULE_DAY_OPTIONS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];

type IrrigationModeSelection =
  | 'automatic'
  | 'scheduled'
  | 'manual';

const IRRIGATION_MODE_OPTIONS: {
  label: string;
  value: IrrigationModeSelection;
}[] = [
  {
    label: 'Automatic',
    value: 'automatic',
  },
  {
    label: 'Scheduled',
    value: 'scheduled',
  },
  {
    label: 'Manual',
    value: 'manual',
  },
];

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
      'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message ===
      'string'
  ) {
    return error.message;
  }

  return fallback;
}

export default function ZoneControlScreen() {
  const {
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

  const {
    zones,
    startManualIrrigation,
    stopManualIrrigation,
    updateIrrigationMode,
    updateZoneSettings,
    updateZoneSchedule,
  } = useAgroFlow();

  const [
    selectedMode,
    setSelectedMode,
  ] =
    useState<IrrigationModeSelection>(
      'automatic'
    );

  const [
    modeSaving,
    setModeSaving,
  ] =
    useState(false);

  const [
    manualDuration,
    setManualDuration,
  ] =
    useState('20');

  // Zone configuration is edited directly inside the page instead of a modal.
  const [
    isEditingZone,
    setIsEditingZone,
  ] =
    useState(false);

  const [
    settingsSaving,
    setSettingsSaving,
  ] =
    useState(false);

  const [
    zoneName,
    setZoneName,
  ] =
    useState('');

  const [
    zoneLocation,
    setZoneLocation,
  ] =
    useState('');

  const [
    zoneCrop,
    setZoneCrop,
  ] =
    useState('');

  const [
    moistureThreshold,
    setMoistureThreshold,
  ] =
    useState('30');

  const [
    desiredMoisture,
    setDesiredMoisture,
  ] =
    useState('60');

  const [
    automationEnabled,
    setAutomationEnabled,
  ] =
    useState(true);

  const [
    weatherAdjustment,
    setWeatherAdjustment,
  ] =
    useState(true);

  const [
    isEditingSchedule,
    setIsEditingSchedule,
  ] =
    useState(false);

  const [
    scheduleSettingsSaving,
    setScheduleSettingsSaving,
  ] =
    useState(false);

  const [
    regularScheduleDays,
    setRegularScheduleDays,
  ] =
    useState<string[]>([]);

  const [
    regularScheduleStartTime,
    setRegularScheduleStartTime,
  ] =
    useState('05:30');

  const [
    regularScheduleDuration,
    setRegularScheduleDuration,
  ] =
    useState('20');

  const routeId =
    Array.isArray(
      id
    )
      ? id[0]
      : id;

  // String conversion keeps numeric Supabase IDs compatible with Expo Router parameters.
  const zone =
    zones.find(
      (
        item
      ) =>
        String(
          item.id
        ) ===
        String(
          routeId
        )
    );

  useEffect(() => {
    if (
      !zone ||
      zone.irrigation
        .override.active
    ) {
      return;
    }

    setSelectedMode(
      zone.irrigation.mode
    );
  }, [
    zone?.id,
    zone?.irrigation.mode,
    zone?.irrigation.override.active,
  ]);

  if (
    !zone
  ) {
    return (
      <SafeAreaView
        style={
          styles.safeArea
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
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft
              size={24}
              color={colors.white}
              strokeWidth={2.25}
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

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

  const isOverrideActive =
    override.active;

  const liveMetrics: {
    label: string;
    value: string;
    note?: string;
  }[] = [
    {
      label:
        'Soil Moisture',
      value:
        `${soil.value}${soil.unit}`,
      note:
        soil.moistureStatus,
    },
    {
      label:
        'Temperature',
      value:
        `${environment.temperature}${environment.temperatureUnit}`,
    },
    {
      label:
        'Humidity',
      value:
        `${environment.humidity}${environment.humidityUnit}`,
    },
    {
      label:
        'Used Today',
      value:
        `${selectedZone.water.usedTodayLitres} L`,
    },
    {
      label:
        'Water Saved',
      value:
        `${selectedZone.waterSavedLitres} L`,
    },
    {
      label:
        'Flow Rate',
      value:
        `${selectedZone.water.flowRateLpm} L/min`,
    },
  ];

  // Manual is temporary, so it never replaces the saved Automatic/Scheduled base mode.
  const displayedBaseMode =
    selectedMode ===
    'manual'
      ? selectedZone.irrigation.mode
      : selectedMode;

  const zoneSummaryRows = [
    [
      {
        label: 'Zone',
        value: selectedZone.name,
      },
      {
        label: 'Location',
        value: selectedZone.location,
      },
    ],
    [
      {
        label: 'Crop',
        value: selectedZone.crop,
      },
      {
        label: 'Start At',
        value: `${automation.moistureThreshold}%`,
      },
    ],
    [
      {
        label: 'Stop At',
        value: `${automation.desiredMoisture}%`,
      },
      {
        label: 'Base Mode',
        value:
          displayedBaseMode ===
          'automatic'
            ? 'Automatic'
            : 'Scheduled',
      },
    ],
  ];

  const scheduleWeatherRows = [
    [
      {
        label: 'Start Time',
        value: schedule.startTime,
      },
      {
        label: 'Days',
        value: schedule.days.join(' '),
      },
      {
        label: 'Duration',
        value: `${schedule.durationMinutes} min`,
      },
    ],
    [
      {
        label: 'Forecast',
        value: selectedZone.weather.rainExpected ? 'Rain' : 'Clear',
      },
      {
        label: 'Rain',
        value: selectedZone.weather.rainExpected ? 'Yes' : 'No',
      },
      {
        label: 'Adjustment',
        value: automation.weatherAdjustment ? 'Enabled' : 'Disabled',
      },
    ],
  ];

  const systemStatusItems = [
    {
      label: 'Soil Sensor',
      value: soil.status,
    },
    {
      label: 'Temp/Humidity',
      value: environment.status,
    },
    {
      label: 'Relay',
      value: selectedZone.relay.status,
    },
  ];

  async function handleModeChange(
    mode: IrrigationModeSelection
  ) {
    if (
      isOverrideActive ||
      modeSaving
    ) {
      return;
    }

    if (
      mode ===
      'manual'
    ) {
      setSelectedMode(
        'manual'
      );

      return;
    }

    // Leaving the Manual preview for the already-saved base mode is only a local UI change.
    if (
      mode ===
      selectedZone.irrigation.mode
    ) {
      setSelectedMode(
        mode
      );

      return;
    }

    setModeSaving(
      true
    );

    try {
      await updateIrrigationMode(
        selectedZone.id,
        mode
      );

      setSelectedMode(
        mode
      );
    } catch (
      error: unknown
    ) {
      Alert.alert(
        'Could Not Change Mode',
        getErrorMessage(
          error,
          'Check your connection and Supabase permissions, then try again.'
        )
      );
    } finally {
      setModeSaving(
        false
      );
    }
  }

  function handleStartManualRun() {
    const duration =
      Number(
        manualDuration
      );

    if (
      !Number.isFinite(
        duration
      ) ||
      duration <
        1 ||
      duration >
        1440
    ) {
      Alert.alert(
        'Invalid Duration',
        'Enter a duration between 1 and 1440 minutes.'
      );

      return;
    }

    Alert.alert(
      'Start Manual Irrigation?',
      `Run irrigation for ${duration} minutes?`,
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
              startManualIrrigation(
                selectedZone.id,
                duration
              ),
        },
      ]
    );
  }

  function handleStopManualRun() {
    Alert.alert(
      'Stop Manual Irrigation?',
      `Stop irrigation for ${selectedZone.name} and return to ${selectedZone.irrigation.mode} mode?`,
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
              stopManualIrrigation(
                selectedZone.id
              ),
        },
      ]
    );
  }

  function openScheduleEditor() {
    beginScheduleEditing();
  }

  function beginZoneEditing() {
    setZoneName(
      selectedZone.name
    );

    setZoneLocation(
      selectedZone.location ===
      'Not configured'
        ? ''
        : selectedZone.location
    );

    setZoneCrop(
      selectedZone.crop ===
      'Not configured'
        ? ''
        : selectedZone.crop
    );

    setMoistureThreshold(
      String(
        automation.moistureThreshold
      )
    );

    setDesiredMoisture(
      String(
        automation.desiredMoisture
      )
    );

    setAutomationEnabled(
      automation.enabled
    );

    setWeatherAdjustment(
      automation.weatherAdjustment
    );

    setIsEditingZone(
      true
    );
  }

  function cancelZoneEditing() {
    setIsEditingZone(
      false
    );
  }

  async function saveZoneSettings() {
    const cleanedName =
      zoneName.trim();

    const cleanedLocation =
      zoneLocation.trim();

    const cleanedCrop =
      zoneCrop.trim();

    const startThreshold =
      Number(
        moistureThreshold
      );

    const stopThreshold =
      Number(
        desiredMoisture
      );

    if (
      !cleanedName ||
      !cleanedLocation ||
      !cleanedCrop
    ) {
      Alert.alert(
        'Missing Zone Details',
        'Enter a zone name, location, and crop type.'
      );

      return;
    }

    if (
      !Number.isFinite(
        startThreshold
      ) ||
      startThreshold <
        0 ||
      startThreshold >
        100 ||
      !Number.isFinite(
        stopThreshold
      ) ||
      stopThreshold <
        0 ||
      stopThreshold >
        100
    ) {
      Alert.alert(
        'Invalid Moisture Values',
        'Moisture values must be between 0 and 100.'
      );

      return;
    }

    if (
      startThreshold >=
      stopThreshold
    ) {
      Alert.alert(
        'Invalid Automation Range',
        'The start threshold must be lower than the desired moisture level.'
      );

      return;
    }

    setSettingsSaving(
      true
    );

    try {
      await updateZoneSettings(
        selectedZone.id,
        {
          name:
            cleanedName,
          location:
            cleanedLocation,
          crop:
            cleanedCrop,
          moistureThreshold:
            startThreshold,
          desiredMoisture:
            stopThreshold,
          automationEnabled,
          weatherAdjustment,
        }
      );

      setIsEditingZone(
        false
      );

      Alert.alert(
        'Zone Updated',
        'The zone settings were saved to Supabase.'
      );
    } catch (
      error: unknown
    ) {
      console.error(
        'Failed to update zone:',
        error
      );

      Alert.alert(
        'Could Not Update Zone',
        getErrorMessage(
          error,
          'Check your connection and Supabase permissions, then try again.'
        )
      );
    } finally {
      setSettingsSaving(
        false
      );
    }
  }

  function beginScheduleEditing() {
    setRegularScheduleDays([
      ...schedule.days,
    ]);

    setRegularScheduleStartTime(
      schedule.startTime
    );

    setRegularScheduleDuration(
      String(
        schedule.durationMinutes
      )
    );

    setIsEditingSchedule(
      true
    );
  }

  function cancelScheduleEditing() {
    setIsEditingSchedule(
      false
    );
  }

  function toggleRegularScheduleDay(
    day: string
  ) {
    setRegularScheduleDays(
      (
        current
      ) =>
        current.includes(
          day
        )
          ? current.filter(
              (
                item
              ) =>
                item !==
                day
            )
          : [
              ...current,
              day,
            ]
    );
  }

  async function saveRegularSchedule() {
    const cleanedStartTime =
      regularScheduleStartTime.trim();

    const duration =
      Number(
        regularScheduleDuration
      );

    const orderedDays =
      SCHEDULE_DAY_OPTIONS.filter(
        (
          day
        ) =>
          regularScheduleDays.includes(
            day
          )
      );

    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(
        cleanedStartTime
      )
    ) {
      Alert.alert(
        'Invalid Start Time',
        'Enter the time as HH:MM, for example 05:30.'
      );

      return;
    }

    if (
      orderedDays.length ===
      0
    ) {
      Alert.alert(
        'Choose Irrigation Days',
        'Select at least one irrigation day.'
      );

      return;
    }

    if (
      !Number.isFinite(
        duration
      ) ||
      duration <
        1 ||
      duration >
        1440
    ) {
      Alert.alert(
        'Invalid Duration',
        'Enter a duration between 1 and 1440 minutes.'
      );

      return;
    }

    setScheduleSettingsSaving(
      true
    );

    try {
      await updateZoneSchedule(
        selectedZone.id,
        {
          enabled:
            displayedBaseMode ===
            'scheduled',
          days:
            orderedDays,
          startTime:
            cleanedStartTime,
          durationMinutes:
            duration,
        }
      );

      setIsEditingSchedule(
        false
      );

      Alert.alert(
        'Schedule Updated',
        'The regular irrigation schedule was saved to Supabase.'
      );
    } catch (
      error: unknown
    ) {
      console.error(
        'Failed to update schedule:',
        error
      );

      Alert.alert(
        'Could Not Update Schedule',
        getErrorMessage(
          error,
          'Check your connection and Supabase permissions, then try again.'
        )
      );
    } finally {
      setScheduleSettingsSaving(
        false
      );
    }
  }

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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          styles.scrollContent
        }
      >
      <View
        style={
          styles.topBar
        }
      >
        <View
          style={
            styles.topBarContent
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
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft
              size={24}
              color={colors.navigationText}
              strokeWidth={2.25}
            />
          </TouchableOpacity>

          <View
            style={
              styles.titleBlock
            }
          >
            <Text
              style={
                styles.zoneName
              }
              numberOfLines={
                1
              }
            >
              {
                selectedZone.name
              }
            </Text>

            <Text
              style={
                styles.zoneSubtitle
              }
              numberOfLines={
                1
              }
            >
              {selectedZone.location} · {selectedZone.crop} · {selectedZone.size.value} {selectedZone.size.unit}
            </Text>
          </View>

          <View
            style={
              styles.statusBadge
            }
          >
            <Text
              style={
                styles.statusBadgeText
              }
            >
              {
                selectedZone
                  .irrigation
                  .status
                  .toUpperCase()
              }
            </Text>
          </View>
        </View>
      </View>

        <View
          style={
            styles.content
          }
        >
          <View
            style={
              styles.sectionHeading
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              Live Overview
            </Text>

            <Text
              style={
                styles.sectionCaption
              }
            >
              Sensor and water readings
            </Text>
          </View>

          <View
            style={
              styles.metricGrid
            }
          >
            {liveMetrics.map(
              (
                metric
              ) => (
                <View
                  key={
                    metric.label
                  }
                  style={
                    styles.metricCard
                  }
                >
                  <Text
                    style={
                      styles.metricValue
                    }
                    numberOfLines={
                      1
                    }
                  >
                    {
                      metric.value
                    }
                  </Text>

                  <Text
                    style={
                      styles.metricLabel
                    }
                    numberOfLines={
                      2
                    }
                  >
                    {
                      metric.label
                    }
                  </Text>

                  <Text
                    style={
                      styles.metricNote
                    }
                    numberOfLines={
                      1
                    }
                  >
                    {
                      metric.note ??
                      ' '
                    }
                  </Text>
                </View>
              )
            )}
          </View>

          <View
            style={
              styles.panel
            }
          >
            <View
              style={
                styles.panelHeader
              }
            >
              <Text
                style={
                  styles.panelTitle
                }
              >
                Irrigation Control
              </Text>

              <Text
                style={
                  styles.panelStatus
                }
              >
                {isOverrideActive
                  ? 'Manual Run'
                  : selectedMode === 'manual'
                    ? 'Manual'
                    : displayedBaseMode === 'automatic'
                    ? 'Automatic'
                    : 'Scheduled'}
              </Text>
            </View>

            <View
              style={
                styles.controlSummary
              }
            >
              <View
                style={
                  styles.controlSummaryItem
                }
              >
                <Text
                  style={
                    styles.controlLabel
                  }
                >
                  MODE
                </Text>

                <Text
                  style={
                    styles.controlValue
                  }
                >
                  {isOverrideActive
                    ? 'Manual'
                    : selectedMode === 'manual'
                      ? 'Manual'
                      : displayedBaseMode === 'automatic'
                      ? 'Automatic'
                      : 'Scheduled'}
                </Text>
              </View>

              <View
                style={
                  styles.controlSummaryItem
                }
              >
                <Text
                  style={
                    styles.controlLabel
                  }
                >
                  RELAY
                </Text>

                <Text
                  style={
                    styles.controlValue
                  }
                >
                  {
                    selectedZone
                      .relay
                      .status
                  }
                </Text>
              </View>

              <View
                style={
                  styles.controlSummaryItem
                }
              >
                <Text
                  style={
                    styles.controlLabel
                  }
                >
                  HEALTH
                </Text>

                <Text
                  style={
                    styles.controlValue
                  }
                  numberOfLines={
                    1
                  }
                >
                  {
                    selectedZone.healthStatus
                  }
                </Text>
              </View>
            </View>

            <View
              style={
                styles.controlActions
              }
            >
              <Text style={styles.modeSelectorLabel}>
                Irrigation Mode
              </Text>

              <View style={styles.modeSelector}>
                {IRRIGATION_MODE_OPTIONS.map(
                  (
                    option
                  ) => {
                    const isSelected =
                      isOverrideActive
                        ? option.value ===
                          'manual'
                        : selectedMode ===
                          option.value;

                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.modeButton,
                          isSelected &&
                            styles.modeButtonSelected,
                        ]}
                        disabled={
                          modeSaving ||
                          isOverrideActive
                        }
                        onPress={() =>
                          handleModeChange(
                            option.value
                          )
                        }
                        accessibilityRole="button"
                        accessibilityState={{
                          selected:
                            isSelected,
                        }}
                      >
                        <Text
                          style={[
                            styles.modeButtonText,
                            isSelected &&
                              styles.modeButtonTextSelected,
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.85}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>

              {selectedMode ===
                'manual' ||
              isOverrideActive ? (
                <>
                  {!isOverrideActive && (
                    <>
                      <Text style={styles.inputLabel}>
                        Duration (minutes)
                      </Text>

                      <TextInput
                        value={manualDuration}
                        onChangeText={setManualDuration}
                        placeholder="20"
                        placeholderTextColor={colors.text}
                        keyboardType="number-pad"
                        maxLength={4}
                        style={styles.input}
                      />
                    </>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      isOverrideActive &&
                        styles.stopButton,
                    ]}
                    onPress={
                      isOverrideActive
                        ? handleStopManualRun
                        : handleStartManualRun
                    }
                  >
                    <Text style={styles.primaryButtonText}>
                      {isOverrideActive
                        ? 'Stop Manual Run'
                        : 'Start Manual Run'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : selectedMode ===
                'scheduled' ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={openScheduleEditor}
                >
                  <Text style={styles.secondaryButtonText}>
                    Edit Regular Schedule
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={beginZoneEditing}
                >
                  <Text style={styles.secondaryButtonText}>
                    Edit Moisture Thresholds
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View
            style={
              styles.panel
            }
          >
            <View
              style={
                styles.panelHeader
              }
            >
              <Text
                style={
                  styles.panelTitle
                }
              >
                Zone &amp; Automation
              </Text>

              {!isEditingZone ? (
                <TouchableOpacity
                  style={
                    styles.textAction
                  }
                  onPress={
                    beginZoneEditing
                  }
                >
                  <Text
                    style={
                      styles.textActionLabel
                    }
                  >
                    Edit
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text
                  style={
                    styles.editingLabel
                  }
                >
                  Editing
                </Text>
              )}
            </View>

            {!isEditingZone ? (
              <View style={styles.infoBoxRows}>
                {zoneSummaryRows.map((row, rowIndex) => (
                  <View key={`zone-row-${rowIndex}`} style={styles.infoBoxRow}>
                    {row.map((item) => (
                      <View
                        key={item.label}
                        style={[styles.infoBox, styles.infoBoxFlexible]}
                      >
                        <Text
                          style={styles.infoBoxLabel}
                          numberOfLines={2}
                        >
                          {item.label}
                        </Text>
                        <Text
                          style={styles.infoBoxValue}
                          numberOfLines={2}
                        >
                          {item.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <View
                style={
                  styles.inlineForm
                }
              >
                <Text style={styles.inputLabel}>Zone Name</Text>
                <TextInput
                  value={zoneName}
                  onChangeText={setZoneName}
                  editable={!settingsSaving}
                  placeholder="Zone 1"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Location</Text>
                <TextInput
                  value={zoneLocation}
                  onChangeText={setZoneLocation}
                  editable={!settingsSaving}
                  placeholder="North Field"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                />

                <Text style={styles.inputLabel}>Crop Type</Text>
                <TextInput
                  value={zoneCrop}
                  onChangeText={setZoneCrop}
                  editable={!settingsSaving}
                  placeholder="Tomatoes"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                />

                <View style={styles.inputRow}>
                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Start At (%)</Text>
                    <TextInput
                      value={moistureThreshold}
                      onChangeText={setMoistureThreshold}
                      editable={!settingsSaving}
                      keyboardType="decimal-pad"
                      placeholder="30"
                      placeholderTextColor={colors.text}
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Stop At (%)</Text>
                    <TextInput
                      value={desiredMoisture}
                      onChangeText={setDesiredMoisture}
                      editable={!settingsSaving}
                      keyboardType="decimal-pad"
                      placeholder="60"
                      placeholderTextColor={colors.text}
                      style={styles.input}
                    />
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <View style={styles.switchCopy}>
                    <Text style={styles.switchTitle}>Weather Adjustment</Text>
                    <Text style={styles.switchDescription}>
                      Delay automatic irrigation when rain is expected.
                    </Text>
                  </View>
                  <Switch
                    value={weatherAdjustment}
                    onValueChange={setWeatherAdjustment}
                    disabled={settingsSaving}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    settingsSaving && styles.disabledButton,
                  ]}
                  disabled={settingsSaving}
                  onPress={saveZoneSettings}
                >
                  <Text style={styles.primaryButtonText}>
                    {settingsSaving ? 'Saving...' : 'Save Changes'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.outlineButton}
                  disabled={settingsSaving}
                  onPress={cancelZoneEditing}
                >
                  <Text style={styles.outlineButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Schedule &amp; Weather</Text>
              <View style={styles.headerActions}>
                <Text style={styles.panelStatus}>
                  {displayedBaseMode === 'scheduled'
                    ? 'Active'
                    : 'Saved'}
                </Text>

                {!isEditingSchedule ? (
                  <TouchableOpacity
                    style={styles.textAction}
                    onPress={beginScheduleEditing}
                    accessibilityRole="button"
                    accessibilityLabel="Edit regular irrigation schedule"
                  >
                    <Text style={styles.textActionLabel}>Edit</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.editingLabel}>Editing</Text>
                )}
              </View>
            </View>

            {!isEditingSchedule ? (
              <View style={styles.infoBoxRows}>
                {scheduleWeatherRows.map((row, rowIndex) => (
                  <View
                    key={`schedule-row-${rowIndex}`}
                    style={styles.infoBoxRow}
                  >
                    {row.map((item) => (
                      <View
                        key={item.label}
                        style={[styles.infoBox, styles.infoBoxFlexible]}
                      >
                        <Text
                          style={styles.infoBoxLabel}
                          numberOfLines={2}
                        >
                          {item.label}
                        </Text>
                        <Text
                          style={styles.infoBoxValue}
                          numberOfLines={2}
                        >
                          {item.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.inlineForm}>
                <Text style={styles.inputLabel}>Irrigation Days</Text>

                <View style={styles.scheduleDayRow}>
                  {SCHEDULE_DAY_OPTIONS.map((day) => {
                    const isSelected =
                      regularScheduleDays.includes(day);

                    return (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.scheduleDayButton,
                          isSelected && styles.scheduleDayButtonSelected,
                        ]}
                        onPress={() => toggleRegularScheduleDay(day)}
                        disabled={scheduleSettingsSaving}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text
                          style={[
                            styles.scheduleDayText,
                            isSelected && styles.scheduleDayTextSelected,
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.8}
                        >
                          {day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.inputRow}>
                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Start Time</Text>
                    <TextInput
                      style={styles.input}
                      value={regularScheduleStartTime}
                      onChangeText={setRegularScheduleStartTime}
                      placeholder="05:30"
                      placeholderTextColor={colors.text}
                      autoCapitalize="none"
                      maxLength={5}
                      editable={!scheduleSettingsSaving}
                    />
                  </View>

                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>Duration (minutes)</Text>
                    <TextInput
                      style={styles.input}
                      value={regularScheduleDuration}
                      onChangeText={setRegularScheduleDuration}
                      placeholder="20"
                      placeholderTextColor={colors.text}
                      keyboardType="number-pad"
                      maxLength={4}
                      editable={!scheduleSettingsSaving}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    scheduleSettingsSaving && styles.disabledButton,
                  ]}
                  disabled={scheduleSettingsSaving}
                  onPress={saveRegularSchedule}
                >
                  <Text style={styles.primaryButtonText}>
                    {scheduleSettingsSaving ? 'Saving...' : 'Save Schedule'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.outlineButton}
                  disabled={scheduleSettingsSaving}
                  onPress={cancelScheduleEditing}
                >
                  <Text style={styles.outlineButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>System Status</Text>
            </View>

            <View style={styles.infoBoxRows}>
              <View style={styles.infoBoxRow}>
                {systemStatusItems.map((item) => (
                  <View
                    key={item.label}
                    style={[styles.infoBox, styles.infoBoxFlexible]}
                  >
                    <Text
                      style={styles.infoBoxLabel}
                      numberOfLines={2}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={styles.infoBoxValue}
                      numberOfLines={2}
                    >
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {selectedZone.alerts.length > 0 && (
            <View style={[styles.panel, styles.alertPanel]}>
              <View style={styles.alertHeader}>
                <Text style={styles.panelTitle}>Zone Alerts</Text>

                <View style={styles.alertCountBadge}>
                  <Text style={styles.alertCountText}>
                    {selectedZone.alerts.length}
                  </Text>
                </View>
              </View>

              {selectedZone.alerts.map((zoneAlert, index) => (
                <View
                  key={zoneAlert.id}
                  style={[
                    styles.alertRow,
                    index === selectedZone.alerts.length - 1 &&
                      styles.alertRowLast,
                  ]}
                >
                  <Text style={styles.alertType}>
                    {zoneAlert.type === 'warning'
                      ? 'ATTENTION'
                      : zoneAlert.type.toUpperCase()}
                  </Text>

                  <Text style={styles.alertMessage}>
                    {zoneAlert.message}
                  </Text>
                </View>
              ))}
            </View>
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
      backgroundColor: colors.navigation,
    },
    page: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
  marginBottom: 16,
  backgroundColor:
    colors.navigation,
},

topBarContent: {
  width: '100%',
  maxWidth: 720,
  alignSelf: 'center',

  paddingHorizontal: 18,
  paddingTop: 4,
  paddingBottom: 6,

  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
},

content: {
  width: '100%',
  maxWidth: 720,
  alignSelf: 'center',
  paddingHorizontal: 16,
  paddingTop: 0,
  gap: 12,
},
    backButton: {
      minWidth: 38,
      minHeight: 38,
      justifyContent: 'center',
    },
    titleBlock: {
      flex: 1,
    },
    zoneName: {
      fontSize: 21,
      fontWeight: '700',
      color: colors.navigationText,
    },
    zoneSubtitle: {
      marginTop: 3,
      fontSize: 14,
      fontWeight: '500',
      color: colors.navigationText,
    },
    statusBadge: {
      minWidth: 54,
      paddingHorizontal: 9,
      paddingVertical: 6,
      alignItems: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.14)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.22)',
    },
    statusBadgeText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.navigationText,
    },
    scrollContent: {
      paddingBottom: 38,
    },
    
    sectionHeading: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 10,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    sectionCaption: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.text,
    },
    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    },
    metricCard: {
      width: '31.8%',
      minHeight: 98,
      paddingHorizontal: 8,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    metricValue: {
      width: '100%',
      minHeight: 25,
      textAlign: 'center',
      textAlignVertical: 'center',
      fontSize: 18,
      lineHeight: 23,
      fontWeight: '700',
      color: colors.secondaryDark,
    },
    metricLabel: {
      width: '100%',
      minHeight: 34,
      marginTop: 2,
      textAlign: 'center',
      textAlignVertical: 'center',
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '500',
      color: colors.text,
    },
    metricNote: {
      width: '100%',
      minHeight: 16,
      textAlign: 'center',
      textAlignVertical: 'center',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      color: colors.warning,
    },
    panel: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    panelHeader: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    panelTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    panelStatus: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    controlSummary: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
    },
    controlSummaryItem: {
      flex: 1,
      minHeight: 76,
      paddingHorizontal: 8,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    controlLabel: {
      width: '100%',
      minHeight: 20,
      textAlign: 'center',
      textAlignVertical: 'center',
      fontSize: 12,
      lineHeight: 20,
      fontWeight: '500',
      color: colors.text,
    },
    controlValue: {
      width: '100%',
      minHeight: 22,
      marginTop: 2,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      textAlign: 'center',
      textAlignVertical: 'center',
      color: colors.text,
    },
    controlActions: {
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    modeSelectorLabel: {
      marginBottom: 7,
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    modeSelector: {
      marginBottom: 12,
      flexDirection: 'row',
      gap: 6,
    },
    modeButton: {
      flex: 1,
      flexBasis: 0,
      minWidth: 0,
      minHeight: 44,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modeButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primaryDark,
    },
    modeButtonText: {
      width: '100%',
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
      color: colors.text,
    },
    modeButtonTextSelected: {
      color: colors.white,
    },
    primaryButton: {
      minHeight: 42,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderWidth: 1,
      borderColor: colors.primaryDark,
    },
    primaryButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    stopButton: {
      backgroundColor: colors.error,
      borderColor: colors.error,
    },
    buttonRow: {
      marginTop: 8,
      flexDirection: 'row',
      gap: 8,
    },
    halfButton: {
      flex: 1,
    },
    secondaryButton: {
      minHeight: 40,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.lightBlue,
      borderWidth: 1,
      borderColor: colors.weatherBorder,
    },
    secondaryButtonText: {
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.primaryDark,
    },
    warningButton: {
      minHeight: 40,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.warningBackground,
      borderWidth: 1,
      borderColor: colors.warning,
    },
    warningButtonText: {
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.warning,
    },
    textAction: {
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    textActionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    editingLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    infoRow: {
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    lastInfoRow: {
      borderBottomWidth: 0,
    },
    infoLabel: {
      flex: 1,
      fontSize: 12,
      color: colors.text,
    },
    infoValue: {
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'right',
      color: colors.text,
    },
    inlineForm: {
      padding: 12,
    },
    inputLabel: {
      marginBottom: 5,
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    input: {
      height: 42,
      marginBottom: 12,
      paddingHorizontal: 10,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      fontSize: 13,
      color: colors.text,
    },
    inputRow: {
      flexDirection: 'row',
      gap: 10,
    },
    inputColumn: {
      flex: 1,
    },
    switchRow: {
      minHeight: 56,
      marginBottom: 10,
      paddingHorizontal: 10,
      paddingVertical: 7,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    switchCopy: {
      flex: 1,
    },
    switchTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    switchDescription: {
      marginTop: 2,
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    scheduleDayRow: {
      marginBottom: 12,
      flexDirection: 'row',
      gap: 4,
    },
    scheduleDayButton: {
      flex: 1,
      flexBasis: 0,
      minWidth: 0,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    scheduleDayButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primaryDark,
    },
    scheduleDayText: {
      width: '100%',
      paddingHorizontal: 2,
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.text,
    },
    scheduleDayTextSelected: {
      color: colors.white,
    },
    outlineButton: {
      minHeight: 40,
      marginTop: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    outlineButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primaryDark,
    },
    disabledButton: {
      opacity: 0.6,
    },
    infoBoxRows: {
      padding: 10,
      gap: 7,
    },
    infoBoxRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 7,
    },
    infoBox: {
      minHeight: 86,
      paddingHorizontal: 8,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    infoBoxFlexible: {
      flex: 1,
      flexBasis: 0,
      minWidth: 0,
    },
    infoBoxLabel: {
      width: '100%',
      height: 34,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
      textAlign: 'center',
      textAlignVertical: 'center',
      color: colors.text,
    },
    infoBoxValue: {
      width: '100%',
      minHeight: 38,
      marginTop: 2,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '600',
      textAlign: 'center',
      textAlignVertical: 'center',
      color: colors.text,
    },
    standalonePanelTitle: {
      paddingHorizontal: 12,
      paddingTop: 11,
      paddingBottom: 8,
    },
    overridePanel: {
      backgroundColor: colors.warningBackground,
      borderColor: colors.warning,
    },
    alertPanel: {
      backgroundColor: colors.surface,
    },
    alertHeader: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    alertCountBadge: {
      minWidth: 24,
      minHeight: 20,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.warningBackground,
      borderWidth: 1,
      borderColor: colors.warning,
    },
    alertCountText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.warning,
    },
    alertRow: {
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    alertRowLast: {
      borderBottomWidth: 0,
    },
    alertType: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.warning,
    },
    alertMessage: {
      marginTop: 3,
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    modalOverlay: {
      flex: 1,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.38)',
    },
    modalCard: {
      width: '100%',
      maxWidth: 520,
      padding: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalHeader: {
      marginBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    modalTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    modalClose: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primaryDark,
    },
    modalNote: {
      marginBottom: 14,
      fontSize: 11,
      lineHeight: 16,
      color: colors.text,
    },
    notFound: {
      flex: 1,
      paddingHorizontal: 25,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    notFoundTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    notFoundText: {
      marginTop: 6,
      marginBottom: 20,
      textAlign: 'center',
      fontSize: 13,
      color: colors.text,
    },
  });
}