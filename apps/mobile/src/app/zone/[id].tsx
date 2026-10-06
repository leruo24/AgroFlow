import { DataState } from '@/components/DataState';
import { AppAlert as Alert } from '@/components/AppAlert';
import { BlurSheet } from '@/components/BlurSheet';

// The FAO-56 engine's farmer-facing pieces, and page help. All of these were
// built and merged but never mounted anywhere - this screen is where they
// belong, and until now the engine had no farmer-visible surface at all.
import { HelpButton } from '@/components/HelpButton';
import { ZoneInsightsCard } from '@/components/ZoneInsightsCard';
import { ZoneGrowthBar } from '@/components/ZoneGrowthBar';
import { ResetRecommendedButton } from '@/components/ResetRecommendedButton';
import { CalibrateSoilSheet } from '@/components/CalibrateSoilSheet';
import { fetchZoneInsights, type ZoneGrowth } from '@/services/agroFlowApi';
// Dynamic Expo route: the same screen manages every irrigation zone using its route ID.
import {
  ArrowLeft,
  ChevronRight,
} from 'lucide-react-native';

import {
  useLocalSearchParams,
} from 'expo-router';
import { router } from '@/lib/router';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import {
  useAgroFlow,
} from '@/context/AgroFlowContext';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  createZoneDetailStyles,
} from '@/styles/zoneDetailStyles';

