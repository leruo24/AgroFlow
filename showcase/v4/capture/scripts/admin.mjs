// v4 capture: the REAL admin console (apps/web/admin, unmodified, Vite on :5173 with demo-only
// hosts). Every backend call is answered here with illustrative demo data for the personas
// Thabo (farmer) and Naledi (field officer, signed in). Fixture shapes follow the admin's own
// Playwright fixtures (apps/web/admin/tests/enquiries.spec.ts, mockBackend.ts).
// No real people, numbers, emails, passwords or codes: every value is an obvious fake.
// Writes ../raw/a-*.png.   Usage: node admin.mjs [step]
import { chromium } from '/home/user/AgroFlow/showcase/capture/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const OUT = new URL('../raw/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
const W = 1440, H = 810, DPR = 2;
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const day = (d = 0) => new Date(NOW + 2 * 3600000 + d * 86400000).toISOString().slice(0, 10);
const ENG = JSON.parse(readFileSync(new URL('../engine/scenario-A-dry.json', import.meta.url)));

const ADMIN_ID = '00000000-0000-4000-8000-00000000a0a1';
const THABO_ID = '00000000-0000-4000-8000-0000000000f9';
const NALEDI = 'Naledi Demo';

// ---- state that the flow changes ----------------------------------------------
const MODE = process.argv[2] || 'enquiry';
const S = MODE === 'enquiry' ? { claimed: false, outcome: null, onboarded: false, calls: [], kitOnline: false }
  : { claimed: true, outcome: 'wants', onboarded: true, calls: [], kitOnline: MODE === 'pages' };

const enquiryBase = {
  email: null, province: 'North West', farmSizeHa: null, cropsOther: null, notes: null,
  handledBy: null, handledByName: null, claimedAt: null, callbackAt: null, noAnswerCount: 0, outcome: null,
  reason: null, reasonOther: null, farmerProfileId: null, anonymisedAt: null, firstCalledAt: null, closedAt: null, callCount: 0,
};
const enquiries = () => [
  { ...enquiryBase, id: 41, fullName: 'Thabo (demo)', phone: '000 000 0000', town: 'Mafikeng', crops: ['tomato'], bestTime: 'morning', createdAt: ago(55),
    status: S.onboarded ? 'won' : S.claimed ? 'open' : 'new',
    ...(S.claimed ? { handledBy: ADMIN_ID, handledByName: NALEDI, claimedAt: ago(20) } : {}),
    ...(S.outcome ? { outcome: S.outcome, callCount: 1, firstCalledAt: ago(10) } : {}),
    ...(S.onboarded ? { farmerProfileId: THABO_ID, closedAt: ago(1) } : {}) },
  { ...enquiryBase, id: 40, fullName: 'Demo Farmer K', phone: '000 000 0001', town: 'Lichtenburg', crops: ['maize'], bestTime: 'afternoon', createdAt: ago(60 * 26),
    status: 'open', handledBy: ADMIN_ID, handledByName: NALEDI, claimedAt: ago(60 * 25), outcome: 'callback', callbackAt: new Date(NOW + 86400000).toISOString(), callCount: 1, firstCalledAt: ago(60 * 25) },
  { ...enquiryBase, id: 39, fullName: 'Demo Farmer L', phone: '000 000 0002', town: 'Zeerust', crops: ['potato'], bestTime: 'morning', createdAt: ago(60 * 50),
    status: 'open', noAnswerCount: 1, callCount: 1, handledBy: ADMIN_ID, handledByName: NALEDI, claimedAt: ago(60 * 49), firstCalledAt: ago(60 * 49) },
];

const people = () => [
  ...(S.onboarded ? [{ id: THABO_ID, name: 'Thabo (demo)', email: 'thabo@demo.invalid', role: 'farm_user', farm_id: 7, farm_name: "Thabo's Farm (demo)", telegram_linked: true }] : []),
  { id: '00000000-0000-4000-8000-0000000000f2', name: 'Demo Farmer B', email: 'farmer.b@demo.invalid', role: 'farm_user', farm_id: 2, farm_name: 'Riverside (demo)', telegram_linked: true },
  { id: '00000000-0000-4000-8000-0000000000f3', name: 'Demo Farmer C', email: 'farmer.c@demo.invalid', role: 'farm_user', farm_id: 3, farm_name: 'Hilltop (demo)', telegram_linked: false },
  { id: ADMIN_ID, name: NALEDI, email: 'naledi@demo.invalid', role: 'admin', farm_id: null, farm_name: null, telegram_linked: true },
].map((u) => ({ phone: null, created_at: ago(60 * 24 * 60), telegram_alerts_enabled: u.telegram_linked, ...u }));

