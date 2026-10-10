// v4 capture: the REAL farmer app (apps/mobile, unmodified, Expo web on :8098 with demo-only
// hosts) for the persona Thabo. Every backend call is answered here; every advice sentence and
// number comes from AgroFlow's own engine run on the demo inputs (../engine/*.json, made by
// ../engine/Program.cs.txt). No real people, numbers, emails, passwords or codes.
// Writes ../raw/m-*.png.   Usage: node mobile.mjs [login|setup|daily|rain|run|reports]
import { chromium } from '/home/user/AgroFlow/showcase/capture/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const OUT = new URL('../raw/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:8098';
const W = 390, H = 844, DPR = 2;
const MODE = process.argv[2] || 'daily';
const eng = (f) => JSON.parse(readFileSync(new URL(`../engine/${f}.json`, import.meta.url)));
const E = { S: eng('scenario-S-setup-incomplete'), S2: eng('scenario-S2-flow-set'), A: eng('scenario-A-dry'), B: eng('scenario-B-rain-sunday') };

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const sastDay = (d = 0) => new Date(NOW + 2 * 3600000 + d * 86400000).toISOString().slice(0, 10);
const weekday = (d) => new Date(NOW + d * 86400000).toLocaleDateString('en-ZA', { weekday: 'short', timeZone: 'Africa/Johannesburg' });
const THABO = '00000000-0000-4000-8000-0000000000f9';
const ZID = [71, 72];

// ---- state the flow changes -------------------------------------------------------
const S = { mustChange: MODE === 'login', scen: MODE === 'setup' ? 'S' : MODE === 'rain' ? 'B' : 'A', flow: MODE !== 'setup', cal: MODE !== 'setup', events: [], requests: [] };
const setupFacts = () => ({ crop: true, plantingDate: true, soil: true, area: true, flowRate: S.flow, calibrated: S.cal, hasKit: true });
const today = () => E[S.scen].map((z, i) => ({ zoneId: ZID[i], name: z.zone, action: { kind: z.kind, text: z.today }, why: z.why,
  confidence: { level: z.confidenceLevel, reason: z.confidence }, confidenceExplanation: z.confidenceWhy,
  nextStep: z.nextStep ? { field: S.flow ? 'calibration' : 'flow_rate', ask: z.nextStep } : null, setup: setupFacts() }));

const farm = { farm_id: 7, owner_id: THABO, owner_name: 'Thabo (demo)', name: "Thabo's Farm (demo)", location: 'Mafikeng, North West', latitude: -25.85, longitude: 25.64, total_area: 0.02, status: 'Active' };
const zoneBase = { farm_id: 7, crop_type: 'tomato', soil_type: 'loam', weather_adjustment: true, size_unit: 'm2', size_value: 20, area_m2: 20, schedule_days: [], schedule_start_time: '06:00', schedule_duration_minutes: 15, schedule_enabled: false, status: 'Active', irrigation_mode: 'manual', moisture_threshold: 35, desired_moisture: 60, health_status: 'Healthy' };
const zones = () => [
  { ...zoneBase, id: 71, name: 'Zone 1', location: 'Field, north half', planting_date: sastDay(-62), flow_rate_lpm: S.flow ? 15 : null, calibration_wet: S.cal ? 1200 : null, calibration_dry: S.cal ? 3000 : null },
  { ...zoneBase, id: 72, name: 'Zone 2', location: 'Field, south half', planting_date: sastDay(-34), flow_rate_lpm: S.flow ? 15 : null, calibration_wet: S.cal ? 1200 : null, calibration_dry: S.cal ? 3000 : null },
];
const readings = [
  { zone_id: 71, moisture: 2300, temperature: 31, humidity: 22, last_reading_at: ago(1) },
  { zone_id: 72, moisture: 2000, temperature: 31, humidity: 22, last_reading_at: ago(1) },
];
const baseEvents = [
  { id: 512, zone_id: 72, started_at: ago(60 * 24 + 90), runtime_seconds: 2000, estimated_litres: 500, trigger_source: 'manual' },
  { id: 511, zone_id: 71, started_at: ago(60 * 24 * 4 + 90), runtime_seconds: 2400, estimated_litres: 600, trigger_source: 'manual' },
];
S.events = [...baseEvents];
const growth = (z) => ({ stage: z.stage, dayOfSeason: z.day, totalDays: z.total, cropLabel: 'Tomato' });

