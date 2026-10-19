// Release oct-19 screenshots of Home (online and offline) and the zone screen's Irrigate states
// ("No kit connected", Sending…, Kit started watering, Finished, Kit didn't respond), and Home's
// "Recommended 66 min — your pump is limited to 5 min per run" note, at 390x844 and 1366x768.
// The real `expo export --platform web` build, served locally; Supabase and the API are fake
// hosts answered here. Same export as scripts/setup-wizard-screenshots.mjs:
//   node scripts/release-screenshots.mjs <build> <out> ../web/admin
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
await new Promise(r => server.listen(5194, r));
const BASE = 'http://localhost:5194';

const now = new Date();
const farmRow = { farm_id: 1, owner_id: FARMER, name: 'Nkosi Farm', location: 'Philippi, Cape Town', total_area: 0.5, status: 'Active', latitude: -34.0, longitude: 18.55 };
const zoneRow = (id, name, max) => ({ id, farm_id: 1, name, location: 'North beds', crop_type: 'spinach', planting_date: '2026-09-20', irrigation_mode: 'automatic',
  moisture_threshold: 30, desired_moisture: 60, calibration_dry: 3900, calibration_wet: 1600, max_run_minutes: max, flow_rate_lpm: 1.5 });
const dashboard = () => ({
  profile: { id: FARMER, name: 'Thandi Nkosi' }, farms: [farmRow], farm: farmRow,
  zones: [zoneRow(7, 'Spinach bed', 5), zoneRow(8, 'Tomato tunnel', 5)],
  readings: [{ zone_id: 7, moisture: 2600, temperature: 21, humidity: 55, last_reading_at: now.toISOString() }],
  events: [{ id: 1, zone_id: 7, started_at: new Date(now - 3600e3).toISOString(), runtime_seconds: 300, trigger_source: 'manual', estimated_litres: 7.5 }],
  usage: [], weather: [], alerts: [],
});
const setup = { crop: true, plantingDate: true, soil: true, area: true, flowRate: true, calibrated: true, hasKit: true };
const today = {
  farmId: 1, day: now.toISOString().slice(0, 10), zones: [
    { zoneId: 7, name: 'Spinach bed', action: { kind: 'water', text: 'Water about 66 min this morning (about 99 L)' }, recommendedMinutes: 66, maxRunMinutes: 5,
      why: null, confidence: { level: 'medium', reason: 'Medium.' }, confidenceExplanation: null, nextStep: null, setup },
    { zoneId: 8, name: 'Tomato tunnel', action: { kind: 'skip', text: 'No water needed today' }, recommendedMinutes: null, maxRunMinutes: 5,
      why: null, confidence: { level: 'high', reason: 'High.' }, confidenceExplanation: null, nextStep: null, setup },
  ],
};

let kit = 'online';            // 'online' | 'none'
let commandStates = [];         // what GET /api/farmer/commands/{id} answers, in turn
function apiAnswer(method, p) {
  if (p === '/api/farmer/dashboard') return dashboard();
  if (p === '/api/farmer/farms/1/today') return today;
  if (p === '/api/telegram/me') return { linked: true, alertsEnabled: true };
  if (p.startsWith('/api/farmer/weather/current')) return { current: { temperature_2m: 22, weather_code: 1 }, daily: { precipitation_probability_max: [10] } };
  if (p.startsWith('/api/farmer/farms/1/tank')) return { farmId: 1, capacityLitres: null, estimatedRemainingLitres: null };
  if (/\/api\/farmer\/zones\/\d+\/hardware$/.test(p)) {
    return kit === 'none'
      ? { hardwareId: null, deviceId: null, deviceName: null, online: false, lastSeen: null, tokenStatus: 'no device' }
      : { hardwareId: 1, deviceId: 'AF-0123456789AB', deviceName: 'Kit 1', online: true, lastSeen: now.toISOString(), tokenStatus: 'active' };
  }
  if (/\/api\/farmer\/zones\/\d+\/soil-ph$/.test(p)) return { zoneId: 7, entries: [] };
  if (/\/api\/farmer\/zones\/\d+\/insights$/.test(p)) return { insights: [], growth: null };
  if (/\/api\/farmer\/zones\/\d+\/recommended$/.test(p)) return { available: false };
  if (method === 'POST' && /\/api\/farmer\/zones\/\d+\/commands$/.test(p)) return { id: 'cmd-1' };
  if (p === '/api/farmer/commands/cmd-1') {
    const state = commandStates.length > 1 ? commandStates.shift() : commandStates[0] ?? 'sent';
    return { id: 'cmd-1', zoneId: 7, command: 'start', source: 'manual', state, label: state, durationSeconds: 300, createdAt: now.toISOString(), startedAt: null, finishedAt: null };
  }
  return method === 'GET' ? [] : {};
}