const farms = () => [
  ...(S.onboarded ? [{ farm_id: 7, owner_id: THABO_ID, owner_name: 'Thabo (demo)', name: "Thabo's Farm (demo)", location: 'Mafikeng, North West', latitude: -25.85, longitude: 25.64, total_area: 0.02, status: 'Active' }] : []),
  { farm_id: 2, owner_id: '00000000-0000-4000-8000-0000000000f2', owner_name: 'Demo Farmer B', name: 'Riverside (demo)', location: 'Zeerust, North West', latitude: -25.54, longitude: 26.08, total_area: 0.6, status: 'Active' },
  { farm_id: 3, owner_id: '00000000-0000-4000-8000-0000000000f3', owner_name: 'Demo Farmer C', name: 'Hilltop (demo)', location: 'Lichtenburg, North West', latitude: -26.15, longitude: 26.16, total_area: 1.1, status: 'Active' },
];
const zones = () => [
  ...(S.onboarded ? [
    { id: 71, farm_id: 7, name: 'Zone 1', crop_type: 'tomato', planting_date: day(-62), area_m2: 20, flow_rate_lpm: 15, status: 'Active', soil_type: 'loam' },
    { id: 72, farm_id: 7, name: 'Zone 2', crop_type: 'tomato', planting_date: day(-34), area_m2: 20, flow_rate_lpm: 15, status: 'Active', soil_type: 'loam' }] : []),
  { id: 21, farm_id: 2, name: 'Bean rows', crop_type: 'dry_beans', planting_date: day(-30), area_m2: 40, flow_rate_lpm: 18, status: 'Active' },
  { id: 31, farm_id: 3, name: 'Potato field', crop_type: 'potato', planting_date: day(-20), area_m2: 80, flow_rate_lpm: 30, status: 'Active' },
];
const kitRows = () => [
  ...(S.kitOnline ? [{ hardware_id: 171, zone_id: 71, deviceId: 'DEMO00000071', online: true, mins: 1 }] : []),
  { hardware_id: 121, zone_id: 21, deviceId: 'DEMO00000021', online: true, mins: 1 },
  { hardware_id: 131, zone_id: 31, deviceId: 'DEMO00000031', online: false, mins: 60 * 26 },
].map((k) => ({ hardware_id: k.hardware_id, device_name: 'Irrigation node', device_type: 'ESP32', zone_id: k.zone_id, status: k.online ? 'Online' : 'Offline', last_seen: ago(k.mins), created_at: ago(60 * 24 * 30), deviceId: k.deviceId, fw: '1.4.0', online: k.online }));
const alerts = [
  { id: 298, zone_id: 31, severity: 'Connectivity', message: 'Kit has not reported for 26 hours.', status: 'Open', created_at: ago(60 * 2), read_at: null },
];
const activity = () => [
  ...(S.onboarded ? [['enquiry.onboarded', `${NALEDI} onboarded the farmer from enquiry 41`, 7, 1], ['farmer.onboard', `${NALEDI} onboarded Thabo (demo) with Thabo's Farm (demo)`, 7, 1]] : []),
  ...(S.outcome ? [['enquiry.call', `${NALEDI} logged a call to enquiry 41: Wants AgroFlow`, null, 9]] : []),
  ...(S.claimed ? [['enquiry.claim', `${NALEDI} is handling enquiry 41`, null, 20]] : []),
  ['maintenance.schedule', `${NALEDI} scheduled maintenance for kit DEMO00000031`, 3, 60 * 3],
].map(([action, summary, farmId, mins], i) => ({ id: 900 - i, createdAt: ago(mins), actorName: NALEDI, action, summary, entityType: action.split('.')[0], entityId: null, farmId, farmName: farms().find((f) => f.farm_id === farmId)?.name ?? null, details: '{}' }));

