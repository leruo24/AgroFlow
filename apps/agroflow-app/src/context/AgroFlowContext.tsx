//defines the central farm state and provides functions to manipulate that state. It uses React's context API to make the farm data and functions available throughout the application. The context includes information about zones, irrigation history, and alerts, as well as functions to start/stop irrigation, enable/disable manual overrides, set override schedules, and mark alerts as read. The state is persisted using AsyncStorage, allowing the app to retain data across sessions.
import AsyncStorage from '@react-native-async-storage/async-storage';//saves information locally on the phone to temporarily allow the demo to remember things when the app is closed

import {
  createContext,//creates shared data that can be accessed by different pages
  useCallback,//memoises the zone-loading function so effects can depend on it safely
  useContext,//reads the shared data
  useEffect,//stores changing info
  useRef,//stores a value without causing the page to render
  useState,//runs the code when data changes
} from 'react';

import type {
  ReactNode,
} from 'react';
//import temporary data while we are still waiting to connect DB
import {
  mockAlerts,
} from '@/data/mockAlerts';//rep database alert records

import {
  mockHistory,
} from '@/data/mockHistory';//rep database history records

import {
  startIrrigationCommand,
  stopIrrigationCommand,
} from '@/services/irrigationCommandService';//queues rows in irrigation_commands for the ESP32 to poll

import {
  fetchFarms,
  fetchZoneLatestReadings,
} from '@/services/zoneService';//reads zone identity + latest sensor readings from Supabase

import type {
  FarmRow,
  ZoneLatestReadingRow,
} from '@/services/zoneService';
//status stypes - restricts irrigation to these statuses
export type IrrigationStatus =
  | 'Active'
  | 'Scheduled'
  | 'Paused'
  | 'Off';

export type MoistureStatus =
  | 'Dry'
  | 'Optimal'
  | 'Wet';

export type SensorStatus =
  | 'Online'
  | 'Offline'
  | 'Low Battery'
  | 'Fault';
//in the actual system these values should come from the backend
export type RelayStatus =
  | 'On'
  | 'Off'
  | 'Fault';

export type PumpStatus =
  | 'Running'
  | 'Off'
  | 'Fault';
//schedule types
export type TemporarySchedule = {//once off schedule created during manuall override
  date: string;
  time: string;
  durationMinutes: number;
};

export type IrrigationSchedule = {//normal irrigation - later can be delegated to backend 
  enabled: boolean;
  days: string[];
  startTime: string;
  durationMinutes: number;
};

export type AutomationRules = {
  enabled: boolean;//irrigation allowed
  moistureThreshold: number;//when it should start
  desiredMoisture: number;//when it should end
  weatherAdjustment: boolean;//whether rain should prevent irrigation
};

export type IrrigationOverride = {
  active: boolean;
  temporarySchedule:
    | TemporarySchedule
    | null;
};
//defines everything one zone needs to show
export type Zone = {
  id: string;
  name: string;
  location: string;
  crop: string;

  // The real Postgres zone.id (bigint) this mock zone corresponds to, if
  // any. undefined for all current mock records since zones are still
  // local-only - irrigation_commands writes are skipped whenever this is
  // unset rather than guessing an id. Once zones are fetched from Supabase
  // instead of mockZones, this should just be that row's real id.
  dbZoneId?: number;

  size: {
    value: number;
    unit: string;
  };
//sensor information
  sensors: {
    soilMoisture: {
      value: number;
      unit: string;
      status: SensorStatus;
      moistureStatus: MoistureStatus;
    };

    temperatureHumidity: {
      temperature: number;
      temperatureUnit: string;
      humidity: number;
      humidityUnit: string;
      status: SensorStatus;
    };
  };
//irrigation information
  irrigation: {
    status: IrrigationStatus;

    lastIrrigation: {
      date: string;
      time: string;
      durationMinutes: number;
    };

    schedule: IrrigationSchedule;

    automation: AutomationRules;

    override: IrrigationOverride;
  };

  relay: {
    status: RelayStatus;
  };

  pump: {
    status: PumpStatus;
  };

  water: {
    usedTodayLitres: number;
    latestCycleLitres: number;
    flowRateLpm: number;
  };
//weather adjustment
  weather: {
    rainExpected: boolean;
    message: string;
  };

  alerts: {
    id: string;
    type: string;
    message: string;
  }[];
};

