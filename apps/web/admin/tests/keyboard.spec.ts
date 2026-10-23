import { test, expect, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/* Part 2: the register-farm wizard can be completed with the keyboard alone
   (Tab, typing, Enter), and wherever focus lands it can be seen. */

const FARMS = [{ farm_id: 1, name: "Alpha Farm", owner_id: "f1", owner_name: "Owner A", location: "Ceres, Western Cape",
  total_area: 5, status: "Active", updated_at: "2026-10-01T08:00:00Z" }];

/** Press Tab until focus is on `selector` - the way a keyboard user gets there. */
async function tabTo(page: Page, selector: string, max = 120): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) {
      // Focus must be visible wherever it lands.
      const visible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const style = getComputedStyle(el);
        return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
      });
      expect(visible, `focus ring on ${selector}`).toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${selector}`);
}

test("register a farm with the keyboard only", async ({ page }) => {
  const posts: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/farms/register")) posts.push(JSON.parse(r.postData() ?? "{}"));
  });
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/farms") return FARMS;
      if (method === "GET" && path === "/api/users/farmers") return [{ id: "f1", name: "Owner A", email: "a@example.com", phone: null }];
      if (method === "POST" && path === "/api/farms/register") return {};
      return undefined;
    },
  });
  await page.goto("/staff/#farms");
  await expect(page.locator('[data-act="add-farm"]')).toBeVisible({ timeout: 15000 });

  await tabTo(page, '[data-act="add-farm"]');
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-wizard="register-farm"]')).toBeVisible();

  await tabTo(page, ".picker-option");
  await page.keyboard.press("Enter");
  await tabTo(page, "[data-wizard-next]");
  await page.keyboard.press("Enter");

  await tabTo(page, '[data-field="farmName"]');
  await page.keyboard.type("Keyboard Farm");
  await tabTo(page, '[data-field="location"]');
  await page.keyboard.type("Ceres, Western Cape");
  await tabTo(page, '[data-field="farmSize"]');
  await page.keyboard.type("1");
  await tabTo(page, "[data-wizard-next]");
  await page.keyboard.press("Enter");

  await tabTo(page, '[data-field="zone_name_0"]');
  await page.keyboard.type("Bed 1");
  await tabTo(page, '[data-field="zone_crop_0"]');
  await page.keyboard.type("Maize");
  // RET-07: Tab enters the selected radio; arrows select within its group.
  await tabTo(page, '[data-act="zone-soil"][data-soil="loam"]');
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-act="zone-soil"][data-soil="clay"]')).toBeFocused();
  await expect(page.locator('[data-act="zone-soil"][data-soil="clay"]')).toHaveAttribute('aria-checked', 'true');
  await tabTo(page, '[data-field="zone_area_preset_0"]');
  await page.keyboard.type("Small");
  await tabTo(page, "[data-wizard-next]");
  await page.keyboard.press("Enter");

  await tabTo(page, "[data-wizard-confirm]");
  await page.keyboard.press("Enter");

  await expect.poll(() => posts.length).toBe(1);
  expect((posts[0] as { farm: { farmName: string; zones: Record<string, unknown>[] } }).farm).toMatchObject({ farmName: "Keyboard Farm" });
  expect((posts[0] as { farm: { zones: Record<string, unknown>[] } }).farm.zones[0]).toMatchObject({ cropType: "maize", soilType: "clay", areaM2: 0.2 });
  await expect(page.locator("body")).toContainText("Keyboard Farm is registered.");
});
