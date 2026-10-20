import { test, expect, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/* Part 2 (admin coherence): Home's numbers are the same numbers the list
   pages show - no contradictions. Mocked backend only. */

const FARMS = [1, 2, 3].map((id) => ({
  farm_id: id, name: `Farm ${id}`, owner_id: `f${id}`, owner_name: `Owner ${id}`, location: "Ceres, Western Cape",
  total_area: 1, status: "Active", updated_at: "2026-10-01T08:00:00Z",
}));

const REQUESTS = [
  { id: 1, farmer_id: "p1", farm_id: null, request_type: "new_farm", location: "Ceres", rough_size: 1, crop_type: "maize",
    notes: null, status: "pending", created_at: "2026-10-05T08:00:00Z", updated_at: "2026-10-05T08:00:00Z" },
  { id: 2, farmer_id: "p1", farm_id: 1, request_type: "new_zone", location: "Ceres", rough_size: 1, crop_type: "tomato",
    notes: null, status: "pending", created_at: "2026-10-04T08:00:00Z", updated_at: "2026-10-04T08:00:00Z" },
  { id: 3, farmer_id: "p1", farm_id: 1, request_type: "new_zone", location: "Ceres", rough_size: 1, crop_type: "potato",
    notes: null, status: "completed", created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-02T08:00:00Z" },
];

const alert = (id: number, status: string, message: string) => ({
  id, severity: "Warning", message, status, created_at: "2026-10-06T06:00:00Z",
  zone: { id: 11, name: "Bed 1", farm: { farm_id: 1, name: "Farm 1", status: "Active", owner: { name: "Owner 1", email: null } } },
});
const ALERTS = [alert(41, "Open", "First open alert"), alert(42, "Open", "Second open alert"), alert(43, "Resolved", "A resolved alert")];

async function open(page: Page, at: string) {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method !== "GET") return undefined;
      if (path === "/api/farms") return FARMS;
      if (path === "/rest/v1/service_request") return REQUESTS;
      if (path === "/rest/v1/alert") return ALERTS;
      return undefined;
    },
  });
  await page.goto(at);
}

async function tile(page: Page, label: string): Promise<number> {
  await expect(page.locator(".card .value[data-countup]").first()).toBeVisible({ timeout: 15000 });
  const value = await page.evaluate((wanted) => {
    for (const card of Array.from(document.querySelectorAll(".card"))) {
      if (card.querySelector(".label")?.textContent?.trim() === wanted) {
        return card.querySelector(".value")?.getAttribute("data-countup") ?? null;
      }
    }
    return null;
  }, label);
  expect(value, `tile "${label}"`).not.toBeNull();
  return Number(value);
}

test("Home's farms, requests waiting and open alerts equal what the list pages show", async ({ page }) => {
  await open(page, "/#dashboard");
  const farms = await tile(page, "Farms");
  const waiting = await tile(page, "Requests waiting");
  const openAlerts = await tile(page, "Open alerts");
  expect([farms, waiting, openAlerts]).toEqual([3, 2, 2]);

  await page.goto("/#farms");
  await expect(page.locator('[data-act="view-farm"]')).toHaveCount(farms, { timeout: 15000 });

  await page.goto("/#requests");
  await expect(page.locator("tbody tr", { hasText: "pending" })).toHaveCount(waiting, { timeout: 15000 });

  await page.goto("/#alerts");
  await expect(page.locator("tr", { hasText: "open alert" })).toHaveCount(openAlerts, { timeout: 15000 });
});

test("each Home tile opens the list it counts", async ({ page }) => {
  await open(page, "/#dashboard");
  await expect(page.locator(".card", { hasText: "Requests waiting" })).toBeVisible({ timeout: 15000 });
  await page.locator(".card", { hasText: "Requests waiting" }).first().click();
  await expect(page).toHaveURL(/#requests/);

  await page.goto("/#dashboard");
  await page.locator(".card", { hasText: /^\s*Farms/ }).first().click();
  await expect(page).toHaveURL(/#farms/);
});