// The forecast the engine was given (Program.cs.txt): dry and hot; B adds 24 mm then 6 mm.
const forecastDays = (zoneIdx) => {
  const z = E[S.scen][zoneIdx ?? 0];
  return Array.from({ length: 7 }, (_, i) => {
    let rain = 0, max = 31, hum = 38, icon = 'sun';
    if (S.scen === 'B' && i === 1) { rain = 24; max = 22; hum = 84; icon = 'rain'; }
    if (S.scen === 'B' && i === 2) { rain = 6; max = 24; hum = 74; icon = 'rain'; }
    return { date: sastDay(i), weekday: weekday(i), minC: 15, maxC: max, rainMm: rain, humidityPercent: hum, icon, advice: zoneIdx == null ? null : z.outlook[i]?.advice ?? null };
  });
};

const user = { id: THABO, email: 'thabo@demo.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: ago(60) };
const exp = Math.floor(NOW / 1000) + 6 * 3600;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: THABO, exp, role: 'authenticated' })}.demo`, refresh_token: 'demo', expires_at: exp, expires_in: 6 * 3600, token_type: 'bearer', user };

const dashboard = () => ({
  profile: { id: THABO, name: 'Thabo (demo)', email: user.email, role: 'farm_user', phone: '' },
  farms: [farm], farm, zones: zones(), readings, events: S.events, usage: [],
  weather: [{ weather_conditions: 'Clear', recorded_at: ago(90) }], alerts: [],
});

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });
const unstubbed = new Set();
const posts = [];

async function api(route) {
  const req = route.request(); const m = req.method();
  if (m === 'OPTIONS') return json(route, undefined, 204);
  const url = new URL(req.url()); const p = url.pathname; let mm;
  if (m !== 'GET') posts.push(`${m} ${p} ${req.postData() ?? ''}`);
  if (p === '/api/farmer/dashboard') return json(route, dashboard());
  if (p === '/api/farmer/password-changed') { S.mustChange = false; return json(route, {}); }
  if (p === '/api/farmer/weather/current') return json(route, { current: { time: ago(10).slice(0, 16), temperature_2m: 29, apparent_temperature: 29, relative_humidity_2m: 24, weather_code: 0, wind_speed_10m: 11 }, daily: { precipitation_probability_max: [S.scen === 'B' ? 20 : 0] } });
  if ((mm = p.match(/farms\/(\d+)\/today$/))) return json(route, { farmId: 7, day: sastDay(), zones: today() });
  if ((mm = p.match(/zones\/(\d+)\/insights$/))) {
    const i = ZID.indexOf(+mm[1]); const z = E[S.scen][i]; const t = today()[i];
    return json(route, { zoneId: +mm[1], day: sastDay(), insights: z?.insights ?? [], growth: z ? growth(z) : null, confidence: t?.confidence ?? null, nextStep: t?.nextStep ?? null, stageAssumed: false, confidenceExplanation: t?.confidenceExplanation ?? null });
  }
  if ((mm = p.match(/zones\/(\d+)\/hardware$/))) return json(route, { hardwareId: 100 + +mm[1], deviceId: `DEMO000000${mm[1]}`, deviceName: `${mm[1] === '71' ? 'Zone 1' : 'Zone 2'} controller`, online: true, lastSeen: ago(1), firmwareVersion: '1.4.0', soilSensorWorking: true, soilLastReadingAt: ago(1), temperatureSensorWorking: true, temperatureLastReadingAt: ago(1), humiditySensorWorking: true, humidityLastReadingAt: ago(1), tokenStatus: 'active', setupNetworkName: null, setupNetworkPassword: null });
  if ((mm = p.match(/zones\/(\d+)\/setup$/))) {
    const b = JSON.parse(req.postData() || '{}'); if (b.flowRateLpm) { S.flow = true; S.scen = 'S2'; }
    return json(route, { message: "Saved. Today's advice now uses it." });
  }
  if ((mm = p.match(/zones\/(\d+)\/calibration$/))) {
    const b = JSON.parse(req.postData() || '{}');
    if (b.point === 'dry') { S.cal = true; S.scen = 'A'; }
    return json(route, { message: b.point === 'wet' ? 'Wet setting saved.' : 'Dry setting saved.', reading: b.point === 'wet' ? 1200 : 3000 });
  }
  if (p.includes('recommended-settings')) return json(route, { available: false, text: '' });
  if ((mm = p.match(/zones\/(\d+)\/commands$/)) && m === 'POST') return json(route, { id: '7f9c2b1e-demo' }, 202);
  if (p.endsWith('/forecast')) { const z = url.searchParams.get('zoneId'); const i = z ? ZID.indexOf(+z) : null;
    return json(route, { farmId: 7, zoneId: z ? +z : null, zoneName: z ? `Zone ${i + 1}` : null, days: forecastDays(i), source: 'Forecast from the weather app (Open-Meteo)', message: null }); }
  if (p.endsWith('/telegram/me')) return json(route, { linked: true, alertsEnabled: true });
  if (p.startsWith('/api/farmer/dismissals')) return json(route, []);
  if (p === '/api/farmer/report-requests' && m === 'GET') return json(route, S.requests);
  if (p === '/api/farmer/report-requests' && m === 'POST') {
    S.requests = [{ id: 88, reportType: 'water_usage', reportTypeLabel: 'Water usage', zoneId: null, zoneName: null, periodStart: sastDay(-6), periodEnd: sastDay(), periodLabel: '4 Oct – 10 Oct 2026', status: 'ready', statusLabel: 'Ready', filePath: '/api/farmer/report-requests/88/pdf', requestedVia: 'app', createdAt: ago(0), completedAt: ago(0) }];
    return json(route, { id: 88, message: 'Your report is being prepared.' });
  }
  if (p.endsWith('/requests')) return json(route, []);
  if (p.endsWith('/auto-reports')) return json(route, { enabled: false, frequency: null, reportTypes: [], reportTypeLabels: [], description: '' });
  unstubbed.add(`api ${m} ${p}`);
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
  if (table === 'zone') rows = zones();
  else if (table === 'profile') rows = [{ id: THABO, name: 'Thabo (demo)', email: user.email, role: 'farm_user', phone: '', must_change_password: S.mustChange }];
  else if (table === 'irrigation_event') rows = S.events;
  else if (['ai_recommendation', 'alert', 'explanation'].includes(table)) rows = [];
  else unstubbed.add(`table ${table}`);
  return json(route, single ? rows[0] ?? null : rows);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, colorScheme: 'light' });
await ctx.route('https://api.demo.local/**', api);
await ctx.route('https://demo.supabase.co/**', supa);
await ctx.route(/tile\.openstreetmap|basemaps|arcgis|nominatim/, (r) => r.abort());
await ctx.addInitScript(() => { try { if (!localStorage.getItem('agroflow_app_preferences')) localStorage.setItem('agroflow_app_preferences', JSON.stringify({ showRaindropHelper: false })); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await page.waitForTimeout(1500); await d.accept().catch(() => {}); });
const pause = (ms) => page.waitForTimeout(ms);
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts });
const vis = (loc) => loc.filter({ visible: true }).first();
const scrollBy = async (dy, steps = 10) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(30); } await pause(500); };
const home = async (text) => { await page.goto(`${ORIGIN}/`); await page.getByText(text).first().waitFor({ timeout: 40000 }); await pause(2500); };
const body = async () => (await page.locator('body').innerText()).replace(/\n+/g, ' | ');

await page.goto(`${ORIGIN}/login`); await pause(8000);

if (MODE === 'login') {
  await shot('m-login');
  await vis(page.getByPlaceholder('farmer@example.com')).fill('thabo@demo.invalid');
  await vis(page.getByPlaceholder('Enter your password')).fill('DEMO-ONLY-0000');
  await shot('m-login-filled');
  await page.getByText('Sign In', { exact: true }).filter({ visible: true }).last().click();
  await page.getByText('Set Your Own Password').first().waitFor({ timeout: 30000 }); await pause(1500);
  await shot('m-pw-change');
  await vis(page.getByPlaceholder('At least 8 characters')).fill('short');
  await vis(page.getByPlaceholder('Enter the password again')).fill('short');
  await page.keyboard.press('Enter'); await pause(1500);
  await shot('m-pw-short');
  console.log('short:', (await body()).slice(0, 600));
  await vis(page.getByPlaceholder('At least 8 characters')).fill('demo-password-not-real');
  await vis(page.getByPlaceholder('Enter the password again')).fill('demo-password-not-real');
  await page.keyboard.press('Enter'); await pause(2500);
  await shot('m-pw-done');
  console.log('done:', (await body()).slice(0, 400));
} else {
  await page.evaluate((v) => localStorage.setItem('sb-demo-auth-token', v), JSON.stringify(session));
}

if (MODE === 'setup') {
  await home('Water about 996 L this morning');
  await shot('m-setup-home');
  await page.goto(`${ORIGIN}/zone-setup?zoneId=71`); await page.getByText('Flow rate', { exact: true }).first().waitFor({ timeout: 30000 }); await pause(2500);
  await shot('m-setup-top');
  const secs = vis(page.getByLabel('Seconds to fill the bottle'));
  await secs.scrollIntoViewIfNeeded(); await scrollBy(200); await secs.fill('2'); await pause(900);
  await shot('m-setup-flow');
  await vis(page.getByLabel('Save flow rate')).click(); await page.getByText("Saved. Today's advice now uses it.").first().waitFor({ timeout: 15000 }); await pause(2500);
  await shot('m-setup-flow-saved');
  await page.evaluate(() => window.scrollTo(0, 0)); await vis(page.getByText('Set up the sensor')).scrollIntoViewIfNeeded(); await pause(800);
  await vis(page.getByText('Set up the sensor')).click(); await pause(2000);
  await shot('m-cal-sheet');
  await vis(page.getByLabel('Save the wet soil reading')).click(); await page.getByText('Wet setting saved.').first().waitFor({ timeout: 15000 }); await pause(1200);
  await shot('m-cal-wet');
  await vis(page.getByLabel('Save the dry soil reading')).click(); await page.getByText('Dry setting saved.').first().waitFor({ timeout: 15000 }); await pause(1200);
  await shot('m-cal-dry');
  await page.keyboard.press('Escape'); await pause(1200);
  await page.goto(`${ORIGIN}/zone-setup?zoneId=71`); await page.getByText('High confidence').first().waitFor({ timeout: 30000 }); await pause(2500);
  await shot('m-setup-done');
  console.log('setup:', (await body()).slice(0, 900));
}

if (MODE === 'daily') {
  await home('Water about 66.4 min (about 996 L) this morning');
  await shot('m-home');
  await shot('m-home-full', { fullPage: true });
  for (const id of ZID) { await page.getByTestId(`today-${id}`).evaluate((el) => el.scrollIntoView({ block: 'center' })); await pause(900); await page.getByTestId(`today-${id}`).screenshot({ path: `${OUT}m-card-${id}.png` }); }
  await page.getByTestId('today-71').evaluate((el) => el.scrollIntoView({ block: 'center' })); await pause(900);
  await vis(page.getByTestId('today-71').getByText('Why am I seeing this?')).click(); await pause(2500);
  await shot('m-why-top'); await scrollBy(420); await pause(1200); await shot('m-why-facts'); await scrollBy(520); await pause(1200); await shot('m-why-rule');
  await page.keyboard.press('Escape'); await pause(800);
  for (const [i, id] of ZID.entries()) {
    await page.goto(`${ORIGIN}/forecast?zoneId=${id}&zoneName=Zone%20${i + 1}`); await page.getByText('The week ahead').first().waitFor({ timeout: 30000 }); await pause(2500);
    await shot(`m-week-A-${id}`); await shot(`m-week-A-${id}-full`, { fullPage: true });
  }
}

if (MODE === 'rain') {
  await home('No watering needed today');
  await shot('m-home-rain');
  await page.getByTestId('today-72').evaluate((el) => el.scrollIntoView({ block: 'center' })); await pause(900);
  await page.getByTestId('today-72').screenshot({ path: `${OUT}m-card-72-rain.png` });
  await page.goto(`${ORIGIN}/forecast?zoneId=72&zoneName=Zone%202`); await page.getByText('24 mm').first().waitFor({ timeout: 30000 }); await pause(2500);
  await shot('m-week-B-72'); await shot('m-week-B-72-full', { fullPage: true });
}

if (MODE === 'run') {
  await page.goto(`${ORIGIN}/zone/71`); await page.getByText('Live Overview').waitFor({ timeout: 40000 }); await pause(2500);
  await shot('m-zone');
  const manualBtn = page.getByText('Manual', { exact: true }).filter({ visible: true }).last();
  await manualBtn.scrollIntoViewIfNeeded(); await pause(600); await manualBtn.click(); await pause(2000);
  const startBtn = vis(page.getByText('Start Manual Run', { exact: true }));
  await startBtn.scrollIntoViewIfNeeded(); await scrollBy(200); await pause(1000);
  await shot('m-run-control');
  const dur = vis(page.getByPlaceholder('20'));
  await dur.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('90'); await pause(500);
  await shot('m-run-90');
  await startBtn.click(); await pause(3500);
  await dur.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.keyboard.type('5'); await pause(500);
  await shot('m-run-5');
  await startBtn.click(); await pause(5000);
  await shot('m-run-sent');
  console.log('dialogs', JSON.stringify(dialogs));
  S.events = [{ id: 513, zone_id: 71, started_at: ago(0), runtime_seconds: 300, estimated_litres: 75, trigger_source: 'manual' }, ...baseEvents];
  await page.goto(`${ORIGIN}/history`); await pause(7000);
  await shot('m-history');
}

if (MODE === 'reports') {
  await page.goto(`${ORIGIN}/reports`); await page.getByText('Your reports').first().waitFor({ timeout: 40000 }); await pause(2500);
  await shot('m-reports');
  await vis(page.getByLabel('Request this report')).click(); await pause(3000);
  await shot('m-reports-ready');
  console.log('reports:', (await body()).slice(0, 900));
}

console.log('posts', posts.join('\n'));
console.log('unstubbed', [...unstubbed]);
await browser.close();
