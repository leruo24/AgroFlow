// Run against the isolated fake-host server on 5183. Generated review videos only.
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const out = path.resolve('../../../docs/test-evidence/visual-revision');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const name of ['enclosure', 'irrigation-demo']) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, recordVideo: { dir: out, size: { width: 1366, height: 768 } } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    if (name === 'enclosure') {
      await page.goto('http://localhost:5183/technology');
      const viewer = page.locator('[data-hardware-viewer]');
      await viewer.scrollIntoViewIfNeeded();
      await page.locator('[data-hardware-viewer].is-ready').waitFor();
      await page.locator('[data-hardware-reset]').click();
      await page.waitForTimeout(900);
      await page.locator('[data-hardware-toggle]').click();
      await page.waitForTimeout(1200);
      await page.locator('[data-hardware-rotate="left"]').click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, 'enclosure-open-left.png') });
      await page.locator('[data-hardware-rotate="right"]').click({ clickCount: 3 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, 'enclosure-open-right.png') });
      await page.locator('[data-hardware-close]').click();
      await page.waitForTimeout(180);
      await page.locator('[data-hardware-toggle]').click();
      await page.waitForTimeout(1000);
      await page.locator('[data-hardware-reset]').click();
      await page.waitForTimeout(1000);
    } else {
      await page.goto('http://localhost:5183/technology');
      const panel = page.locator('[data-irrigation-illustration]');
      await panel.scrollIntoViewIfNeeded();
      await page.locator('[data-demo-start]').click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(out, 'demo-running.png') });
      await page.locator('[data-demo-stop]').click();
      await page.waitForTimeout(700);
      await page.locator('[data-demo-reset]').click();
      await panel.locator('summary').click();
      await page.waitForTimeout(700);
    }
    const video = page.video();
    await context.close();
    fs.renameSync(await video.path(), path.join(out, name + '.webm'));
    console.log(name + '.webm');
  }
} finally { await browser.close(); }
