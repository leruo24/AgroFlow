// Captures the REAL AgroFlow admin console (apps/web/admin, unmodified) for
// the walkthrough video. The app runs under `vite` with a placeholder
// Supabase URL; every network call it makes is answered here with clearly
// labelled ILLUSTRATIVE demo data. Nothing here is a production record.
//
// Same approach as apps/mobile/scripts/ui-smoke.mjs (fixture responses for
// UI verification), done with Playwright instead of raw CDP.
//
// Usage: node admin-capture.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || '../assets/admin';
const ORIGIN = 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const day = (d) => new Date(now + d * 86400000).toISOString().slice(0, 10);

const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const admin = { id: ADMIN_ID, name: 'Demo Admin', email: 'admin@demo.invalid', role: 'admin' };

// ---- illustrative demo dataset ------------------------------------------
const farmers = [
  ['f1', 'Demo Farmer A', 1, 'Green Valley (demo)', true],
  ['f2', 'Demo Farmer B', 2, 'Riverside (demo)', true],
  ['f3', 'Demo Farmer C', 3, 'Hilltop (demo)', false],
  ['f4', 'Demo Farmer D', 4, 'Sunfield (demo)', true],
].map(([id, name, farm_id, farm_name, tg]) => ({
  id: `00000000-0000-0000-0000-0000000000${id.slice(1).padStart(2, '0')}`,
  name, email: `${name.toLowerCase().replace(/ /g, '.')}@demo.invalid`, phone: null,
  role: 'farm_user', created_at: ago(60 * 24 * (30 + farm_id * 9)), farm_id, farm_name,
  telegram_linked: tg, telegram_alerts_enabled: tg,
}));
const users = [
  ...farmers,
  { id: ADMIN_ID, name: 'Demo Admin', email: admin.email, phone: null, role: 'admin', created_at: ago(60 * 24 * 120), farm_id: null, farm_name: null, telegram_linked: true, telegram_alerts_enabled: true },
  { id: '00000000-0000-0000-0000-00000000a002', name: 'Demo Technician Lead', email: 'ops@demo.invalid', phone: null, role: 'admin', created_at: ago(60 * 24 * 100), farm_id: null, farm_name: null, telegram_linked: true, telegram_alerts_enabled: true },
];

const farms = [
  { farm_id: 1, name: 'Green Valley (demo)', owner_id: farmers[0].id, owner_name: 'Demo Farmer A', location: 'Stellenbosch, Western Cape', total_area: 2.4, status: 'Active', updated_at: ago(60 * 24 * 40), latitude: -33.93, longitude: 18.86 },
  { farm_id: 2, name: 'Riverside (demo)', owner_id: farmers[1].id, owner_name: 'Demo Farmer B', location: 'Paarl, Western Cape', total_area: 1.6, status: 'Active', updated_at: ago(60 * 24 * 52), latitude: -33.73, longitude: 18.97 },
  { farm_id: 3, name: 'Hilltop (demo)', owner_id: farmers[2].id, owner_name: 'Demo Farmer C', location: 'Polokwane, Limpopo', total_area: 3.1, status: 'Active', updated_at: ago(60 * 24 * 61), latitude: -23.9, longitude: 29.45 },
  { farm_id: 4, name: 'Sunfield (demo)', owner_id: farmers[3].id, owner_name: 'Demo Farmer D', location: 'Bloemfontein, Free State', total_area: 0.9, status: 'Active', updated_at: ago(60 * 24 * 70), latitude: -29.12, longitude: 26.21 },
];

