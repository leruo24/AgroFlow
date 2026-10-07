import { expect, test, type Page } from "@playwright/test";
import { captureErrors, FAKE_API, FAKE_SUPABASE } from "./mockBackend";

async function mockPublicPage(page: Page): Promise<void> {
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}",
  }));
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]",
  }));
}

test("public hardware story is usable and does not block the rest of the landing page", async ({ page }) => {
  const errors = captureErrors(page);
  await mockPublicPage(page);
  await page.goto("/");
  await page.locator("#agroflow-splash").waitFor({ state: "detached", timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "The AgroFlow field controller" })).toBeVisible({ timeout: 15_000 });
  const viewer = page.locator("[data-hardware-viewer]");
  await expect(viewer).toBeVisible();
  await expect(page.locator("[data-hardware-fallback]:visible, [data-hardware-canvas] canvas:visible").first()).toBeVisible();

  const componentNames = [
    "ESP32 Controller",
    "Soil Moisture Sensor",
    "DHT11 Sensor",
    "Relay Module",
    "Pump Output",
    "Power Input",
  ];
  for (const name of componentNames) {
    await expect(page.getByRole("button", { name, includeHidden: true })).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "Rotate product left" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Reset product view" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Rotate product right" })).toBeAttached();

  await page.getByRole("heading", { name: "Inside AgroFlow" }).scrollIntoViewIfNeeded();
  const stickyBox = await viewer.boundingBox();
  expect(stickyBox).not.toBeNull();
  expect(stickyBox!.y).toBeGreaterThanOrEqual(20);
  expect(stickyBox!.y).toBeLessThanOrEqual(30);

  await page.getByRole("heading", { name: "How it works" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.getByRole("button", { name: "Admin console" }).first().click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { name: "AgroFlow" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("hardware story remains compact and overflow-free on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPublicPage(page);
  await page.goto("/");
  await page.locator("#agroflow-splash").waitFor({ state: "detached", timeout: 15_000 });

  const viewer = page.locator("[data-hardware-viewer]");
  await viewer.scrollIntoViewIfNeeded();
  await expect(viewer).toBeVisible();
  const box = await viewer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(300);
  expect(box!.height).toBeLessThanOrEqual(380);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.getByRole("heading", { name: "How it works" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
});
