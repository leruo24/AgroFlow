// @agroflow/controllers — barrel export
//
// Everything here was moved out of the apps, not rewritten:
// - AuthController / NotificationController: moved from
//   agroflow-app/src/services/*.ts, unchanged.
// - WeatherController / IrrigationEngineController: extracted from the
//   business logic that was inline inside web-dashboard's Dashboard.jsx.

export * from './AuthController';
export * from './WeatherController';
export * from './IrrigationEngineController';

// NotificationController is NOT re-exported here on purpose: it imports
// `react-native` (Platform) and `expo-constants`, which only exist in the
// Expo app. Bundlers (Vite/Rolldown) parse every module reachable from an
// import, even ones that get tree-shaken later, so re-exporting it here
// broke the web-dashboard build (react-native's Flow syntax can't be
// parsed by Vite). Import it directly instead:
//   import { configureNotifications } from '@agroflow/controllers/notifications';

// Placeholders for the hardware-facing controllers you'll wire up once
// the hardware/ classes are dropped in, e.g.:
// export * from './ZoneController';
// export * from './PumpController';