// Builds the app's rich Zone shape from what the real schema actually has.
// zone_latest_reading only carries zone_id, farm_id, crop_type, water_saved,
// health_status and the three latest sensor values - everything else below
// (schedule, automation, override, relay/pump status, water usage stats,
// weather, alerts) has no backing table yet, so it's defaulted rather than
// invented. See the summary this was introduced with for the full list of
// what still needs a real data source.
function deriveMoistureStatus(
  moisture: number | null
): MoistureStatus {
  if (
    moisture ==
      null
  ) {
    return 'Optimal'; // no reading yet - avoid a false "Dry" alarm
  }

  if (
    moisture <
      30
  ) {
    return 'Dry';
  }

  if (
    moisture >
      60
  ) {
    return 'Wet';
  }

  return 'Optimal';
}

function buildZoneFromDb(
  row: ZoneLatestReadingRow,
  farm: FarmRow | undefined
): Zone {
  const hasMoisture =
    row.moisture !=
      null;

  const hasTempHumidity =
    row.temperature !=
      null ||
    row.humidity !=
      null;

  return {
    id:
      String(
        row.zone_id
      ),

    dbZoneId:
      row.zone_id,

    name:
      row.crop_type
        ? `Zone ${row.zone_id} — ${row.crop_type}`
        : `Zone ${row.zone_id}`,

    location:
      farm?.location ??
      '',

    crop:
      row.crop_type ??
      '',

    size: {
      value:
        farm?.total_area ??
        0,

      unit: 'ha',
    },

    sensors: {
      soilMoisture: {
        value:
          row.moisture ??
          0,

        unit: '%',

        status: hasMoisture
          ? 'Online'
          : 'Offline',

        moistureStatus:
          deriveMoistureStatus(
            row.moisture
          ),
      },

      temperatureHumidity: {
        temperature:
          row.temperature ??
          0,

        temperatureUnit:
          '°C',

        humidity:
          row.humidity ??
          0,

        humidityUnit: '%',

        status: hasTempHumidity
          ? 'Online'
          : 'Offline',
      },
    },

    // No irrigation_event/schedule/automation-rules query is wired up here
    // yet, so these all start at a neutral "nothing happening" default.
    irrigation: {
      status: 'Off',

      lastIrrigation: {
        date: '',
        time: '',
        durationMinutes: 0,
      },

      schedule: {
        enabled: false,
        days: [],
        startTime: '',
        durationMinutes: 0,
      },

      automation: {
        enabled: false,
        moistureThreshold: 30,
        desiredMoisture: 60,
        weatherAdjustment: false,
      },

      override: {
        active: false,
        temporarySchedule: null,
      },
    },

    relay: {
      status: 'Off',
    },

    pump: {
      status: 'Off',
    },

    water: {
      usedTodayLitres: 0,
      latestCycleLitres: 0,
      flowRateLpm: 0,
    },

    weather: {
      rainExpected: false,
      message:
        'Weather data not connected to zones yet',
    },

    alerts: [],
  };
}

type AutomaticIrrigationAction =//deciding whether to start or stop
  | 'start'
  | 'stop'
  | null;

function getAutomaticIrrigationAction(
  zone: Zone
): AutomaticIrrigationAction {
  const automation =
    zone.irrigation.automation;

  const moisture =
    zone.sensors.soilMoisture.value;

  const startAt =
    automation.moistureThreshold;

  const stopAt =
    automation.desiredMoisture;

  const automaticControlIsAvailable =
    automation.enabled &&
    !zone.irrigation.override.active;

  if (
    !automaticControlIsAvailable
  ) {
    return null;
  }

  // Once irrigation starts, it continues until the
  // separate desired moisture level is reached.
  if (
    zone.irrigation.status === 'Active' &&
    moisture >= stopAt
  ) {
    return 'stop';
  }

  const scheduleAllowsStart =
    zone.irrigation.schedule.enabled;

  const sensorAllowsStart =
    zone.sensors.soilMoisture.status ===
    'Online';

  const weatherBlocksStart =
    automation.weatherAdjustment &&
    zone.weather.rainExpected;

  if (
    zone.irrigation.status !== 'Active' &&
    moisture <= startAt &&
    scheduleAllowsStart &&
    sensorAllowsStart &&
    !weatherBlocksStart
  ) {
    return 'start';
  }

  return null;
}

