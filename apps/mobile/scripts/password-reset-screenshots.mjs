// Screenshots of Forgot password (code by Telegram), the one-tap sign-in screen and the
// temporary-password hint on Login, at 390x844 and 1366x768. The real `expo export --platform
// web` build, served locally; Supabase and the API are fake hosts answered here. Usage (from
// apps/mobile), with the same export as scripts/setup-wizard-screenshots.mjs:
//   node scripts/password-reset-screenshots.mjs <build> <out> ../web/admin
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
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const browser = await chromium.launch();
fs.mkdirSync(outDir, { recursive: true });

for (const [label, viewport] of [['390x844', { width: 390, height: 844 }], ['1366x768', { width: 1366, height: 768 }]]) {
  const page = await browser.newPage({ viewport });
  await page.route(`${FAKE_SUPABASE}/**`, route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(req.url()).pathname === '/auth/v1/token') {
      return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }) });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${FAKE_API}/**`, route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (p === '/api/auth/forgot-password') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ message: 'sent' }) });
    if (p === '/api/auth/reset-password') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ message: 'Your password was changed.' }) });
    if (p === '/api/auth/one-tap') return route.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'expired' }) });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
  });
  const shot = async name => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `${name}-${label}.png`) });
  };

  await page.goto(`${BASE}/forgot-password`);
  await page.getByTestId('forgot-email').waitFor({ timeout: 30000 });
  await shot('1-forgot-email');
  await page.getByTestId('forgot-email').fill('thandi@example.org');
  await page.getByTestId('forgot-send').click();
  await page.getByTestId('forgot-code').waitFor();
  await page.getByTestId('forgot-code').fill('482 913');
  await page.getByTestId('forgot-password').fill('my-new-password');
  await page.getByTestId('forgot-again').fill('my-new-password');
  await shot('2-forgot-code');
  await page.getByTestId('forgot-change').click();
  await page.getByTestId('forgot-to-login').waitFor();
  await shot('3-forgot-done');

  await page.goto(`${BASE}/signin?token=${'x'.repeat(43)}`);
  await page.getByTestId('onetap-failed').waitFor({ timeout: 30000 });
  await shot('4-onetap-used');

  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('farmer@example.com').waitFor({ timeout: 30000 });
  await page.getByPlaceholder('farmer@example.com').fill('thandi@example.org');
  await page.getByPlaceholder('Enter your password').fill('kx7p 4mrt');
  await page.getByText('Sign In', { exact: true }).last().click();
  await page.getByText(/Temporary passwords are 8 letters/).waitFor();
  await shot('5-login-temp-hint');
  await page.close();
}

await browser.close();
server.close();
console.log('done');
