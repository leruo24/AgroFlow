import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Item 6b: "Recommended for you" on the farm's zones and in the register
   wizard. Mocked backend only. */

const FARMS = [
  { farm_id: 1, name: "Alpha Farm", owner_id: "f1", owner_name: "Owner A", location: "Mafikeng, North West",
    total_area: 1, status: "Active", updated_at: "2026-10-01T08:00:00Z" },
];

const REC = {
  available: true,
  cropLabel: "Potato",
  text: "Based on your climate in Mafikeng and since you want to grow potato on loam soil, we recommend: water when the soil reaches about 65% (relative), stop at 100%; expect to water about every 2–3 days in October, about 9 minutes each time for this 0.2 m² irrigation zone.",
  thresholdPercent: 65,
  confidence: { level: "medium", reason: "Medium: the planting date is missing, so peak growth is assumed." },
  canApply: true,
  applyNote: null,
};

async function open(page: Page, extra?: (method: string, path: string) => unknown) {
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 40,
    respond: (method, path) => {
      const custom = extra?.(method, path);
      if (custom !== undefined) return custom;
      if (method === "GET" && path === "/api/farms") return FARMS;
      if (method === "GET" && path === "/api/farmer/reports/zones") return [{ zoneId: 11, name: "Bed 1", farmId: 1, cropType: "potato" }];
      if (method === "GET" && path === "/api/farmer/farms/1/today") return { farmId: 1, day: "2026-10-06", zones: [] };
      if (method === "GET" && path === "/api/farmer/zones/11/recommended-settings") return REC;
      if (method === "GET" && path === "/api/users/farmers") return [{ id: "f1", name: "Owner A", email: "a@example.com", phone: null }];
      return undefined;
    },
  });
  await page.goto("/staff/#farms");
  await expect(page.locator('[data-act="view-farm"][data-id="1"]')).toBeVisible({ timeout: 15000 });
}

test("a zone's Recommended settings shows the card; Use these settings saves through Reset to recommended", async ({ page }) => {
  const errors = captureErrors(page);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/reset-recommended")) posts.push(new URL(r.url()).pathname);
  });
  await open(page, (method, path) =>
    method === "POST" && path === "/api/farmer/zones/11/reset-recommended"
      ? { message: "Reset for potato: waters at 2160, stops at 1200." } : undefined);

  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  await page.locator('[data-act="zone-recommend"][data-id="11"]').click();

  const card = page.locator('[data-recommend-zone="11"]');
  await expect(card).toContainText("water when the soil reaches about 65% (relative), stop at 100%");
  await expect(card).toContainText("Medium confidence");

  await card.getByRole("button", { name: "Use these settings" }).click();
  await expect.poll(() => posts).toEqual(["/api/farmer/zones/11/reset-recommended"]);
  await expect(page.locator("body")).toContainText("Reset for potato: waters at 2160, stops at 1200.");

  expect(errors).toEqual([]);
});

test("without the sensor setup, Use these settings is off and says why; Keep my own closes", async ({ page }) => {
  await open(page, (method, path) =>
    method === "GET" && path === "/api/farmer/zones/11/recommended-settings"
      ? { ...REC, canApply: false, applyNote: "Do the wet and dry soil setup first; then Use these settings saves this level." }
      : undefined);

  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  await page.locator('[data-act="zone-recommend"][data-id="11"]').click();
  const card = page.locator('[data-recommend-zone="11"]');
  await expect(card.getByRole("button", { name: "Use these settings" })).toBeDisabled();
  await expect(card).toContainText("Do the wet and dry soil setup first");

  await card.getByRole("button", { name: "Keep my own" }).click();
  await expect(card).toBeHidden();
});

test("the register wizard shows Recommended for you once a crop is chosen", async ({ page }) => {
  const previews: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/admin/recommended-settings/preview")) previews.push(JSON.parse(r.postData() ?? "{}"));
  });
  await open(page, (method, path) =>
    method === "POST" && path === "/api/admin/recommended-settings/preview"
      ? { ...REC, text: "Based on your climate in Ceres and since you want to grow potato on clay soil, we recommend: water when the soil reaches about 67% (relative), stop at 100%." }
      : undefined);

  await page.locator('[data-act="add-farm"]').click();
  const wiz = page.locator('[data-wizard="register-farm"]');
  await wiz.locator(".picker-option", { hasText: "Owner A" }).click();
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator('[data-field="farmName"]').fill("Beta Farm");
  await wiz.locator('[data-field="location"]').fill("Ceres, Western Cape");
  await wiz.locator('[data-field="farmSize"]').fill("1");
  await wiz.locator("[data-wizard-next]").click();

  await expect(wiz.locator('[data-recommend="0"]')).toBeEmpty();
  await wiz.locator('[data-act="zone-soil"][data-soil="clay"]').click();
  await wiz.locator('[data-field="zone_crop_0"]').selectOption("potato");

  await expect(wiz.locator('[data-recommend="0"]')).toContainText("Recommended for you");
  await expect(wiz.locator('[data-recommend="0"]')).toContainText("about 67% (relative)");
  expect(previews.at(-1)).toMatchObject({ cropType: "potato", soilType: "clay", location: "Ceres" });
});
