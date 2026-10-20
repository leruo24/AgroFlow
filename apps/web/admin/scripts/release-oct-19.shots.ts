import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockBackend, captureErrors, ADMIN_ID } from "../tests/mockBackend";

/* Release oct-19 screenshots of the admin site at 1366x768 and 390x844: Home with the
 * notification bell, a farmer's page (Unlink Telegram, Reset password), the farm drawer's
 * maximum run time, Change password, and the product page. Everything is mocked. */

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/test-evidence/release-oct-19/admin");
const FARMER_ID = "00000000-0000-4000-8000-0000000000fa";

const USERS = [
  { id: ADMIN_ID, name: "Test Admin", email: "admin@agroflow.test", phone: null, role: "admin", created_at: "2026-09-01T08:00:00Z",
    farm_id: null, farm_name: null, telegram_linked: false, telegram_alerts_enabled: true },
  { id: FARMER_ID, name: "Thandi Nkosi", email: "thandi@example.org", phone: "082 555 0101", role: "farm_user",
    created_at: "2026-09-10T08:00:00Z", farm_id: 1, farm_name: "Nkosi Farm", telegram_linked: true, telegram_alerts_enabled: true },
];
const FARMS = [{ farm_id: 1, name: "Nkosi Farm", location: "Philippi, Cape Town", status: "Active", owner_id: FARMER_ID, total_area: 0.5 }];
const PENDING = [{ id: 41, farmer_id: FARMER_ID, farm_id: null, request_type: "new_farm", location: "Philippi", rough_size: 1, crop_type: "maize",
  notes: null, status: "pending", created_at: "2026-10-19T07:00:00Z", updated_at: "2026-10-19T07:00:00Z",
  assigned_to_profile_id: null, scheduled_by_profile_id: null, scheduled_at: null, completed_by_profile_id: null, completed_at: null }];

async function signedIn(page: Page): Promise<string[]> {
  const errors = captureErrors(page);
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, p) => {
      if (method === "GET" && p === "/api/users") return USERS;
      if (method === "GET" && p === "/api/farms") return FARMS;
      if (method === "GET" && p === "/api/admin/enquiries/summary") return { waiting: 2, callbacksDue: 1 };
      if (method === "GET" && p === "/rest/v1/service_request") return PENDING;
      if (method === "GET" && p === "/api/farmer/reports/zones") {
        return [{ zoneId: 11, name: "Bed 1", cropType: "tomato", irrigationMode: "automatic", maxRunMinutes: 5 },
                { zoneId: 12, name: "Bed 2", cropType: "spinach", irrigationMode: "manual", maxRunMinutes: 30 }];
      }
      return undefined;
    },
  });
  return errors;
}

for (const [tag, viewport] of [["1366", { width: 1366, height: 768 }], ["390", { width: 390, height: 844 }]] as const) {
  test.describe(`admin ${tag}`, () => {
    test.use({ viewport });

    test(`Home and the bell ${tag}`, async ({ page }) => {
      const errors = await signedIn(page);
      await page.goto("/#dashboard");
      await expect(page.locator("#bellCount")).toHaveText("4", { timeout: 15000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${tag}-home.png` });
      await page.locator("#bellBtn").click();
      await expect(page.locator("#bellMenu")).toHaveClass(/open/);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-home-bell-open.png` });
      expect(errors).toEqual([]);
    });

    test(`a farmer's page ${tag}`, async ({ page }) => {
      const errors = await signedIn(page);
      await page.goto("/#users");
      await expect(page.locator("#content")).toHaveAttribute("data-page", "users", { timeout: 15000 });
      await page.locator(`[data-act="view-user"][data-id="${FARMER_ID}"]`).first().click();
      await expect(page.getByRole("button", { name: "Unlink Telegram" })).toBeVisible({ timeout: 15000 });
      await expect(page.locator(`button[data-act="reset-password"][data-id="${FARMER_ID}"]`)).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${tag}-farmer-page.png` });
      await page.getByRole("button", { name: "Unlink Telegram" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${tag}-farmer-page-telegram-and-reset.png` });
      expect(errors).toEqual([]);
    });

    test(`max run time ${tag}`, async ({ page }) => {
      const errors = await signedIn(page);
      await page.goto("/#farms");
      await page.locator('[data-act="view-farm"][data-id="1"]').first().click();
      const cell = page.locator('[data-today-zone="12"] [data-zone-max-run]');
      await expect(cell).toContainText("30 min", { timeout: 15000 });
      await cell.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${tag}-farm-max-run.png` });
      await cell.getByRole("link", { name: "Change" }).click();
      await expect(page.getByText("Maximum run time: Bed 2")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-farm-max-run-change.png` });
      expect(errors).toEqual([]);
    });

    test(`Change password ${tag}`, async ({ page }) => {
      const errors = await signedIn(page);
      await page.goto("/#dashboard");
      await page.locator("#avatarBtn").click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${tag}-account-menu.png` });
      await page.locator("#avatarMenu").getByRole("link", { name: "Change password" }).click();
      await expect(page.locator('[data-field="newPassword"]')).toBeFocused({ timeout: 5000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${tag}-change-password.png` });
      expect(errors).toEqual([]);
    });

    test(`product page and staff Forgot password ${tag}`, async ({ page }) => {
      await page.route("**/rest/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /A smarter way to manage water/ })).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${tag}-product-page.png` });
      await page.goto("/#/admin");
      await page.getByRole("button", { name: "Forgot password?" }).click();
      await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
      await page.screenshot({ path: `${OUT}/${tag}-staff-forgot-password.png` });
    });
  });
}
