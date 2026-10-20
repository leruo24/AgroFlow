import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockBackend, ADMIN_ID } from "../tests/mockBackend";

/* Visual polish screenshots of the public site and the admin console at 1366x768 and 390x844
 * (docs/overnight-report-2026-10-21.md), before (dev) and after (fix/visual-polish):
 *   VP_OUT=before VP_CONSOLE=/ VP_SIGNIN=/#/admin npx playwright test --config scripts/screenshots.config.ts visual-polish
 *   VP_OUT=after  (defaults: the console at /staff/)
 * Everything is mocked; the only farms are the simulated Mahikeng and Ottoshoop. */

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/test-evidence/visual-polish", process.env.VP_OUT ?? "after");
const CONSOLE = process.env.VP_CONSOLE ?? "/staff/";
const SIGNIN = process.env.VP_SIGNIN ?? "/staff/";
const SLOW_MS = Number(process.env.VP_SLOW_MS ?? 10_500);
const FARMER_ID = "00000000-0000-4000-8000-0000000000fa";

const USERS = [
  { id: ADMIN_ID, name: "Test Admin", email: "admin@agroflow.test", phone: null, role: "admin", created_at: "2026-09-01T08:00:00Z",
    farm_id: null, farm_name: null, telegram_linked: false, telegram_alerts_enabled: true },
  { id: FARMER_ID, name: "Thabo Molefe", email: "thabo@example.org", phone: "082 555 0101", role: "farm_user",
    created_at: "2026-09-10T08:00:00Z", farm_id: 1, farm_name: "Mahikeng (Simulated)", telegram_linked: true, telegram_alerts_enabled: true },
];
const FARMS = [{ farm_id: 1, name: "Mahikeng (Simulated)", location: "Mahikeng, North West", status: "Active", owner_id: FARMER_ID, total_area: 0.5,
  latitude: -25.86522, longitude: 25.64421, is_simulated: true }];
const ALERT = {
  id: 42, severity: "Critical", message: "Maize entered Critical: soil sensor reading 12.", status: "Open", created_at: "2026-10-20T06:00:00Z",
  zone: { id: 11, name: "Maize", farm: { farm_id: 1, name: "Mahikeng (Simulated)", status: "Active", owner: { name: "Thabo Molefe", email: null } } },
};
const EXPLANATION = { explanation: { summary: "The zone's soil sensor reading dropped very low.", facts: [], rule: "Below 20 is critical.", confidence: "High." } };

async function console_(page: Page, opts: { slowUsers?: boolean } = {}): Promise<void> {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    delayFor: (method, p) => (opts.slowUsers && method === "GET" && p === "/api/users" ? 60_000 : undefined),
    respond: (method, p) => {
      if (method === "GET" && p === "/api/users") return USERS;
      if (method === "GET" && p === "/api/farms") return FARMS;
      if (method === "GET" && p === "/rest/v1/alert") return [ALERT];
      if (method === "GET" && p === "/rest/v1/explanation") return [EXPLANATION];
      if (method === "DELETE" && p === `/api/users/${FARMER_ID}`) return {};
      return undefined;
    },
  });
}

const settle = async (page: Page) => {
  await page.locator("#agroflow-splash").waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
};

for (const [tag, viewport] of [["1366", { width: 1366, height: 768 }], ["390", { width: 390, height: 844 }]] as const) {
  test.describe(`at ${tag}`, () => {
    test.use({ viewport });

    test(`public site and staff sign-in (${tag})`, async ({ page }) => {
      await page.route("**/testproject.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("**/api.agroflow.test/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.goto("/");
      await settle(page);
      await page.screenshot({ path: `${OUT}/${tag}-public-top.png` });
      const shots = page.locator("#the-app");
      if (await shots.count()) {
        await shots.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${tag}-public-app-screens.png` });
      }
      await page.locator("footer").last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${tag}-public-footer.png` });
      // A fresh load: on the old site "#/admin" is only a hash on the same page.
      await page.goto("about:blank");
      await page.goto(SIGNIN);
      await settle(page);
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${tag}-staff-sign-in.png` });
    });

    test(`console: Home, an alert, remove account (${tag})`, async ({ page }) => {
      await console_(page);
      await page.goto(`${CONSOLE}#dashboard`);
      await settle(page);
      await expect(page.locator("#appShell")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${tag}-admin-home.png` });

      await page.goto(`${CONSOLE}#alerts`);
      await page.locator('[data-act="view-alert"][data-id="42"]').first().click({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${tag}-admin-alert-drawer.png` });

      await page.goto(`${CONSOLE}#users`);
      await page.locator(`[data-act="delete-user"][data-id="${FARMER_ID}"]`).first().click({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${tag}-admin-remove-confirm.png` });
      await page.getByRole("alertdialog").getByRole("button", { name: /Remove account/ }).click();
      await page.locator(".toast").first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-admin-remove-done.png` });
    });

    test(`console: a slow page (${tag})`, async ({ page }) => {
      test.setTimeout(60_000);
      await console_(page, { slowUsers: true });
      await page.goto(`${CONSOLE}#users`);
      await settle(page);
      await page.screenshot({ path: `${OUT}/${tag}-admin-loading.png` });
      await page.waitForTimeout(SLOW_MS);
      await page.screenshot({ path: `${OUT}/${tag}-admin-loading-slow.png` });
    });
  });
}
