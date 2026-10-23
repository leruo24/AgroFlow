import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Item 6: the farm page shows each zone's one action, how sure, and what is
   missing; registering a farm asks for soil, size and planting. Mocked
   backend only. */

const FARMS = [
  { farm_id: 1, name: "Alpha Farm", owner_id: "f1", owner_name: "Owner A", location: "Ceres, Western Cape",
    total_area: 1, status: "Active", updated_at: "2026-10-01T08:00:00Z" },
];

const TODAY = {
  farmId: 1,
  day: "2026-10-06",
  zones: [
    {
      zoneId: 11, name: "Bed 1",
      action: { kind: "water", text: "Water about 8 min this morning (about 12 L)" },
      why: { summary: "Your soil has dried to the watering point.", facts: [], rule: "r", confidence: "Medium" },
      confidence: { level: "medium", reason: "Medium: based on the weather; the planting date is missing." },
      confidenceExplanation: { summary: "Medium: the planting date is missing.", facts: [], rule: "r", confidence: "Medium" },
      nextStep: { field: "planting_date", ask: "Add the planting date for advice that follows your crop's growth." },
    },
  ],
};

async function open(page: Page, extra?: (method: string, path: string) => unknown) {
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 40,
    respond: (method, path) => {
      const custom = extra?.(method, path);
      if (custom !== undefined) return custom;
      if (method === "GET" && path === "/api/farms") return FARMS;
      if (method === "GET" && path === "/api/farmer/reports/zones") return [{ zoneId: 11, name: "Bed 1", farmId: 1, cropType: "tomato" }];
      if (method === "GET" && path === "/api/farmer/farms/1/today") return TODAY;
      if (method === "GET" && path === "/api/users/farmers") return [{ id: "f1", name: "Owner A", email: "a@example.com", phone: null }];
      return undefined;
    },
  });
  await page.goto("/staff/#farms");
  await expect(page.locator('[data-act="view-farm"][data-id="1"]')).toBeVisible({ timeout: 15000 });
}

test("the farm drawer shows each zone's action, confidence and next step", async ({ page }) => {
  const errors = captureErrors(page);
  await open(page);

  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  const row = page.locator('[data-today-zone="11"]');
  await expect(row).toContainText("Water about 8 min this morning (about 12 L)", { timeout: 15000 });
  await expect(row).toContainText("Medium");
  await expect(row).toContainText("Add the planting date");
  await expect(row.getByText("Why am I seeing this?")).toHaveCount(0);   // farmers only

  expect(errors).toEqual([]);
});