const health = { overall: 'ok', checkedAt: ago(0.3), checks: [
  { key: 'api', name: 'API', status: 'ok', detail: 'Running.', responseMs: 12 },
  { key: 'database', name: 'Database', status: 'ok', detail: 'Reachable.', responseMs: 38 },
  { key: 'mqtt', name: 'MQTT broker', status: 'ok', detail: 'Connected. Readings and commands are flowing.', responseMs: null },
  { key: 'weather', name: 'Weather', status: 'ok', detail: 'Last refreshed 2 hours ago.', responseMs: null },
  { key: 'devices', name: 'Kits', status: 'warning', detail: 'One kit has not reported for 26 hours.', responseMs: null },
  { key: 'telegram', name: 'Telegram', status: 'ok', detail: 'Bot connected.', responseMs: null },
] };

const today = () => ENG.map((z, i) => ({ zoneId: 71 + i, name: z.zone, action: { kind: z.kind, text: z.today }, why: z.why, confidence: { level: z.confidenceLevel, reason: z.confidence }, confidenceExplanation: z.confidenceWhy, nextStep: null }));

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...headers }, body: body === undefined ? '' : JSON.stringify(body) });
const unstubbed = new Set();
const zoneById = (id) => zones().find((z) => z.id === id);
const farmById = (id) => farms().find((f) => f.farm_id === id);
const TABLES = {
  profile: () => people().map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
  farm: farms, zone: zones,
  hardware: () => kitRows().map(({ deviceId, fw, online, ...h }) => h),
  alert: () => alerts.map((a) => { const z = zoneById(a.zone_id); const f = farmById(z.farm_id); return { ...a, zone: { id: z.id, name: z.name, farm: { farm_id: f.farm_id, name: f.name, status: f.status, owner: { name: f.owner_name, email: null } } } }; }),
  maintenance: () => [{ maintenance_id: 301, farm_id: 3, hardware_id: 131, scheduled_date: day(2), description: 'Kit offline - check power and WiFi on site', status: 'Scheduled', created_at: ago(60 * 3) }],
  irrigation_event: () => [], service_request: () => [
    { id: 52, farmer_id: '00000000-0000-4000-8000-0000000000f2', farm_id: 2, request_type: 'new_zone', location: null, rough_size: 0.004, crop_type: 'tomato', notes: 'Second bed next to the beans (demo).', status: 'pending', created_at: ago(60 * 5), updated_at: ago(60 * 5) }],
  report_request: () => [], ai_recommendation: () => [], explanation: () => [],
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
  const url = new URL(req.url()); const p = url.pathname; const m = req.method(); let mm;
  if (p === '/api/users') return json(route, people());
  if (p === '/api/users/farmers') return json(route, people().filter((u) => u.role === 'farm_user').map((u) => ({ id: u.id, name: u.name, email: u.email, phone: null })));
  if (p === '/api/farms' || p === '/api/admin/farms') return json(route, farms().map((f) => ({ ...f, updated_at: ago(60) })));
  if (p === '/api/admin/hardware') return json(route, kitRows().map((h) => { const z = zoneById(h.zone_id); return { hardwareId: h.hardware_id, deviceId: h.deviceId, deviceName: h.device_name, zoneId: h.zone_id, zoneName: z?.name ?? null, farmName: farmById(z?.farm_id)?.name ?? null, online: h.online, lastSeen: h.last_seen, firmwareVersion: h.fw, enrollmentStatus: 'active', tokenStatus: 'active', mqttUsername: 'agroflow-kit-demo' }; }));
  if (p === '/api/admin/health') return json(route, health);
  if (p === '/api/admin/mqtt-logins') return json(route, { entries: [], freeCount: 6, assignedCount: 3, burnedCount: 0, runningLow: false, warning: null });
  if (p.startsWith('/api/admin/activity/')) return json(route, []);
  if (p === '/api/admin/activity') { const a = activity(); return json(route, { rows: a, total: a.length, actions: [...new Set(a.map((x) => x.action))].map((x) => ({ value: x, label: x })), actors: [{ value: NALEDI, label: NALEDI }] }); }
  if (p.startsWith('/api/admin/handling/')) return json(route, []);
  if (p === '/api/admin/dismissals') return json(route, []);
  if (p === '/api/admin/enquiries') return json(route, enquiries());
  if (p === '/api/admin/enquiries/summary') return json(route, { waiting: S.claimed ? 0 : 1, callbacksDue: 0 });
  if ((mm = p.match(/^\/api\/admin\/enquiries\/(\d+)\/claim$/))) { S.claimed = true; return json(route, { message: 'You are handling this enquiry.' }); }
  if ((mm = p.match(/^\/api\/admin\/enquiries\/(\d+)\/calls$/))) {
    if (m === 'POST') { const b = JSON.parse(req.postData() || '{}'); S.outcome = b.outcome; S.calls.push({ calledAt: ago(0), callerName: NALEDI, outcome: b.outcome, reason: null, reasonOther: null, note: b.note ?? null, callbackAt: null }); return json(route, { message: 'Call logged.', suggestClosing: false }); }
    return json(route, S.calls);
  }
  if ((mm = p.match(/^\/api\/admin\/enquiries\/(\d+)\/onboarded$/))) { S.onboarded = true; return json(route, { message: 'Enquiry completed.' }); }
  if (p === '/api/farmers/onboard' && m === 'POST') {
    S.onboarded = true;
    return json(route, { message: 'Farmer onboarded successfully.', profileId: THABO_ID, email: 'thabo@demo.invalid', temporaryPassword: 'DEMO-ONLY-0000',
      telegramDeepLink: 'https://t.me/AgroFlowDemoBot?start=DEMO0000', telegramCode: 'DEMO0000', telegramCodeExpiresAt: new Date(NOW + 48 * 3600000).toISOString(), warning: null });
  }
  if (p === '/api/devices/enroll' && m === 'POST') return json(route, { hardwareId: 171, enrollmentCode: 'DEMO-0000', expiresAt: new Date(NOW + 86400000).toISOString() });
  if ((mm = p.match(/^\/api\/farmer\/farms\/(\d+)\/today$/))) return json(route, { farmId: +mm[1], day: day(), zones: +mm[1] === 7 ? today() : [] });
  if (p.includes('report-schedule')) return json(route, { farmId: 7, enabled: true, frequency: 'weekly', weekday: 1, reportKind: 'schedule', nextRunAt: new Date(NOW + 3 * 86400000).toISOString(), lastRunAt: null, perZone: false, recipients: [] });
  if (p === '/api/farmer/reports/zones') return json(route, zones().filter((z) => z.farm_id === 7).map((z) => ({ zoneId: z.id, name: z.name, cropType: z.crop_type })));
  if (p.includes('/zones')) return json(route, zones().filter((z) => p.includes(`/${z.farm_id}/`)).map((z) => ({ id: z.id, name: z.name })));
  if (p === '/api/telegram/me') return json(route, { linked: true, alertsEnabled: true });
  if (p === '/api/admin/platform-config') return json(route, { groups: [] });
  unstubbed.add(`api ${m} ${p}`);
  return json(route, []);
}

