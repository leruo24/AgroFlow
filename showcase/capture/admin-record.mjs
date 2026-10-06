// Records the REAL AgroFlow admin console (apps/web/admin, unmodified, served
// by vite with VITE_SUPABASE_URL=https://demo.supabase.co and
// VITE_AGROFLOW_API_BASE=https://api.demo.local) answering with the
// illustrative data in demo-data.mjs. Output: ../assets/rec/a*.mp4 + events.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import * as D from './demo-data.mjs';
import { startRec, stopRec, tapAt } from './recorder.mjs';

const OUT = new URL('../assets/rec/', import.meta.url).pathname;
const SHOTS = new URL('../assets/screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
const W = 1440, H = 810, DPR = 2;

const zoneById = new Map(D.adminZones.map((z) => [z.id, z]));
const farmById = new Map(D.adminFarms.map((f) => [f.farm_id, f]));
const embedAlert = (a) => { const z = zoneById.get(a.zone_id); const f = farmById.get(z.farm_id);
  return { ...a, zone: { id: z.id, name: z.name, farm: { farm_id: f.farm_id, name: f.name, status: f.status, owner: { name: f.owner_name, email: null } } } }; };
const events = [];
let eid = 9000;
for (let d = 0; d < 21; d++) for (const z of D.adminZones.slice(0, 5)) {
  if ((d + z.id) % 3 === 0) continue;
  const f = farmById.get(z.farm_id);
  events.push({ id: eid++, started_at: new Date(D.NOW - d * 86400000 - (z.id % 5) * 3600000).toISOString(), runtime_seconds: 600 + ((d * 37 + z.id * 13) % 9) * 60,
    zone: { id: z.id, name: z.name, crop_type: z.crop_type, flow_rate_lpm: z.flow_rate_lpm, status: 'Active', farm: { farm_id: f.farm_id, name: f.name, location: f.location, status: f.status } } });
}

const health = { overall: 'ok', checkedAt: D.ago(0.3), checks: [
  { key: 'api', name: 'API', status: 'ok', detail: 'Version 2.0.0. Running for 3 days.', responseMs: 12 },
  { key: 'database', name: 'Database', status: 'ok', detail: 'Reachable in 38 ms.', responseMs: 38 },
  { key: 'mqtt', name: 'MQTT broker', status: 'ok', detail: 'Connected. Readings and commands are flowing.', responseMs: null },
  { key: 'weather', name: 'Weather', status: 'ok', detail: 'Last refreshed 2 hours ago.', responseMs: null },
  { key: 'devices', name: 'Kits', status: 'warning', detail: '5 of 6 online. Last reading 1 minute ago.', responseMs: null },
  { key: 'telegram', name: 'Telegram', status: 'ok', detail: 'Bot connected.', responseMs: null },
] };

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

const TABLES = {
  profile: () => D.people.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
  farm: () => D.adminFarms, zone: () => D.adminZones,
  hardware: () => D.kits.map(({ deviceId, fw, online, mqtt, ...h }) => h),
  alert: () => D.adminAlerts.map(embedAlert), maintenance: () => D.maintenanceJobs,
  irrigation_event: () => events, service_request: () => [], report_request: () => [], ai_recommendation: () => [],
};
async function supa(route) {
  const req = route.request(); const url = new URL(req.url());
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  if (url.pathname.startsWith('/auth/v1/')) return json(route, url.pathname.endsWith('/user') ? sessionUser : {});
  const table = url.pathname.replace('/rest/v1/', '');
  let rows = (TABLES[table] ?? (() => []))();
  const idEq = url.searchParams.get('id');
  if (table === 'profile' && idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  if (req.method() === 'HEAD') return json(route, undefined, 200, { 'content-range': `*/${rows.length}` });
  return json(route, single ? rows[0] : rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
}
async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return json(route, undefined, 204);
  const p = new URL(req.url()).pathname;
  if (p === '/api/users') return json(route, D.people);
  if (p === '/api/farms') return json(route, D.adminFarms.map((f) => ({ ...f, updated_at: D.ago(60 * 24 * 40) })));
  if (p === '/api/admin/hardware') return json(route, D.kits.map((h) => { const z = zoneById.get(h.zone_id);
    return { hardwareId: h.hardware_id, deviceId: h.deviceId, deviceName: h.device_name, zoneId: h.zone_id, zoneName: z?.name ?? null, farmName: farmById.get(z?.farm_id)?.name ?? null,
      online: h.online, lastSeen: h.last_seen, firmwareVersion: h.fw, enrollmentStatus: 'active', tokenStatus: 'active', mqttUsername: h.mqtt }; }));
  if (p === '/api/admin/health') return json(route, health);
  if (p === '/api/admin/mqtt-logins') return json(route, { entries: [], freeCount: 6, assignedCount: 6, burnedCount: 0, runningLow: false, warning: null });
  if (p.startsWith('/api/admin/activity/')) return json(route, []);
  if (p === '/api/admin/activity') return json(route, { rows: D.activity, total: D.activity.length,
    actions: [...new Set(D.activity.map((a) => a.action))].map((a) => ({ value: a, label: a })),
    actors: [...new Set(D.activity.map((a) => a.actorName))].map((a) => ({ value: a, label: a })) });
  if (p.includes('report-schedule')) return json(route, { farmId: 1, enabled: false, frequency: 'monthly', reportKind: 'water_usage', nextRunAt: null, lastRunAt: null });
  if (p.includes('/zones')) return json(route, D.adminZones.filter((z) => p.includes(`/${z.farm_id}/`)).map((z) => ({ id: z.id, name: z.name })));
  console.log('unstubbed API', req.method(), p);
  return json(route, []);
}

const exp = Math.floor(D.NOW / 1000) + 3600 * 6;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sessionUser = { id: D.ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: 'admin@demo.invalid', app_metadata: {}, user_metadata: {}, created_at: D.ago(1000) };
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: D.ADMIN_ID, exp, role: 'authenticated', aud: 'authenticated' })}.demo`, refresh_token: 'demo', token_type: 'bearer', expires_in: 3600 * 6, expires_at: exp, user: sessionUser };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['sb-demo-auth-token', JSON.stringify(session)]);
await ctx.route('https://demo.supabase.co/**', supa);
await ctx.route('https://api.demo.local/**', api);
await ctx.route(/tile\.openstreetmap|basemaps|arcgis/, (r) => r.abort());
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const pause = (ms) => page.waitForTimeout(ms);
const nav = (label) => page.locator('#nav button').filter({ hasText: label }).first();
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const glide = async (rec, loc, label) => { const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  rec.mark('point', { x: Math.round(x), y: Math.round(y), label }); await page.mouse.move(x, y, { steps: 12 }); await pause(900); };

await page.goto(`${ORIGIN}/#dashboard`);
await page.waitForSelector('#appShell', { timeout: 30000 });
await page.waitForLoadState('networkidle').catch(() => {}); await pause(3500);
await page.mouse.move(720, 760);

