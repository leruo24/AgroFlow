// BEFORE / AFTER screenshots for the spacing and layout pass (docs/app-spacing.md): every screen
// at 320x568, 390x844, 430x932 and 1366x768, once at the top and once scrolled to the bottom
// (where the floating tab bar used to cover the last button). The real `expo export --platform
// web` build, served locally; Supabase and the API are fake hosts answered here. The demo farm
// has a raw crop value (leafy_veg), a zone with no kit, alerts and watering history, so the
// label, empty-state and grid fixes all show. Usage (from apps/mobile):
//   EXPO_PUBLIC_SUPABASE_URL=https://testproject.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon-key \
//   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.agroflow.test npx expo export --clear --platform web --output-dir <build>
//   node scripts/spacing-screenshots.mjs <build> <out> ../web/admin
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [, , buildArg, outDir, adminDir] = process.argv;
const buildDir = path.resolve(buildArg);
const { chromium } = require(path.join(path.resolve(adminDir), 'node_modules', 'playwright-core'));

const FAKE_SUPABASE = 'https://testproject.supabase.co';
const FAKE_API = 'https://api.agroflow.test';
const FARMER = '00000000-0000-4000-8000-0000000000fa';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(buildDir, url);
  if (!file.startsWith(buildDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(buildDir, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(5195, r));
const BASE = 'http://localhost:5195';

const now = new Date();
const ago = h => new Date(now - h * 3600e3).toISOString();
const farmRow = { farm_id: 1, owner_id: FARMER, name: 'Nkosi Farm', location: 'Philippi, Cape Town', total_area: 0.5, status: 'Active', latitude: -34.0, longitude: 18.55 };
const zoneRow = (id, name, crop, kit) => ({ id, farm_id: 1, name, location: 'North beds', crop_type: crop, planting_date: '2026-09-20', irrigation_mode: id === 8 ? 'manual' : 'automatic',
  moisture_threshold: 30, desired_moisture: 60, calibration_dry: kit ? 3900 : null, calibration_wet: kit ? 1600 : null, max_run_minutes: 5, flow_rate_lpm: 1.5, soil_type: 'loam' });
const dashboard = () => ({
  profile: { id: FARMER, name: 'Thandi Nkosi' }, farms: [farmRow], farm: farmRow,
  zones: [zoneRow(7, 'Spinach bed', 'leafy_veg', true), zoneRow(8, 'Tomato tunnel', 'tomato', false)],
  readings: [{ zone_id: 7, moisture: 2600, temperature: 21.4, humidity: 55, last_reading_at: ago(0.2) }],
  events: [
    { id: 1, zone_id: 7, started_at: ago(5), runtime_seconds: 300, trigger_source: 'manual', estimated_litres: 7.5 },
    { id: 2, zone_id: 7, started_at: ago(29), runtime_seconds: 240, trigger_source: 'auto', estimated_litres: 6 },
  ],
  usage: [], weather: [],
  alerts: [
    { id: 1, zone_id: 7, alert_type: 'low_moisture', severity: 'warning', message: 'Spinach bed is getting dry.', created_at: ago(3), is_read: false },
    { id: 2, zone_id: null, alert_type: 'frost', severity: 'critical', message: 'Frost possible tonight. Cover young plants.', created_at: ago(20), is_read: true },
  ],
});
const setup = { crop: true, plantingDate: true, soil: true, area: true, flowRate: true, calibrated: true, hasKit: true };
const today = { farmId: 1, day: now.toISOString().slice(0, 10), zones: [
  { zoneId: 7, name: 'Spinach bed', action: { kind: 'water', text: 'Water about 6 min this morning (about 9 L)' }, recommendedMinutes: 6, maxRunMinutes: 5,
    why: null, confidence: { level: 'medium', reason: 'Medium.' }, confidenceExplanation: null, nextStep: null, setup },
  { zoneId: 8, name: 'Tomato tunnel', action: { kind: 'setup', text: 'Connect a kit to get advice from the soil' }, recommendedMinutes: null, maxRunMinutes: 5,
    why: null, confidence: null, confidenceExplanation: null, nextStep: null, setup: { ...setup, hasKit: false, calibrated: false } },
] };
function apiAnswer(method, p) {
  if (p === '/api/farmer/dashboard') return dashboard();
  if (p === '/api/farmer/farms/1/today') return today;
  if (p === '/api/telegram/me') return { linked: true, alertsEnabled: true };
  if (p.startsWith('/api/farmer/weather/current')) return { current: { temperature_2m: 22, weather_code: 1 }, daily: { precipitation_probability_max: [10] } };
  const zone = p.match(/\/api\/farmer\/zones\/(\d+)\/(hardware|soil-ph|insights|recommended)$/);
  if (zone) {
    const [, id, what] = zone;
    if (what === 'hardware') return id === '7'
      ? { hardwareId: 1, deviceId: 'AF-0123456789AB', deviceName: 'Kit 1', online: true, lastSeen: ago(0.2), tokenStatus: 'active' }
      : { hardwareId: null, deviceId: null, deviceName: null, online: false, lastSeen: null, tokenStatus: 'no device' };
    if (what === 'soil-ph') return { zoneId: Number(id), entries: [] };
    if (what === 'insights') return { insights: [], growth: null };
    return { available: false };
  }
  if (p.startsWith('/api/farmer/farms/1/tank')) return { farmId: 1, capacityLitres: 2500, estimatedRemainingLitres: 1400, lastRefillLitres: 2000, lastRefilledAt: ago(48), latestWaterPh: 6.8 };
  return method === 'GET' ? [] : {};
}

const browser = await chromium.launch();
fs.mkdirSync(outDir, { recursive: true });
const errors = [];

async function newPage(viewport, signedIn) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg', reducedMotion: 'reduce' });
  if (signedIn) await context.addInitScript(({ id }) => {
    if (window.localStorage.getItem('sb-testproject-auth-token')) return;
    const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
    window.localStorage.setItem('sb-testproject-auth-token', JSON.stringify({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: exp,
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'thandi@example.org', app_metadata: {}, user_metadata: { name: 'Thandi Nkosi' }, created_at: new Date().toISOString() },
    }));
    // The wizard is done, so Home opens on Home.
    window.localStorage.setItem(`agroflow_setup:v1:${id}`, JSON.stringify({ languageConfirmed: true, telegramDeclined: false, skipped: [], unsent: [] }));
  }, { id: FARMER });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (url.origin === BASE) return route.continue();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = body => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.origin === FAKE_API) return json(apiAnswer(route.request().method(), url.pathname));
    if (url.origin === FAKE_SUPABASE) {
      if (url.pathname === '/rest/v1/profile') return json({ must_change_password: false });
      return json([]);
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${viewport.width}: ${e.message}`));
  return page;
}

// Scroll every scrollable box (React Native Web scroll views are inner divs) to the bottom.
const toBottom = page => page.evaluate(() => {
  for (const el of Array.from(document.querySelectorAll('div'))) {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
});

const SCREENS = [
  ['home', '/'], ['irrigation', '/irrigation'], ['zone', '/zone/7'], ['zone-nokit', '/zone/8'], ['alerts', '/alerts'],
  ['history', '/history'], ['reports', '/reports'], ['settings', '/settings'], ['tank', '/tank'],
  ['setup', '/setup?step=welcome'], ['setup-zones', '/setup?step=zones'], ['setup-done', '/setup?step=done'],
];
const SIGNED_OUT = [['signin', '/login'], ['reset', '/forgot-password']];
const VIEWPORTS = [['320', { width: 320, height: 568 }], ['390', { width: 390, height: 844 }], ['430', { width: 430, height: 932 }], ['1366', { width: 1366, height: 768 }]];

for (const [tag, viewport] of VIEWPORTS) {
  const page = await newPage(viewport, true);
  for (const [name, url] of SCREENS) {
    await page.goto(BASE + url);
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });
    await toBottom(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `${tag}-${name}-bottom.png`) });
  }
  await page.context().close();
  const out = await newPage(viewport, false);
  for (const [name, url] of SIGNED_OUT) {
    await out.goto(BASE + url);
    await out.waitForTimeout(2600);
    await out.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });
  }
  await out.context().close();
  console.log('done', tag);
}
console.log(JSON.stringify({ pageErrors: errors }));
await browser.close();
server.close();
