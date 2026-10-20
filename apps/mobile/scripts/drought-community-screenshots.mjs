// Screenshots for docs/drought-community.md at 390x844 and 1366x768: every step of the 17-step
// setup wizard, Home's drought card with zone priorities, Farmers nearby (a normal report and a
// downwind fire), "I'm seeing this too", fire updates, and the report form with the limit
// message. The real `expo export --platform web` build, served locally; Supabase and the API
// are fake hosts answered here (demo farm: Mahikeng (Simulated)). Usage (from apps/mobile):
//   EXPO_PUBLIC_SUPABASE_URL=https://testproject.supabase.co EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-anon-key \
//   EXPO_PUBLIC_AGROFLOW_API_BASE=https://api.agroflow.test npx expo export --clear --platform web --output-dir <build>
//   node scripts/drought-community-screenshots.mjs <build> <out> ../web/admin
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
await new Promise(r => server.listen(5193, r));
const BASE = 'http://localhost:5193';

const now = new Date();
const farmRow = { farm_id: 1, owner_id: FARMER, name: 'Mahikeng (Simulated)', location: 'Mahikeng, North West', total_area: 0.5, status: 'Active', latitude: -25.86522, longitude: 25.64421 };
const zoneRow = (id, name, crop, planting) => ({ id, farm_id: 1, name, location: '', crop_type: crop, planting_date: planting, irrigation_mode: 'automatic', moisture_threshold: 30, desired_moisture: 60, calibration_dry: 3900, calibration_wet: 1500, max_run_minutes: 8 });
const dashboard = () => ({
  profile: { id: FARMER, name: 'Thabo Molefe' }, farms: [farmRow], farm: farmRow,
  zones: [zoneRow(1, 'Maize', 'maize', '2026-08-26'), zoneRow(2, 'Beans', 'dry_beans', '2026-09-30'), zoneRow(3, 'Potato', 'potato', '2026-07-02')],
  readings: [1, 2, 3].map(z => ({ zone_id: z, moisture: 3000, temperature: 27, humidity: 22, last_reading_at: now.toISOString() })),
  events: [], usage: [], weather: [], alerts: [],
});
const todayZone = (zoneId, name, text) => ({ zoneId, name, action: { kind: 'water', text }, why: null, confidence: { level: 'medium', reason: 'Medium.' }, confidenceExplanation: null, nextStep: null,
  setup: { crop: true, plantingDate: true, soil: true, area: true, flowRate: true, calibrated: true, hasKit: true } });
const today = { farmId: 1, day: now.toISOString().slice(0, 10), zones: [
  todayZone(1, 'Maize', 'Water about 9 min this morning'), todayZone(2, 'Beans', 'Water about 6 min this morning'), todayZone(3, 'Potato', 'Water about 5 min this morning')] };