const zones = [
  { id: 11, farm_id: 1, name: 'Zone 1', crop_type: 'tomato', planting_date: day(-48), area_m2: 400, flow_rate_lpm: 1.5, status: 'Active' },
  { id: 12, farm_id: 1, name: 'Zone 2', crop_type: 'maize', planting_date: day(-62), area_m2: 650, flow_rate_lpm: 1.5, status: 'Active' },
  { id: 21, farm_id: 2, name: 'Zone 1', crop_type: 'cabbage', planting_date: day(-30), area_m2: 300, flow_rate_lpm: 1.2, status: 'Active' },
  { id: 31, farm_id: 3, name: 'Zone 1', crop_type: 'potato', planting_date: day(-20), area_m2: 500, flow_rate_lpm: 1.5, status: 'Active' },
  { id: 41, farm_id: 4, name: 'Zone 1', crop_type: 'tomato', planting_date: null, area_m2: null, flow_rate_lpm: 1.5, status: 'Active' },
];
const zoneById = new Map(zones.map((z) => [z.id, z]));
const farmById = new Map(farms.map((f) => [f.farm_id, f]));

const hardware = [
  { hardware_id: 101, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: 11, status: 'Online', last_seen: ago(1), created_at: ago(60 * 24 * 38), deviceId: 'A4CF12B7E901', fw: '1.4.0', online: true, mqtt: 'agroflow-kit-01' },
  { hardware_id: 102, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: 12, status: 'Online', last_seen: ago(2), created_at: ago(60 * 24 * 38), deviceId: 'A4CF12B7E9C4', fw: '1.4.0', online: true, mqtt: 'agroflow-kit-02' },
  { hardware_id: 103, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: 21, status: 'Online', last_seen: ago(1), created_at: ago(60 * 24 * 50), deviceId: 'A4CF12B80A17', fw: '1.4.0', online: true, mqtt: 'agroflow-kit-03' },
  { hardware_id: 104, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: 31, status: 'Offline', last_seen: ago(60 * 26), created_at: ago(60 * 24 * 58), deviceId: 'A4CF12B81D55', fw: '1.3.0', online: false, mqtt: 'agroflow-kit-04' },
  { hardware_id: 105, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: 41, status: 'Online', last_seen: ago(3), created_at: ago(60 * 24 * 66), deviceId: 'A4CF12B82F08', fw: '1.4.0', online: true, mqtt: 'agroflow-kit-05' },
];

const alertRow = (id, severity, message, status, mins, zoneId) => {
  const z = zoneById.get(zoneId); const f = farmById.get(z.farm_id);
  return { id, severity, message, status, created_at: ago(mins), zone_id: zoneId, read_at: null,
    zone: { id: z.id, name: z.name, farm: { farm_id: f.farm_id, name: f.name, status: f.status, owner: { name: f.owner_name, email: null } } } };
};
const alerts = [
  alertRow(5012, 'Connectivity', 'Kit has not reported for 26 hours.', 'New', 40, 31),
  alertRow(5011, 'Critical', 'Zone entered Critical: soil moisture 18%.', 'New', 95, 21),
  alertRow(5009, 'Hardware', 'Pump did not acknowledge a start command.', 'Assigned', 60 * 5, 12),
  alertRow(5004, 'Critical', 'Zone entered Critical: soil moisture 17%.', 'Resolved', 60 * 30, 11),
];

const maintenance = [
  { maintenance_id: 301, farm_id: 3, hardware_id: 104, scheduled_date: day(2), description: 'Kit offline - check power and WiFi on site', status: 'Scheduled', created_at: ago(60 * 20) },
  { maintenance_id: 302, farm_id: 1, hardware_id: 102, scheduled_date: day(-1), description: 'Inspect relay and pump wiring', status: 'Overdue', created_at: ago(60 * 24 * 4) },
  { maintenance_id: 303, farm_id: 4, hardware_id: 105, scheduled_date: day(6), description: 'Recalibrate soil moisture probe', status: 'Upcoming', created_at: ago(60 * 24 * 2) },
  { maintenance_id: 298, farm_id: 2, hardware_id: 103, scheduled_date: day(-9), description: 'Replace DHT11 sensor', status: 'Completed', created_at: ago(60 * 24 * 14) },
];

