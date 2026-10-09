// Captures the REAL AgroFlow farmer app (apps/mobile, unmodified, Expo web)
// for the walkthrough video. Network calls are answered with ILLUSTRATIVE
// demo data, following apps/mobile/scripts/ui-smoke.mjs. Insight messages use
// the exact templates in backend/AgroFlow.Domain/Agronomy/ZoneInsightBuilder.cs.
//
// Usage: node mobile-capture.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || '../assets/mobile';
const ORIGIN = 'http://localhost:8098';
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const sastDay = (d = 0) => new Date(now + 2 * 3600000 + d * 86400000).toISOString().slice(0, 10);
const weekday = (d) => new Date(now + d * 86400000).toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'Africa/Johannesburg' });

const USER_ID = '00000000-0000-0000-0000-000000000001';
const user = { id: USER_ID, email: 'demo.farmer.a@demo.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: { first_name: 'Demo', last_name: 'Farmer' }, app_metadata: {}, created_at: ago(90000) };
const exp = Math.floor(now / 1000) + 6 * 3600;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: USER_ID, exp, role: 'authenticated' })}.demo`, refresh_token: 'demo', expires_at: exp, expires_in: 6 * 3600, token_type: 'bearer', user };

const farms = [
  { farm_id: 1, owner_id: USER_ID, name: 'Green Valley (demo)', location: 'Stellenbosch, Western Cape', latitude: -33.93, longitude: 18.86 },
  { farm_id: 2, owner_id: USER_ID, name: 'Riverside (demo)', location: 'Paarl, Western Cape', latitude: -33.73, longitude: 18.97 },
];
const zoneBase = { irrigation_mode: 'automatic', schedule_enabled: false, schedule_days: [], schedule_start_time: '06:00', schedule_duration_minutes: 15, weather_adjustment: true, size_unit: 'm2' };
const zones = [
  { ...zoneBase, id: 11, farm_id: 1, name: 'Zone 1', crop_type: 'tomato', location: 'North beds', planting_date: sastDay(-48), moisture_threshold: 35, desired_moisture: 55, health_status: 'Warning', size_value: 400, flow_rate_lpm: 1.5, area_m2: 400 },
  { ...zoneBase, id: 12, farm_id: 1, name: 'Zone 2', crop_type: 'maize', location: 'South beds', planting_date: sastDay(-62), moisture_threshold: 30, desired_moisture: 50, health_status: 'Healthy', size_value: 650, flow_rate_lpm: 1.5, area_m2: 650 },
];
const readings = [
  { zone_id: 11, moisture: 34, temperature: 27, humidity: 61, last_reading_at: ago(1) },
  { zone_id: 12, moisture: 47, temperature: 26, humidity: 63, last_reading_at: ago(1) },
];
const events = [
  { id: 401, zone_id: 12, started_at: ago(60 * 20), runtime_seconds: 900, estimated_litres: 22, trigger_source: 'auto' },
  { id: 400, zone_id: 11, started_at: ago(60 * 44), runtime_seconds: 720, estimated_litres: 18, trigger_source: 'auto' },
  { id: 399, zone_id: 12, started_at: ago(60 * 70), runtime_seconds: 900, estimated_litres: 22, trigger_source: 'schedule' },
];
const alerts = [
  { id: 301, zone_id: 11, severity: 'Warning', message: 'Soil moisture below target in Zone 1.', status: 'Open', created_at: ago(35), read_at: null },
];
const insights = {
  11: [
    { insightType: 'water_now', severity: 'act_now', message: 'Water Zone 1 now: about 12 min (~18 L).' },
  ],
  12: [{ insightType: 'water_soon', severity: 'heads_up', message: `Zone 2 will need water in ~2 days (${weekday(2)}).` }],
};

const dashboard = (farmId) => ({
  profile: { id: USER_ID, name: 'Demo Farmer A', email: user.email, role: 'farm_user', phone: '' },
  farms, farm: farms.find((f) => f.farm_id === farmId) ?? farms[0],
  zones: zones.filter((z) => z.farm_id === farmId), readings, events,
  usage: [{ zone_id: 11, used_today_litres: 0 }, { zone_id: 12, used_today_litres: 22 }],
  weather: [{ weather_conditions: 'Partly cloudy', recorded_at: ago(90) }],
  alerts,
});

const days = Array.from({ length: 7 }, (_, i) => ({ date: sastDay(i), weekday: weekday(i).slice(0, 3), minC: 12 + (i % 3), maxC: 26 + (i % 4), rainMm: i === 4 ? 6 : 0, humidityPercent: 58 + i, icon: i === 4 ? 'rain' : i === 3 ? 'cloud' : 'sun', advice: null }));

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });

async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const url = new URL(req.url()); const p = url.pathname;
  if (p === '/api/farmer/dashboard') return json(route, dashboard(Number(url.searchParams.get('farmId') || 1)));
  if (p === '/api/farmer/weather/current') return json(route, { current: { time: ago(10).slice(0, 16), temperature_2m: 27, apparent_temperature: 28, relative_humidity_2m: 61, weather_code: 2, wind_speed_10m: 11 }, daily: { precipitation_probability_max: [10] } });
  let m;
  if ((m = p.match(/zones\/(\d+)\/insights$/))) return json(route, { zoneId: +m[1], day: sastDay(), insights: insights[m[1]] ?? [], growth: m[1] === '11' ? { stage: 'Development', dayOfSeason: 48, totalDays: 145, cropLabel: 'Tomato' } : { stage: 'Mid-season', dayOfSeason: 62, totalDays: 125, cropLabel: 'Maize' } });
  if ((m = p.match(/zones\/(\d+)\/hardware$/))) return json(route, { hardwareId: 101, deviceId: 'A4CF12B7E901', deviceName: 'Irrigation node', online: true, lastSeen: ago(1), firmwareVersion: '1.4.0', soilSensorWorking: true, soilLastReadingAt: ago(1), temperatureSensorWorking: true, temperatureLastReadingAt: ago(1), humiditySensorWorking: true, humidityLastReadingAt: ago(1), tokenStatus: 'active', setupNetworkName: null, setupNetworkPassword: null });
  if (p.endsWith('/forecast')) return json(route, { farmId: 1, zoneId: null, zoneName: null, days, source: 'Open-Meteo', message: null });
  if (p.endsWith('/telegram/me')) return json(route, { linked: true, alertsEnabled: true });
  if (p.endsWith('/report-requests') || p.endsWith('/requests')) return json(route, []);
  if (p.endsWith('/auto-reports')) return json(route, { enabled: false, farms: [] });
  console.log('unstubbed api', req.method(), p);
  return json(route, {});
}

async function supa(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const url = new URL(req.url()); const p = url.pathname;
  if (p.endsWith('/token')) return json(route, session);
  if (p.endsWith('/user')) return json(route, user);
  if (p.startsWith('/auth/')) return json(route, {});
  const table = p.replace('/rest/v1/', '');
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  let rows = [];
  if (table === 'ai_recommendation') rows = [11, 12].flatMap((z) => (insights[z] ?? []).map((i) => ({ zone_id: z, insight_type: i.insightType, severity: i.severity, message: i.message, created_at: ago(20), valid_for: sastDay() })));
  else if (table === 'alert') rows = alerts;
  else if (table === 'zone') rows = zones;
  else if (table === 'profile') rows = [{ id: USER_ID, name: 'Demo Farmer A', email: user.email, role: 'farm_user', phone: '' }];
  else if (table === 'irrigation_event') rows = events;
  else console.log('unstubbed table', table);
  return json(route, single ? rows[0] ?? null : rows);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light', reducedMotion: 'reduce' });
await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem('__seeded')) { localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('__seeded', '1'); } }, ['sb-demo-auth-token', JSON.stringify(session)]);
await ctx.route('https://api.demo.local/**', api);
await ctx.route('https://demo.supabase.co/**', supa);
await ctx.route(/tile\.openstreetmap|basemaps|arcgis|openfreemap/, (r) => r.abort());
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('dialog', (d) => d.accept());

const wait = async (ms = 2500) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); };
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('saved', name); };
const nav = async (path) => { await page.goto(`${ORIGIN}${path}`); await wait(); };

await page.goto(`${ORIGIN}/`);
await page.waitForTimeout(12000); // first bundle + splash
await wait(3000);
await shot('m01-home');
// Farm selector sheet
const farmBtn = page.getByText('Green Valley (demo)').first();
if (await farmBtn.count()) { await farmBtn.click(); await page.waitForTimeout(1500); await shot('m00-farm-selector'); await page.keyboard.press('Escape'); await page.mouse.click(195, 120); await page.waitForTimeout(800); }

await nav('/irrigation'); await shot('m02-irrigation');
await nav('/zone/11'); await shot('m03-zone');
await page.mouse.wheel(0, 700); await page.waitForTimeout(1200); await shot('m03b-zone-scrolled');
await page.mouse.wheel(0, 900); await page.waitForTimeout(1200); await shot('m03c-zone-scrolled2');
await nav('/alerts'); await shot('m04-alerts');
await nav('/history'); await shot('m05-history');
await nav('/forecast'); await shot('m06-forecast');
await browser.close();