const farmSetup = {
  farmId: 1,
  farm: { name: farmRow.name, location: farmRow.location, latitude: farmRow.latitude, longitude: farmRow.longitude, province: 'North West', town: 'Mahikeng', waterSource: 'tank' },
  zones: [
    { zoneId: 1, name: 'Maize', crop: 'maize', plantingDate: '2026-08-26', soilType: 'loam', areaM2: 60, flowRateLpm: 6, irrigationType: 'drip', maxRunMinutes: 8 },
    { zoneId: 2, name: 'Beans', crop: 'dry_beans', plantingDate: '2026-09-30', soilType: 'sandy', areaM2: 40, flowRateLpm: 6, irrigationType: 'sprinkler', maxRunMinutes: 8 },
    { zoneId: 3, name: 'Potato', crop: 'potato', plantingDate: '2026-07-02', soilType: 'loam', areaM2: 50, flowRateLpm: 6, irrigationType: 'surface', maxRunMinutes: 8 },
  ],
  tank: { capacityLitres: 5000, estimatedRemainingLitres: 1000 },
};
const drought = {
  farmId: 1, active: true, automatic: true, override: null, since: now.toISOString(),
  reason: 'Drought mode on: tank about 20% full (drought line 25%); 2 mm of rain forecast over 7 days (less than 5 mm counts as dry); crop water use 6 mm a day forecast against 5 mm usual for this farm.',
  budget: { litresLeft: 1000, normalDays: 5, droughtDays: 8, text: 'You have about 1 000 L. At normal watering that lasts 5 days; in drought mode it lasts 8 days.' },
  summary: 'Drought mode on: water Maize fully, Beans at half, skip Potato today.',
  zones: [
    { zoneId: 1, zoneName: 'Maize', crop: 'maize', priority: 'full', fraction: 1, ky: 1.5, normalLitres: 42, droughtLitres: 42, why: 'Maize in crop development is very sensitive to a water shortfall (FAO Ky 1.50), so it keeps full water.', irrigationType: 'drip', efficiencyNote: '' },
    { zoneId: 2, zoneName: 'Beans', crop: 'dry_beans', priority: 'reduced', fraction: 0.5, ky: 0.2, normalLitres: 32, droughtLitres: 16, why: 'Beans early on lose little yield from a short dry spell (FAO Ky 0.20 at this stage), so they get half.', irrigationType: 'sprinkler', efficiencyNote: '' },
    { zoneId: 3, zoneName: 'Potato', crop: 'potato', priority: 'skip', fraction: 0, ky: 0.2, normalLitres: 25, droughtLitres: 0, why: 'Potato in late season (ripening) loses little yield from a short dry spell (FAO Ky 0.20), so it can skip today.', irrigationType: 'surface', efficiencyNote: '' },
  ],
  honesty: "Worked out from your farm's own tank estimate, soil readings and weather forecast. It is not a drought prediction or an official drought declaration.",
  source: 'FAO Irrigation and Drainage Paper 66 (Steduto et al. 2012)',
};
const UNVERIFIED = 'This is a community report and has not been independently verified.';
let confirmed = false;
let limitReached = false;
const community = () => ({
  unverified: UNVERIFIED,
  emergency: 'your local emergency number (112 from a mobile phone)',
  limit: limitReached
    ? { allowed: false, nextAllowedAt: '2026-10-21T10:00:00Z', message: 'You can add up to 2 reports every 36 hours. You can add another after Wednesday 21 October, 12:00.' }
    : { allowed: true, nextAllowedAt: null, message: 'You can add up to 2 reports every 36 hours. You have 2 left.' },
  reports: [
    { reportId: 21, category: 'fire', subtype: 'veld_fire', label: 'Veld fire', severity: 'high', distanceKm: 35, downwind: true, similarFarms: 1, confirmations: 3,
      fireState: 'spreading', createdAt: now.toISOString(), expiresAt: now.toISOString(), mine: false, confirmed: true, canUpdate: true,
      updates: ['Spreading towards the south-west (wind from the north-east, 24 km/h)'],
      message: `Veld fire (high) about 35 km from your farm. The wind may carry it towards you: this is an estimate from the wind, not a prediction. If you're in danger, leave and call your local emergency number (112 from a mobile phone). ${UNVERIFIED}` },
    { reportId: 11, category: 'pest', subtype: 'fall_armyworm', label: 'Fall armyworm', severity: 'moderate', distanceKm: 18, downwind: false, similarFarms: 0, confirmations: confirmed ? 1 : 0,
      fireState: null, createdAt: now.toISOString(), expiresAt: now.toISOString(), mine: false, confirmed, canUpdate: false, updates: [],
      message: `Fall armyworm (moderate) reported about 18 km from your farm. ${UNVERIFIED}` },
  ],
});
function apiAnswer(method, p) {
  if (p === '/api/farmer/dashboard') return dashboard();
  if (p === '/api/farmer/farms/1/today') return today;
  if (p === '/api/farmer/farms/1/setup') return farmSetup;
  if (p === '/api/farmer/farms/1/drought') return drought;
  if (p === '/api/farmer/farms/1/community') return community();
  if (p === '/api/farmer/notification-preferences') return { wateringTelegram: true, lowTankTelegram: true, droughtTelegram: true, communityTelegram: true, weatherTelegram: false, communityOptIn: true, quietStart: '21:00', quietEnd: '06:00' };
  if (p.startsWith('/api/farmer/community/reports/11/confirm')) { confirmed = true; return { confirmations: 1, message: `2 nearby farms have reported similar activity. ${UNVERIFIED}` }; }
  if (p === '/api/telegram/me') return { linked: true, alertsEnabled: true };
  if (p.startsWith('/api/farmer/weather/current')) return { current: { temperature_2m: 31, weather_code: 0 }, daily: { precipitation_probability_max: [5] } };
  if (p.startsWith('/api/farmer/farms/1/tank')) return { farmId: 1, capacityLitres: 5000, estimatedRemainingLitres: 1000 };
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
      user: { id, aud: 'authenticated', role: 'authenticated', email: 'thabo@example.org', app_metadata: {}, user_metadata: { name: 'Thabo Molefe' }, created_at: new Date().toISOString() },
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
    return route.abort();   // map tiles too: the map box shows its own fallback
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return page;
}

