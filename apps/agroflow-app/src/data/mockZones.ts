export const mockZones = [
  {
    id: 'zone-1',
    name: 'Zone 1',
    location: 'North Field',
    crop: 'Tomatoes',

    size: {
      value: 2.4,
      unit: 'ha',
    },

    sensors: {
      soilMoisture: {
        value: 30,
        unit: '%',
        status: 'Online',
        moistureStatus: 'Dry',
      },

      temperatureHumidity: {
        temperature: 24,
        temperatureUnit: '°C',
        humidity: 62,
        humidityUnit: '%',
        status: 'Online',
      },
    },

    irrigation: {
      status: 'Off',

      lastIrrigation: {
        date: '2026-08-09',
        time: '08:32',
        durationMinutes: 18,
      },

      schedule: {
        enabled: true,
        days: [
          'Mon',
          'Wed',
          'Fri',
        ],
        startTime: '18:00',
        durationMinutes: 20,
      },

      automation: {
        enabled: true,
        moistureThreshold: 30,
        desiredMoisture: 60,
        weatherAdjustment: true,
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
      usedTodayLitres: 420,
      latestCycleLitres: 420,
      flowRateLpm: 0,
    },

    weather: {
      rainExpected: false,
      message: 'No rain expected',
    },

    alerts: [
      {
        id: 'alert-1',
        type: 'warning',
        message:
          'Soil moisture is below the recommended threshold',
      },
    ],
  },

  {
    id: 'zone-2',
    name: 'Zone 2',
    location: 'East Field',
    crop: 'Lettuce',

    size: {
      value: 1.8,
      unit: 'ha',
    },

    sensors: {
      soilMoisture: {
        value: 63,
        unit: '%',
        status: 'Online',
        moistureStatus: 'Optimal',
      },

      temperatureHumidity: {
        temperature: 22,
        temperatureUnit: '°C',
        humidity: 70,
        humidityUnit: '%',
        status: 'Online',
      },
    },

    irrigation: {
      status: 'Active',

      lastIrrigation: {
        date: '2026-08-09',
        time: '10:42',
        durationMinutes: 12,
      },

      schedule: {
        enabled: true,
        days: [
          'Tue',
          'Thu',
          'Sat',
        ],
        startTime: '06:00',
        durationMinutes: 15,
      },

      automation: {
        enabled: true,
        moistureThreshold: 30,
        desiredMoisture: 60,
        weatherAdjustment: true,
      },

      override: {
        active: false,
        temporarySchedule: null,
      },
    },

    relay: {
      status: 'On',
    },

    pump: {
      status: 'Running',
    },

    water: {
      usedTodayLitres: 310,
      latestCycleLitres: 180,
      flowRateLpm: 15,
    },

    weather: {
      rainExpected: false,
      message: 'No rain expected',
    },

    alerts: [],
  },

  {
    id: 'zone-3',
    name: 'Zone 3',
    location: 'South Field',
    crop: 'Maize',

    size: {
      value: 3.2,
      unit: 'ha',
    },

    sensors: {
      soilMoisture: {
        value: 71,
        unit: '%',
        status: 'Online',
        moistureStatus: 'Wet',
      },

      temperatureHumidity: {
        temperature: 26,
        temperatureUnit: '°C',
        humidity: 58,
        humidityUnit: '%',
        status: 'Online',
      },
    },

    irrigation: {
      status: 'Scheduled',

      lastIrrigation: {
        date: '2026-08-08',
        time: '17:30',
        durationMinutes: 25,
      },

      schedule: {
        enabled: true,
        days: [
          'Mon',
          'Thu',
          'Sat',
        ],
        startTime: '19:00',
        durationMinutes: 25,
      },

      automation: {
        enabled: true,
        moistureThreshold: 30,
        desiredMoisture: 60,
        weatherAdjustment: true,
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
      latestCycleLitres: 610,
      flowRateLpm: 0,
    },

    weather: {
      rainExpected: true,
      message:
        'Rain may delay the next irrigation cycle',
    },

    alerts: [],
  },

  {
    id: 'zone-4',
    name: 'Zone 4',
    location: 'West Field',
    crop: 'Peppers',

    size: {
      value: 1.5,
      unit: 'ha',
    },

    sensors: {
      soilMoisture: {
        value: 36,
        unit: '%',
        status: 'Low Battery',
        moistureStatus: 'Dry',
      },

      temperatureHumidity: {
        temperature: 25,
        temperatureUnit: '°C',
        humidity: 55,
        humidityUnit: '%',
        status: 'Online',
      },
    },

    irrigation: {
      status: 'Paused',

      lastIrrigation: {
        date: '2026-08-09',
        time: '07:15',
        durationMinutes: 10,
      },

      schedule: {
        enabled: true,
        days: [
          'Mon',
          'Wed',
          'Fri',
        ],
        startTime: '17:30',
        durationMinutes: 18,
      },

      automation: {
        enabled: true,
        moistureThreshold: 30,
        desiredMoisture: 60,
        weatherAdjustment: true,
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
      usedTodayLitres: 190,
      latestCycleLitres: 190,
      flowRateLpm: 0,
    },

    weather: {
      rainExpected: false,
      message: 'No rain expected',
    },

    alerts: [
      {
        id: 'alert-2',
        type: 'warning',
        message: 'Soil moisture is low',
      },

      {
        id: 'alert-3',
        type: 'warning',
        message:
          'Soil moisture sensor battery is low',
      },
    ],
  },
];