const exp = Math.floor(NOW / 1000) + 3600 * 6;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sessionUser = { id: ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: 'naledi@demo.invalid', app_metadata: {}, user_metadata: {}, created_at: ago(1000) };
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ADMIN_ID, exp, role: 'authenticated', aud: 'authenticated' })}.demo`, refresh_token: 'demo', token_type: 'bearer', expires_in: 3600 * 6, expires_at: exp, user: sessionUser };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['sb-demo-auth-token', JSON.stringify(session)]);
await ctx.route('https://demo.supabase.co/**', supa);
await ctx.route('https://api.demo.local/**', api);
await ctx.route(/tile\.openstreetmap|basemaps|arcgis|nominatim/, (r) => r.abort());
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('dialog', (d) => d.accept());
const pause = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await pause(2600); };

await page.goto(`${ORIGIN}/#dashboard`);
await page.waitForSelector('#appShell', { timeout: 30000 }); await pause(3500);
await page.mouse.move(1400, 790);
if (MODE === 'enquiry') {
await shot('a-dashboard-before');

// ---- 1. Enquiries: claim, log the call ------------------------------------------
await go('requests');
await page.getByRole('tab', { name: /Enquiries/ }).click(); await pause(2000);
await shot('a-enq-list');
await page.locator('[data-enquiry="41"]').getByText("I'll handle this").click(); await pause(2500);
await shot('a-enq-claimed');
await page.locator('[data-enquiry="41"]').getByRole('button', { name: 'Log call' }).click(); await pause(1500);
await page.locator('.log-call').getByLabel('Wants AgroFlow').check(); await pause(800);
await shot('a-enq-logcall');
await page.locator('[data-drawer-confirm]').click(); await pause(2500);
await shot('a-enq-wants');

// ---- 2. Onboarding from the enquiry -----------------------------------------------
await page.locator('[data-enquiry="41"] [data-act="enquiry-onboard"]').click(); await pause(3000);
await shot('a-onb-step1');
// the enquiry gives name and phone; Naledi adds an email for the sign-in
const email = page.locator('[data-field="email"]');
if (!(await email.inputValue())) await email.fill('thabo@demo.invalid');
await shot('a-onb-step1-filled');
await page.locator('[data-act="onboarding-next"]').click(); await pause(1500);
await page.locator('[data-field="farmName"]').fill("Thabo's Farm (demo)");
const loc = page.locator('[data-field="location"]'); if (!(await loc.inputValue())) await loc.fill('Mafikeng, North West');
await page.locator('[data-field="farmSize"]').fill('0.02');
await page.locator('[data-field="zoneCount"]').fill('2'); await page.locator('[data-field="zoneCount"]').dispatchEvent('input'); await page.locator('[data-field="zoneCount"]').dispatchEvent('change'); await pause(1200);
for (const i of [0, 1]) {
  await page.locator(`[data-field="zone_name_${i}"]`).fill(`Zone ${i + 1}`);
  await page.locator(`[data-field="zone_crop_${i}"]`).selectOption('tomato');
  await page.locator(`[data-field="zone_area_preset_${i}"]`).selectOption('custom').catch(() => {});
  await page.locator(`[data-field="zone_area_m2_${i}"]`).fill('20').catch(() => {});
  await page.locator(`[data-field="zone_weeks_${i}"]`).fill(i === 0 ? '9' : '5');
}
await page.locator('[data-field="zone_name_0"]').scrollIntoViewIfNeeded(); await pause(800);
await shot('a-onb-step2');
await page.locator('[data-act="onboarding-submit"]').click(); await pause(4000);
await shot('a-onb-handover');
await page.locator('[data-act="handover-done"]').click().catch(() => {}); await pause(2500);
await go('requests'); await page.getByRole('tab', { name: /Enquiries/ }).click(); await pause(2000);
await shot('a-enq-done');

}
// ---- 3. Kit registration ------------------------------------------------------------
if (MODE === 'kit') {
  await go('hardware');
  await page.getByRole('button', { name: /Register a kit/ }).first().click(); await pause(2500);
  const wiz = page.locator('[data-wizard="register-hardware"]');
  const pick = async (name, text) => { await wiz.locator(`[data-picker-for="${name}"]`, { hasText: text }).first().click(); await pause(1200); };
  const next = async () => { await wiz.locator('[data-wizard-next]').click(); await pause(1200); };
  await pick('kitOwnerId', 'Thabo (demo)'); await shot('a-kit-wizard-1'); await next();
  await pick('kitFarmId', "Thabo's Farm"); await shot('a-kit-wizard-2'); await next();
  await pause(1000); await pick('kitZoneId', 'Zone 1'); await shot('a-kit-wizard-3'); await next();
  await wiz.locator('[data-field="kitName"]').fill('Zone 1 controller'); await shot('a-kit-wizard-4'); await next();
  await shot('a-kit-wizard-5');
  await wiz.locator('[data-wizard-confirm]').click(); await pause(2500);
  await shot('a-kit-code');
  console.log('modal', (await page.locator('body').innerText()).match(/Enrollment code[\s\S]{0,300}/)?.[0]);
}
// ---- 4. Other pages ---------------------------------------------------------------
if (MODE === 'pages') {
  await shot('a-dashboard-after');
  for (const h of ['farms', 'reports', 'activity', 'hardware', 'alerts']) {
    await go(h); await shot(`a-page-${h}`);
    console.log(h, (await page.locator('main, #appShell').first().innerText()).slice(0, 300).replace(/\n+/g, ' | '));
  }
  await go('reports');
  await page.getByRole('button', { name: 'Set up automatic reports' }).click(); await pause(2000);
  await shot('a-reports-auto');
  console.log('auto', (await page.locator('.drawer').first().innerText().catch(() => '')).slice(0, 500).replace(/\n+/g, ' | '));
}

console.log('unstubbed', [...unstubbed]);
await browser.close();
