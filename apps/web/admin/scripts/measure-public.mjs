// Read-only local fixture measurement. Start the Playwright fake-host Vite server first.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
  if (url.hostname === 'testproject.supabase.co' || url.hostname === 'api.agroflow.test')
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  return route.abort();
});
const page = await context.newPage();
const results = [];
try {
  for (const destination of ['/', '/about', '/technology']) {
    const started = performance.now();
    if (destination === '/') await page.goto('http://localhost:5183/');
    else await page.locator('.visual-header a[href="' + destination + '"]').click();
    await page.locator('#publicTitle').waitFor();
    await page.locator('#agroflow-splash').waitFor({ state: 'detached' });
    results.push({ destination, visibleMs: Math.round(performance.now() - started), timeOrigin: await page.evaluate(() => performance.timeOrigin) });
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
