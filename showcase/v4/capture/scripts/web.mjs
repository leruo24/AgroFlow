// v4 capture: the REAL public website (apps/web/admin, unmodified, Vite on :5173 with
// demo-only hosts). Enquiry POST is answered locally with the server's own thank-you text.
// Writes ../raw/web-*.png and ../raw/web-*.mp4 (CDP screencast, see showcase/capture/recorder.mjs).
import { chromium } from '/home/user/AgroFlow/showcase/capture/node_modules/playwright/index.mjs';
import { startRec, stopRec } from '/home/user/AgroFlow/showcase/capture/recorder.mjs';
import { mkdirSync } from 'node:fs';
const OUT = new URL('../raw/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const only = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ARGS });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
async function ctxFor(dpr) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: dpr });
  await ctx.route('https://api.demo.local/**', (r) => r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: cors })
    : r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ message: 'Thank you, a representative will call you within 2 working days.' }) }));
  await ctx.route('https://demo.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' }));
  return ctx;
}

if (!only || only === 'enquiry') {
  const ctx = await ctxFor(2); const p = await ctx.newPage();
  await p.goto(`${ORIGIN}/`); await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}web-hero.png` });
  await p.goto(`${ORIGIN}/#enquire`); await p.waitForTimeout(3000);
  const f = p.locator('#enquiryForm');
  await f.scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
  await p.fill('input[name="fullName"]', 'Thabo (demo)');
  await p.fill('input[name="phone"]', '082 12');
  await p.selectOption('select[name="province"]', 'North West');
  await p.fill('input[name="town"]', 'Mafikeng');
  await p.check('input[name="crops"][value="tomato"]');
  await p.check('input[name="bestTime"][value="morning"]');
  await p.check('input[name="consent"]');
  await p.click('#enquiryForm button[type="submit"]'); await p.waitForTimeout(800);
  await p.locator('.enquiry-error').scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}web-enquiry-error.png` });
  await p.locator('input[name="fullName"]').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -140)); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}web-enquiry-top.png` });
  await p.fill('input[name="phone"]', '000 000 0000');
  await p.locator('#enquiryForm button[type="submit"]').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}web-enquiry-filled.png` });
  await p.click('#enquiryForm button[type="submit"]'); await p.waitForTimeout(1500);
  await p.locator('.enquiry-thanks').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -200)); await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}web-enquiry-thanks.png` });
  await ctx.close();
}

if (!only || only === 'hardware') {
  const ctx = await ctxFor(1.5); const p = await ctx.newPage();
  await p.goto(`${ORIGIN}/`); await p.waitForTimeout(4000);
  const sec = p.locator('[data-hardware-showcase]');
  const top = await sec.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const h = await sec.evaluate((el) => el.scrollHeight);
  await p.evaluate((y) => window.scrollTo(0, y), top - 40); await p.waitForTimeout(4000);
  const rec = await startRec(p, 'web-hardware', OUT, { width: 1920, height: 1080 });
  await p.waitForTimeout(1500);
  for (let y = top - 40; y < top + h - 800; y += 14) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(45); }
  await p.waitForTimeout(2500);
  await stopRec(rec);
  // stills: closed and open
  await p.evaluate((y) => window.scrollTo(0, y), top - 40); await p.waitForTimeout(3500);
  await p.locator('[data-hardware-viewer]').screenshot({ path: `${OUT}web-hw-closed.png` });
  const st3 = p.locator('[data-hardware-stage="3"]');
  await st3.evaluate((el) => el.scrollIntoView({ block: 'center' })); await p.waitForTimeout(4000);
  await p.locator('[data-hardware-viewer]').screenshot({ path: `${OUT}web-hw-open.png` });
  await ctx.close();
}

if (!only || only === 'experience') {
  const ctx = await ctxFor(1.5); const p = await ctx.newPage();
  await p.goto(`${ORIGIN}/#experience`); await p.waitForTimeout(3000);
  await p.locator('[data-experience-launch]').first().click(); await p.waitForTimeout(14000);
  await p.screenshot({ path: `${OUT}web-exp-before.png` });
  const rec = await startRec(p, 'web-experience', OUT, { width: 1920, height: 1080 });
  await p.waitForTimeout(1200);
  await p.locator('[data-testid="experience-dialog"] button', { hasText: 'IRRIGATE' }).first().click();
  await p.waitForTimeout(9000);
  await stopRec(rec);
  await ctx.close();
}
await b.close();
