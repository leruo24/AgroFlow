// Isolated browser fixtures for UI verification. Never imported by the app.
// Requires a dedicated Edge/Chrome CDP session on port 9223 and Expo web on 8098.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const route = process.argv[2] || '/';
const mode = process.argv[3] || 'empty';
const width = Number(process.argv[4] || 390);
const name = process.argv[5] || 'agroflow-ui';
const scenario = process.argv[6] || '';
const appOrigin = process.env.UI_SMOKE_ORIGIN || 'http://localhost:8098';
const checks = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const url = env.match(/^EXPO_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g, '');
const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const user = { id: '00000000-0000-0000-0000-000000000001', email: 'ui-test@example.invalid', role: 'authenticated', aud: 'authenticated', user_metadata: { first_name: 'Test', last_name: 'Farmer' }, app_metadata: {}, created_at: new Date().toISOString() };
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated' })).toString('base64url')}.test-signature`;
const session = { access_token: token, refresh_token: 'test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user };
const farms = [{ farm_id: 101, owner_id: user.id, name: 'Test farm A', location: 'Test location A', latitude: -33.96, longitude: 18.47 }, { farm_id: 102, owner_id: user.id, name: 'Test farm B', location: 'Test location B', latitude: null, longitude: null }];
const tab = await (await fetch('http://localhost:9223/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
const requests = [];
let bench = null;
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.addEventListener('message', async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); return; }
  if (message.method === 'Page.javascriptDialogOpening') { await call('Page.handleJavaScriptDialog', { accept: true }); return; }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = message.params;
  const path = new URL(request.url).pathname;
  requests.push({ path, query: new URL(request.url).search, method: request.method });
  let body = {}, status = 200;
  if (path.includes('/api/farmer/')) {
    if (mode === 'loading') await sleep(25000);
    if (mode === 'error') { status = 503; body = { error: 'Test failure' }; }
    else if (path.endsWith('/dashboard')) {
      const id = Number(new URL(request.url).searchParams.get('farmId') || 101);
      body = { profile: { id: user.id, name: 'Test Farmer', email: user.email, role: 'farmer', phone: '' }, farms: mode === 'no-farm' ? [] : farms, farm: mode === 'no-farm' ? null : farms.find(f => f.farm_id === id), zones: mode === 'populated' && id === 101 ? [{ id: 201, farm_id: 101, name: 'Test zone A', crop_type: 'Test crop', location: 'North field', irrigation_mode: 'automatic', moisture_threshold: 30, desired_moisture: 60, schedule_enabled: true, schedule_days: ['Mon'], schedule_start_time: '05:30', schedule_duration_minutes: 20, weather_adjustment: true, health_status: 'Unknown' }] : [], readings: [], events: mode === 'populated' && id === 101 ? [{ id: 401, zone_id: 201, started_at: '2026-09-15T12:00:00Z', runtime_seconds: 60, estimated_litres: 2, trigger_source: 'manual' }] : [], usage: [], weather: [], alerts: mode === 'populated' && id === 101 ? [{ id: 301, zone_id: 201, severity: 'warning', message: 'Test sensor warning', status: 'Open', created_at: '2026-09-16T12:00:00Z' }] : [] };
      if (mode === 'dense' && id === 101) {
        body.zones = Array.from({ length: 12 }, (_, i) => ({ id: 201 + i, farm_id: 101, name: `Test zone ${i + 1}`, crop_type: 'Test crop', location: `Field ${i + 1}`, irrigation_mode: 'automatic', moisture_threshold: 30, desired_moisture: 60, schedule_enabled: true, schedule_days: ['Mon'], schedule_start_time: '05:30', schedule_duration_minutes: 20, weather_adjustment: true, health_status: 'Unknown' }));
        body.events = Array.from({ length: 24 }, (_, i) => ({ id: 401 + i, zone_id: 201 + i % 12, started_at: new Date(Date.UTC(2026, 8, 16, 12 - i)).toISOString(), runtime_seconds: 60, estimated_litres: 2, trigger_source: 'manual' }));
        body.alerts = Array.from({ length: 24 }, (_, i) => ({ id: 301 + i, zone_id: 201 + i % 12, severity: 'warning', message: `Test sensor warning ${i + 1}`, status: 'Open', created_at: new Date(Date.UTC(2026, 8, 16, 12 - i)).toISOString() }));
      }
    } else if (path.endsWith('/weather/current')) {
      body = { current: { temperature_2m: 22, weather_code: 0, relative_humidity_2m: 60, time: '2026-09-16T12:00' }, daily: { precipitation_probability_max: [20] } };
    } else if (path.endsWith('/commands')) body = { id: 'test-command' };
    else status = 204;
  } else if (path.endsWith('/token')) body = session;
  else if (path.endsWith('/user')) body = user;
  else if (path.endsWith('/logout')) status = 204;
  if (request.method === 'OPTIONS') status = 204;
  await call('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,apikey,x-client-info,x-supabase-api-version' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,OPTIONS' }], body: Buffer.from(status === 204 ? '' : JSON.stringify(body)).toString('base64') });
});
await call('Page.enable');
await call('Runtime.enable');
await call('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/farmer/*' }, { urlPattern: '*supabase.co/*' }] });
await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
const seed = `localStorage.clear(); ${mode === 'signed-out' ? '' : `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(session))});`}`;
const script = await call('Page.addScriptToEvaluateOnNewDocument', { source: seed });
process.on('uncaughtException', async error => { console.error(error.message); const r = await call('Runtime.evaluate', { expression: 'JSON.stringify({text:document.body.innerText,inputs:[...document.querySelectorAll("input")].map(e=>({type:e.type,value:e.value,placeholder:e.placeholder}))})', returnByValue: true }); console.log(JSON.stringify({checks,bench,...JSON.parse(r.result.value)})); await call('Page.removeScriptToEvaluateOnNewDocument', {identifier:script.identifier}); await call('Fetch.disable'); ws.close(); await fetch(`http://localhost:9223/json/close/${tab.id}`); process.exitCode=1; });
await call('Page.navigate', { url: `${appOrigin}${route}` });
await sleep(mode === 'loading' ? 3000 : 7000);
if (mode !== 'loading') {
  for (let attempt = 0; attempt < 25; attempt++) {
    const ready = await call('Runtime.evaluate', { expression: "document.body?.innerText?.length > 20 && !document.body.innerText.includes('Loading farm') && !document.body.innerText.includes('Loading weather')", returnByValue: true });
    if (ready.result.value) break;
    await sleep(1000);
  }
}

