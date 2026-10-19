// Screenshots of the setup wizard (every step), Home's setup card, and Settings in English,
// Afrikaans and Setswana, at 390x844 and 1366x768. The real `expo export --platform web` build,
// served locally; Supabase and the API are fake hosts answered here. Usage (from apps/mobile):
//   EXPO_PUBLIC_SUPABASE_URL=https://testproject.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon-key \
//   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.agroflow.test npx expo export --clear --platform web --output-dir <build>
//   node scripts/setup-wizard-screenshots.mjs <build> <out> ../web/admin
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
await new Promise(r => server.listen(5192, r));
const BASE = 'http://localhost:5192';

const now = new Date();
let mustChange = true;
const farmRow = { farm_id: 1, owner_id: FARMER, name: 'Nkosi Farm', location: 'Philippi, Cape Town', total_area: 0.5, status: 'Active', latitude: -34.0, longitude: 18.55 };
const zoneRow = (id, name, crop, planting, dry) => ({ id, farm_id: 1, name, location: 'North beds', crop_type: crop, planting_date: planting, irrigation_mode: 'automatic', moisture_threshold: 30, desired_moisture: 60, calibration_dry: dry ? 3900 : null, calibration_wet: null });
const dashboard = () => ({
  profile: { id: FARMER, name: 'Thandi Nkosi' }, farms: [farmRow], farm: farmRow,
  zones: [zoneRow(7, 'Spinach bed', 'spinach', '2026-09-20', true), zoneRow(8, 'Tomato tunnel', null, null, false)],
  readings: [{ zone_id: 7, moisture: 2600, temperature: 21, humidity: 55, last_reading_at: now.toISOString() }],
  events: [], usage: [], weather: [], alerts: [],
});
const today = {
  farmId: 1, day: now.toISOString().slice(0, 10), zones: [
    { zoneId: 7, name: 'Spinach bed', action: { kind: 'skip', text: 'No water needed today' }, why: null, confidence: { level: 'medium', reason: 'Medium.' }, confidenceExplanation: null, nextStep: null,
      setup: { crop: true, plantingDate: true, soil: true, area: true, flowRate: false, calibrated: false, hasKit: true } },
    { zoneId: 8, name: 'Tomato tunnel', action: { kind: 'setup', text: 'Finish setup: add the crop' }, why: null, confidence: null, confidenceExplanation: null, nextStep: null,
      setup: { crop: false, plantingDate: false, soil: true, area: true, flowRate: false, calibrated: false, hasKit: false } },
  ],
};
function apiAnswer(method, p) {
  if (p === '/api/farmer/dashboard') return dashboard();
  if (p === '/api/farmer/farms/1/today') return today;
  if (p === '/api/telegram/me') return { linked: false, alertsEnabled: true };
  if (p.startsWith('/api/farmer/weather/current')) return { current: { temperature_2m: 22, weather_code: 1 }, daily: { precipitation_probability_max: [10] } };
  if (p.startsWith('/api/farmer/farms/1/tank')) return { farmId: 1, capacityLitres: null, estimatedRemainingLitres: null };
  return method === 'GET' ? [] : {};
}

const browser = await chromium.launch();
fs.mkdirSync(outDir, { recursive: true });
const errors = [];

async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg', reducedMotion: 'reduce' });
  await context.addInitScript(({ id }) => {
    if (window.localStorage.getItem('sb-testproject-auth-token')) return;
    const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
    window.localStorage.setItem('sb-testproject-auth-token', JSON.stringify({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: exp,
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'thandi@example.org', app_metadata: {}, user_metadata: { name: 'Thandi Nkosi' }, created_at: new Date().toISOString() },
    }));
  }, { id: FARMER });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (url.origin === BASE) return route.continue();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = body => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.origin === FAKE_API) return json(apiAnswer(route.request().method(), url.pathname));
    if (url.origin === FAKE_SUPABASE) {
      if (url.pathname === '/rest/v1/profile') return json({ must_change_password: mustChange });
      return json([]);
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return page;
}

async function settle(page) {
  await page.waitForTimeout(2500);
}

for (const [tag, viewport] of [['390', { width: 390, height: 844 }], ['1366', { width: 1366, height: 768 }]]) {
  mustChange = true;
  const page = await newPage(viewport);
  // A first sign-in with a temporary password lands in the wizard.
  await page.goto(BASE + '/');
  await page.getByText('Welcome to AgroFlow').first().waitFor({ timeout: 30000 });
  await settle(page);
  await page.screenshot({ path: path.join(outDir, `${tag}-1-welcome.png`) });
  for (const [n, step, text] of [[2, 'password', 'Set your own password'], [3, 'telegram', 'Link Telegram'], [4, 'zones', 'Your zones'], [5, 'flow', 'Measure your water flow'], [6, 'soil', 'Teach AgroFlow your soil'], [7, 'done', 'Nearly there']]) {
    if (n === 3) mustChange = false;   // the password was changed in step 2
    await page.goto(`${BASE}/setup?step=${step}`);
    await page.getByText(text).first().waitFor({ timeout: 30000 });
    await settle(page);
    if (step === 'flow') {
      await page.getByTestId('setup-flow-amount').fill('5');
      await page.getByTestId('setup-flow-stopwatch').click();
      await page.waitForTimeout(3200);
      await page.getByTestId('setup-flow-stopwatch').click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: path.join(outDir, `${tag}-${n}-${step}.png`), fullPage: false });
  }
  // Home with the setup card.
  await page.goto(BASE + '/');
  await page.getByTestId('setup-card').first().waitFor({ timeout: 30000 });
  await settle(page);
  await page.screenshot({ path: path.join(outDir, `${tag}-home-card.png`) });
  // Settings in three languages (the same setting as step 1).
  await page.goto(BASE + '/settings');
  await page.getByTestId('redo-setup').first().waitFor({ timeout: 30000 });
  await settle(page);
  await page.screenshot({ path: path.join(outDir, `${tag}-settings-en.png`) });
  await page.getByTestId('language-af').click();
  await page.getByText('Taal').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, `${tag}-settings-af.png`) });
  await page.getByTestId('language-tn').click();
  await page.getByText('Puo').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, `${tag}-settings-tn.png`) });
  await page.getByTestId('language-en').click();
  await page.context().close();
  console.log('done', tag);
}
console.log(JSON.stringify({ pageErrors: errors }));
await browser.close();
server.close();
