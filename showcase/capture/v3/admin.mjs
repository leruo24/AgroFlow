// Captures the REAL AgroFlow admin console and public landing page
// (apps/web/admin, unmodified, served by vite with
// VITE_SUPABASE_URL=https://demo.supabase.co and
// VITE_AGROFLOW_API_BASE=https://api.demo.local) answering with illustrative
// demo data. Stills -> ../../assets/v3/a-*.png. Usage: node v3/admin.mjs [probe]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import * as D from './demo.mjs';

const OUT = new URL('../../assets/v3/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
const W = 1440, H = 810, DPR = 2;
const PROBE = process.argv[2] === 'probe';

// ---- the platform, as an administrator sees it ---------------------------------
const farms = [
  ...D.farms,
  { farm_id: 2, owner_id: '00000000-0000-0000-0000-000000000002', owner_name: 'Demo Farmer B', name: 'Riverside (demo)', location: 'Paarl, Western Cape', latitude: -33.73, longitude: 18.97, total_area: 0.6, status: 'Active' },
  { farm_id: 3, owner_id: '00000000-0000-0000-0000-000000000003', owner_name: 'Demo Farmer C', name: 'Hilltop (demo)', location: 'Polokwane, Limpopo', latitude: -23.9, longitude: 29.45, total_area: 3.1, status: 'Active' },
];
const zones = [
  ...D.zones,
  { id: 21, farm_id: 2, name: 'Bean rows', crop_type: 'dry beans', planting_date: D.sastDay(-30), area_m2: 40, flow_rate_lpm: 18, status: 'Active', irrigation_mode: 'manual', health_status: 'Healthy' },
  { id: 31, farm_id: 3, name: 'Potato field', crop_type: 'potato', planting_date: D.sastDay(-20), area_m2: 80, flow_rate_lpm: 30, status: 'Active', irrigation_mode: 'manual', health_status: 'Warning' },
];
const zoneById = new Map(zones.map((z) => [z.id, z]));
const farmById = new Map(farms.map((f) => [f.farm_id, f]));
const kitRows = [[101, 11, 'A4CF12B7E901', '1.4.0', true, 1], [102, 12, 'A4CF12B7E9C4', '1.4.0', true, 1], [103, 13, 'A4CF12B7EA38', '1.4.0', true, 2], [104, 21, 'A4CF12B80A17', '1.4.0', true, 1], [105, 31, 'A4CF12B81D55', '1.4.0', false, 60 * 26]]
  .map(([id, zone, dev, fw, online, mins], i) => ({ hardware_id: id, device_name: 'Irrigation node', device_type: 'ESP32 Irrigation Node', zone_id: zone, status: online ? 'Online' : 'Offline', last_seen: D.ago(mins), created_at: D.ago(60 * 24 * (70 - i * 6)), deviceId: dev, fw, online, mqtt: `agroflow-kit-0${i + 1}` }));
const people = [
  { id: D.FARMER_ID, name: 'Smallholder Farmer (demo)', email: 'farmer@demo.invalid', role: 'farm_user', farm_id: 1, farm_name: 'Green Valley (demo)', telegram_linked: true },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Demo Farmer B', email: 'farmer.b@demo.invalid', role: 'farm_user', farm_id: 2, farm_name: 'Riverside (demo)', telegram_linked: true },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Demo Farmer C', email: 'farmer.c@demo.invalid', role: 'farm_user', farm_id: 3, farm_name: 'Hilltop (demo)', telegram_linked: false },
  { id: D.ADMIN_ID, name: 'Platform Administrator (demo)', email: 'admin@demo.invalid', role: 'admin', farm_id: null, farm_name: null, telegram_linked: true },
].map((u) => ({ phone: null, created_at: D.ago(60 * 24 * 60), telegram_alerts_enabled: u.telegram_linked, ...u }));
const alerts = [
  { id: 298, zone_id: 31, severity: 'Connectivity', message: 'Kit has not reported for 26 hours.', status: 'Open', created_at: D.ago(60 * 2), read_at: null },
  { id: 290, zone_id: 13, severity: 'Hardware', message: 'Pump did not acknowledge a start command.', status: 'Resolved', created_at: D.ago(60 * 30), read_at: D.ago(60 * 28) },
];
const embedAlert = (a) => { const z = zoneById.get(a.zone_id); const f = farmById.get(z.farm_id);
  return { ...a, zone: { id: z.id, name: z.name, farm: { farm_id: f.farm_id, name: f.name, status: f.status, owner: { name: f.owner_name, email: null } } } }; };