const events = [];
let eid = 9000;
for (let d = 0; d < 28; d++) for (const z of zones.slice(0, 4)) {
  if ((d + z.id) % 3 === 0) continue;
  const f = farmById.get(z.farm_id);
  events.push({ id: eid++, started_at: new Date(now - d * 86400000 - (z.id % 5) * 3600000).toISOString(), runtime_seconds: 600 + ((d * 37 + z.id * 13) % 9) * 60,
    zone: { id: z.id, name: z.name, crop_type: z.crop_type, flow_rate_lpm: z.flow_rate_lpm, status: z.status, farm: { farm_id: f.farm_id, name: f.name, location: f.location, status: f.status } } });
}

const activity = [
  ['Demo Admin', 'alert.assign', 'Demo Admin assigned alert 5009 to Demo Technician Lead', 1, 12],
  ['Demo Admin', 'maintenance.schedule', 'Demo Admin scheduled maintenance for kit A4CF12B81D55', 3, 25],
  ['Demo Technician Lead', 'device.enroll', 'Demo Technician Lead created an enrollment code for Sunfield (demo) · Zone 1', 4, 60 * 3],
  ['Demo Admin', 'farm.register', 'Demo Admin registered the farm Sunfield (demo)', 4, 60 * 4],
  ['Demo Admin', 'advice.run', 'Demo Admin ran advice now for Green Valley (demo) · Zone 1', 1, 60 * 6],
  ['Demo Technician Lead', 'request.status', 'Demo Technician Lead marked a kit request as scheduled', 2, 60 * 22],
].map(([actorName, action, summary, farmId, mins], i) => ({ id: 700 - i, createdAt: ago(mins), actorName, action, summary, entityType: action.split('.')[0], entityId: null, farmId, farmName: farmById.get(farmId)?.name ?? null, details: '{}' }));

const health = { overall: 'ok', checkedAt: ago(0.3), checks: [
  { key: 'api', name: 'API', status: 'ok', detail: 'Version 2.0.0. Running for 3 days.', responseMs: 12 },
  { key: 'database', name: 'Database', status: 'ok', detail: 'Reachable in 38 ms.', responseMs: 38 },
  { key: 'mqtt', name: 'MQTT broker', status: 'ok', detail: 'Connected. Readings and commands are flowing.', responseMs: null },
  { key: 'weather', name: 'Weather', status: 'ok', detail: 'Last refreshed 2 hours ago.', responseMs: null },
  { key: 'devices', name: 'Kits', status: 'warning', detail: '4 of 5 online. Last reading 1 minute ago.', responseMs: null },
  { key: 'telegram', name: 'Telegram', status: 'ok', detail: 'Bot connected.', responseMs: null },
] };

// ---- network stubs -------------------------------------------------------
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', ...headers },
  body: body === undefined ? '' : JSON.stringify(body) });

const TABLES = {
  profile: () => [...users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))],
  farm: () => farms,
  zone: () => zones,
  hardware: () => hardware.map(({ deviceId, fw, online, mqtt, ...h }) => h),
  alert: () => alerts,
  maintenance: () => maintenance,
  irrigation_event: () => events,
  service_request: () => [],
  report_request: () => [],
  ai_recommendation: () => [],
};

