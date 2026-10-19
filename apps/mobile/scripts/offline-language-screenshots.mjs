// Usage (from apps/mobile):
//   EXPO_PUBLIC_SUPABASE_URL=https://testproject.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon-key //   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.agroflow.test npx expo export --clear --platform web --output-dir <build>
//   node scripts/offline-language-screenshots.mjs <build> <out> ../web/admin
// (Playwright comes from the admin app's install; --clear stops Metro reusing the real .env values.)
//
// Screenshots of the farmer web app at 390x844 for Part B: Home online and offline, a zone's
// Irrigate panel offline, and Settings in English, Afrikaans and Setswana. The app is the real
// `expo export --platform web` build, served locally; Supabase and the API are fake hosts
// answered here, so nothing reaches a live system.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [, , buildArg, outDir, adminDir] = process.argv;
const buildDir = path.resolve(buildArg);
const { chromium } = require(path.join(adminDir, 'node_modules', 'playwright-core'));

const FAKE_SUPABASE = 'https://testproject.supabase.co';
const FAKE_API = 'https://api.agroflow.test';
const FARMER = '00000000-0000-4000-8000-0000000000fa';

// Static server with single-page fallback.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.webm': 'video/webm' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(buildDir, url);
  if (!file.startsWith(buildDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(buildDir, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(5191, r));
const BASE = 'http://localhost:5191';

const now = new Date();
const farmRow = { farm_id: 1, owner_id: FARMER, name: 'Nkosi Farm', location: 'Philippi, Cape Town', total_area: 0.5, status: 'Active', latitude: -34.0, longitude: 18.55, is_simulated: false };
const zoneRow = (id, name, crop) => ({ id, farm_id: 1, name, location: 'North beds', crop_type: crop, planting_date: '2026-09-01', water_saved: 120, health_status: 'Healthy', size_value: 20, size_unit: 'm²', automation_enabled: true, moisture_threshold: 30, desired_moisture: 60, weather_adjustment: true, irrigation_mode: id === 7 ? 'manual' : 'automatic', schedule_enabled: false, schedule_days: [], schedule_start_time: '05:30', schedule_duration_minutes: 10, calibration_wet: 1550, calibration_dry: 4095 });
const dashboard = {
  profile: { id: FARMER, name: 'Thandi Nkosi' },
  farms: [farmRow], farm: farmRow,
  zones: [zoneRow(7, 'Spinach bed', 'spinach'), zoneRow(8, 'Tomato tunnel', 'tomato')],
  readings: [
    { zone_id: 7, moisture: 2300, temperature: 21.5, humidity: 58, last_reading_at: now.toISOString() },
    { zone_id: 8, moisture: 2900, temperature: 23.0, humidity: 52, last_reading_at: now.toISOString() },
  ],
  events: [], usage: [{ zone_id: 7, total_litres: 36 }], weather: [],
  alerts: [{ id: 41, zone_id: 8, severity: 'Warning', message: 'Tomato tunnel is getting dry.', status: 'Open', created_at: now.toISOString(), read_at: null }],
};
const today = (zoneId, name, kind, text) => ({
  zoneId, name, action: { kind, text }, why: null,
  confidence: { level: 'high', reason: 'High: live soil readings and today\'s weather.' }, confidenceExplanation: null,
  nextStep: null, setup: { crop: true, plantingDate: true, soil: true, area: true, flowRate: true, calibrated: true, hasKit: true },
});

function apiAnswer(method, p) {
  if (p === '/api/farmer/dashboard') return dashboard;
  if (p === '/api/farmer/farms/1/today') return { farmId: 1, day: now.toISOString().slice(0, 10), zones: [today(7, 'Spinach bed', 'skip', 'No water needed today'), today(8, 'Tomato tunnel', 'water', 'Water about 8 min this morning (about 12 L)')] };
  if (p === '/api/farmer/farms/1/tank') return { farmId: 1, farmName: 'Nkosi Farm', capacityLitres: 1000, lastRefillId: 3, lastRefillLitres: 800, lastRefilledAt: now.toISOString(), latestWaterPh: 7.1, estimatedUsedLitres: 180, estimatedRemainingLitres: 620, isLow: false, waterPhWarning: null };
  if (p.startsWith('/api/farmer/weather/current')) return { current: { time: now.toISOString(), temperature_2m: 22, apparent_temperature: 22, relative_humidity_2m: 55, weather_code: 1, wind_speed_10m: 12 }, daily: { precipitation_probability_max: [10] } };
  if (p === '/api/telegram/me') return { linked: true, alertsEnabled: true };
  if (p.startsWith('/api/farmer/dismissals')) return [];
  if (p.startsWith('/api/farmer/zones/') && p.endsWith('/insights')) return { insights: [], growth: null };
  if (p.startsWith('/api/farmer/zones/') && p.endsWith('/soil-ph')) return { zoneId: 7, entries: [] };
  if (p.startsWith('/api/farmer/zones/') && p.endsWith('/recommended-settings')) return { available: false };
  if (p.startsWith('/api/farmer/forecast')) return { days: [] };
  if (method !== 'GET') return {};
  return [];
}

let offline = false;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg', reducedMotion: 'reduce' });
await context.addInitScript(({ id }) => {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
  window.localStorage.setItem('sb-testproject-auth-token', JSON.stringify({
    access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: exp,
    user: { id, aud: 'authenticated', role: 'authenticated', email: 'thandi@example.org', app_metadata: {}, user_metadata: { name: 'Thandi Nkosi' }, created_at: new Date().toISOString() },
  }));
  // Skip the start-up animation's "seen it" check (the splash plays once per session).
  window.sessionStorage.setItem('agroflow_loading_seen', '1');
}, { id: FARMER });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (url.origin === BASE) return route.continue();
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (url.origin === FAKE_API) {
    if (offline) return route.abort('internetdisconnected');
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(apiAnswer(route.request().method(), url.pathname)) });
  }
  if (url.origin === FAKE_SUPABASE) {
    if (offline) return route.abort('internetdisconnected');
    if (url.pathname === '/rest/v1/profile') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ must_change_password: false }) });
    if (url.pathname.startsWith('/auth/v1/user')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ id: FARMER, email: 'thandi@example.org' }) });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '[]' });
  }
  return route.abort();   // map tiles and anything else: not needed for these shots
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
fs.mkdirSync(outDir, { recursive: true });