const maintenance = [
  { maintenance_id: 301, farm_id: 3, hardware_id: 105, scheduled_date: D.sastDay(2), description: 'Kit offline - check power and WiFi on site', status: 'Scheduled', created_at: D.ago(60 * 20) },
];
const serviceRequests = [
  { id: 52, farmer_id: '00000000-0000-0000-0000-000000000002', farm_id: 2, request_type: 'new_zone', location: null, rough_size: 0.004, crop_type: 'spinach', notes: 'Second bed next to the beans (demo).', status: 'pending', created_at: D.ago(60 * 5), updated_at: D.ago(60 * 5) },
  { id: 51, farmer_id: D.FARMER_ID, farm_id: 1, request_type: 'new_zone', location: null, rough_size: 0.006, crop_type: 'cucumber', notes: 'New cucumber block by the tunnel (demo).', status: 'pending', created_at: D.ago(60 * 26), updated_at: D.ago(60 * 26) },
];
const activity = [
  ['Platform Administrator (demo)', 'maintenance.schedule', 'Platform Administrator (demo) scheduled maintenance for kit A4CF12B81D55', 3, 25],
  ['Platform Administrator (demo)', 'alert.resolve', 'Platform Administrator (demo) resolved alert 290', 1, 60 * 27],
  ['Platform Administrator (demo)', 'device.enroll', 'Platform Administrator (demo) created an enrollment code for Riverside (demo) · Bean rows', 2, 60 * 50],
  ['Platform Administrator (demo)', 'farm.register', 'Platform Administrator (demo) registered the farm Riverside (demo)', 2, 60 * 52],
].map(([actorName, action, summary, farmId, mins], i) => ({ id: 700 - i, createdAt: D.ago(mins), actorName, action, summary, entityType: action.split('.')[0], entityId: null, farmId, farmName: farmById.get(farmId)?.name ?? null, details: '{}' }));
const events = [];
let eid = 9000;
for (let d = 1; d < 21; d++) for (const z of zones) {
  if ((d + z.id) % 4 !== 0) continue;
  const f = farmById.get(z.farm_id);
  events.push({ id: eid++, started_at: new Date(D.NOW - d * 86400000 - (z.id % 5) * 3600000).toISOString(), runtime_seconds: 1800 + ((d * 37 + z.id * 13) % 9) * 300,
    zone: { id: z.id, name: z.name, crop_type: z.crop_type, flow_rate_lpm: z.flow_rate_lpm, status: 'Active', farm: { farm_id: f.farm_id, name: f.name, location: f.location, status: f.status } } });
}
const insightRows = Object.entries(D.insights).flatMap(([z, list]) => list.map((i, k) => ({ recommendation_id: 800 + +z * 10 + k, zone_id: +z, insight_type: i.insightType, severity: i.severity, message: i.message, valid_for: D.sastDay(), created_at: D.ago(40), dismissed_at: null, data: { explanation: i.explanation } })));

const health = { overall: 'ok', checkedAt: D.ago(0.3), checks: [
  { key: 'api', name: 'API', status: 'ok', detail: 'Version 2.0.0. Running for 3 days.', responseMs: 12 },
  { key: 'database', name: 'Database', status: 'ok', detail: 'Reachable in 38 ms.', responseMs: 38 },
  { key: 'mqtt', name: 'MQTT broker', status: 'ok', detail: 'Connected. Readings and commands are flowing.', responseMs: null },
  { key: 'weather', name: 'Weather', status: 'ok', detail: 'Last refreshed 2 hours ago.', responseMs: null },
  { key: 'devices', name: 'Kits', status: 'warning', detail: '4 of 5 online. Last reading 1 minute ago.', responseMs: null },
  { key: 'telegram', name: 'Telegram', status: 'ok', detail: 'Bot connected.', responseMs: null },
] };

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...headers }, body: body === undefined ? '' : JSON.stringify(body) });
const unstubbed = new Set();