function applyAutomaticIrrigationAction(//creates updated zone object
  zone: Zone,
  action: 'start' | 'stop'
): Zone {
  const shouldStart =
    action === 'start';

  return {
    ...zone,

    irrigation: {
      ...zone.irrigation,
      status: shouldStart
        ? 'Active'
        : zone.irrigation.schedule.enabled
          ? 'Scheduled'
          : 'Off',
    },

    relay: {
      ...zone.relay,
      status: shouldStart
        ? 'On'
        : 'Off',
    },

    pump: {
      ...zone.pump,
      status: shouldStart
        ? 'Running'
        : 'Off',
    },

    water: {
      ...zone.water,
      flowRateLpm: shouldStart
        ? 15
        : 0,
    },
  };
}

export type HistoryEntry =
  (typeof mockHistory)[number];

type AlertEntry =
  (typeof mockAlerts)[number];

type AgroFlowContextType = {//defines the structure of the AgroFlow context, including the state variables for zones, history, and alerts, as well as the functions to manipulate these states. It provides a centralized way to manage the farm's irrigation system and related data within the app.
  zones: Zone[];
  zonesLoading: boolean;
  zonesError: string | null;
  refreshZones: () => void;
  history: HistoryEntry[];
  alerts: AlertEntry[];

  startIrrigation: (//starts irrigation for a specific zone, updating the zone's irrigation status to "Active" and turning on the relay and pump. It also logs the action in the history and generates an alert to inform the user that manual irrigation has started. durationMinutes is optional - null/omitted means run until an explicit stop.
    zoneId: string,
    durationMinutes?: number | null
  ) => void;

  stopIrrigation: (//stops irrigation for a specific zone, updating the zone's irrigation status to "Off" and turning off the relay and pump. It also logs the action in the history and generates an alert to inform the user that manual irrigation has been stopped.
    zoneId: string
  ) => void;

  enableManualOverride: (//enables manual override for a specific zone, allowing the user to take control of the irrigation system. It updates the zone's irrigation status to "Active" and sets the override state to active. This function also logs the action in the history and generates an alert to inform the user that manual override is now active.
    zoneId: string
  ) => void;

  endManualOverride: (//ends the manual override for a specific zone, returning control to the automatic irrigation system. It updates the zone's irrigation status based on whether the schedule is enabled or not, and resets the override state. This function also logs the action in the history and generates an alert to inform the user that automatic control has been restored.
    zoneId: string
  ) => void;

  setOverrideSchedule: (
    zoneId: string,//sets a temporary irrigation schedule for a specific zone. It updates the zone's irrigation status to "Scheduled" and stores the provided date, time, and duration for the override. This allows users to manually control irrigation timing while the manual override is active.
    date: string,
    time: string,
    durationMinutes: number
  ) => void;

  markAlertAsRead: (
    alertId: string
  ) => void;
};

const STORAGE_KEYS = {//data is saved in AsyncStorage with specific keys for history and alerts, so the app retains them across sessions. zones is intentionally NOT persisted here - it now comes from Supabase on every load (see loadZones), and caching it locally would silently override live data with a stale snapshot.
  history:
    'agroflow_history',

  alerts:
    'agroflow_alerts',
};

const AgroFlowContext =//creates a React context for the AgroFlow state, allowing components to access and manipulate the farm's irrigation system data. The context provides a centralized way to manage zones, history, and alerts, as well as functions to control irrigation and overrides.
  createContext<
    AgroFlowContextType | undefined
  >(undefined);

