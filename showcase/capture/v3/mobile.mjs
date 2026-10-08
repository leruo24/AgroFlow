// Captures the REAL AgroFlow farmer app (apps/mobile on Expo web, unmodified)
// for the v3 walkthrough. Network calls are answered with the illustrative
// data in demo.mjs. Stills -> ../../assets/v3/m-*.png, clips -> ../../assets/v3/*.mp4
//
// Usage: Expo web on :8098 started with
//   EXPO_PUBLIC_SUPABASE_URL=https://demo.supabase.co
//   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=demo-key
//   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.demo.local
// then: node v3/mobile.mjs [probe]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import * as D from './demo.mjs';
import { startRec, stopRec, tapAt } from '../recorder.mjs';

const OUT = new URL('../../assets/v3/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:8098';
const W = 390, H = 844, DPR = 2;
const PROBE = process.argv[2] === 'probe';

const state = { today: D.todayBefore, forecast: 'A', events: [...D.baseEvents], logged: [] };

const user = { id: D.FARMER_ID, email: 'farmer@demo.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: D.ago(90000) };
const exp = Math.floor(D.NOW / 1000) + 6 * 3600;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: D.FARMER_ID, exp, role: 'authenticated' })}.demo`, refresh_token: 'demo', expires_at: exp, expires_in: 6 * 3600, token_type: 'bearer', user };

const dashboard = () => ({
  profile: { id: D.FARMER_ID, name: 'Smallholder Farmer (demo)', email: user.email, role: 'farm_user', phone: '' },
  farms: D.farms, farm: D.farms[0], zones: D.zones, readings: D.readings, events: state.events,
  usage: state.logged.length ? [{ zone_id: 11, used_today_litres: 1500 }] : [],
  weather: [{ weather_conditions: 'Partly cloudy', recorded_at: D.ago(90) }],
  alerts: [],
});

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });
const unstubbed = new Set();

async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const url = new URL(req.url()); const p = url.pathname; let m;
  if (p === '/api/farmer/dashboard') return json(route, dashboard());
  if (p === '/api/farmer/weather/current') return json(route, D.currentWeather);
  if ((m = p.match(/farms\/(\d+)\/today$/))) return json(route, { farmId: 1, day: D.sastDay(), zones: state.today });
  if ((m = p.match(/zones\/(\d+)\/insights$/))) {
    const z = +m[1]; const t = state.today.find((x) => x.zoneId === z);
    const list = z === 11 && state.logged.length ? [] : (D.insights[z] ?? []);
    return json(route, { zoneId: z, day: D.sastDay(), insights: list, growth: D.growth[z] ?? null, confidence: t?.confidence ?? null, nextStep: t?.nextStep ?? null, stageAssumed: false, confidenceExplanation: t?.confidenceExplanation ?? null });
  }
  if ((m = p.match(/zones\/(\d+)\/hardware$/))) { const k = { 11: 'A4CF12B7E901', 12: 'A4CF12B7E9C4', 13: 'A4CF12B7EA38' }[m[1]];
    return json(route, { hardwareId: 100 + +m[1], deviceId: k, deviceName: 'Irrigation node', online: true, lastSeen: D.ago(1), firmwareVersion: '1.4.0', soilSensorWorking: true, soilLastReadingAt: D.ago(1), temperatureSensorWorking: true, temperatureLastReadingAt: D.ago(1), humiditySensorWorking: true, humidityLastReadingAt: D.ago(1), tokenStatus: 'active', setupNetworkName: null, setupNetworkPassword: null }); }
  if ((m = p.match(/zones\/(\d+)\/manual-watering$/)) && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}'); state.logged.push(body);
    return json(route, { id: 403, message: 'Watering logged. Today\'s advice now counts it.' });
  }
  if ((m = p.match(/zones\/(\d+)\/soil-feel$/)) && req.method() === 'POST') return json(route, { id: 77, message: 'Soil check saved. Today\'s advice now counts it.' });
  if ((m = p.match(/zones\/(\d+)\/commands$/)) && req.method() === 'POST') return json(route, { id: '7f9c2b1e-demo' }, 202);
  if (p.endsWith('/forecast')) { const z = url.searchParams.get('zoneId');
    return json(route, { farmId: 1, zoneId: z ? +z : null, zoneName: z ? D.zones.find((x) => x.id === +z)?.name : null, days: z ? D.forecast(state.forecast) : D.forecast(state.forecast).map((d) => ({ ...d, advice: null })), source: 'Forecast from the weather app (Open-Meteo)', message: null }); }
  if (p.endsWith('/telegram/me')) return json(route, { linked: true, alertsEnabled: true });
  if (p.startsWith('/api/farmer/dismissals')) return json(route, []);
  if (p.endsWith('/report-requests') || p.endsWith('/requests')) return json(route, []);
  if (p.endsWith('/auto-reports')) return json(route, { enabled: false, farms: [] });
  if (p.includes('recommended-settings')) return json(route, null);
  if (p.endsWith('/settings') && req.method() === 'PUT') return json(route, { ok: true });
  unstubbed.add(`api ${req.method()} ${p}`);
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
  if (table === 'ai_recommendation') rows = Object.entries(D.insights).flatMap(([z, list]) => (+z === 11 && state.logged.length ? [] : list).map((i) => ({ zone_id: +z, insight_type: i.insightType, severity: i.severity, message: i.message, valid_for: D.sastDay(), data: { explanation: i.explanation } })));
  else if (table === 'alert') rows = [];
  else if (table === 'explanation') rows = [];
  else if (table === 'zone') rows = D.zones;
  else if (table === 'profile') rows = [{ id: D.FARMER_ID, name: 'Smallholder Farmer (demo)', email: user.email, role: 'farm_user', phone: '', must_change_password: false }];
  else if (table === 'irrigation_event') rows = state.events;
  else unstubbed.add(`table ${table}`);
  return json(route, single ? rows[0] ?? null : rows);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, colorScheme: 'light' });
await ctx.route('https://api.demo.local/**', api);
await ctx.route('https://demo.supabase.co/**', supa);
// map tiles load from their public servers
// Drip (the Home helper) is switched off through the app's own preference so
// the Today cards are the focus; it repeats the same advice.
await ctx.addInitScript(() => { try { if (!localStorage.getItem('agroflow_app_preferences')) localStorage.setItem('agroflow_app_preferences', JSON.stringify({ showRaindropHelper: false })); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const pause = (ms) => page.waitForTimeout(ms);
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });
const scrollBy = async (dy, steps = 12) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(28); } await pause(400); };
const vis = (loc) => loc.filter({ visible: true }).first();

await page.goto(`${ORIGIN}/login`); await pause(8000);
await page.evaluate((v) => localStorage.setItem('sb-demo-auth-token', v), JSON.stringify(session));

if (process.argv[2] === 'kit') {
  state.today = D.todayKitOffline;
  await page.goto(`${ORIGIN}/`); await page.getByText('Check the kit: it has stopped sending readings').first().waitFor({ timeout: 30000 }); await pause(2000);
  for (const [id, name] of [['today-12', 'm-card-kit'], ['today-11', 'm-card-tomato']]) {
    // Centred, so the floating tab bar is not over the card.
    await page.getByTestId(id).evaluate((el) => el.scrollIntoView({ block: 'center' })); await pause(1200);
    await page.getByTestId(id).screenshot({ path: `${OUT}${name}.png` });
  }
  await browser.close(); process.exit(0);
}
if (PROBE) {
  await page.goto(`${ORIGIN}/`); await pause(9000);
  await shot('probe-home', { fullPage: true });
  console.log('texts:', (await page.locator('body').innerText()).slice(0, 2500));
  console.log('unstubbed', [...unstubbed]);
  await browser.close(); process.exit(0);
}

// ---- 1. Home: Today cards ------------------------------------------------------
await page.goto(`${ORIGIN}/`);
await page.getByText('Water about 70 min this morning (about 1750 L)').first().waitFor({ timeout: 30000 });
await pause(2500);
await shot('m-home');
await shot('m-home-full', { fullPage: true });

// ---- 2. Why am I seeing this? (Tomato field) -----------------------------------
let rec = await startRec(page, 'mv-why', OUT, { width: W * DPR, height: H * DPR });
await pause(1200);
const card = page.getByTestId('today-11');
await card.scrollIntoViewIfNeeded(); await pause(900);
await tapAt(page, rec, vis(card.getByText('Why am I seeing this?')), { label: 'why' });
await pause(2400);
await shot('m-why-top');
await scrollBy(420); await pause(1800);
await shot('m-why-facts');
await scrollBy(520); await pause(1800);
await shot('m-why-rule');
await stopRec(rec);
await page.keyboard.press('Escape'); await pause(800);
await page.goto(`${ORIGIN}/`); await page.getByText('Water about 70 min this morning (about 1750 L)').first().waitFor(); await pause(2000);

// ---- 3. Farmer decides: I watered -> 1500 L ------------------------------------
rec = await startRec(page, 'mv-watered', OUT, { width: W * DPR, height: H * DPR });
await pause(1000);
await tapAt(page, rec, vis(page.getByTestId('today-11').getByText('I watered')), { label: 'I watered' });
await pause(1800);
await shot('m-watered-sheet');
const litres = vis(page.getByLabel('Litres watered'));
await tapAt(page, rec, litres, { label: 'litres' });
await page.keyboard.type('1500', { delay: 160 }); await pause(800);
state.today = D.todayAfter; state.events = [D.loggedEvent, ...D.baseEvents];
await tapAt(page, rec, vis(page.getByLabel('Save litres watered')), { label: 'save' });
await page.getByText("Watering logged. Today's advice now counts it.").first().waitFor({ timeout: 15000 });
await pause(2200);
await shot('m-watered-saved');
await stopRec(rec);
await page.keyboard.press('Escape'); await pause(600);
await page.goto(`${ORIGIN}/`); await page.getByText('No watering needed today').first().waitFor({ timeout: 30000 }); await pause(2200);
await shot('m-home-after');

// ---- 4. Soil feel (the farmer's own check) --------------------------------------
await tapAt(page, { mark() {} }, vis(page.getByTestId('today-11').getByText('How does the soil feel?')), {});
await pause(1800);
await shot('m-feel-sheet');
await page.keyboard.press('Escape'); await pause(600);

// ---- 5. Maize block: Finish setup (flow rate missing) -------------------------
state.today = D.todayBefore; state.events = [...D.baseEvents]; state.logged = [];
await page.goto(`${ORIGIN}/`); await page.getByText('Water about 900 L this morning').first().waitFor(); await pause(1500);
await page.getByTestId('today-13').scrollIntoViewIfNeeded(); await pause(1200);
await page.getByTestId('today-13').screenshot({ path: `${OUT}m-card-maize.png` });
await shot('m-home-maize');
await vis(page.getByTestId('today-13').getByText('Finish setup')).click();
await pause(5000);
await shot('m-finish-setup');
{ const fr = page.getByText('Flow rate', { exact: true }).filter({ visible: true }).first();
  await fr.scrollIntoViewIfNeeded().catch(() => {}); await scrollBy(250); await pause(1500); await shot('m-finish-flow'); }

// ---- 6. The week ahead: forecast A, then forecast B ---------------------------
await page.goto(`${ORIGIN}/forecast?zoneId=11&zoneName=Tomato%20field`);
await page.getByText('The week ahead').first().waitFor({ timeout: 30000 }); await pause(2500);
await shot('m-week-A');
await shot('m-week-A-full', { fullPage: true });
state.forecast = 'B';
await page.goto(`${ORIGIN}/forecast?zoneId=11&zoneName=Tomato%20field`);
await page.getByText('22 mm rain').first().waitFor({ timeout: 30000 }); await pause(2500);
await shot('m-week-B');
await shot('m-week-B-full', { fullPage: true });

// ---- 7. Zone page --------------------------------------------------------------
state.forecast = 'A'; state.today = D.todayBefore; state.events = [...D.baseEvents]; state.logged = [];
await page.goto(`${ORIGIN}/zone/11`); await pause(7000);
await shot('m-zone');
await shot('m-zone-full', { fullPage: true });

await scrollBy(700); await pause(1500); await shot('m-zone-2');
await scrollBy(700); await pause(1500); await shot('m-zone-3');

// ---- 8. Irrigation tab: every zone -------------------------------------------
await page.goto(`${ORIGIN}/irrigation`); await pause(7000);
await shot('m-irrigation');

// ---- 9. A run from the app: invalid duration first, then 5 min -----------------
const dialogs = [];
let mrec = null;
page.on('dialog', async (d) => {
  dialogs.push({ type: d.type(), message: d.message() });
  mrec?.mark('dialog', { message: d.message() });
  setTimeout(() => { mrec?.mark('dialog-close', {}); d.accept().catch(() => {}); }, 2600);
});
await page.goto(`${ORIGIN}/zone/11`); await page.getByText('Live Overview').waitFor({ timeout: 30000 }); await pause(2500);
const manualBtn = page.getByText('Manual', { exact: true }).filter({ visible: true }).last();
await manualBtn.scrollIntoViewIfNeeded(); await pause(800);
await manualBtn.click(); await pause(2500);
const startBtn = vis(page.getByText('Start Manual Run', { exact: true }));
await startBtn.scrollIntoViewIfNeeded(); await scrollBy(200); await pause(1200);
await shot('m-run-control');
mrec = await startRec(page, 'mv-run', OUT, { width: W * DPR, height: H * DPR });
await pause(900);
const dur = vis(page.getByPlaceholder('20'));
await tapAt(page, mrec, dur, { label: 'duration' });
await page.keyboard.press('Control+A'); await page.keyboard.type('90', { delay: 140 }); await pause(700);
await tapAt(page, mrec, startBtn, { label: 'start (invalid)' });
await pause(3400);
await tapAt(page, mrec, dur, { label: 'duration' });
await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.type('5', { delay: 140 }); await pause(700);
await tapAt(page, mrec, startBtn, { label: 'start' });
await pause(4200);
await shot('m-run-sent');
await stopRec(mrec);
console.log('dialogs', JSON.stringify(dialogs));

// ---- 10. History: what actually happened -----------------------------------------
state.events = [{ id: 404, zone_id: 11, started_at: D.ago(0), runtime_seconds: 300, estimated_litres: 125, trigger_source: 'manual' }, D.loggedEvent, ...D.baseEvents];
await page.goto(`${ORIGIN}/history`); await pause(7000);
await shot('m-history');

console.log('unstubbed', [...unstubbed]);
await browser.close();