const TABLES = {
  profile: () => people.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
  farm: () => farms, zone: () => zones,
  hardware: () => kitRows.map(({ deviceId, fw, online, mqtt, ...h }) => h),
  alert: () => alerts.map(embedAlert), maintenance: () => maintenance,
  irrigation_event: () => events, service_request: () => serviceRequests, report_request: () => [], ai_recommendation: () => insightRows, explanation: () => [],
};
async function supa(route) {
  const req = route.request(); const url = new URL(req.url());
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  if (url.pathname.startsWith('/auth/v1/')) return json(route, url.pathname.endsWith('/user') ? sessionUser : {});
  const table = url.pathname.replace('/rest/v1/', '');
  if (!TABLES[table]) unstubbed.add(`table ${table}`);
  let rows = (TABLES[table] ?? (() => []))();
  const idEq = url.searchParams.get('id');
  if (table === 'profile' && idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  if (req.method() === 'HEAD') return json(route, undefined, 200, { 'content-range': `*/${rows.length}` });
  return json(route, single ? rows[0] ?? null : rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
}
async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const url = new URL(req.url()); const p = url.pathname; let m;
  if (p === '/api/users' || p === '/api/users/farmers') return json(route, people);
  if (p === '/api/farms' || p === '/api/admin/farms') return json(route, farms.map((f) => ({ ...f, updated_at: D.ago(60 * 24 * 40) })));
  if (p === '/api/admin/hardware') return json(route, kitRows.map((h) => { const z = zoneById.get(h.zone_id);
    return { hardwareId: h.hardware_id, deviceId: h.deviceId, deviceName: h.device_name, zoneId: h.zone_id, zoneName: z?.name ?? null, farmName: farmById.get(z?.farm_id)?.name ?? null,
      online: h.online, lastSeen: h.last_seen, firmwareVersion: h.fw, enrollmentStatus: 'active', tokenStatus: 'active', mqttUsername: h.mqtt }; }));
  if (p === '/api/admin/health') return json(route, health);
  if (p === '/api/admin/mqtt-logins') return json(route, { entries: [], freeCount: 6, assignedCount: 5, burnedCount: 0, runningLow: false, warning: null });
  if (p.startsWith('/api/admin/activity/')) return json(route, []);
  if (p === '/api/admin/activity') return json(route, { rows: activity, total: activity.length,
    actions: [...new Set(activity.map((a) => a.action))].map((a) => ({ value: a, label: a })),
    actors: [...new Set(activity.map((a) => a.actorName))].map((a) => ({ value: a, label: a })) });
  if (p.startsWith('/api/admin/handling/')) return json(route, []);
  if (p === '/api/telegram/me') return json(route, { linked: false, alertsEnabled: false });
  if (p === '/api/admin/dismissals') return json(route, []);
  if (p === '/api/admin/enquiries') return json(route, []);
  if (p === '/api/admin/enquiries/summary') return json(route, { open: 0, overdueCallBacks: 0, uncalled: 0 });
  if ((m = p.match(/^\/api\/farmer\/farms\/(\d+)\/today$/))) return json(route, { farmId: +m[1], day: D.sastDay(), zones: +m[1] === 1 ? D.todayBefore : [] });
  if ((m = p.match(/^\/api\/admin\/zones\/(\d+)\/run-advice$/))) return json(route, {
    zoneId: 11, zoneName: 'Tomato field', ranFor: D.sastDay(), stage: 'Growing', dayOfSeason: 66, crop: 'Tomato', soil: 'Loam / garden soil', soilWasDefaulted: false,
    etcTodayMm: 6.4, etoTodayMm: 5.8, depletionMm: 35, readilyAvailableMm: 31.5, totalAvailableMm: 91, recommendedLitres: 1750, recommendedMinutes: 70,
    daysToNextWatering: 1, nextWateringDate: D.sastDay(1), moisturePercent: 41, balanceRan: true, setupMissing: [],
    limitations: ["Water amounts in litres are estimates worked out from pump running time and the zone's flow rate. There is no flow meter anywhere in AgroFlow."],
    insights: D.insights[11] });
  if (p.includes('report-schedule')) return json(route, { farmId: 1, enabled: true, frequency: 'weekly', weekday: 1, reportKind: 'water_usage', nextRunAt: D.ago(-60 * 24 * 4), lastRunAt: D.ago(60 * 24 * 3) });
  if (p === '/api/farmer/reports/zones') return json(route, zones.filter((z) => z.farm_id === 1).map((z) => ({ zoneId: z.id, name: z.name, cropType: z.crop_type })));
  if (p.includes('/zones')) return json(route, zones.filter((z) => p.includes(`/${z.farm_id}/`)).map((z) => ({ id: z.id, name: z.name })));
  unstubbed.add(`api ${req.method()} ${p}`);
  return json(route, []);
}

const exp = Math.floor(D.NOW / 1000) + 3600 * 6;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sessionUser = { id: D.ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: 'admin@demo.invalid', app_metadata: {}, user_metadata: {}, created_at: D.ago(1000) };
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: D.ADMIN_ID, exp, role: 'authenticated', aud: 'authenticated' })}.demo`, refresh_token: 'demo', token_type: 'bearer', expires_in: 3600 * 6, expires_at: exp, user: sessionUser };

const browser = await chromium.launch();

// ---- public landing page (signed out) ---------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await ctx.route('https://demo.supabase.co/**', supa); await ctx.route('https://api.demo.local/**', api);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`); await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}w-landing.png` });
  await page.mouse.wheel(0, 760); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}w-landing-2.png` });
  await page.mouse.wheel(0, 760); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}w-landing-3.png` });
  await ctx.close();
}

const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['sb-demo-auth-token', JSON.stringify(session)]);
await ctx.route('https://demo.supabase.co/**', supa);
await ctx.route('https://api.demo.local/**', api);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const pause = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });

await page.goto(`${ORIGIN}/#dashboard`);
await page.waitForSelector('#appShell', { timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {}); await pause(3500);
await page.mouse.move(1400, 790);

for (const id of ['dashboard', 'requests', 'users', 'farms', 'hardware', 'alerts', 'maintenance', 'reports', 'activity', 'settings']) {
  await page.evaluate((h) => { location.hash = h; }, id); await pause(3000);
  await shot(`a-${id}`);
  if (PROBE) console.log(id, (await page.locator('main, #appShell').first().innerText()).slice(0, 700).replace(/\n+/g, ' | '));
}
// ---- farm detail: today per zone, Why (with the admin-only technical line), run advice
await page.evaluate(() => { location.hash = 'farms'; }); await pause(2500);
await page.locator('[data-act="view-farm"][data-id="1"]').first().click(); await pause(3500);
const zonesHead = page.getByText('Zones (3)').first();
await zonesHead.scrollIntoViewIfNeeded().catch(() => {}); await pause(1500);
await shot('a-farm-zones');
await page.locator('[data-today-zone="11"] a, [data-today-zone="11"] button').filter({ hasText: 'Why am I seeing this?' }).first().click(); await pause(2500);
await shot('a-why');
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 300); await pause(120); }
await pause(1200);
await shot('a-why-2');
await page.keyboard.press('Escape'); await pause(1200);
await page.evaluate(() => { location.hash = 'farms'; }); await pause(2500);
await page.locator('[data-act="view-farm"][data-id="1"]').first().click(); await pause(3500);
await page.locator('[data-act="run-advice"][data-id="11"]').first().click(); await pause(3500);
await shot('a-run-advice');
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 300); await pause(120); }
await pause(1200);
await shot('a-run-advice-2');
await page.keyboard.press('Escape'); await pause(1000);

// ---- alert detail ------------------------------------------------------------------
await page.evaluate(() => { location.hash = 'alerts'; }); await pause(2800);
await page.locator('[data-act="view-alert"][data-id="298"]').first().click().catch((e) => console.log('alert', e.message)); await pause(3000);
await shot('a-alert-detail');
await page.keyboard.press('Escape'); await pause(1000);

// ---- the same console at phone width ---------------------------------------------
await page.setViewportSize({ width: 430, height: 932 });
for (const [hash, name] of [['dashboard', 'a-narrow-home'], ['hardware', 'a-narrow-kits']]) {
  await page.evaluate((h) => { location.hash = h; }, hash); await pause(2500); await shot(name);
}
console.log('unstubbed', [...unstubbed]);
await browser.close();
