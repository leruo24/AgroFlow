// ILLUSTRATIVE DEMO DATA for the INF3003W showcase capture.
//
// Nothing here is a production record. The real, unmodified AgroFlow apps run
// locally and these values are what their network calls receive (the same
// approach as apps/mobile/scripts/ui-smoke.mjs). Every farm name carries
// "(demo)", every e-mail address uses the reserved .invalid domain.
//
// The values are chosen to be coherent with the real backend rules:
//  - Zone 2 waters on a SCHEDULE (next run Friday). IrrigationMode.cs only
//    lets sensor readings issue commands in automatic mode, so with the zone
//    dry before its next run the decision is the farmer's: they switch the
//    zone to Manual and start a run (the real Manual control in the app).
//    Start/stop levels 30% / 50%, so the app labels 19% "Dry".
//  - Zone 2 reads 19% soil moisture: below Zone.MoistureCriticalMax (20), so
//    health is "Critical" and the backend's real alert text is
//    "Zone entered Critical: soil moisture 19%." (InsertCriticalAlertAsync).
//  - Insight messages use the exact templates in ZoneInsightBuilder.cs.
//  - Crops are values the FAO-56 engine resolves (referenceData.ZONE_CROPS).

export const NOW = Date.now();
export const ago = (min) => new Date(NOW - min * 60000).toISOString();
export const sastDay = (d = 0) => new Date(NOW + 2 * 3600000 + d * 86400000).toISOString().slice(0, 10);
export const weekday = (d) => new Date(NOW + d * 86400000).toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'Africa/Johannesburg' });

export const FARMER_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';

export const farms = [
  { farm_id: 1, owner_id: FARMER_ID, owner_name: 'Smallholder Farmer (demo)', name: 'Green Valley (demo)', location: 'Stellenbosch, Western Cape', latitude: -33.93, longitude: 18.86, total_area: 1.2, status: 'Active' },
  { farm_id: 2, owner_id: FARMER_ID, owner_name: 'Smallholder Farmer (demo)', name: 'Riverside (demo)', location: 'Paarl, Western Cape', latitude: -33.73, longitude: 18.97, total_area: 0.6, status: 'Active' },
];

const zoneBase = { weather_adjustment: true, size_unit: 'm2', schedule_days: [], schedule_start_time: '06:00', schedule_duration_minutes: 15, schedule_enabled: false, status: 'Active' };
export const zones = [
  { ...zoneBase, id: 11, farm_id: 1, name: 'Zone 1', crop_type: 'tomato', location: 'North beds', planting_date: sastDay(-48), irrigation_mode: 'automatic', moisture_threshold: 35, desired_moisture: 55, health_status: 'Healthy', size_value: 400, area_m2: 400, flow_rate_lpm: 1.5 },
  { ...zoneBase, id: 12, farm_id: 1, name: 'Zone 2', crop_type: 'spinach', location: 'South beds', planting_date: sastDay(-26), irrigation_mode: 'scheduled', schedule_enabled: true, schedule_days: ['Fri'], schedule_start_time: '05:30', schedule_duration_minutes: 15, moisture_threshold: 30, desired_moisture: 50, health_status: 'Critical', size_value: 250, area_m2: 250, flow_rate_lpm: 1.5 },
  { ...zoneBase, id: 13, farm_id: 1, name: 'Zone 3', crop_type: 'maize', location: 'East field', planting_date: sastDay(-62), irrigation_mode: 'scheduled', schedule_enabled: true, schedule_days: ['Mon', 'Wed', 'Fri'], schedule_start_time: '05:30', schedule_duration_minutes: 20, moisture_threshold: 30, desired_moisture: 50, health_status: 'Healthy', size_value: 600, area_m2: 600, flow_rate_lpm: 1.5 },
];

export const readings = [
  { zone_id: 11, moisture: 46, temperature: 29, humidity: 38, last_reading_at: ago(1) },
  { zone_id: 12, moisture: 19, temperature: 30, humidity: 36, last_reading_at: ago(1) },
  { zone_id: 13, moisture: 41, temperature: 29, humidity: 39, last_reading_at: ago(2) },
];

