import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { FAKE_API, FAKE_SUPABASE, mockBackend } from "../tests/mockBackend";

const phase = process.env["UI_EVIDENCE_PHASE"] === "before" ? "before" : "after";
const evidence = path.resolve(`../../../docs/test-evidence/ui-redesign-2026-10-24/${phase}`);

async function mockPublic(page: Page) {
  await page.route(`${FAKE_SUPABASE}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route(`${FAKE_API}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

async function settleImages(page: Page) {
  await page.locator("img").evaluateAll((images) => {
    images.forEach((image) => ((image as HTMLImageElement).loading = "eager"));
  });
  await expect
    .poll(
      () => page.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
}

const screenshotOptions = { fullPage: true, animations: "disabled" as const };

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1366, height: 768 },
  ]) {
    test(`${phase} public, technology and staff ${theme} ${viewport.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.addInitScript((preference) => {
        localStorage.setItem("agroflow_appearance", preference);
        localStorage.setItem("agroflow_public_language", "en");
      }, theme);

      await mockPublic(page);
      await page.goto("/");
      await expect(page.locator("#publicTitle")).toBeVisible();
      await settleImages(page);
      await page.screenshot({
        path: path.join(evidence, `public-home-${theme}-${viewport.name}.png`),
        ...screenshotOptions,
      });
      if (viewport.name === "phone") {
        await page.locator("[data-public-menu]").click();
        await expect(page.locator("[data-public-menu-close]")).toBeFocused();
        await page.screenshot({
          path: path.join(evidence, `public-menu-${theme}-${viewport.name}.png`),
          animations: "disabled",
        });
        await page.locator("[data-public-menu-close]").click();
      }

      await page.goto("/technology");
      await expect(page.locator("[data-irrigation-illustration]")).toBeVisible();
      await settleImages(page);
      await page.screenshot({
        path: path.join(evidence, `public-technology-${theme}-${viewport.name}.png`),
        ...screenshotOptions,
      });

      await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
      await page.goto("/staff/#dashboard");
      await expect(page.locator("#appShell")).toBeVisible();
      await page.locator("#agroflow-splash").waitFor({ state: "detached" });
      await settleImages(page);
      await page.screenshot({
        path: path.join(evidence, `staff-dashboard-${theme}-${viewport.name}.png`),
        ...screenshotOptions,
      });
      if (viewport.name === "phone") {
        await page.locator("#sidebarToggle").click();
        await expect(page.locator("#sidebar")).toHaveClass(/open/);
        await page.screenshot({
          path: path.join(evidence, `staff-drawer-${theme}-${viewport.name}.png`),
          animations: "disabled",
        });
      }
    });
  }
}