async function settle() {
  await page.waitForTimeout(800);
  // The start-up animation covers the app until it finishes.
  await page.waitForFunction(() => !document.querySelector('[data-testid="loading-animation"]'), null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}
async function shot(name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
  console.log('saved', name);
}

// 1. Home online (this also saves the copies the offline shots show).
await page.goto(BASE + '/');
await page.getByText('Today', { exact: true }).first().waitFor({ timeout: 30000 });
await settle();
await shot('home-online.png');

// Load the zone and Settings once online so they are saved on the phone too.
await page.goto(BASE + '/zone/7');
await page.getByText('Irrigation mode').first().waitFor({ timeout: 30000 });
await page.goto(BASE + '/settings');
await page.getByText('Language').first().waitFor({ timeout: 30000 });

// 2. Home offline: the API and Supabase stop answering; the app shows what it saved.
offline = true;
await page.goto(BASE + '/');
await page.getByText(/You're offline — showing data from/).first().waitFor({ timeout: 30000 });
await settle();
await shot('home-offline.png');
const bannerText = await page.getByText(/You're offline — showing data from/).first().textContent();

// 3. The zone's Irrigate panel offline: the button is off and says why.
await page.goto(BASE + '/zone/7');
await page.getByText('Irrigation mode').first().waitFor({ timeout: 30000 });
await settle();
// "Manual" shows the Water now controls (a preview; it does not change the zone's saved mode).
await page.getByText('Manual', { exact: true }).first().click();
await page.getByText('Needs a connection to reach your kit').first().waitFor({ timeout: 30000 });
const irrigate = page.getByTestId('irrigate-button');
await irrigate.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const disabled = await irrigate.getAttribute('aria-disabled');
await shot('zone-irrigate-offline.png');

// 4. Settings in the three languages (online again).
offline = false;
await page.goto(BASE + '/settings');
await page.getByText('Language').first().waitFor({ timeout: 30000 });
await settle();
await shot('settings-en.png');
await page.getByTestId('language-af').click();
await page.getByText('Taal').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await shot('settings-af.png');
await page.getByTestId('language-tn').click();
await page.getByText('Puo').first().waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await shot('settings-tn.png');
// And Home in Setswana, to show the rest of the app follows.
await page.goto(BASE + '/');
await page.getByText('Gompieno', { exact: true }).first().waitFor({ timeout: 30000 });
await settle();
await shot('home-tn.png');
await page.goto(BASE + '/settings');
await page.getByTestId('language-en').click();

console.log(JSON.stringify({ bannerText, irrigateAriaDisabled: disabled, pageErrors: errors }));
await browser.close();
server.close();
