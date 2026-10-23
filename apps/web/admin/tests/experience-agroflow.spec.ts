import { expect, test, type Page } from "@playwright/test";
import path from 'node:path';
import { captureErrors, FAKE_API, FAKE_SUPABASE } from "./mockBackend";

async function openPublicExperience(page: Page): Promise<void> {
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/experience");
  await page.locator("#agroflow-splash").waitFor({ state: "detached", timeout: 15_000 });
  const launch = page.getByRole("button", { name: /Launch interactive demo/ });
  await launch.scrollIntoViewIfNeeded();
  await launch.click();
  await expect(page.getByTestId("experience-dialog")).toBeVisible({ timeout: 15_000 });
}

test("homepage demo opens, waters the field, explains the decision and exits", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = captureErrors(page);
  await openPublicExperience(page);

  // The 3D scene is lazy-loaded (three.js is its own chunk), so on a cold
  // dev server the canvas can take longer than the default 5 s to appear.
  const canvas = page.locator(".experience-stage .soil-cutaway svg");
  await canvas.waitFor({ state: "attached", timeout: 15_000 });
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".experience-recommendation .experience-kicker")).toHaveText("Water today");
  await page.getByRole("button", { name: "See why" }).click();
  await expect(page.getByText("Weather demand", { exact: true })).toBeVisible();
  await expect(page.getByText("Root-zone depletion", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close explanation" }).click();

  await page.getByRole("button", { name: "Other options" }).click();
  await page.getByRole("button", { name: "Adjust to 1,200 L" }).click();
  await page.getByRole("button", { name: "Irrigate", exact: true }).click();
  // Any phone state that shows Irrigate sent the command, not one transient frame.
  await expect(page.locator(".experience-phone")).toContainText(/Command sent|Controller ready|Target reached/);
  await expect(page.getByText("Irrigating North Field", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Irrigation complete", { exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Heavy rain expected", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("That's AgroFlow", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/1,200 L applied/).last()).toBeVisible();

  await page.getByRole("button", { name: "Return to site" }).click();
  await expect(page.getByTestId("experience-dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "See a decision take shape." })).toBeVisible();
  expect(errors).toEqual([]);
});

test("demo stays usable without horizontal page overflow at desktop, tablet and phone widths", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 320, height: 844 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    await openPublicExperience(page);
    const dialog = page.getByTestId("experience-dialog");
    const box = await dialog.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(viewport.width);
    const canvas = page.locator(".experience-stage .soil-cutaway svg");
    await canvas.waitFor({ state: "attached", timeout: 15_000 });
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Irrigate/ }).first()).toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({path:path.resolve(`../../../docs/test-evidence/visual-redesign/public-experience-2d-en-${viewport.width}.png`)});
    await page.getByRole("button", { name: "Close Experience AgroFlow" }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test("the guided UI stays minimal while farmer options remain available secondarily", async ({ page }) => {
  await openPublicExperience(page);
  await expect(page.getByRole("button", { name: "Heavy rain incoming" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sensor disagreement" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Root-zone view" })).toHaveCount(0);
  await expect(page.locator(".experience-live, .experience-plan")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Postpone" })).toHaveCount(0);
  await page.getByRole("button", { name: "Other options" }).click();
  await expect(page.getByTestId("farmer-options")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust to 1,200 L" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Postpone" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(page.locator(".experience-card:visible")).toHaveCount(1);
});