// Recorded irrigation events (written by the ESP32 via POST /api/irrigation-events).
export const baseEvents = [
  { id: 402, zone_id: 13, started_at: ago(60 * 26), runtime_seconds: 1200, estimated_litres: 30, trigger_source: 'schedule' },
  { id: 401, zone_id: 11, started_at: ago(60 * 31), runtime_seconds: 720, estimated_litres: 18, trigger_source: 'auto' },
  { id: 400, zone_id: 13, started_at: ago(60 * 74), runtime_seconds: 1200, estimated_litres: 30, trigger_source: 'schedule' },
];
// The run the farmer starts in the story, as the device later records it.
// 5 minutes: the firmware stops every cycle at SAFETY_MAX_RUN_MS (5 min).
export const storyEvent = { id: 403, zone_id: 12, started_at: ago(0), runtime_seconds: 300, estimated_litres: 7.5, trigger_source: 'manual' };

export const criticalAlert = { id: 301, zone_id: 12, severity: 'Critical', message: 'Zone entered Critical: soil moisture 19%.', status: 'Open', created_at: ago(18), read_at: null };

export const insights = {
  12: [{ insightType: 'water_now', severity: 'act_now', message: 'Water Zone 2 now: about 5 min (~8 L).' }],
  11: [{ insightType: 'water_soon', severity: 'heads_up', message: `Zone 1 will need water in ~2 days (${weekday(2)}).` }],
  13: [],
};
export const growth = {
  11: { stage: 'Development', dayOfSeason: 48, totalDays: 145, cropLabel: 'Tomato' },
  12: { stage: 'Development', dayOfSeason: 26, totalDays: 70, cropLabel: 'Spinach' },
  13: { stage: 'Mid-season', dayOfSeason: 62, totalDays: 125, cropLabel: 'Maize' },
};

export const forecastDays = Array.from({ length: 7 }, (_, i) => ({
  date: sastDay(i), weekday: weekday(i).slice(0, 3), minC: 13 + (i % 3), maxC: 29 + (i % 3) - (i > 4 ? 2 : 0),
  rainMm: i === 6 ? 3 : 0, humidityPercent: 36 + i * 2, icon: i === 6 ? 'rain' : i === 5 ? 'cloud' : 'sun', advice: null,
}));

export const currentWeather = { current: { time: ago(10).slice(0, 16), temperature_2m: 29, apparent_temperature: 30, relative_humidity_2m: 36, weather_code: 1, wind_speed_10m: 14 }, daily: { precipitation_probability_max: [5] } };

// ---- admin-side records ---------------------------------------------------
export const adminFarms = [
  ...farms,
  { farm_id: 3, owner_id: '00000000-0000-0000-0000-000000000003', owner_name: 'Demo Farmer C', name: 'Hilltop (demo)', location: 'Polokwane, Limpopo', latitude: -23.9, longitude: 29.45, total_area: 3.1, status: 'Active' },
  { farm_id: 4, owner_id: '00000000-0000-0000-0000-000000000004', owner_name: 'Demo Farmer D', name: 'Sunfield (demo)', location: 'Bloemfontein, Free State', latitude: -29.12, longitude: 26.21, total_area: 0.9, status: 'Active' },
];
export const adminZones = [
  ...zones,
  { id: 21, farm_id: 2, name: 'Zone 1', crop_type: 'dry_beans', planting_date: sastDay(-30), area_m2: 300, flow_rate_lpm: 1.2, status: 'Active' },
  { id: 31, farm_id: 3, name: 'Zone 1', crop_type: 'potato', planting_date: sastDay(-20), area_m2: 500, flow_rate_lpm: 1.5, status: 'Active' },
  { id: 41, farm_id: 4, name: 'Zone 1', crop_type: 'tomato', planting_date: null, area_m2: null, flow_rate_lpm: 1.5, status: 'Active' },
];
export const kits = [
  [101, 11, 'A4CF12B7E901', '1.4.0', true, 1], [102, 12, 'A4CF12B7E9C4', '1.4.0', true, 1], [103, 13, 'A4CF12B7EA38', '1.4.0', true, 2],
  [104, 21, 'A4CF12B80A17', '1.4.0', true, 1], [105, 31, 'A4CF12B81D55', '1.3.0', false, 60 * 26], [106, 41, 'A4CF12B82F08', '1.4.0', true, 3],
].map(([id, zone, dev, fw, online, mins], i) => ({ hardware_id: id, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: zone,
  status: online ? 'Online' : 'Offline', last_seen: ago(mins), created_at: ago(60 * 24 * (70 - i * 6)), deviceId: dev, fw, online, mqtt: `agroflow-kit-0${i + 1}` }));
