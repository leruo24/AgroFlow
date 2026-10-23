import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID, FAKE_API, FAKE_SUPABASE } from "./mockBackend";

/* Admin polish, items 2-7. Everything is mocked: nothing reaches a real
   Supabase or API. */

const SERVER = "AgroFlow's server can't be reached right now. Check your internet, then press Retry.";
const BLOCKED = "A browser extension (like an ad blocker) may be blocking AgroFlow. Turn it off for this site and press Retry.";

/* ------------------------------ 2. Requests ------------------------------ */

const REQUESTS = [
  { id: 1, farmer_id: "p-named", farm_id: null, request_type: "new_farm", location: "Ceres", rough_size: 1, crop_type: "maize",
    notes: null, status: "completed", created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-02T08:00:00Z" },
  { id: 2, farmer_id: "p-email", farm_id: null, request_type: "new_farm", location: "Paarl", rough_size: 2, crop_type: "potato",
    notes: null, status: "pending", created_at: "2026-10-03T08:00:00Z", updated_at: "2026-10-03T08:00:00Z" },
  { id: 3, farmer_id: "p-phone", farm_id: null, request_type: "new_farm", location: "Worcester", rough_size: 3, crop_type: "tomato",
    notes: null, status: "scheduled", created_at: "2026-10-04T08:00:00Z", updated_at: "2026-10-04T08:00:00Z" },
  { id: 4, farmer_id: "p-nothing", farm_id: null, request_type: "new_farm", location: "Tulbagh", rough_size: 1, crop_type: "citrus",
    notes: null, status: "pending", created_at: "2026-10-05T08:00:00Z", updated_at: "2026-10-05T08:00:00Z" },
];
const FARMERS = [
  { id: "p-named", name: "Thandi Nkosi", email: "thandi@example.org", phone: null },
  { id: "p-email", name: null, email: "sipho@example.org", phone: null },
  { id: "p-phone", name: "", email: null, phone: "082 555 0101" },
  { id: "p-nothing", name: null, email: null, phone: null },
];

async function requestsPage(page: Page): Promise<void> {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path, url) => {
      if (method === "GET" && path === "/rest/v1/service_request") return REQUESTS;
      if (method === "GET" && path === "/rest/v1/profile" && !(url.searchParams.get("id") ?? "").includes(ADMIN_ID)) return FARMERS;
      return undefined;
    },
  });
  await page.goto("/staff/#requests");
  await expect(page.locator(".requests-table")).toBeVisible({ timeout: 15000 });
}