export function AgroFlowProvider({//provides the AgroFlow context to its child components, allowing them to access and manipulate the farm's irrigation system data. It initializes the state for zones, history, and alerts, and defines functions to control irrigation, manage overrides, and handle alerts. The provider also handles loading and saving the state to AsyncStorage to persist data across app sessions.
  children,
}: {
  children: ReactNode;
}) {
  const [//zones now come from Supabase (zone_latest_reading + farm), not mock data or AsyncStorage - see loadZones below. Starts empty until the first fetch resolves.
    zones,
    setZones,
  ] =
    useState<Zone[]>(
      []
    );

  const [
    zonesLoading,
    setZonesLoading,
  ] =
    useState(true);

  const [
    zonesError,
    setZonesError,
  ] =
    useState<string | null>(
      null
    );

  const loadZones =
    useCallback(
      async () => {
        try {
          setZonesLoading(
            true
          );

          setZonesError(
            null
          );

          const [
            readings,
            farms,
          ] =
            await Promise.all([
              fetchZoneLatestReadings(),
              fetchFarms(),
            ]);

          const farmsById =
            new Map(
              farms.map(
                (
                  farm
                ) =>
                  [
                    farm.farm_id,
                    farm,
                  ] as const
              )
            );

          setZones(
            readings.map(
              (
                row
              ) =>
                buildZoneFromDb(
                  row,
                  row.farm_id ==
                    null
                    ? undefined
                    : farmsById.get(
                        row.farm_id
                      )
                )
            )
          );
        } catch (
          error
        ) {
          console.error(
            'Failed to load zones from Supabase:',
            error
          );

          setZonesError(
            'Unable to load zones'
          );
        } finally {
          setZonesLoading(
            false
          );
        }
      },
      []
    );

  useEffect(() => {
    loadZones();
  }, [
    loadZones,
  ]);
//stores action history
  const [
    history,
    setHistory,
  ] =
    useState<
      HistoryEntry[]
    >(mockHistory);
//stores irrigation alerts
  const [
    alerts,
    setAlerts,
  ] =
    useState<
      AlertEntry[]
    >(mockAlerts);

  const [//isHydrated state variable is used to track whether the initial data has been loaded from AsyncStorage. It prevents saving to AsyncStorage before the initial load is complete, ensuring that the app does not overwrite existing data with default values.
    isHydrated,
    setIsHydrated,
  ] =
    useState(false);

  const automaticActionKeys =
    useRef<
      Record<string, string>
    >({});

  useEffect(() => {//loads the saved history/alerts data from AsyncStorage when the component mounts (zones are handled separately by loadZones, not AsyncStorage). It retrieves the data using the defined storage keys and updates the state variables accordingly. If any of the data is not found, it retains the default mock data. Once the data is loaded, it sets isHydrated to true to indicate that the initial load is complete.
    async function loadSavedData() {
      try {
        const [
          savedHistory,
          savedAlerts,
        ] =
          await Promise.all([//retrieves the saved data for history and alerts from AsyncStorage in parallel. This improves performance by reducing the total time spent waiting for each individual retrieval operation.
            AsyncStorage.getItem(
              STORAGE_KEYS.history
            ),

            AsyncStorage.getItem(
              STORAGE_KEYS.alerts
            ),
          ]);

        if (
          savedHistory
        ) {
          setHistory(
            JSON.parse(
              savedHistory
            ) as HistoryEntry[]
          );
        }

        if (
          savedAlerts
        ) {
          setAlerts(
            JSON.parse(
              savedAlerts
            ) as AlertEntry[]
          );
        }
      } catch (
        error
      ) {
        console.error(
          'Failed to load AgroFlow data:',
          error
        );
      } finally {
        setIsHydrated(
          true
        );
      }
    }

    loadSavedData();
  }, []);

  useEffect(() => {//saves the history data to AsyncStorage whenever it changes, but only after the initial load is complete (isHydrated is true). This ensures that the app does not overwrite existing data with default values before the initial load. If an error occurs during saving, it logs the error to the console.
    if (
      !isHydrated
    ) {
      return;
    }

    AsyncStorage.setItem(
      STORAGE_KEYS.history,
      JSON.stringify(
        history
      )
    ).catch(
      (
        error
      ) => {
        console.error(
          'Failed to save history:',
          error
        );
      }
    );
  }, [
    history,
    isHydrated,
  ]);

  useEffect(() => {//saves the alerts data to AsyncStorage whenever it changes, but only after the initial load is complete (isHydrated is true). This ensures that the app does not overwrite existing data with default values before the initial load. If an error occurs during saving, it logs the error to the console.
    if (
      !isHydrated
    ) {
      return;
    }

    AsyncStorage.setItem(
      STORAGE_KEYS.alerts,
      JSON.stringify(
        alerts
      )
    ).catch(
      (
        error
      ) => {
        console.error(
          'Failed to save alerts:',
          error
        );
      }
    );
  }, [
    alerts,
    isHydrated,
  ]);

  useEffect(() => {
    if (
      !isHydrated
    ) {
      return;
    }

    const transitions: {
      zone: Zone;
      action: 'start' | 'stop';
    }[] = [];

    zones.forEach(
      (
        zone
      ) => {
        const action =
          getAutomaticIrrigationAction(
            zone
          );

        if (
          !action
        ) {
          delete automaticActionKeys
            .current[
              zone.id
            ];

          return;
        }

        const moisture =
          zone.sensors
            .soilMoisture
            .value;

        const transitionKey =
          `${action}:${moisture}:${zone.irrigation.status}`;

        if (
          automaticActionKeys
            .current[
              zone.id
            ] ===
          transitionKey
        ) {
          return;
        }

        automaticActionKeys
          .current[
            zone.id
          ] =
          transitionKey;

        transitions.push({
          zone,
          action,
        });
      }
    );

    if (
      transitions.length === 0
    ) {
      return;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            zone
          ) => {
            const transition =
              transitions.find(
                (
                  item
                ) =>
                  item.zone.id ===
                  zone.id
              );

            return transition
              ? applyAutomaticIrrigationAction(
                  zone,
                  transition.action
                )
              : zone;
          }
        )
    );

    transitions.forEach(
      ({
        zone,
        action,
      }) => {
        const moisture =
          zone.sensors
            .soilMoisture
            .value;

        const startAt =
          zone.irrigation
            .automation
            .moistureThreshold;

        const stopAt =
          zone.irrigation
            .automation
            .desiredMoisture;

        if (
          action === 'start'
        ) {
          addHistoryEntry(
            zone.id,
            'Automatic Irrigation Started',
            `Soil moisture reached ${moisture}%. Irrigation started at ${startAt}% and will continue until ${stopAt}%.`,
            'irrigation',
            'Automatic'
          );

          addAlert(
            zone.id,
            'Automatic Irrigation Started',
            `Soil moisture is ${moisture}%. Irrigation will stop when it reaches ${stopAt}%.`,
            'success'
          );

          return;
        }

        addHistoryEntry(
          zone.id,
          'Automatic Irrigation Stopped',
          `Soil moisture reached the desired level of ${stopAt}%, so irrigation stopped automatically.`,
          'irrigation',
          'Automatic'
        );

        addAlert(
          zone.id,
          'Desired Moisture Reached',
          `Soil moisture reached ${moisture}%. Automatic irrigation has stopped.`,
          'info'
        );
      }
    );
  }, [
    zones,
    isHydrated,
  ]);

  function findZone(//finds a zone by its ID from the zones state array. It returns the zone object if found, or undefined if no matching zone is found. This function is used internally by other functions to locate specific zones for irrigation control and alert management.
    zoneId: string
  ) {
    return zones.find(
      (
        zone
      ) =>
        zone.id ===
        zoneId
    );
  }

  function addHistoryEntry(//adds a new entry to the irrigation history for a specific zone. It creates a new history entry object with the provided action, description, and type, along with the current timestamp. The new entry is then added to the beginning of the history array, ensuring that the most recent actions are displayed first.
    zoneId: string,
    action: string,
    description: string,
    type: HistoryEntry['type'],
    source: HistoryEntry['source'] =
      'Farmer'
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone
    ) {
      return;
    }

    const newEntry = {
      id:
        `history-${Date.now()}-${Math.random()}`,

      action,

      description,

      zone:
        zone.name,

      source,

      timestamp:
        new Date().toISOString(),

      type,
    } as HistoryEntry;

    setHistory(
      (
        current
      ) => [
        newEntry,
        ...current,
      ]
    );
  }

  function addAlert(//adds a new alert for a specific zone. It creates a new alert object with the provided title, message, and type, along with the current timestamp. The new alert is then added to the beginning of the alerts array, ensuring that the most recent alerts are displayed first. This function is used to notify users of important events related to irrigation and zone management.
    zoneId: string,
    title: string,
    message: string,
    type: AlertEntry['type']
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone
    ) {
      return;
    }

    const newAlert = {//creates a new alert object with a unique ID, the provided title, message, and type, the name of the zone, the current timestamp, and a read status set to false. This object is then added to the alerts state array to notify users of important events related to irrigation and zone management.
      id:
        `alert-${Date.now()}-${Math.random()}`,

      type,

      title,

      message,

      zone:
        zone.name,

      timestamp:
        new Date().toISOString(),

      read:
        false,
    } as AlertEntry;

    setAlerts(
      (
        current
      ) => [
        newAlert,
        ...current,
      ]
    );
  }

  function startIrrigation(//starts irrigation for a specific zone, updating the zone's irrigation status to "Active" and turning on the relay and pump. It also logs the action in the history and generates an alert to inform the user that manual irrigation has started.
    zoneId: string,
    durationMinutes?: number | null
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone ||
      !zone.irrigation
        .override.active
    ) {
      return;
    }

    // Queues the actual command the ESP32 polls for. Skipped when this mock
    // zone has no corresponding real Postgres row yet (see Zone.dbZoneId) -
    // the local state update below still drives the UI either way.
    if (
      zone.dbZoneId !=
        null
    ) {
      startIrrigationCommand(
        zone.dbZoneId,
        durationMinutes ??
          null
      ).catch(
        (
          error
        ) => {
          console.error(
            'Failed to queue irrigation_commands start row:',
            error
          );
        }
      );
    }

    setZones(//sets the irrigation status of the specified zone to "Active", turns on the relay and pump, and sets the water flow rate to 15 liters per minute. This function updates the zones state by mapping over the current zones and modifying the matching zone's properties accordingly.
      (
        current
      ) =>
        current.map(
          (
            item
          ) =>
            item.id ===
            zoneId
              ? {
                  ...item,

                  irrigation: {
                    ...item.irrigation,

                    status:
                      'Active',
                  },

                  relay: {
                    ...item.relay,

                    status:
                      'On',
                  },

                  pump: {
                    ...item.pump,

                    status:
                      'Running',
                  },

                  water: {
                    ...item.water,

                    flowRateLpm:
                      15,
                  },
                }
              : item
        )
    );

    addHistoryEntry(//logs the action of starting irrigation in the history for the specific zone, providing a description and categorizing it as an "irrigation" type entry. This helps track user actions and system events related to irrigation control.
      zoneId,
      'Manual Irrigation Started',
      'Irrigation was started while manual override was active.',
      'irrigation'
    );

    addAlert(//generates an alert to inform the user that manual irrigation has started for the specific zone. The alert includes a title, message, and type, and is added to the alerts state to notify users of important events related to irrigation and zone management.
      zoneId,
      'Irrigation Started',
      'Manual irrigation has started successfully.',
      'success'
    );
  }

  function stopIrrigation(//stops irrigation for a specific zone, updating the zone's irrigation status to "Off" and turning off the relay and pump. It also logs the action in the history and generates an alert to inform the user that manual irrigation has been stopped.
    zoneId: string
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone ||
      !zone.irrigation
        .override.active
    ) {
      return;
    }

    // See startIrrigation - same dbZoneId guard, same fire-and-forget queue.
    if (
      zone.dbZoneId !=
        null
    ) {
      stopIrrigationCommand(
        zone.dbZoneId
      ).catch(
        (
          error
        ) => {
          console.error(
            'Failed to queue irrigation_commands stop row:',
            error
          );
        }
      );
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            item
          ) =>
            item.id ===
            zoneId
              ? {
                  ...item,

                  irrigation: {
                    ...item.irrigation,

                    status:
                      'Off',
                  },

                  relay: {
                    ...item.relay,

                    status:
                      'Off',
                  },

                  pump: {
                    ...item.pump,

                    status:
                      'Off',
                  },

                  water: {
                    ...item.water,

                    flowRateLpm:
                      0,
                  },
                }
              : item
        )
    );

    addHistoryEntry(//logs the action of stopping irrigation in the history for the specific zone, providing a description and categorizing it as an "irrigation" type entry. This helps track user actions and system events related to irrigation control.
      zoneId,
      'Manual Irrigation Stopped',
      'Irrigation was stopped while manual override was active.',
      'irrigation'
    );

    addAlert(
      zoneId,
      'Irrigation Stopped',
      'Manual irrigation has been stopped.',
      'info'
    );
  }

  function enableManualOverride(//enables manual override for a specific zone, allowing the user to take control of the irrigation system. It updates the zone's irrigation status to "Active" and sets the override state to active. This function also logs the action in the history and generates an alert to inform the user that manual override is now active.
    zoneId: string
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone ||
      zone.irrigation
        .override.active
    ) {
      return;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            item
          ) =>
            item.id ===
            zoneId
              ? {
                  ...item,

                  irrigation: {
                    ...item.irrigation,

                    override: {
                      active:
                        true,

                      temporarySchedule:
                        null,
                    },
                  },
                }
              : item
        )
    );

    addHistoryEntry(//logs the action of enabling manual override in the history for the specific zone, providing a description and categorizing it as an "override" type entry. This helps track user actions and system events related to irrigation control.
      zoneId,
      'Manual Override Enabled',
      'Automatic irrigation control was temporarily suspended.',
      'override'
    );

    addAlert(//generates an alert to inform the user that manual override has been enabled for the specific zone. The alert includes a title, message, and type, and is added to the alerts state to notify users of important events related to irrigation and zone management.
      zoneId,
      'Manual Override Active',
      'Automatic irrigation control has been temporarily suspended.',
      'warning'
    );
  }

  function endManualOverride(
    zoneId: string
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone ||
      !zone.irrigation
        .override.active
    ) {
      return;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            item
          ) => {
            if (
              item.id !==
              zoneId
            ) {
              return item;
            }

            return {
              ...item,

              irrigation: {
                ...item.irrigation,

                status:
                  item.irrigation
                    .schedule.enabled
                    ? 'Scheduled'
                    : 'Off',

                override: {
                  active:
                    false,

                  temporarySchedule:
                    null,
                },
              },

              relay: {
                ...item.relay,

                status:
                  'Off',
              },

              pump: {
                ...item.pump,

                status:
                  'Off',
              },

              water: {
                ...item.water,

                flowRateLpm:
                  0,
              },
            };
          }
        )
    );

    addHistoryEntry(//logs the action of ending manual override in the history for the specific zone, providing a description and categorizing it as an "override" type entry. This helps track user actions and system events related to irrigation control.
      zoneId,
      'Manual Override Ended',
      'Manual control ended and automatic irrigation control resumed.',
      'override'
    );

    addAlert(//generates an alert to inform the user that manual override has ended for the specific zone. The alert includes a title, message, and type, and is added to the alerts state to notify users of important events related to irrigation and zone management.
      zoneId,
      'Automatic Control Restored',
      'The zone has returned to automatic irrigation control.',
      'success'
    );
  }

  function setOverrideSchedule(//sets a temporary irrigation schedule for a specific zone. It updates the zone's irrigation status to "Scheduled" and stores the provided date, time, and duration for the override. This allows users to manually control irrigation timing while the manual override is active.
    zoneId: string,
    date: string,
    time: string,
    durationMinutes: number
  ) {
    const zone =
      findZone(
        zoneId
      );

    if (
      !zone ||
      !zone.irrigation
        .override.active
    ) {
      return;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            item
          ) =>
            item.id ===
            zoneId
              ? {
                  ...item,

                  irrigation: {
                    ...item.irrigation,

                    status:
                      'Scheduled',

                    override: {
                      active:
                        true,

                      temporarySchedule: {
                        date,
                        time,
                        durationMinutes,
                      },
                    },
                  },

                  relay: {
                    ...item.relay,

                    status:
                      'Off',
                  },

                  pump: {
                    ...item.pump,

                    status:
                      'Off',
                  },

                  water: {
                    ...item.water,

                    flowRateLpm:
                      0,
                  },
                }
              : item
        )
    );

    addHistoryEntry(//logs the action of overriding schedule
      zoneId,
      'Override Schedule Created',
      `Temporary irrigation scheduled for ${date} at ${time} for ${durationMinutes} minutes.`,
      'override'
    );

    addAlert(//generate an alert to inform user that the temporary schedule is set
      zoneId,
      'Override Schedule Set',
      `Temporary irrigation is scheduled for ${date} at ${time}.`,
      'info'
    );
  }

  function markAlertAsRead(
    alertId: string
  ) {
    setAlerts(
      (
        current
      ) =>
        current.map(
          (
            alert
          ) =>
            alert.id ===
            alertId
              ? {
                  ...alert,

                  read:
                    true,
                }
              : alert
        )
    );
  }

  return (
    <AgroFlowContext.Provider
      value={{
        zones,
        zonesLoading,
        zonesError,
        refreshZones:
          loadZones,
        history,
        alerts,
        startIrrigation,
        stopIrrigation,
        enableManualOverride,
        endManualOverride,
        setOverrideSchedule,
        markAlertAsRead,
      }}
    >
      {children}
    </AgroFlowContext.Provider>
  );
}

export function useAgroFlow() {
  const context =
    useContext(
      AgroFlowContext
    );

  if (
    !context
  ) {
    throw new Error(
      'useAgroFlow must be used inside AgroFlowProvider'
    );
  }

  return context;
}