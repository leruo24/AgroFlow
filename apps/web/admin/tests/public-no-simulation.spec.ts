import { test, expect } from '@playwright/test';

// The public website shows no simulated farm data: no demo, no "experience" page and no
// screenshots taken from a simulated farm. Simulated farms stay a staff-only testing tool.
test.describe.configure({ mode: 'parallel' });
const routes = ['/', '/solutions', '/how-it-works', '/technology', '/about', '/get-the-app', '/contact', '/service-pricing', '/terms', '/privacy'];

for (const route of routes) {
  test(`${route} shows no simulation or demo`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('#publicTitle')).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/simulat|gesimuleer|etsisedits|interactive demo|start demo|experience agroflow/i);
    await expect(page.locator('[data-experience-launch], [data-demo-start], [data-hardware-demo], [data-irrigation-illustration], .app-shot')).toHaveCount(0);
    await expect(page.locator('a[href="/experience"]')).toHaveCount(0);
    expect(await page.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src).filter(src => src.includes('/media/app/')))).toEqual([]);
  });
}

test('the old /experience address opens Home', async ({ page }) => {
  await page.goto('/experience');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#publicTitle')).toBeVisible();
  await expect(page.locator('[data-experience-launch]')).toHaveCount(0);
});