test("registering a farm asks for soil (Loam by default), a size preset and weeks since planting", async ({ page }) => {
  const posts: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/farms/register")) posts.push(JSON.parse(r.postData() ?? "{}"));
  });
  await open(page, (method, path) => (method === "POST" && path === "/api/farms/register" ? {} : undefined));

  await page.locator('[data-act="add-farm"]').click();
  const wiz = page.locator('[data-wizard="register-farm"]');
  await expect(wiz).toBeVisible({ timeout: 15000 });

  await wiz.locator(".picker-option", { hasText: "Owner A" }).click();
  await wiz.locator("[data-wizard-next]").click();

  await wiz.locator('[data-field="farmName"]').fill("Beta Farm");
  await wiz.locator('[data-field="location"]').fill("Ceres, Western Cape");
  await wiz.locator('[data-field="farmSize"]').fill("1");
  await wiz.locator("[data-wizard-next]").click();

  // Soil: three cards, Loam chosen, and the "Not sure?" line.
  await expect(wiz.locator('[data-act="zone-soil"]')).toHaveCount(3);
  await expect(wiz.locator('[data-act="zone-soil"].is-selected')).toHaveText(/Loam/);
  await expect(wiz).toContainText("Not sure? Pick Loam.");
  // RET-07: custom soil cards behave like one named native radio group.
  const soilGroup = wiz.getByRole('radiogroup', { name: 'Zone 1 soil' });
  const loam = soilGroup.getByRole('radio', { name: /Loam/ });
  await expect(loam).toHaveAttribute('aria-checked', 'true');
  await loam.focus(); await page.keyboard.press('ArrowRight');
  await expect(soilGroup.getByRole('radio', { name: /Clay/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(loam).toHaveAttribute('aria-checked', 'true');

  await wiz.locator('[data-field="zone_name_0"]').fill("North Plot");
  await wiz.locator('[data-field="zone_crop_0"]').selectOption({ index: 1 });

  // Size is required before Next.
  await wiz.locator("[data-wizard-next]").click();
  await expect(page.locator("body")).toContainText("Choose how big zone 1 is.");

  await wiz.locator('[data-act="zone-soil"][data-soil="clay"]').click();
  await expect(wiz.locator('[data-act="zone-soil"].is-selected')).toHaveText(/Clay/);

  // Custom shows the m² box; a preset hides it again.
  await expect(wiz.locator('[data-area-custom="0"]')).toBeHidden();
  await wiz.locator('[data-field="zone_area_preset_0"]').selectOption("custom");
  await expect(wiz.locator('[data-area-custom="0"]')).toBeVisible();
  await wiz.locator('[data-field="zone_area_preset_0"]').selectOption("small");
  await expect(wiz.locator('[data-area-custom="0"]')).toBeHidden();

  await wiz.locator('[data-field="zone_weeks_0"]').fill("3");
  await wiz.locator('[data-field="zone_flow_0"]').fill("1.5");
  await wiz.locator('[data-field="zone_depth_cm_0"]').fill("30");
  await wiz.locator("[data-wizard-next]").click();

  await expect(page.locator("#registerFarmReview")).toContainText("Clay");
  await expect(page.locator("#registerFarmReview")).toContainText("about 3 weeks ago");
  await wiz.locator("[data-wizard-confirm]").click();

  await expect.poll(() => posts.length).toBe(1);
  const zone = (posts[0] as { farm: { zones: Record<string, unknown>[] } }).farm.zones[0];
  expect(zone).toMatchObject({
    name: "North Plot", soilType: "clay", areaM2: 0.2, sizeHectares: 0.00002, flowRateLpm: 1.5, rootDepthLimitM: 0.3,
  });
  expect(zone.plantingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("the wizard blocks Next until a step is valid, and Back keeps what was typed", async ({ page }) => {
  await open(page);
  await page.locator('[data-act="add-farm"]').click();
  const wiz = page.locator('[data-wizard="register-farm"]');

  // Step 1: no farmer chosen - Next stays on step 1 and says why.
  await wiz.locator("[data-wizard-next]").click();
  await expect(page.locator("body")).toContainText("Choose the farmer this farm belongs to.");
  await wiz.locator(".picker-option", { hasText: "Owner A" }).click();
  await wiz.locator("[data-wizard-next]").click();

  // Step 2: empty name blocks; then fill, go on, come back - still there.
  await wiz.locator("[data-wizard-next]").click();
  await expect(page.locator("body")).toContainText("Give the farm a name.");
  await wiz.locator('[data-field="farmName"]').fill("Back And Forth Farm");
  await wiz.locator('[data-field="location"]').fill("Ceres, Western Cape");
  await wiz.locator('[data-field="farmSize"]').fill("2");
  await wiz.locator("[data-wizard-next]").click();
  await expect(wiz.locator('[data-field="zone_name_0"]')).toBeVisible();
  await wiz.locator("[data-wizard-back]").click();
  await expect(wiz.locator('[data-field="farmName"]')).toHaveValue("Back And Forth Farm");
  await expect(wiz.locator('[data-field="farmSize"]')).toHaveValue("2");
});

// Part 0: each zone's watering mode, as saved, including Manual (it used to read as Automatic
// in the app; the console did not show it at all).
test("the farm drawer shows each zone's watering mode, Manual included", async ({ page }) => {
  const errors = captureErrors(page);
  await open(page, (method, path) => method === "GET" && path === "/api/farmer/reports/zones"
    ? [
        { zoneId: 11, name: "Bed 1", cropType: "tomato", irrigationMode: "manual" },
        { zoneId: 12, name: "Bed 2", cropType: "spinach", irrigationMode: "automatic" },
        { zoneId: 13, name: "Bed 3", cropType: "onion", irrigationMode: "scheduled" },
      ]
    : undefined);
  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  await expect(page.locator('[data-today-zone="11"] [data-zone-mode]')).toHaveText("Manual (never by itself)", { timeout: 15000 });
  await expect(page.locator('[data-today-zone="12"] [data-zone-mode]')).toHaveText("Automatic");
  await expect(page.locator('[data-today-zone="13"] [data-zone-mode]')).toHaveText("Scheduled");
  expect(errors).toEqual([]);
});

// Release oct-19: each zone's maximum run time, set by staff from the farm drawer.
test("staff see and change a zone's maximum run time from the farm drawer", async ({ page }) => {
  const errors = captureErrors(page);
  const puts: string[] = [];
  await open(page, (method, path) => {
    if (method === "GET" && path === "/api/farmer/reports/zones") {
      return [{ zoneId: 11, name: "Bed 1", cropType: "tomato", irrigationMode: "automatic", maxRunMinutes: 5 }];
    }
    if (method === "PUT" && path === "/api/admin/zones/11/max-run") {
      puts.push(path);
      return { zoneId: 11, maxRunMinutes: 30, message: "Runs on this zone now stop after 30 min at most. The kit gets the new limit with its next command." };
    }
    return undefined;
  });
  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  const cell = page.locator('[data-today-zone="11"] [data-zone-max-run]');
  await expect(cell).toContainText("5 min", { timeout: 15000 });

  await cell.getByRole("link", { name: "Change" }).click();
  await expect(page.getByText("Maximum run time: Bed 1")).toBeVisible();
  const box = page.locator('input[data-field="minutes"]');
  await expect(box).toHaveValue("5");

  // Out of range: caught before anything is sent.
  await box.fill("500");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast")).toContainText("from 1 to 120");
  expect(puts).toEqual([]);

  await box.fill("30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast.toast-success")).toContainText("now stop after 30 min at most");
  expect(puts).toEqual(["/api/admin/zones/11/max-run"]);
  expect(errors).toEqual([]);
});
