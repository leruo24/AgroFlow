//defines the central farm state and provides functions to manipulate that state. Zone identity and automation settings come from Supabase, while temporary irrigation history and alerts are still stored locally with AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';//saves information locally on the phone to temporarily allow the demo to remember things when the app is closed

import {
  createContext,//creates shared data that can be accessed by different pages
  useCallback,//memoises a function so it can be reused (e.g. as a manual "retry" action) without changing identity every render
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
  mockZones,
} from '@/data/mockZones';//temporary sensor, irrigation, relay, and pump values until the hardware tables are connected

import {
  useAuth,
} from '@/context/AuthContext';

import {
  supabase,
} from '@/lib/supabase';
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
export type IrrigationMode =
  | 'automatic'
  | 'scheduled';

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
  durationMinutes:
    | number
    | null;
};
//defines everything one zone needs to show
export type Zone = {
  id: string;
  farmId: string;
  name: string;
  location: string;
  crop: string;
  healthStatus: string;
  waterSavedLitres: number;

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
    mode: IrrigationMode;

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

//defines the farm information retrieved from Supabase for the
//currently authenticated farmer
export type Farm = {
  id: string;
  ownerId: string;
  name: string;
  location: string;
  totalArea: number;
  status: string;
  latitude: number | null;
  longitude: number | null;
};

type DatabaseId =
  | string
  | number;

type FarmMemberRow = {
  farm_id: DatabaseId;
};

type FarmRow = {
  farm_id: DatabaseId;
  owner_id: string;
  name: string;
  location: string;
  total_area:
    | number
    | string;
  status: string;
  latitude:
    | number
    | string
    | null;
  longitude:
    | number
    | string
    | null;
};

type ZoneRow = {
  id: DatabaseId;
  farm_id: DatabaseId;
  name?: string | null;
  location?: string | null;
  crop_type?: string | null;
  water_saved?:
    | number
    | string
    | null;
  health_status?: string | null;
  size_value?:
    | number
    | string
    | null;
  size_unit?: string | null;
  automation_enabled?: boolean | null;
  moisture_threshold?:
    | number
    | string
    | null;
  desired_moisture?:
    | number
    | string
    | null;
  weather_adjustment?: boolean | null;
  irrigation_mode?: string | null;
  schedule_enabled?: boolean | null;
  schedule_days?: string[] | null;
  schedule_start_time?: string | null;
  schedule_duration_minutes?:
    | number
    | string
    | null;
};

//uses the authenticated profile ID to find the farmer's membership
//record and then retrieves the assigned farm from Supabase
async function fetchAssignedFarm(
  profileId: string
): Promise<Farm | null> {
  const {
    data: membership,
    error: membershipError,
  } =
    await supabase
      .from('farm_member')
      .select('farm_id')
      .eq(
        'profile_id',
        profileId
      )
      .limit(1)
      .maybeSingle<
        FarmMemberRow
      >();

  if (
    membershipError
  ) {
    throw membershipError;
  }

  if (
    !membership
  ) {
    return null;
  }

  const {
    data: farmRow,
    error: farmError,
  } =
    await supabase
      .from('farm')
      .select(
        'farm_id, owner_id, name, location, total_area, status, latitude, longitude'
      )
      .eq(
        'farm_id',
        membership.farm_id
      )
      .single<
        FarmRow
      >();

  if (
    farmError
  ) {
    throw farmError;
  }

  return {
    id:
      String(
        farmRow.farm_id
      ),

    ownerId:
      farmRow.owner_id,

    name:
      farmRow.name,

    location:
      farmRow.location,

    totalArea:
      Number(
        farmRow.total_area
      ),

    status:
      farmRow.status,

    latitude:
      farmRow.latitude ===
      null
        ? null
        : Number(
            farmRow.latitude
          ),

    longitude:
      farmRow.longitude ===
      null
        ? null
        : Number(
            farmRow.longitude
          ),
  };
}

export type UpdateZoneSettingsInput = {
  name: string;
  location: string;
  crop: string;
  moistureThreshold: number;
  desiredMoisture: number;
  automationEnabled: boolean;
  weatherAdjustment: boolean;
};

export type UpdateZoneScheduleInput = {
  enabled: boolean;
  days: string[];
  startTime: string;
  durationMinutes: number;
};

function mapZoneRow(
  row: ZoneRow,
  index: number
): Zone {
  const template =
    mockZones[
      index %
      mockZones.length
    ] as unknown as Zone;

  return {
    ...template,
    id:
      String(
        row.id
      ),
    farmId:
      String(
        row.farm_id
      ),
    name:
      row.name?.trim() ||
      `Zone ${index + 1}`,
    location:
      row.location?.trim() ||
      'Not configured',
    crop:
      row.crop_type?.trim() ||
      'Not configured',
    healthStatus:
      row.health_status ??
      'Unknown',
    waterSavedLitres:
      Number(
        row.water_saved ??
        0
      ),
    size: {
      ...template.size,
      value:
        Number(
          row.size_value ??
          template.size.value
        ),
      unit:
        row.size_unit ??
        template.size.unit,
    },
    irrigation: {
      ...template.irrigation,
      status:
        row.irrigation_mode ===
        'scheduled'
          ? 'Scheduled'
          : 'Off',
      mode:
        row.irrigation_mode ===
        'scheduled'
          ? 'scheduled'
          : 'automatic',
      schedule: {
        ...template.irrigation.schedule,
        enabled:
          row.irrigation_mode ===
          'scheduled',
        days:
          Array.isArray(
            row.schedule_days
          ) &&
          row.schedule_days.length > 0
            ? row.schedule_days
            : template.irrigation.schedule.days,
        startTime:
          row.schedule_start_time
            ?.trim()
            .slice(0, 5) ||
          template.irrigation.schedule.startTime,
        durationMinutes:
          Number(
            row.schedule_duration_minutes ??
            template.irrigation.schedule.durationMinutes
          ),
      },
      automation: {
        ...template.irrigation.automation,
        enabled:
          row.irrigation_mode !==
          'scheduled',
        moistureThreshold:
          Number(
            row.moisture_threshold ??
            30
          ),
        desiredMoisture:
          Number(
            row.desired_moisture ??
            60
          ),
        weatherAdjustment:
          row.weather_adjustment ??
          true,
      },
      override: {
        active:
          false,
        durationMinutes:
          null,
      },
    },
  };
}

async function fetchZonesForFarm(
  farmId: string
): Promise<Zone[]> {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        'zone'
      )
      .select(
        '*'
      )
      .eq(
        'farm_id',
        farmId
      )
      .order(
        'id',
        {
          ascending:
            true,
        }
      );

  if (
    error
  ) {
    throw error;
  }

  return (
    data as ZoneRow[]
  ).map(
    mapZoneRow
  );
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
    zone.irrigation.mode ===
      'automatic' &&
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

  const sensorAllowsStart =
    zone.sensors.soilMoisture.status ===
    'Online';

  const weatherBlocksStart =
    automation.weatherAdjustment &&
    zone.weather.rainExpected;

  if (
    zone.irrigation.status !== 'Active' &&
    moisture <= startAt &&
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
        : zone.irrigation.mode ===
            'scheduled'
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

type HistoryEntry =
  (typeof mockHistory)[number];

type AlertEntry =
  (typeof mockAlerts)[number];

type AgroFlowContextType = {//defines the structure of the AgroFlow context, including the state variables for zones, history, and alerts, as well as the functions to manipulate these states. It provides a centralized way to manage the farm's irrigation system and related data within the app.
  farm: Farm | null;
  isFarmLoading: boolean;
  farmError: string | null;
  zones: Zone[];
  isZonesLoading: boolean;
  zonesError: string | null;
  refreshZones: () => void;
  history: HistoryEntry[];
  alerts: AlertEntry[];

  updateZoneSettings: (
    zoneId: string,
    settings: UpdateZoneSettingsInput
  ) => Promise<void>;

  updateZoneSchedule: (
    zoneId: string,
    schedule: UpdateZoneScheduleInput
  ) => Promise<void>;

  updateIrrigationMode: (
    zoneId: string,
    mode: IrrigationMode
  ) => Promise<void>;

  startManualIrrigation: (
    zoneId: string,
    durationMinutes: number
  ) => void;

  stopManualIrrigation: (
    zoneId: string
  ) => void;

  markAlertAsRead: (
    alertId: string
  ) => void;
};

const STORAGE_KEYS = {//history and alerts remain local while zone configuration is stored in Supabase.
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
  const {
    user,
    isLoading:
      isAuthLoading,
  } = useAuth();

  const [
    farm,
    setFarm,
  ] =
    useState<
      Farm | null
    >(null);

  const [
    isFarmLoading,
    setIsFarmLoading,
  ] =
    useState(true);

  const [
    farmError,
    setFarmError,
  ] =
    useState<
      string | null
    >(null);

  const [//zone identity and configuration are loaded from Supabase after the farmer's assigned farm has been retrieved. Sensor and hardware values still use the temporary mock structures until those tables are connected.
    zones,
    setZones,
  ] =
    useState<Zone[]>([]);

  const [
    isZonesLoading,
    setIsZonesLoading,
  ] =
    useState(true);

  const [
    zonesError,
    setZonesError,
  ] =
    useState<
      string | null
    >(null);
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

  const manualRunTimers =
    useRef<
      Record<
        string,
        ReturnType<
          typeof setTimeout
        >
      >
    >({});

  const zonesRef =
    useRef<Zone[]>(
      []
    );

  useEffect(() => {
    zonesRef.current =
      zones;
  }, [
    zones,
  ]);

  useEffect(() => {
    return () => {
      Object.values(
        manualRunTimers.current
      ).forEach(
        clearTimeout
      );
    };
  }, []);

  useEffect(() => {//loads the farm assigned to the authenticated farmer from Supabase. The profile ID is the same UUID as the Supabase Authentication user ID.
    let isMounted =
      true;

    if (
      isAuthLoading
    ) {
      return () => {
        isMounted =
          false;
      };
    }

    if (
      !user
    ) {
      setFarm(
        null
      );

      setFarmError(
        null
      );

      setIsFarmLoading(
        false
      );

      return () => {
        isMounted =
          false;
      };
    }

    setIsFarmLoading(
      true
    );

    setFarmError(
      null
    );

    fetchAssignedFarm(
      user.id
    )
      .then(
        (
          assignedFarm
        ) => {
          if (
            !isMounted
          ) {
            return;
          }

          setFarm(
            assignedFarm
          );

          if (
            !assignedFarm
          ) {
            setFarmError(
              'No farm has been assigned to this farmer.'
            );
          }
        }
      )
      .catch(
        (
          error: unknown
        ) => {
          if (
            !isMounted
          ) {
            return;
          }

          console.error(
            'Failed to load assigned farm:',
            error
          );

          setFarm(
            null
          );

          setFarmError(
            error instanceof Error
              ? error.message
              : 'Failed to load the assigned farm.'
          );
        }
      )
      .finally(
        () => {
          if (
            isMounted
          ) {
            setIsFarmLoading(
              false
            );
          }
        }
      );

    return () => {
      isMounted =
        false;
    };
  }, [
    user,
    isAuthLoading,
  ]);

  const loadZones = useCallback(//fetches the zones for the currently-assigned farm and updates loading/error/zones state - shared between the initial-load effect below and the manually-triggered refreshZones exposed on the context (e.g. a "retry" action after a failed load).
    () => {
      let isMounted =
        true;

      if (
        isFarmLoading
      ) {
        return () => {
          isMounted =
            false;
        };
      }

      if (
        !farm
      ) {
        setZones(
          []
        );

        setZonesError(
          null
        );

        setIsZonesLoading(
          false
        );

        return () => {
          isMounted =
            false;
        };
      }

      setIsZonesLoading(
        true
      );

      setZonesError(
        null
      );

      fetchZonesForFarm(
        farm.id
      )
        .then(
          (
            assignedZones
          ) => {
            if (
              !isMounted
            ) {
              return;
            }

            setZones(
              assignedZones
            );
          }
        )
        .catch(
          (
            error: unknown
          ) => {
            if (
              !isMounted
            ) {
              return;
            }

            console.error(
              'Failed to load farm zones:',
              error
            );

            setZones(
              []
            );

            setZonesError(
              error instanceof Error
                ? error.message
                : 'Failed to load the farm zones.'
            );
          }
        )
        .finally(
          () => {
            if (
              isMounted
            ) {
              setIsZonesLoading(
                false
              );
            }
          }
        );

      return () => {
        isMounted =
          false;
      };
    },
    [
      farm,
      isFarmLoading,
    ]
  );

  useEffect(() => {//loads the zones that belong to the farmer's assigned farm. Supabase is the source of truth for zone identity and automation settings.
    return loadZones();
  }, [
    loadZones,
  ]);

  const refreshZones = useCallback(//manually re-triggers the zone load above - exposed on the context for UI "retry after error" actions.
    () => {
      loadZones();
    },
    [
      loadZones,
    ]
  );

  useEffect(() => {//loads history and alerts from AsyncStorage. Zone configuration is no longer restored locally because Supabase is now its source of truth.
    async function loadSavedData() {
      try {
        const [
          savedHistory,
          savedAlerts,
        ] =
          await Promise.all([//retrieves history and alerts from AsyncStorage in parallel. This improves performance by reducing the total time spent waiting for each individual retrieval operation.
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
    return zonesRef.current.find(
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

  function startManualIrrigation(
    zoneId: string,
    durationMinutes: number
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

                    override: {
                      active:
                        true,
                      durationMinutes,
                    },
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
      `Manual irrigation started for ${durationMinutes} minutes.`,
      'irrigation'
    );

    addAlert(//generates an alert to inform the user that manual irrigation has started for the specific zone. The alert includes a title, message, and type, and is added to the alerts state to notify users of important events related to irrigation and zone management.
      zoneId,
      'Irrigation Started',
      `Manual irrigation will run for ${durationMinutes} minutes.`,
      'success'
    );

    const existingTimer =
      manualRunTimers.current[
        zoneId
      ];

    if (
      existingTimer
    ) {
      clearTimeout(
        existingTimer
      );
    }

    manualRunTimers.current[
      zoneId
    ] = setTimeout(
      () => {
        stopManualIrrigation(
          zoneId,
          true
        );
      },
      durationMinutes *
        60 *
        1000
    );
  }

  function stopManualIrrigation(
    zoneId: string,
    endedAutomatically = false
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
                      item.irrigation.mode ===
                      'scheduled'
                        ? 'Scheduled'
                        : 'Off',

                    override: {
                      active:
                        false,
                      durationMinutes:
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
                }
              : item
        )
    );

    addHistoryEntry(//logs the action of stopping irrigation in the history for the specific zone, providing a description and categorizing it as an "irrigation" type entry. This helps track user actions and system events related to irrigation control.
      zoneId,
      endedAutomatically
        ? 'Manual Irrigation Completed'
        : 'Manual Irrigation Stopped',
      endedAutomatically
        ? `The timed manual run finished and the zone returned to ${zone.irrigation.mode} mode.`
        : `Manual irrigation was stopped and the zone returned to ${zone.irrigation.mode} mode.`,
      'irrigation'
    );

    addAlert(
      zoneId,
      endedAutomatically
        ? 'Manual Run Complete'
        : 'Irrigation Stopped',
      endedAutomatically
        ? `The zone has returned to ${zone.irrigation.mode} mode.`
        : 'Manual irrigation has been stopped.',
      'info'
    );

    const timer =
      manualRunTimers.current[
        zoneId
      ];

    if (
      timer
    ) {
      clearTimeout(
        timer
      );

      delete manualRunTimers
        .current[
          zoneId
        ];
    }
  }

  async function updateIrrigationMode(
    zoneId: string,
    mode: IrrigationMode
  ) {
    if (
      !farm
    ) {
      throw new Error(
        'No assigned farm is available.'
      );
    }

    const {
      error,
    } =
      await supabase
        .from(
          'zone'
        )
        .update({
          irrigation_mode:
            mode,
          automation_enabled:
            mode ===
            'automatic',
          schedule_enabled:
            mode ===
            'scheduled',
        })
        .eq(
          'id',
          zoneId
        )
        .eq(
          'farm_id',
          farm.id
        )
        .select(
          'id'
        )
        .single();

    if (
      error
    ) {
      throw error;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            zone
          ) =>
            zone.id ===
            zoneId
              ? {
                  ...zone,
                  irrigation: {
                    ...zone.irrigation,
                    mode,
                    status:
                      zone.irrigation.override.active ||
                      zone.irrigation.status ===
                        'Active'
                        ? zone.irrigation.status
                        : mode ===
                            'scheduled'
                          ? 'Scheduled'
                          : 'Off',
                    schedule: {
                      ...zone.irrigation.schedule,
                      enabled:
                        mode ===
                        'scheduled',
                    },
                    automation: {
                      ...zone.irrigation.automation,
                      enabled:
                        mode ===
                        'automatic',
                    },
                  },
                }
              : zone
        )
    );

    addHistoryEntry(
      zoneId,
      'Irrigation Mode Changed',
      `The zone was changed to ${mode} mode.`,
      'irrigation'
    );

    setZonesError(
      null
    );
  }

  async function updateZoneSettings(
    zoneId: string,
    settings: UpdateZoneSettingsInput
  ) {
    if (
      !farm
    ) {
      throw new Error(
        'No assigned farm is available.'
      );
    }

    const cleanedName =
      settings.name.trim();

    const cleanedLocation =
      settings.location.trim();

    const cleanedCrop =
      settings.crop.trim();

    const {
      error,
    } =
      await supabase
        .from(
          'zone'
        )
        .update({
          name:
            cleanedName,
          location:
            cleanedLocation,
          crop_type:
            cleanedCrop,
          automation_enabled:
            settings.automationEnabled,
          moisture_threshold:
            settings.moistureThreshold,
          desired_moisture:
            settings.desiredMoisture,
          weather_adjustment:
            settings.weatherAdjustment,
        })
        .eq(
          'id',
          zoneId
        )
        .eq(
          'farm_id',
          farm.id
        )
        .select(
          'id'
        )
        .single();

    if (
      error
    ) {
      throw error;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            zone
          ) =>
            zone.id ===
            zoneId
              ? {
                  ...zone,
                  name:
                    cleanedName,
                  location:
                    cleanedLocation,
                  crop:
                    cleanedCrop,
                  irrigation: {
                    ...zone.irrigation,
                    automation: {
                      ...zone.irrigation.automation,
                      enabled:
                        settings.automationEnabled,
                      moistureThreshold:
                        settings.moistureThreshold,
                      desiredMoisture:
                        settings.desiredMoisture,
                      weatherAdjustment:
                        settings.weatherAdjustment,
                    },
                  },
                }
              : zone
        )
    );

    setZonesError(
      null
    );
  }

  async function updateZoneSchedule(
    zoneId: string,
    scheduleSettings: UpdateZoneScheduleInput
  ) {
    if (
      !farm
    ) {
      throw new Error(
        'No assigned farm is available.'
      );
    }

    const cleanedDays =
      scheduleSettings.days
        .map(
          (
            day
          ) =>
            day.trim()
        )
        .filter(
          Boolean
        );

    const cleanedStartTime =
      scheduleSettings.startTime.trim();

    const {
      error,
    } =
      await supabase
        .from(
          'zone'
        )
        .update({
          schedule_enabled:
            scheduleSettings.enabled,
          schedule_days:
            cleanedDays,
          schedule_start_time:
            cleanedStartTime,
          schedule_duration_minutes:
            scheduleSettings.durationMinutes,
        })
        .eq(
          'id',
          zoneId
        )
        .eq(
          'farm_id',
          farm.id
        )
        .select(
          'id'
        )
        .single();

    if (
      error
    ) {
      throw error;
    }

    setZones(
      (
        current
      ) =>
        current.map(
          (
            zone
          ) =>
            zone.id ===
            zoneId
              ? {
                  ...zone,
                  irrigation: {
                    ...zone.irrigation,
                    status:
                      zone.irrigation.override.active ||
                      zone.irrigation.status === 'Active'
                        ? zone.irrigation.status
                        : scheduleSettings.enabled
                          ? 'Scheduled'
                          : 'Off',
                    schedule: {
                      enabled:
                        scheduleSettings.enabled,
                      days:
                        cleanedDays,
                      startTime:
                        cleanedStartTime,
                      durationMinutes:
                        scheduleSettings.durationMinutes,
                    },
                  },
                }
              : zone
        )
    );

    setZonesError(
      null
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
        farm,
        isFarmLoading,
        farmError,
        zones,
        isZonesLoading,
        zonesError,
        refreshZones,
        history,
        alerts,
        updateZoneSettings,
        updateZoneSchedule,
        updateIrrigationMode,
        startManualIrrigation,
        stopManualIrrigation,
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