test("Requests: Open first, then Completed, with an Open / Completed / All filter", async ({ page }) => {
  const errors = captureErrors(page);
  await requestsPage(page);

  const groups = page.locator(".requests-table tr.req-group");
  await expect(groups).toHaveText([/Open \(3\)/, /Completed \(1\)/]);
  // Every open row comes before the Completed heading.
  const rows = await page.locator(".requests-table tbody tr").allTextContents();
  const completedAt = rows.findIndex((t) => /Completed \(1\)/.test(t));
  expect(rows.findIndex((t) => t.includes("Thandi Nkosi"))).toBeGreaterThan(completedAt);
  expect(rows.findIndex((t) => t.includes("sipho@example.org"))).toBeLessThan(completedAt);

  await page.locator('[data-act="requests-filter"][data-filter="open"]').click();
  await expect(groups).toHaveText([/Open \(3\)/]);
  await expect(page.locator(".requests-table")).not.toContainText("Thandi Nkosi");

  await page.locator('[data-act="requests-filter"][data-filter="completed"]').click();
  await expect(groups).toHaveText([/Completed \(1\)/]);
  await expect(page.locator(".requests-table")).toContainText("Thandi Nkosi");
  await expect(page.locator(".requests-table")).not.toContainText("sipho@example.org");

  await page.locator('[data-act="requests-filter"][data-filter="all"]').click();
  await expect(groups).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("Requests: a farmer with no name shows the email or phone; with neither, the request id, flagged", async ({ page }) => {
  await requestsPage(page);
  const table = page.locator(".requests-table");
  await expect(table).not.toContainText("Farmer without a name");
  await expect(table.locator("tr", { hasText: "Paarl" }).locator("strong")).toHaveText("sipho@example.org");
  await expect(table.locator("tr", { hasText: "Worcester" }).locator("strong")).toHaveText("082 555 0101");
  const unknown = table.locator("tr", { hasText: "Tulbagh" });
  await expect(unknown.locator("strong")).toHaveText("Request #4");
  await expect(unknown).toContainText("No name, email or phone on file");
  await expect(table.locator("tr", { hasText: "Paarl" })).not.toContainText("No name, email or phone");
});

/* --------------------------- 3 and 4. The shell -------------------------- */

test("the sidebar logo and name go Home", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/staff/#alerts");
  await expect(page.locator("#headerTitle")).not.toHaveText("Dashboard", { timeout: 15000 });
  await page.locator("#brandHome").click();
  await expect(page).toHaveURL(/#dashboard$/);
  await expect(page.locator("#headerTitle")).toHaveText(/Dashboard|Home/);
  await expect(page.getByRole("link", { name: /AgroFlow Administration/ })).toBeVisible();
});

for (const where of ["sidebar", "avatar menu"] as const) {
  test(`Log out from the ${where} ends the session and shows staff sign-in`, async ({ page }) => {
    const log = await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
    await page.goto("/staff/#dashboard");
    await expect(page.locator("#appShell")).toBeVisible({ timeout: 15000 });

    if (where === "sidebar") {
      await page.locator(".sidebar").getByRole("button", { name: "Log out" }).click();
    } else {
      await page.locator("#avatarBtn").click();
      await page.locator("#avatarMenu").getByRole("button", { name: "Log out" }).click();
    }

    // Back to staff sign-in on /staff/, not the product site.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("#appShell")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/staff/");
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.evaluate(() => window.localStorage.getItem("sb-testproject-auth-token"))).toBeNull();
    expect(log.requests.some((r) => r.url.includes("/auth/v1/logout"))).toBe(true);
  });
}

test("Log out still ends the session on this computer when Supabase cannot be reached", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/staff/#dashboard");
  await expect(page.locator("#appShell")).toBeVisible({ timeout: 15000 });
  await page.route(`${FAKE_SUPABASE}/auth/v1/logout**`, (route) => route.abort("internetdisconnected"));

  await page.locator(".sidebar").getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("sb-testproject-auth-token"))).toBeNull();
});

/* ---------------------------- 5. Landing page ---------------------------- */