const rec = await startRec(page, 'a1-admin', OUT, { width: W * DPR, height: H * DPR });
await pause(3800);
await shot('a-home');
await tapAt(page, rec, nav('Farms & zones'), { kind: 'click', label: 'farms' });
await pause(2600);
await shot('a-farms');
await tapAt(page, rec, page.locator('[data-act="view-farm"]').first(), { kind: 'click', label: 'view farm' });
await pause(3400);
await shot('a-farm-detail');
await page.keyboard.press('Escape'); rec.mark('key', { label: 'close' }); await pause(1200);
await tapAt(page, rec, nav('Kits'), { kind: 'click', label: 'kits' });
await pause(2600);
await shot('a-kits');
await glide(rec, page.locator('tbody tr').filter({ hasText: 'A4CF12B7E9C4' }).locator('td').nth(4), 'zone 2 kit connection');
await pause(1600);
await tapAt(page, rec, nav('Alerts'), { kind: 'click', label: 'alerts' });
await pause(2600);
await shot('a-alerts');
await tapAt(page, rec, page.locator('[data-act="view-alert"][data-id="301"]').first(), { kind: 'click', label: 'view alert' });
await pause(3600);
await shot('a-alert-detail');
await page.keyboard.press('Escape'); rec.mark('key', { label: 'close' }); await pause(1200);
await tapAt(page, rec, nav('Maintenance'), { kind: 'click', label: 'maintenance' });
await pause(3000);
await shot('a-maintenance');
await tapAt(page, rec, nav('Activity'), { kind: 'click', label: 'activity' });
await pause(3200);
await shot('a-activity');
await stopRec(rec);
// The same console at phone width (real breakpoints in main.css).
await page.setViewportSize({ width: 430, height: 932 });
for (const [hash, name] of [['dashboard', 'a-narrow-home'], ['hardware', 'a-narrow-kits']]) {
  await page.evaluate((h) => { location.hash = h; }, hash); await pause(2500); await shot(name);
}
await browser.close();