const browser = await chromium.launch();
fs.mkdirSync(outDir, { recursive: true });
const errors = [];

async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg', reducedMotion: 'reduce' });
  await context.addInitScript(({ id }) => {
    window.localStorage.setItem('agroflow_language', 'en');
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
      if (url.pathname === '/rest/v1/profile') return json({ must_change_password: false });
      return json([]);
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return page;
}

const settle = page => page.waitForTimeout(2500);

// Drip's greeting floats over the content for a few seconds; close it for a clear shot.
async function closeDrip(page) {
  const close = page.getByRole('button', { name: /close|dismiss|hide/i }).last();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  await page.waitForTimeout(400);
}

// A step that does not appear saves what the screen showed instead, and the run goes on.
async function waitOrDebug(page, locator, file) {
  try {
    await locator.waitFor({ timeout: 30000 });
    return true;
  } catch (e) {
    errors.push(`${file}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(outDir, `${file}-DEBUG.png`) });
    return false;
  }
}

// On web the "Water Bed now?" confirm is the browser's own dialog (components/AppAlert.ts).
async function pressStart(page) {
  page.once('dialog', d => d.accept());
  await page.getByTestId('irrigate-button').first().click();
}

for (const [tag, viewport] of [['390', { width: 390, height: 844 }], ['1366', { width: 1366, height: 768 }]]) {
  // Home, online: the over-limit advice note.
  kit = 'online';
  let page = await newPage(viewport);
  await page.goto(BASE + '/');
  await page.getByTestId('today-over-limit-7').first().waitFor({ timeout: 30000 });
  await settle(page);
  await closeDrip(page);
  await page.getByTestId('today-over-limit-7').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, `${tag}-home-online.png`) });
  await page.waitForTimeout(3000);   // the saved copy for offline is written after the load

  // Home, offline: the read-only banner over the saved copy.
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, `${tag}-home-offline.png`) });
  await page.context().close();

  // Zone screen: no kit connected.
  kit = 'none';
  page = await newPage(viewport);
  await page.goto(BASE + '/zone/7');
  if (await waitOrDebug(page, page.getByTestId('irrigate-no-kit').first(), `${tag}-zone-no-kit`)) {
    await settle(page);
    await closeDrip(page);
    await page.getByTestId('irrigate-no-kit').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `${tag}-zone-no-kit.png`) });
  }
  await page.context().close();

  // Zone screen: Sending… -> Kit started watering -> Finished.
  kit = 'online';
  commandStates = ['sent', 'sent', 'started', 'started', 'finished'];
  page = await newPage(viewport);
  await page.goto(BASE + '/zone/7');
  await page.getByTestId('irrigate-button').first().waitFor({ timeout: 30000 });
  await settle(page);
  await pressStart(page);
  const status = page.getByTestId('run-status').first();
  for (const [file, text] of [['zone-sending', 'Sending…'], ['zone-started', 'Kit started watering'], ['zone-finished', 'Finished']]) {
    await page.getByText(text, { exact: true }).first().waitFor({ timeout: 30000 });
    await status.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `${tag}-${file}.png`) });
  }
  await page.context().close();

  // Zone screen: the kit never answers.
  commandStates = ['no_response'];
  page = await newPage(viewport);
  await page.goto(BASE + '/zone/7');
  await page.getByTestId('irrigate-button').first().waitFor({ timeout: 30000 });
  await settle(page);
  await pressStart(page);
  await page.getByText("Kit didn't respond — check it's online").first().waitFor({ timeout: 30000 });
  await page.getByTestId('run-status').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, `${tag}-zone-no-response.png`) });
  await page.context().close();
  console.log('done', tag);
}
console.log(JSON.stringify({ errors }));
await browser.close();
server.close();
