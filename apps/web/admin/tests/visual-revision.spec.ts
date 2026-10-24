import { test, expect } from '@playwright/test';
import { stepHinge, ENCLOSURE_OPEN_RADIANS } from '../src/features/enclosureHinge';
import path from 'node:path';
import fs from 'node:fs';

test.describe.configure({ mode: 'parallel' });
const evidence = path.resolve('../../../docs/test-evidence/visual-revision');

test('public first load needs no auth or branded gate; header survives Back and Forward', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#publicTitle')).toBeVisible();
  await expect(page.locator('#agroflow-splash')).toHaveCount(0);
  await page.locator('.visual-header').evaluate(node => node.setAttribute('data-review-identity', 'same-node'));
  const origin = await page.evaluate(() => performance.timeOrigin);
  for (const route of ['/about', '/technology', '/contact', '/get-the-app']) {
    await page.locator(`.visual-header a[href="${route}"]`).click();
    await expect(page).toHaveURL(new RegExp(route + '$'));
    await expect(page.locator('#publicTitle')).toBeVisible();
    await expect(page.locator('.visual-header')).toHaveAttribute('data-review-identity', 'same-node');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  }
  await page.goBack(); await expect(page).toHaveURL(/\/contact$/);
  await page.goForward(); await expect(page).toHaveURL(/\/get-the-app$/);
  await page.goto('/not-a-real-page');
  await expect(page.locator('#publicTitle')).toHaveText('Page not found');
  await page.reload(); await expect(page.locator('#publicTitle')).toHaveText('Page not found');
  expect(external).toEqual([]);
});

test('hinge is bounded and reverses continuously, opening outward', () => {
  let value = 0, velocity = 0;
  expect(ENCLOSURE_OPEN_RADIANS).toBeLessThan(0);
  for (let i = 0; i < 180; i++) {
    const next = stepHinge(value, velocity, i < 25 ? 1 : i < 40 ? 0 : 1, 1 / 60);
    expect(next.value).toBeGreaterThanOrEqual(0);
    expect(next.value).toBeLessThanOrEqual(1);
    expect(Math.abs(next.value - value)).toBeLessThan(0.1);
    value = next.value; velocity = next.velocity;
  }
  expect(value).toBeCloseTo(1, 4);
});

for (const language of ['en', 'af', 'tn']) for (const theme of ['light', 'dark'])
  for (const width of [320, 390, 768, 1366]) {
    test(`public evidence ${language} ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : width === 1366 ? 768 : 844 });
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('agroflow_public_language', language);
        localStorage.setItem('agroflow_appearance', theme);
      }, { language, theme });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const forbidden: string[] = [];
      page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') || (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')) forbidden.push(request.url()); });
      for (const [name, route] of [['home', '/'], ['about', '/about'], ['technology', '/technology']]) {
        await page.goto(route);
        await expect(page.locator('#publicTitle')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: path.join(evidence, `${name}-${language}-${theme}-${width}.png`), fullPage: true });
      }
      expect(forbidden).toEqual([]);
    });
  }

test('physical lid keeps the hinge attached and its free edge opens outward at several angles', async ({ page }) => {
  await page.goto('/technology');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/features/hardwareModel.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { buildHardwareModel } = await import(modelPath);
    const THREE = await import(threePath);
    const model = buildHardwareModel(THREE);
    const positions = [0, -0.5, -1, -2.05].map(angle => {
      model.lid.rotation.y = angle;
      model.root.updateMatrixWorld(true);
      return { pivot: model.lid.getWorldPosition(new THREE.Vector3()).toArray(), tip: model.lid.localToWorld(new THREE.Vector3(5.4, 0, 0)).toArray() };
    });
    return positions;
  });
  for (const position of result) expect(position.pivot).toEqual(result[0].pivot);
  for (const position of result.slice(1)) expect(position.tip[2]).toBeGreaterThan(result[0].tip[2]);
});

test('doubled public text retains menu and content', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/technology');
  await page.addStyleTag({ content: 'html {font-size:200%} .visual-site :is(p,a,button,select,summary,label){font-size:1rem;line-height:1.5}' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('[data-public-menu]')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'technology-en-light-320-text200.png'), fullPage: true });
});