const settle = page => page.waitForTimeout(2200);
const shot = (page, tag, name) => page.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });

const STEPS = [
  ['you', 1, 'welcome', 'Welcome to AgroFlow'], ['you', 2, 'password', 'Set your own password'], ['you', 3, 'telegram', 'Link Telegram'],
  ['farm', 4, 'location', 'Is this your farm?'], ['farm', 5, 'water', 'Where does your water come from?'], ['farm', 6, 'tank', 'Your tank'],
  ['zones', 7, 'crop', 'Your zones'], ['zones', 8, 'irrigation', 'How is Maize watered?'], ['zones', 9, 'soilType', 'What is the soil like in Maize?'],
  ['zones', 10, 'size', 'How big is Maize?'], ['zones', 11, 'flow', 'Measure your water flow'], ['zones', 12, 'soil', 'Teach AgroFlow your soil'],
  ['zones', 13, 'maxRun', 'Longest watering at a time'],
  ['alerts', 14, 'alerts', 'Which alerts do you want?'], ['alerts', 15, 'community', 'Alerts from farmers nearby'], ['alerts', 16, 'help', 'Help while you learn'],
  ['alerts', 17, 'done', 'All set'],
];

for (const [tag, viewport] of [['390', { width: 390, height: 844 }], ['1366', { width: 1366, height: 768 }]]) {
  confirmed = false; limitReached = false;
  const page = await newPage(viewport);
  for (const [section, n, step, text] of STEPS) {
    await page.goto(`${BASE}/setup?step=${step}`);
    await page.getByText(text).first().waitFor({ timeout: 30000 }).catch(() => undefined);
    await settle(page);
    await shot(page, tag, `wizard-${section}-${String(n).padStart(2, '0')}-${step}`);
  }
  // Home: the drought card with the zone priorities.
  await page.goto(BASE + '/');
  await page.getByTestId('drought-card').first().waitFor({ timeout: 30000 });
  await settle(page);
  await page.getByTestId('drought-card').first().scrollIntoViewIfNeeded();
  await shot(page, tag, 'home-drought-card');
  // Farmers nearby: a downwind fire first, then a normal report.
  await page.goto(BASE + '/community');
  await page.getByTestId('community-report-21').first().waitFor({ timeout: 30000 });
  await settle(page);
  await shot(page, tag, 'community-alerts-downwind-fire');
  await page.getByTestId('community-fire-dir-SW-21').first().click();
  await page.getByTestId('community-fire-spreading-21').first().scrollIntoViewIfNeeded();
  await shot(page, tag, 'community-fire-updates');
  await page.getByTestId('community-report-11').first().scrollIntoViewIfNeeded();
  await shot(page, tag, 'community-alert-normal');
  await page.getByTestId('community-confirm-11').first().click();
  await page.getByTestId('community-notice').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  await page.getByTestId('community-notice').first().scrollIntoViewIfNeeded();
  await shot(page, tag, 'community-seeing-this-too');
  // The report form: what, which kind, how serious; the limit shown before starting.
  await page.getByTestId('community-add').first().click();
  await page.getByTestId('community-cat-fire').first().click();
  await page.getByTestId('community-sub-veld_fire').first().click();
  await page.getByTestId('community-sev-high').first().click();
  await page.getByTestId('community-form').first().scrollIntoViewIfNeeded();
  await shot(page, tag, 'community-report-form');
  // At the limit.
  limitReached = true;
  await page.goto(BASE + '/community');
  await page.getByTestId('community-add').first().waitFor({ timeout: 30000 });
  await settle(page);
  await page.getByTestId('community-add').first().click();
  await page.getByTestId('community-form-limit').first().waitFor({ timeout: 10000 });
  await shot(page, tag, 'community-report-limit');
  await page.context().close();
  console.log('done', tag);
}
console.log(JSON.stringify({ pageErrors: errors }));
await browser.close();
server.close();