async function supabaseRoute(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  if (url.pathname.startsWith('/auth/v1/')) {
    if (url.pathname.endsWith('/user')) return json(route, sessionUser);
    return json(route, {});
  }
  const table = url.pathname.replace('/rest/v1/', '');
  let rows = (TABLES[table] ?? (() => []))();
  const idEq = url.searchParams.get('id');
  if (table === 'profile' && idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  if (req.method() === 'HEAD') return json(route, undefined, 200, { 'content-range': `*/${rows.length}` });
  return json(route, single ? rows[0] : rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
}

async function apiRoute(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const p = new URL(req.url()).pathname;
  if (p === '/api/users') return json(route, users);
  if (p === '/api/farms') return json(route, farms);
  if (p === '/api/admin/hardware') return json(route, hardware.map((h) => {
    const z = zoneById.get(h.zone_id);
    return { hardwareId: h.hardware_id, deviceId: h.deviceId, deviceName: h.device_name, zoneId: h.zone_id, zoneName: z?.name ?? null,
      farmName: farmById.get(z?.farm_id)?.name ?? null, online: h.online, lastSeen: h.last_seen, firmwareVersion: h.fw,
      enrollmentStatus: 'active', tokenStatus: 'active', mqttUsername: h.mqtt };
  }));
  if (p === '/api/admin/health') return json(route, health);
  if (p === '/api/admin/mqtt-logins') return json(route, { entries: [], freeCount: 6, assignedCount: 5, burnedCount: 0, runningLow: false, warning: null });
  if (p.startsWith('/api/admin/activity/')) return json(route, activity.slice(0, 2));
  if (p === '/api/admin/activity') return json(route, { rows: activity, total: activity.length,
    actions: [...new Set(activity.map((a) => a.action))].map((a) => ({ value: a, label: a })),
    actors: [...new Set(activity.map((a) => a.actorName))].map((a) => ({ value: a, label: a })) });
  if (p.startsWith('/api/reports/farms') || p.includes('/zones')) return json(route, zones.filter((z) => p.includes(`/${z.farm_id}/`)).map((z) => ({ id: z.id, name: z.name })));
  if (p.includes('report-schedule')) return json(route, { farmId: 1, enabled: false, frequency: 'monthly', reportKind: 'water_usage', nextRunAt: null, lastRunAt: null });
  console.log('unstubbed API', req.method(), p);
  return json(route, []);
}

// A syntactically valid, never-verified JWT: supabase-js only decodes it.
const exp = Math.floor(now / 1000) + 3600 * 6;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sessionUser = { id: ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: admin.email, app_metadata: {}, user_metadata: {}, created_at: ago(1000) };
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ADMIN_ID, exp, role: 'authenticated', aud: 'authenticated' })}.demo`, refresh_token: 'demo', token_type: 'bearer', expires_in: 3600 * 6, expires_at: exp, user: sessionUser };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['sb-demo-auth-token', JSON.stringify(session)]);
await ctx.route('https://demo.supabase.co/**', supabaseRoute);
await ctx.route('https://api.demo.local/**', apiRoute);
// External map tiles are not needed for the captures.
await ctx.route(/tile\.openstreetmap|basemaps|arcgis/, (r) => r.abort());
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1600); };
const shot = async (name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}.png`, ...opts }); console.log('saved', name); };
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await settle(); };

await page.goto(`${ORIGIN}/#dashboard`);
await page.waitForSelector('#appShell', { timeout: 30000 });
await settle();
await page.waitForTimeout(1500);
await shot('01-home');
await shot('01-home-full', { fullPage: true });

for (const [hash, name] of [['farms', '02-farms'], ['hardware', '03-kits'], ['alerts', '04-alerts'], ['maintenance', '05-maintenance'], ['activity', '06-activity'], ['reports', '07-reports'], ['users', '08-farmers']]) {
  await go(hash);
  await shot(name);
}

// Farm detail drawer (real "View" action on the Farms page).
await go('farms');
const viewFarm = page.locator('[data-act="view-farm"]').first();
if (await viewFarm.count()) { await viewFarm.click(); await settle(); await shot('02b-farm-detail'); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }

// Kit detail drawer.
await go('hardware');
const viewDev = page.locator('[data-act="view-device"]').first();
if (await viewDev.count()) { await viewDev.click(); await settle(); await shot('03b-kit-detail'); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }

// Alert workflow driven through the console's own actions on alert 5011.
await go('alerts');
await shot('04a-alert-new');
await page.locator('[data-act="assign-alert"][data-id="5011"]').click();
await page.waitForTimeout(900);
await shot('04b-alert-assign-picker');
const opt = page.locator('.drawer').getByText('Demo Technician Lead').first();
if (await opt.count()) await opt.click();
await page.waitForTimeout(400);
await page.locator('.drawer button.btn:not(.ghost)').last().click().catch((e) => console.log('assign confirm', e.message));
await settle();
await shot('04c-alert-assigned');
await page.locator('[data-act="resolve-alert"][data-id="5011"]').click();
await settle();
await shot('04d-alert-resolved');

await browser.close();