async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
async function click(text) { const ok = await evaluate(`(() => { const el = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.children.length === 0); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`); if (!ok) throw new Error(`Missing action: ${text}`); await sleep(800); }
async function label(text) { const ok = await evaluate(`(() => { const e = document.querySelector('[aria-label="${text}"]'); if(!e) return false; (e.querySelector('input') || e).click(); return true; })()`); if(!ok) throw new Error(`Missing label: ${text}`); await sleep(500); }
async function input(index, value) { await evaluate(`(() => { const e = document.querySelectorAll('input')[${index}]; e.focus(); e.select(); })()`); await call('Input.insertText', { text: value }); await sleep(200); }
async function check(title, expression) { const passed = await evaluate(expression); checks.push({title, passed: !!passed}); if (!passed) throw new Error(`Failed: ${title}`); }
if (scenario === 'switch') {
 await click('Test farm A'); await check('Blur sheet visible', `document.body.innerText.includes('Select a farm') || document.body.innerText.includes('Choose farm')`);
 await click('Test farm B'); await sleep(1200);
 await check('Farm B has no Farm A zone or weather', `document.body.innerText.includes('Test farm B') && !document.body.innerText.includes('Test zone A') && !document.body.innerText.includes('22?C')`);
 await check('Missing coordinates handled', `document.body.innerText.includes('coordinates')`);
 await click('Irrigation'); await check('Farm B empty zones', `document.body.innerText.includes('No zones set up yet')`);
 await click('Alerts'); await check('Farm B empty alerts', `!document.body.innerText.includes('Test sensor warning') && document.body.innerText.includes('No alerts')`);
 await click('History'); await check('Farm B empty history', `document.body.innerText.includes('No recent activity')`);
} else if (scenario === 'farm-sheet') {
 await click('Test farm A');
 await check('Farm selector shows both farms and current selection', `document.body.innerText.includes('Select a farm') && document.body.innerText.includes('Test farm B')`);
 await check('Farm selector keeps a frosted backdrop', `[...document.querySelectorAll('*')].some(e => getComputedStyle(e).backdropFilter.includes('blur(') && getComputedStyle(e).position === 'absolute')`);
} else if (scenario === 'map') {
 await label('Zoom in'); await check('Map visible', `document.body.innerText.includes('OpenStreetMap')`);
 await label('Test location A, collapse map'); await check('Map collapsed', `!document.body.innerText.includes('OpenStreetMap')`);
 await label('Test location A, expand map'); await check('Map expanded', `document.body.innerText.includes('OpenStreetMap')`);
} else if (scenario === 'map-collapsed') {
 await label('Test location A, collapse map');
 await check('Map collapsed', `!document.body.innerText.includes('OpenStreetMap')`);
} else if (scenario === 'settings') {
 await click('Dark'); await check('Dark theme', `document.body.innerText.includes('Currently using dark mode')`);
 await click('Light'); await check('Light theme', `document.body.innerText.includes('Currently using light mode')`);
 await click('System Default'); await check('System theme persisted', `Object.values(localStorage).some(v => v.includes('system'))`);
 await label('Irrigation'); await check('Notification preference saved', `Object.values(localStorage).some(v => v.includes('"irrigation":false'))`);
 await click('Profile'); await check('Profile with single tab bar', `location.pathname === '/profile' && document.querySelectorAll('[role="tablist"]').length === 1`);
 await click('Back'); await check('Profile back to Settings', `location.pathname === '/settings'`);
} else if (scenario === 'dark') {
 await click('Dark'); await check('Dark theme selected', `document.body.innerText.includes('Currently using dark mode')`);
} else if (scenario === 'profile') {
 await click('Edit Profile'); await input(0, 'Updated'); await click('Save Changes');
 await check('Profile save request', `${requests.some(r => r.path.endsWith('/profile') && r.method === 'PUT')}`);
 await click('Change Password'); await input(0,'Test-only-Password-42'); await input(1,'Test-only-Password-42'); await click('Update Password');
 await check('Password update success', `document.body.innerText.toLowerCase().includes('password updated')`);
 await click('Return to Profile'); await click('Log Out'); await sleep(1200);
 await check('Logout returns to login', `location.pathname === '/login'`);
} else if (scenario === 'forgot') {
 await click('Forgot password?'); await check('Forgot password route', `location.pathname === '/forgot-password'`);
 await sleep(500);
 await input(2,'ui-test@example.invalid'); await click('Send Reset Instructions');
 await check('Reset request sent', `${requests.some(r => r.path.endsWith('/recover') && r.method === 'POST')}`);
 await check('Recovery email confirmation', `document.body.innerText.toLowerCase().includes('check your email')`);
} else if (scenario === 'zone') {
 await click('Manual'); await click('Start Manual Run'); await sleep(600);
 await check('Start command sent', `${requests.some(r => r.path.endsWith('/commands') && r.method === 'POST')}`);
 await check('Command truthfully labelled', `document.body.innerText.includes('Manual command sent')`);
 await click('Send Stop Command');
 await check('Stop command sent', `${requests.filter(r => r.path.endsWith('/commands') && r.method === 'POST').length >= 2}`);
} else if (scenario === 'edit-zone') {
 await label('Edit zone and automation');
 await check('Zone editor opens in a sheet', `document.body.innerText.includes('Edit Zone & Automation') && document.body.innerText.includes('Save Changes')`);
 await check('Zone editor keeps a frosted backdrop', `[...document.querySelectorAll('*')].some(e => getComputedStyle(e).backdropFilter.includes('blur(') && getComputedStyle(e).position === 'absolute')`);
} else if (scenario === 'edit-schedule') {
 await label('Edit regular irrigation schedule');
 await check('Schedule editor opens in a sheet', `document.body.innerText.includes('Edit Schedule') && document.body.innerText.includes('Save Schedule')`);
 await check('Schedule editor keeps a frosted backdrop', `[...document.querySelectorAll('*')].some(e => getComputedStyle(e).backdropFilter.includes('blur(') && getComputedStyle(e).position === 'absolute')`);
} else if (scenario === 'alert') {
 await click('Test sensor warning'); await check('Alert navigates to zone', `location.pathname === '/zone/201'`);
} else if (scenario === 'alert-read') {
 await click('Test sensor warning'); await sleep(500); await evaluate('history.back()'); await sleep(800);
 await check('Alert remains visible and is read', `location.pathname === '/alerts' && document.body.innerText.includes('Test sensor warning') && document.body.innerText.includes('0\\nUnread')`);
} else if (scenario === 'map-zoom-bench') {
 await call('Performance.enable');
 const before = await call('Performance.getMetrics');
 bench = await evaluate(`(async () => {
   const runs = [];
   for (const [label, zoom] of [['Zoom in',14], ['Zoom out',13], ['Zoom in',14]]) {
     const oldRoot = document.querySelector('[aria-label="Farm location map. Use the zoom buttons to change scale."]');
     const button = document.querySelector('[aria-label="' + label + '"]');
     if (!oldRoot || !button) throw new Error('Map or zoom button missing');
     const start = performance.now();
     const seen = await new Promise(resolve => {
       const observer = new MutationObserver(() => {
         if (document.querySelector('img[src*="/' + zoom + '/"]')) { observer.disconnect(); resolve(true); }
       });
       observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
       button.click();
       setTimeout(() => { observer.disconnect(); resolve(false); }, 2000);
     });
     runs.push({ zoom, rendered: seen, renderMs: Math.round(performance.now() - start), remounted: oldRoot !== document.querySelector('[aria-label="Farm location map. Use the zoom buttons to change scale."]') });
   }
   return { runs };
 })()`);
 const after = await call('Performance.getMetrics');
 const metric = (list, name) => list.metrics.find(m => m.name === name)?.value || 0;
 bench.taskDurationMs = Math.round((metric(after,'TaskDuration') - metric(before,'TaskDuration')) * 1000);
 await check('Map zoom rendered every tile set', `${bench.runs.every(r => r.rendered)}`);
} else if (scenario === 'tab-blur') {
 await call('Performance.enable');
 const before = await call('Performance.getMetrics');
 bench = await evaluate(`(async () => {
   const scroller = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 100 && getComputedStyle(e).overflowY !== 'hidden' && e.getBoundingClientRect().height > 100).sort((a,b) => b.scrollHeight - a.scrollHeight)[0];
   if (!scroller) throw new Error('No scrollable content on tab');
   const max = scroller.scrollHeight - scroller.clientHeight;
   const frames = [];
   await new Promise(resolve => {
     let start = null, previous = null;
     function frame(now) {
       if (start === null) start = now;
       if (previous !== null) frames.push(now - previous);
       previous = now;
       const progress = Math.min(1, (now - start) / 1200);
       scroller.scrollTop = max * (location.pathname === '/' ? 0.25 : location.pathname === '/settings' ? 0.5 : 0.7) * progress;
       if (progress < 1) requestAnimationFrame(frame); else resolve();
     }
     requestAnimationFrame(frame);
   });
   const labels = { '/': 'Manage Irrigation', '/irrigation': 'Manage Zone', '/alerts': 'Unread', '/history': 'Irrigation recorded', '/settings': 'Profile' };
   const tabTop = document.querySelector('[role="tablist"]').getBoundingClientRect().top;
   const desiredTop = tabTop + 22;
   const candidates = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === labels[location.pathname]);
   const chosen = candidates.sort((a,b) => Math.abs(a.getBoundingClientRect().top - desiredTop) - Math.abs(b.getBoundingClientRect().top - desiredTop))[0];
   if (chosen) scroller.scrollTop = Math.max(0, Math.min(max, scroller.scrollTop + chosen.getBoundingClientRect().top - desiredTop));
   await new Promise(resolve => setTimeout(resolve, 120));
   return { scrollTop: scroller.scrollTop, scrollMax: max, frames: frames.length,
     targetTop: chosen?.getBoundingClientRect().top, tabTop,
     medianFrameMs: frames.sort((a,b) => a-b)[Math.floor(frames.length/2)],
     slowFrames: frames.filter(n => n > 33).length,
     domNodes: document.querySelectorAll('*').length,
     blurStyles: [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).backdropFilter !== 'none').slice(0,4).map(e => ({ filter: getComputedStyle(e).backdropFilter, background: getComputedStyle(e).backgroundColor, overlayBackground: getComputedStyle(e.nextElementSibling).backgroundColor })) };
 })()`);
 const after = await call('Performance.getMetrics');
 const metric = (list, name) => list.metrics.find(m => m.name === name)?.value || 0;
 bench.taskDurationMs = Math.round((metric(after,'TaskDuration') - metric(before,'TaskDuration')) * 1000);
 await check('Content passes under floating tab bar', `${bench.scrollTop} > 0 && ${bench.targetTop} >= ${bench.tabTop} && ${bench.targetTop} < ${bench.tabTop} + 70`);
}

