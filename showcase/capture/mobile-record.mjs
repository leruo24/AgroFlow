// Records the REAL AgroFlow farmer app (apps/mobile on Expo web, unmodified)
// performing the showcase story. Network calls are answered with the
// illustrative data in demo-data.mjs. Output: ../assets/rec/m*.mp4 + events.
//
// Usage (Expo web on :8098 with EXPO_PUBLIC_SUPABASE_URL=https://demo.supabase.co
// and EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.demo.local): node mobile-record.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as D from './demo-data.mjs';
import { startRec, stopRec, tapAt } from './recorder.mjs';

const OUT = new URL('../assets/rec/', import.meta.url).pathname;
const SHOTS = new URL('../assets/screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const ORIGIN = 'http://localhost:8098';
const W = 390, H = 844, DPR = 2;

const state = { events: [...D.baseEvents], storyRunRecorded: false };

const user = { id: D.FARMER_ID, email: 'farmer@demo.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: D.ago(90000) };
const exp = Math.floor(D.NOW / 1000) + 6 * 3600;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: D.FARMER_ID, exp, role: 'authenticated' })}.demo`, refresh_token: 'demo', expires_at: exp, expires_in: 6 * 3600, token_type: 'bearer', user };

const dashboard = (farmId) => ({
  profile: { id: D.FARMER_ID, name: 'Smallholder Farmer (demo)', email: user.email, role: 'farm_user', phone: '' },
  farms: D.farms, farm: D.farms.find((f) => f.farm_id === farmId) ?? D.farms[0],
  zones: D.zones.filter((z) => z.farm_id === farmId), readings: D.readings, events: state.events,
  usage: [{ zone_id: 11, used_today_litres: 18 }, { zone_id: 13, used_today_litres: 30 }, ...(state.storyRunRecorded ? [{ zone_id: 12, used_today_litres: 7.5 }] : [])],
  weather: [{ weather_conditions: 'Mainly clear', recorded_at: D.ago(90) }],
  alerts: [D.criticalAlert],
});

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });
const commands = [];

async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const url = new URL(req.url()); const p = url.pathname; let m;
  if (p === '/api/farmer/dashboard') return json(route, dashboard(Number(url.searchParams.get('farmId') || 1)));
  if (p === '/api/farmer/weather/current') return json(route, D.currentWeather);
  if ((m = p.match(/zones\/(\d+)\/insights$/))) return json(route, { zoneId: +m[1], day: D.sastDay(), insights: D.insights[m[1]] ?? [], growth: D.growth[m[1]] ?? null });
  if ((m = p.match(/zones\/(\d+)\/hardware$/))) { const k = { 11: 'A4CF12B7E901', 12: 'A4CF12B7E9C4', 13: 'A4CF12B7EA38' }[m[1]];
    return json(route, { hardwareId: 100 + +m[1], deviceId: k, deviceName: 'Irrigation node', online: true, lastSeen: D.ago(1), firmwareVersion: '1.4.0', soilSensorWorking: true, soilLastReadingAt: D.ago(1), temperatureSensorWorking: true, temperatureLastReadingAt: D.ago(1), humiditySensorWorking: true, humidityLastReadingAt: D.ago(1), tokenStatus: 'active', setupNetworkName: null, setupNetworkPassword: null }); }
  if ((m = p.match(/zones\/(\d+)\/commands$/)) && req.method() === 'POST') { commands.push(JSON.parse(req.postData() || '{}')); return json(route, { id: '7f9c2b1e-demo' }, 202); }
  if (p.endsWith('/forecast')) return json(route, { farmId: 1, zoneId: null, zoneName: null, days: D.forecastDays, source: 'Open-Meteo', message: null });
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
  if (process.env.DEBUG) console.log('supa', req.method(), table, url.search);
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  let rows = [];
  if (table === 'ai_recommendation') rows = Object.entries(D.insights).flatMap(([z, list]) => list.map((i) => ({ zone_id: +z, insight_type: i.insightType, severity: i.severity, message: i.message, valid_for: D.sastDay() })));
  else if (table === 'alert') rows = [D.criticalAlert];
  else if (table === 'zone') rows = D.zones;
  else if (table === 'profile') rows = [{ id: D.FARMER_ID, name: 'Smallholder Farmer (demo)', email: user.email, role: 'farm_user', phone: '', must_change_password: false }];
  else if (table === 'irrigation_event') rows = state.events;
  else console.log('unstubbed table', table);
  return json(route, single ? rows[0] ?? null : rows);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, colorScheme: 'light' });
await ctx.route('https://api.demo.local/**', api);
await ctx.route('https://demo.supabase.co/**', supa);
await ctx.route(/tile\.openstreetmap|basemaps|arcgis|openfreemap/, (r) => r.abort());
// The Home helper ("Drip") can decide its greeting before zones load and then
// says "All your zones look good today" regardless (DripHelper.tsx: ready is
// true while zones is still []). Switched off through the app's own preference
// rather than shown misleading.
await ctx.addInitScript(() => { try { if (!localStorage.getItem('agroflow_app_preferences')) localStorage.setItem('agroflow_app_preferences', JSON.stringify({ showRaindropHelper: false })); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

let rec = null;
const dialogs = [];
page.on('dialog', async (d) => {
  const entry = { type: d.type(), message: d.message() };
  dialogs.push(entry);
  rec?.mark('dialog', entry);
  console.log('dialog', JSON.stringify(entry));
  // Hold it the way a person would read it, then answer like they would.
  setTimeout(() => { rec?.mark('dialog-close', { accept: true }); d.accept().catch(() => {}); }, 2600);
});

const pause = (ms) => page.waitForTimeout(ms);
const byText = (t, n = 0) => page.getByText(t, { exact: true }).filter({ visible: true }).nth(n);
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const scrollBy = async (dy, steps = 12) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(28); } await pause(350); };

// ---- warm up: load once so the bundle and fonts are cached -------------------
await page.goto(`${ORIGIN}/login`); await pause(9000);
await shot('m-login');

// ---- m1: sign in -> Home ------------------------------------------------------
await page.goto(`${ORIGIN}/login`); await byText('Sign In', 1).waitFor({ timeout: 30000 }); await pause(1200);
await page.mouse.move(195, 820);
rec = await startRec(page, 'm1-signin', OUT, { width: W * DPR, height: H * DPR });
await pause(700);
await tapAt(page, rec, page.getByPlaceholder('farmer@example.com'), { label: 'email' });
await page.keyboard.type('farmer@demo.invalid', { delay: 38 });
await tapAt(page, rec, page.getByPlaceholder('Enter your password'), { label: 'password' });
await page.keyboard.type('demo-password', { delay: 30 });
await tapAt(page, rec, byText('Sign In', 1), { label: 'sign in' });
await page.getByText('Your farm at a glance.').waitFor({ timeout: 30000 });
await pause(4200);           // Home settles
await shot('m-home');
await stopRec(rec);

// ---- m2: Home -> Irrigation (all zones) -> Zone 2 -------------------------------
rec = await startRec(page, 'm2-zones', OUT, { width: W * DPR, height: H * DPR });
await pause(600);
await scrollBy(330);
await pause(1600);
await tapAt(page, rec, byText('Manage Irrigation'), { label: 'manage irrigation' });
await page.getByText('Irrigation zones').waitFor(); await pause(1800);
await shot('m-irrigation');
await scrollBy(300); await pause(1700);
await shot('m-irrigation-zone2');
await tapAt(page, rec, page.getByText('Manage Zone').filter({ visible: true }).nth(1), { label: 'manage zone 2' });
await page.getByText('Live Overview').waitFor(); await pause(2400);
await shot('m-zone2');
await stopRec(rec);

// ---- m3: understand Zone 2: readings, growth, advice, the week ahead ------------
rec = await startRec(page, 'm3-zone', OUT, { width: W * DPR, height: H * DPR });
await pause(2600);
await scrollBy(300); await pause(2600);
await shot('m-zone2-advice');
await tapAt(page, rec, page.getByLabel('The week ahead').filter({ visible: true }), { label: 'the week ahead' });
await page.getByText('Today', { exact: true }).first().waitFor(); await pause(3000);
await shot('m-forecast');
await tapAt(page, rec, page.getByLabel('Go back').filter({ visible: true }).first(), { label: 'back' });
await page.getByText('Live Overview').waitFor(); await pause(1200);
await stopRec(rec);

// ---- m4: manual run, with an invalid duration first ---------------------------
rec = await startRec(page, 'm4-manual', OUT, { width: W * DPR, height: H * DPR });
await pause(500);
const manualBtn = page.getByText('Manual', { exact: true }).filter({ visible: true }).last();
await manualBtn.scrollIntoViewIfNeeded(); await scrollBy(160); await pause(1600);
await shot('m-zone2-control');
await tapAt(page, rec, manualBtn, { label: 'manual mode' });
const input = page.getByPlaceholder('20').filter({ visible: true });
await input.waitFor({ timeout: 15000 }); await pause(1400);
await tapAt(page, rec, input, { label: 'duration' });
await page.keyboard.press('Control+A'); await page.keyboard.type('90', { delay: 120 }); await pause(700);
await tapAt(page, rec, byText('Start Manual Run'), { label: 'start (invalid)' });
await pause(3200);
await tapAt(page, rec, input, { label: 'duration' });
await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.type('5', { delay: 120 }); await pause(700);
await tapAt(page, rec, byText('Start Manual Run'), { label: 'start' });
await page.getByText('Send Stop Command').waitFor({ timeout: 15000 }); await pause(2600);
await shot('m-zone2-sent');
await stopRec(rec);

// ---- m5: later - the run as recorded, in History --------------------------------
state.events = [{ ...D.storyEvent, started_at: new Date().toISOString() }, ...D.baseEvents];
state.storyRunRecorded = true;
await page.goto(`${ORIGIN}/history`);
await page.getByText('Recent activity').waitFor({ timeout: 30000 }); await pause(2500);
rec = await startRec(page, 'm5-history', OUT, { width: W * DPR, height: H * DPR });
await pause(3200);
await shot('m-history');
await tapAt(page, rec, byText('Alerts & advice'), { label: 'alerts & advice' });
await pause(3000);
await shot('m-history-alerts');
await stopRec(rec);

writeFileSync(`${OUT}mobile-dialogs.json`, JSON.stringify({ dialogs, commands }, null, 2));
console.log('commands sent', JSON.stringify(commands));
await browser.close();