export const people = [
  { id: FARMER_ID, name: 'Smallholder Farmer (demo)', email: 'farmer@demo.invalid', role: 'farm_user', farm_id: 1, farm_name: 'Green Valley (demo)', telegram_linked: true },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Demo Farmer C', email: 'farmer.c@demo.invalid', role: 'farm_user', farm_id: 3, farm_name: 'Hilltop (demo)', telegram_linked: false },
  { id: '00000000-0000-0000-0000-000000000004', name: 'Demo Farmer D', email: 'farmer.d@demo.invalid', role: 'farm_user', farm_id: 4, farm_name: 'Sunfield (demo)', telegram_linked: true },
  { id: ADMIN_ID, name: 'Platform Administrator (demo)', email: 'admin@demo.invalid', role: 'admin', farm_id: null, farm_name: null, telegram_linked: true },
  { id: '00000000-0000-0000-0000-00000000a002', name: 'Field Technician Lead (demo)', email: 'ops@demo.invalid', role: 'admin', farm_id: null, farm_name: null, telegram_linked: true },
].map((u) => ({ phone: null, created_at: ago(60 * 24 * 60), telegram_alerts_enabled: u.telegram_linked, ...u }));
export const adminAlerts = [
  { ...criticalAlert },
  { id: 298, zone_id: 31, severity: 'Connectivity', message: 'Kit has not reported for 26 hours.', status: 'New', created_at: ago(60 * 2), read_at: null },
  { id: 290, zone_id: 13, severity: 'Hardware', message: 'Pump did not acknowledge a start command.', status: 'Resolved', created_at: ago(60 * 30), read_at: ago(60 * 28) },
];
export const maintenanceJobs = [
  { maintenance_id: 301, farm_id: 3, hardware_id: 105, scheduled_date: sastDay(2), description: 'Kit offline - check power and WiFi on site', status: 'Scheduled', created_at: ago(60 * 20) },
  { maintenance_id: 302, farm_id: 1, hardware_id: 103, scheduled_date: sastDay(5), description: 'Inspect relay and pump wiring', status: 'Upcoming', created_at: ago(60 * 24 * 2) },
  { maintenance_id: 297, farm_id: 2, hardware_id: 104, scheduled_date: sastDay(-9), description: 'Replace DHT11 sensor', status: 'Completed', created_at: ago(60 * 24 * 14) },
];
export const activity = [
  ['Platform Administrator (demo)', 'maintenance.schedule', 'Platform Administrator (demo) scheduled maintenance for kit A4CF12B81D55', 3, 25],
  ['Field Technician Lead (demo)', 'alert.resolve', 'Field Technician Lead (demo) resolved alert 290', 1, 60 * 27],
  ['Platform Administrator (demo)', 'device.enroll', 'Platform Administrator (demo) created an enrollment code for Sunfield (demo) · Zone 1', 4, 60 * 50],
  ['Platform Administrator (demo)', 'farm.register', 'Platform Administrator (demo) registered the farm Sunfield (demo)', 4, 60 * 52],
].map(([actorName, action, summary, farmId, mins], i) => ({ id: 700 - i, createdAt: ago(mins), actorName, action, summary, entityType: action.split('.')[0], entityId: null, farmId, farmName: adminFarms.find((f) => f.farm_id === farmId)?.name ?? null, details: '{}' }));

// Farm Requests (service_request, migration 0021): farmers ask for a new farm or
// zone; types/crops/statuses are the ones the CHECK constraints allow.
export const serviceRequests = [
  { id: 52, farmer_id: '00000000-0000-0000-0000-000000000004', farm_id: null, request_type: 'new_farm', location: 'Bloemfontein, Free State', rough_size: 0.5, crop_type: 'potato', notes: 'Second plot next to the house (demo).', status: 'pending', created_at: ago(60 * 5), updated_at: ago(60 * 5), assigned_to_profile_id: null, scheduled_by_profile_id: null, scheduled_at: null, completed_by_profile_id: null, completed_at: null },
  { id: 51, farmer_id: FARMER_ID, farm_id: 1, request_type: 'new_zone', location: null, rough_size: 0.02, crop_type: 'tomato', notes: 'New tomato bed by the tunnel (demo).', status: 'scheduled', created_at: ago(60 * 24 * 3), updated_at: ago(60 * 24), assigned_to_profile_id: ADMIN_ID, scheduled_by_profile_id: ADMIN_ID, scheduled_at: ago(60 * 24), completed_by_profile_id: null, completed_at: null },
];
