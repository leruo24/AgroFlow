import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, FAKE_API, FAKE_SUPABASE, ADMIN_ID } from "./mockBackend";

/* Part 2: UI robustness. Every page, with no data, with every call failing,
   and at three screen sizes. Mocked backend only. */

const PAGES = [
  "dashboard", "requests", "users", "farms", "hardware", "mqttLogins", "alerts",
  "maintenance", "reports", "irrigation", "activity", "settings", "onboarding",
];

/* Pages built from several independent sections: one failing call blanks
   that section only, so there is no whole-page error to show. */
const DEGRADE_BY_SECTION = ["reports", "irrigation", "settings", "onboarding"];

async function settled(page: Page): Promise<void> {
  // Never an endless skeleton: within 10 s nothing is still loading.
  await expect(page.locator(".skeleton, .is-loading, [aria-busy=true]")).toHaveCount(0, { timeout: 10_000 });
}

for (const id of PAGES) {
  test(`${id}: loads with an empty database and says so`, async ({ page }) => {
    const errors = captureErrors(page);
    await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
    await page.goto(`/#${id}`);
    await expect(page.locator(".page-head, h1, .page-title").first()).toBeVisible({ timeout: 15_000 });
    await settled(page);
    expect(errors).toEqual([]);
  });

  test(`${id}: every call failing shows an error with a way out, not a blank page`, async ({ page }) => {
    await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
    // Registered after mockBackend, so these win: every data call fails.
    // The admin's own profile still loads - this is the API being down, not
    // the admin being signed out.
    await page.route(`${FAKE_API}/**`, (route) =>
      route.request().method() === "OPTIONS" ? route.fulfill({ status: 204 }) : route.fulfill({ status: 500, body: "boom" }));
    await page.route(`${FAKE_SUPABASE}/rest/v1/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/rest/v1/profile" && (url.searchParams.get("id") ?? "").includes(ADMIN_ID)) return route.fallback();
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' });
    });
    await page.goto(`/#${id}`);
    await settled(page);
    const content = page.locator("#content");
    if (DEGRADE_BY_SECTION.includes(id)) {
      // These pages lose only the failing sections; the page itself stays.
      await expect(content.locator(".page-head, h1, .page-title").first()).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(content.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 10_000 });
    }
    // A sentence, never raw JSON from the server.
    await expect(content).not.toContainText('{"');
  });
}

for (const [w, h] of [[1366, 768], [1920, 1080], [390, 844]] as const) {
  test(`no page scrolls sideways at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
    const wide: string[] = [];
    for (const id of PAGES) {
      await page.goto(`/#${id}`);
      await expect(page.locator(".page-head, h1, .page-title").first()).toBeVisible({ timeout: 15_000 });
      await settled(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) wide.push(`${id}: ${overflow}px`);
    }
    expect(wide).toEqual([]);
  });
}

test("the loading animation clears within 10 s even when its video is blocked", async ({ page }) => {
  await page.route(/\.(mp4|webm)(\?.*)?$/, (route) => route.abort());
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  const started = Date.now();
  await page.goto("/#dashboard");
  await expect(page.locator("#agroflow-splash")).toHaveCount(0, { timeout: 11_000 });
  expect(Date.now() - started).toBeLessThan(11_000);
});

test("a signed-in farmer is not let into the console", async ({ page }) => {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path, url) =>
      path === "/rest/v1/profile" && (url.searchParams.get("id") ?? "").includes(ADMIN_ID)
        ? { id: ADMIN_ID, name: "A Farmer", email: "farmer@example.com", role: "farm_user" }
        : undefined,
  });
  await page.goto("/#farms");
  await expect(page.locator("#nav")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText("Farms & zones");
});

test("a refused registration shows the server's own sentence, not 'Request failed (400)'", async ({ page }) => {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/users/farmers") return [{ id: "f1", name: "Owner A", email: "a@example.com", phone: null }];
      return undefined;
    },
  });
  await page.route(`${FAKE_API}/api/farms/register`, (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Farm size must be greater than 0." }) }));
  await page.goto("/#farms");
  await page.locator('[data-act="add-farm"]').click();
  const wiz = page.locator('[data-wizard="register-farm"]');
  await wiz.locator(".picker-option", { hasText: "Owner A" }).click();
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator('[data-field="farmName"]').fill("Beta Farm");
  await wiz.locator('[data-field="location"]').fill("Ceres, Western Cape");
  await wiz.locator('[data-field="farmSize"]').fill("1");
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator('[data-field="zone_name_0"]').fill("Tub 1");
  await wiz.locator('[data-field="zone_crop_0"]').selectOption("maize");
  await wiz.locator('[data-field="zone_area_preset_0"]').selectOption("small");
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator("[data-wizard-confirm]").click();

  await expect(page.locator("body")).toContainText("Farm size must be greater than 0.");
  await expect(page.locator("body")).not.toContainText("Request failed (400)");
  await expect(page.locator("body")).not.toContainText('{"message"');
});