const result = await call('Runtime.evaluate', { expression: 'JSON.stringify({url:location.pathname,text:document.body.innerText,width:innerWidth,scrollWidth:document.documentElement.scrollWidth})', returnByValue: true });
const shot = await call('Page.captureScreenshot', { format: 'png' });
const path = join(tmpdir(), `${name}.png`);
writeFileSync(path, Buffer.from(shot.data, 'base64'));
let underlayScreenshot;
if (scenario === 'tab-blur') {
  await evaluate(`(() => {
    const blur = [...document.querySelectorAll('*')].find(e => getComputedStyle(e).backdropFilter.includes('blur('));
    if (!blur) throw new Error('Tab blur layer missing');
    blur.style.visibility = 'hidden';
    blur.nextElementSibling.style.visibility = 'hidden';
  })()`);
  await sleep(100);
  const underlayShot = await call('Page.captureScreenshot', { format: 'png' });
  underlayScreenshot = join(tmpdir(), `${name}-underlay.png`);
  writeFileSync(underlayScreenshot, Buffer.from(underlayShot.data, 'base64'));
}
console.log(JSON.stringify({ page: JSON.parse(result.result.value), checks, errors, requests, bench, screenshot: path, underlayScreenshot }));
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
await call('Fetch.disable');
ws.close();
await fetch(`http://localhost:9223/json/close/${tab.id}`);