test("the landing page has no 'Who made this' section and no staff sign-in link", async ({ page }) => {
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Smart irrigation for small farms/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Who made this")).toHaveCount(0);
  await expect(page.locator("#creditsHeading")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Staff sign-in" })).toHaveCount(0);
});

/* ------------------------------ 6. Settings ------------------------------ */

// Telegram is for farmers only (docs/telegram-farmers-only.md): staff get a note, no Connect.
test("Settings has only My account: profile, password, and a farmers-only Telegram note", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/staff/#settings");
  await expect(page.locator(".tab[data-tab]")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(".tab[data-tab]")).toHaveText("My account");
  await expect(page.getByText("Platform thresholds")).toHaveCount(0);
  await expect(page.getByText("Backup & Recovery")).toHaveCount(0);
  const body = page.locator("#settingsTabBody");
  await expect(body.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(body.getByRole("heading", { name: "Password" })).toBeVisible();
  await expect(body.getByRole("heading", { name: "Telegram" })).toBeVisible();
  await expect(body.locator("#myTelegramStatus")).toContainText("Telegram is for farmers only.");
  await expect(body.getByRole("button", { name: "Connect Telegram" })).toHaveCount(0);
});

/* ---------------------------- 7. Plain errors ---------------------------- */

// An API read that fails, on a page that needs it: Activity (GET /api/admin/activity). This
// used the staff Telegram panel in Settings, which is gone (staff do not use Telegram).
const ACTIVITY = `${FAKE_API}/api/admin/activity**`;
async function activityFailing(page: Page, pingWorks: boolean): Promise<string[]> {
  const warnings: string[] = [];
  page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  // What an ad blocker does: the request never leaves the browser.
  await page.route(ACTIVITY, (route) => route.abort("blockedbyclient"));
  if (!pingWorks) await page.route(`${FAKE_API}/api/public/ping`, (route) => route.abort("internetdisconnected"));
  await page.goto("/staff/#activity");
  return warnings;
}

test("a request a browser extension blocks says so, while the server answers a ping", async ({ page }) => {
  const warnings = await activityFailing(page, true);
  const card = page.locator(".error-state-card");
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText(BLOCKED);
  await expect(page.locator("body")).not.toContainText("Failed to fetch");
  await expect(card.getByRole("button", { name: "Retry" })).toBeVisible();
  // The technical detail is in the console, not on the page.
  expect(warnings.some((w) => w.includes("/api/admin/activity"))).toBe(true);
});

test("when the server cannot be reached at all, the plain server sentence", async ({ page }) => {
  await activityFailing(page, false);
  const card = page.locator(".error-state-card");
  await expect(card).toContainText(SERVER, { timeout: 15000 });
  await expect(page.locator("body")).not.toContainText("Failed to fetch");

  // Retry once the network is back.
  await page.unroute(ACTIVITY);
  await page.unroute(`${FAKE_API}/api/public/ping`);
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".error-state-card")).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator("#content")).toHaveAttribute("data-page", "activity");
});

test("a failed Supabase read on a page shows the plain sentence, never 'Failed to fetch'", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.route(`${FAKE_SUPABASE}/rest/v1/service_request**`, (route) => route.abort("failed"));
  await page.route(`${FAKE_API}/api/public/ping`, (route) => route.abort("failed"));
  await page.goto("/staff/#requests");
  await expect(page.locator(".error-state-card")).toContainText(SERVER, { timeout: 30000 });
  await expect(page.locator("body")).not.toContainText("Failed to fetch");
  await expect(page.locator("body")).not.toContainText("TypeError");
});

test("the enquiry form keeps what was typed when sending fails, and Retry sends it", async ({ page }) => {
  const sent: unknown[] = [];
  let fail = true;
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    if (path === "/api/public/ping") return route.abort("internetdisconnected");
    if (r.method() === "POST" && path === "/api/public/enquiries") {
      if (fail) return route.abort("internetdisconnected");
      sent.push(JSON.parse(r.postData() ?? "{}"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Thank you, a representative will call you within 2 working days." }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/#enquire");
  const form = page.locator("#enquiryForm");
  await expect(form).toBeVisible({ timeout: 15000 });
  await form.locator('[name="fullName"]').fill("Thandi Nkosi");
  await form.locator('[name="phone"]').fill("082 123 4567");
  await form.locator('[name="province"]').selectOption("Western Cape");
  await form.locator('[name="town"]').fill("Ceres");
  await form.locator('input[name="crops"][value="potato"]').check();
  await form.locator('input[name="bestTime"][value="morning"]').check();
  await form.getByLabel(/I agree that AgroFlow may contact me/).check();
  await form.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".enquiry-error")).toHaveText(SERVER);
  await expect(form.locator('[name="fullName"]')).toHaveValue("Thandi Nkosi");
  await expect(form.locator('[name="phone"]')).toHaveValue("082 123 4567");
  await expect(form.locator('[name="town"]')).toHaveValue("Ceres");

  fail = false;
  await form.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Thank you, a representative will call you within 2 working days.")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ fullName: "Thandi Nkosi", town: "Ceres" });
});
