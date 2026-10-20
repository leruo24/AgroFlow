import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID } from "./mockBackend";

/* Telegram is for farmers only (docs/telegram-farmers-only.md). Staff notices that went to
 * Telegram are under the bell (and on Home), staff have Change password in the account menu,
 * Settings has no staff Telegram, and staff are not listed or linkable as farmers.
 * Everything is mocked. */

const FARMER_ID = "00000000-0000-4000-8000-0000000000fa";
const OFFICER_ID = "00000000-0000-4000-8000-0000000000f0";

const USERS = [
  { id: ADMIN_ID, name: "Test Admin", email: "admin@agroflow.test", phone: null, role: "admin", created_at: "2026-09-01T08:00:00Z",
    farm_id: null, farm_name: null, telegram_linked: false, telegram_alerts_enabled: true },
  { id: OFFICER_ID, name: "Field Officer", email: "officer@agroflow.test", phone: null, role: "field_officer", created_at: "2026-09-02T08:00:00Z",
    farm_id: null, farm_name: null, telegram_linked: false, telegram_alerts_enabled: true },
  { id: FARMER_ID, name: "Thandi Nkosi", email: "thandi@example.org", phone: "082 555 0101", role: "farm_user",
    created_at: "2026-09-10T08:00:00Z", farm_id: 1, farm_name: "Nkosi Farm", telegram_linked: false, telegram_alerts_enabled: true },
];

const PENDING = [
  { id: 41, farmer_id: FARMER_ID, farm_id: null, request_type: "new_farm", location: "Philippi", rough_size: 1, crop_type: "maize",
    notes: null, status: "pending", created_at: "2026-10-19T07:00:00Z", updated_at: "2026-10-19T07:00:00Z",
    assigned_to_profile_id: null, scheduled_by_profile_id: null, scheduled_at: null, completed_by_profile_id: null, completed_at: null },
];

async function signedIn(page: Page): Promise<void> {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/users") return USERS;
      if (method === "GET" && path === "/api/admin/enquiries/summary") return { waiting: 2, callbacksDue: 1 };
      if (method === "GET" && path === "/rest/v1/service_request") return PENDING;
      return undefined;
    },
  });
}

test("the bell shows the staff notices that used to go to Telegram, and opens each list", async ({ page }) => {
  const errors = captureErrors(page);
  await signedIn(page);
  await page.goto("/#dashboard");
  const bell = page.locator("#bellBtn");
  await expect(bell).toBeVisible({ timeout: 15000 });
  // 1 request + 1 call-back due + 2 enquiries waiting.
  await expect(page.locator("#bellCount")).toHaveText("4", { timeout: 15000 });
  await expect(bell).toHaveAttribute("aria-label", "Notifications: 4 need attention");

  await bell.click();
  const menu = page.locator("#bellMenu");
  await expect(menu).toHaveClass(/open/);
  await expect(menu.locator('[data-bell="requests"]')).toContainText("1 New requests waiting");
  await expect(menu.locator('[data-bell="callbacks"]')).toContainText("1 Call-backs due");
  await expect(menu.locator('[data-bell="enquiries"]')).toContainText("2 Enquiries waiting for a call");
  await expect(menu.locator('[data-bell="alerts"]')).toHaveCount(0);   // nothing at zero

  await menu.locator('[data-bell="requests"]').click();
  await expect(page.locator("#content")).toHaveAttribute("data-page", "requests", { timeout: 15000 });
  await expect(menu).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test("Change password is in the account menu and opens the password box", async ({ page }) => {
  const errors = captureErrors(page);
  await signedIn(page);
  await page.goto("/#dashboard");
  await page.locator("#avatarBtn").click();
  await page.locator("#avatarMenu").getByRole("link", { name: "Change password" }).click();
  await expect(page.locator("#content")).toHaveAttribute("data-page", "settings", { timeout: 15000 });
  await expect(page.locator('[data-field="newPassword"]')).toBeFocused({ timeout: 5000 });
  // No staff Telegram in Settings.
  await expect(page.locator("#myTelegramStatus")).toHaveText(
    "Telegram is for farmers only. You get every notice on Home and under the bell at the top of the page.");
  await expect(page.locator('[data-act="connect-my-telegram"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("staff are not listed as farmers, so there is no Telegram Connect for them", async ({ page }) => {
  const errors = captureErrors(page);
  await signedIn(page);
  await page.goto("/#users");
  await expect(page.locator("#content")).toHaveAttribute("data-page", "users", { timeout: 15000 });
  await expect(page.getByText("Thandi Nkosi").first()).toBeVisible();
  await expect(page.getByText("Field Officer")).toHaveCount(0);
  await expect(page.locator(`[data-act="send-link-code"][data-id="${OFFICER_ID}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-act="send-link-code"][data-id="${FARMER_ID}"]`).first()).toBeVisible();
  expect(errors).toEqual([]);
});