import {
  soilReadingText,
} from '@/lib/moistureDisplay';

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
  console.error('Zone action failed:', error);
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
        createZoneDetailStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const {
    zones, isZonesLoading, zonesError, isFarmLoading, farmError, refreshZones, refreshFarms,
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
    plantingDate,
    setPlantingDate,
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

  // Growth + insights for the engine components below. Fetched here rather
  // than inside ZoneInsightsCard so that one request fills both it and the
  // growth bar - the endpoint returns the two together.
  const [zoneGrowth, setZoneGrowth] =
    useState<ZoneGrowth | null>(null);

  const [calibrateVisible, setCalibrateVisible] =
    useState(false);

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

  // The growth summary for the bar below. Failure is silent and leaves it
  // null, which renders nothing - the engine's advice is additional to this
  // screen, never a precondition for it, so a dead engine must not take the
  // whole zone page down with it.
  useEffect(() => {
    const numericId =
      Number(routeId);

    if (
      !Number.isFinite(
        numericId
      ) ||
      numericId <= 0
    ) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const result =
          await fetchZoneInsights(
            numericId
          );

        if (active) {
          setZoneGrowth(
            result.growth ?? null
          );
        }
      } catch {
        if (active) {
          setZoneGrowth(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    routeId,
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
          <DataState kind={isFarmLoading || isZonesLoading ? 'loading' : farmError || zonesError ? 'error' : 'empty'}
            title={isFarmLoading || isZonesLoading ? 'Loading zone' : farmError || zonesError ? 'Unable to load zone' : 'Zone not found'}
            description={isFarmLoading || isZonesLoading ? undefined : 'Return to Irrigation to select a zone in the current farm.'}
            onRetry={farmError ? refreshFarms : zonesError ? refreshZones : undefined} />
          <TouchableOpacity
            style={
              styles.primaryButton
            }
            onPress={() =>
              router.canGoBack() ? router.back() : router.navigate('/irrigation')
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
        soilReadingText(soil, 'Unavailable'),
      note:
        soil.calibrated
          ? soil.moistureStatus
          : 'Do the wet/dry setup to read this as moisture',
    },
    {
      label:
        'Temperature',
      value:
        environment.status === 'Online' ? `${environment.temperature}${environment.temperatureUnit}` : 'Unavailable',
    },
    {
      label:
        'Humidity',
      value:
        environment.status === 'Online' ? `${environment.humidity}${environment.humidityUnit}` : 'Unavailable',
    },
    {
      // "(est.)" is not decoration: no AgroFlow node has a flow meter, so this
      // is runtime multiplied by the zone's configured flow_rate_lpm. Showing
      // a bare litre figure would present an inference as a measurement.
      label:
        'Used Today',
      value:
        selectedZone.water.usedTodayLitres != null
          ? `${selectedZone.water.usedTodayLitres} L (est.)`
          : 'No data',
    },
    {
      label:
        'Water Saved',
      value:
        selectedZone.waterSavedLitres != null
          ? `${selectedZone.waterSavedLitres} L (est.)`
          : 'No data',
    },
    {
      label:
        'Flow Rate',
      value:
        'Unavailable',
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
        60
    ) {
      Alert.alert(
        'Invalid Duration',
        'Enter a duration between 1 and 60 minutes.'
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
          onPress: async () => {
            try {
              await startManualIrrigation(
                selectedZone.id,
                duration
              );
            } catch (error: unknown) {
              Alert.alert(
                'Could Not Start Irrigation',
                getErrorMessage(error, 'The command could not be sent. Please retry.')
              );
            }
          },
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
          onPress: async () => {
            try {
              await stopManualIrrigation(
                selectedZone.id
              );
            } catch (error: unknown) {
              Alert.alert(
                'Could Not Stop Irrigation',
                getErrorMessage(error, 'The command could not be sent. Please retry.')
              );
            }
          },
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

    setPlantingDate(
      selectedZone.plantingDate ?? ''
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

    const cleanedPlantingDate =
      plantingDate.trim();

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
      !cleanedCrop ||
      !cleanedPlantingDate
    ) {
      Alert.alert(
        'Missing Zone Details',
        'Enter a zone name, location, and crop type.'
      );

      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanedPlantingDate)) {
      Alert.alert(
        'Invalid Planting Date',
        'Enter the planting date in YYYY-MM-DD format.'
      );

      return;
    }

    const plantingDateValue =
      new Date(`${cleanedPlantingDate}T00:00:00`);

    const todayValue = new Date();

    const today =
      `${todayValue.getFullYear()}-${String(
        todayValue.getMonth() + 1
      ).padStart(2, '0')}-${String(
        todayValue.getDate()
      ).padStart(2, '0')}`;

    const isRealDate =
      plantingDateValue.getFullYear() ===
        Number(cleanedPlantingDate.slice(0, 4)) &&
      plantingDateValue.getMonth() + 1 ===
        Number(cleanedPlantingDate.slice(5, 7)) &&
      plantingDateValue.getDate() ===
        Number(cleanedPlantingDate.slice(8, 10));

    if (!isRealDate || cleanedPlantingDate > today) {
      Alert.alert(
        'Invalid Planting Date',
        'Planting date must be a valid date that is not in the future.'
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
          plantingDate:
            cleanedPlantingDate,
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
              router.canGoBack() ? router.back() : router.navigate('/irrigation')
            }
            activeOpacity={
              0.7
            }
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft
              size={24}
              color={colors.text}
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

          {/* Page help, in the same place every other screen puts it -
              beside the header's trailing element. It disappears entirely
              when the farmer turns page help off in Settings. */}
          <HelpButton screen="zoneDetail" />

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

          {/* ------------------------------------------------------------
              THE ENGINE'S FARMER-FACING SURFACE

              Placed straight after the live readings, because the readings
              say what is happening and these say what to do about it - which
              is the order the screen is read in. Each piece renders nothing
              when its data is missing, so a zone with no crop, no planting
              date or no calibration shows exactly what it did before.
              ------------------------------------------------------------ */}

          <ZoneGrowthBar
            stage={zoneGrowth?.stage}
            dayOfSeason={zoneGrowth?.dayOfSeason}
            totalDays={zoneGrowth?.totalDays}
            cropLabel={zoneGrowth?.cropLabel}
          />

          <ZoneInsightsCard
            zoneId={Number(
              selectedZone.id
            )}
          />

          {/* ---- Kit, soil and setup rows ---------------------------- */}
          {/* Three navigation/action rows rather than three cards: each is
              a door to somewhere else, and a farmer scanning this screen
              should be able to tell them apart from the readings above at a
              glance. */}

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              router.push({
                pathname: '/zone-hardware',
                params: {
                  zoneId: String(
                    selectedZone.id
                  ),
                  zoneName:
                    selectedZone.name,
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Your kit"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                Your kit
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                Is it working, and change its WiFi
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              router.push({
                pathname: '/forecast',
                params: {
                  zoneId: String(
                    selectedZone.id
                  ),
                  zoneName:
                    selectedZone.name,
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="The week ahead"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                The week ahead
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                Weather and watering advice for 7 days
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          {/* Item 6: the checklist of what this zone's advice is missing. */}
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() =>
              router.push({
                pathname: '/zone-setup',
                params: { zoneId: String(selectedZone.id) },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Finish setup"
          >
            <View style={styles.linkRowCopy}>
              <Text style={styles.linkRowTitle}>Finish setup</Text>
              <Text style={styles.linkRowHint}>Planting date, size, flow rate - for surer advice</Text>
            </View>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              router.push({
                pathname: '/zone-soil',
                params: {
                  zoneId: String(
                    selectedZone.id
                  ),
                },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Soil type"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                Soil type
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                How much water your soil holds
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.linkRow
            }
            onPress={() =>
              setCalibrateVisible(
                true
              )
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Teach the sensor your soil"
          >
            <View
              style={
                styles.linkRowCopy
              }
            >
              <Text
                style={
                  styles.linkRowTitle
                }
              >
                Teach the sensor your soil
              </Text>

              <Text
                style={
                  styles.linkRowHint
                }
              >
                Save a wet and a dry reading
              </Text>
            </View>

            <ChevronRight
              size={20}
              color={colors.textMuted}
              strokeWidth={2}
            />
          </TouchableOpacity>

          <ResetRecommendedButton
            zoneId={Number(
              selectedZone.id
            )}
          />

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
                  ? 'Manual command sent'
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
                    ? 'Manual request'
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
                        ? 'Send Stop Command'
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

              <TouchableOpacity
                style={styles.textAction}
                onPress={beginZoneEditing}
                accessibilityRole="button"
                accessibilityLabel="Edit zone and automation"
              >
                <Text style={styles.textActionLabel}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.detailRows}>
              {zoneSummaryRows.flat().map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
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

                <TouchableOpacity
                  style={styles.textAction}
                  onPress={beginScheduleEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Edit regular irrigation schedule"
                >
                  <Text style={styles.textActionLabel}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.detailRows}>
              {scheduleWeatherRows.flat().map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>System Status</Text>
            </View>

            <View style={styles.detailRows}>
              {systemStatusItems.map((item) => (
                <View key={item.label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={styles.detailValue}>{item.value}</Text>
                </View>
              ))}
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

      <BlurSheet visible={isEditingZone} onClose={() => { if (!settingsSaving) cancelZoneEditing(); }} title="Edit Zone & Automation">
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

                <Text style={styles.inputLabel}>Planting Date</Text>
                <TextInput
                  value={plantingDate}
                  onChangeText={setPlantingDate}
                  editable={!settingsSaving}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.text}
                  style={styles.input}
                  maxLength={10}
                  autoCapitalize="none"
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
      </BlurSheet>
      <BlurSheet visible={isEditingSchedule} onClose={() => { if (!scheduleSettingsSaving) cancelScheduleEditing(); }} title="Edit Schedule">
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
      </BlurSheet>

      {/* Teaching the sensor what wet and dry look like in THIS soil. Its own
          sheet (not a BlurSheet row) because it is two independent saves made
          on different days - soaked soil and properly dry soil are a day or
          more apart - rather than one choice. */}
      <CalibrateSoilSheet
        zoneId={Number(
          selectedZone.id
        )}
        visible={
          calibrateVisible
        }
        onClose={() =>
          setCalibrateVisible(
            false
          )
        }
      />
    </SafeAreaView>
  );
}

