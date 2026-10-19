import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID, FAKE_API, FAKE_SUPABASE } from "./mockBackend";

/* Sponsor feedback, Part A: remove-account confirm and toast, the loading indicator, staff
 * only, Forgot password and Unlink Telegram. Everything is mocked: nothing reaches a real
 * Supabase or API. */

const FARMER_ID = "00000000-0000-4000-8000-0000000000fa";

const USERS = [
  { id: ADMIN_ID, name: "Test Admin", email: "admin@agroflow.test", phone: null, role: "admin", created_at: "2026-09-01T08:00:00Z",
    farm_id: null, farm_name: null, telegram_linked: true, telegram_alerts_enabled: true },
  { id: FARMER_ID, name: "Thandi Nkosi", email: "thandi@example.org", phone: "082 555 0101", role: "farm_user",
    created_at: "2026-09-10T08:00:00Z", farm_id: 1, farm_name: "Nkosi Farm", telegram_linked: true, telegram_alerts_enabled: true },
];

type Calls = { method: string; path: string }[];

async function usersPage(page: Page, calls: Calls): Promise<void> {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (path.startsWith("/api/users") || path.startsWith("/api/telegram/admin")) calls.push({ method, path });
      if (method === "GET" && path === "/api/users") return USERS;
      if (method === "DELETE" && path === `/api/users/${FARMER_ID}`) {
        return { message: "The account was removed. Their farms, zones and history were kept." };
      }
      if (method === "DELETE" && path === `/api/telegram/admin/link/${FARMER_ID}`) {
        return { message: "Thandi Nkosi's Telegram was disconnected. They can connect again with a new code.", wasLinked: true };
      }
      return undefined;
    },
  });
  await page.goto("/#users");
  await expect(page.locator("#content")).toHaveAttribute("data-page", "users", { timeout: 15000 });
}

/* ------------------------------ 1. Remove account ------------------------------ */

test("removing a farmer asks first, and Cancel removes nothing", async ({ page }) => {
  const errors = captureErrors(page);
  const calls: Calls = [];
  await usersPage(page, calls);

  await page.locator(`[data-act="delete-user"][data-id="${FARMER_ID}"]`).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Remove Thandi Nkosi's account?");
  await expect(dialog).toContainText("Their farms, zones and history will be kept.");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);

  // Escape is a Cancel too.
  await page.locator(`[data-act="delete-user"][data-id="${FARMER_ID}"]`).first().click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
  expect(errors).toEqual([]);
});

test("removing a farmer shows a success toast that says what was kept", async ({ page }) => {
  const errors = captureErrors(page);
  const calls: Calls = [];
  await usersPage(page, calls);

  await page.locator(`[data-act="delete-user"][data-id="${FARMER_ID}"]`).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove account" }).click();

  const t = page.locator(".toast.toast-success");
  await expect(t).toHaveText("Thandi Nkosi's account was removed. Their farms, zones and history were kept.");
  await expect(page.getByText("Farm data was retained")).toHaveCount(0);
  expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([`/api/users/${FARMER_ID}`]);
  expect(errors).toEqual([]);
});

/* ------------------------------ 2. Loading ------------------------------ */

test("a loading page shows a spinner and Loading…, then the connection hint after 8 s", async ({ page }) => {
  test.setTimeout(45_000);
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    // The Farmers page's list never answers, so the skeleton stays up.
    delayFor: (method, path) => (method === "GET" && path === "/api/users" ? 30_000 : undefined),
  });
  await page.goto("/#users");

  const indicator = page.locator("#content [data-loading-indicator]");
  await expect(indicator).toBeVisible({ timeout: 15000 });
  await expect(indicator).toHaveText("Loading…");
  await expect(indicator.locator(".spinner")).toBeVisible();
  await expect(indicator).toHaveAttribute("role", "status");

  await expect(indicator).toHaveText("Still loading — check your connection", { timeout: 12_000 });
  await expect(indicator).toHaveClass(/slow/);
});

test("a page that loads quickly never shows the connection hint", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/#users");
  await expect(page.locator("#content")).toHaveAttribute("data-page", "users", { timeout: 15000 });
  await expect(page.locator("[data-loading-indicator]")).toHaveCount(0);
  await expect(page.getByText("Still loading")).toHaveCount(0);
});

/* ------------------------------ 3. Staff only ------------------------------ */

const FARMER_SESSION = {
  access_token: "farmer-access-token",
  refresh_token: "farmer-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FARMER_ID, aud: "authenticated", role: "authenticated", email: "thandi@example.org",
    app_metadata: {}, user_metadata: {}, created_at: "2026-09-10T08:00:00Z" },
};

test("a farmer who signs in is shown the staff-only message and where the app is", async ({ page }) => {
  const errors = captureErrors(page);
  const profileReads: string[] = [];
  const signOutScopes: (string | null)[] = [];
  // No stored session: a visitor at the sign-in page.
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (route.request().method() === "OPTIONS") return json({});
    if (url.pathname === "/auth/v1/token") return json(FARMER_SESSION);
    if (url.pathname === "/auth/v1/logout") { signOutScopes.push(url.searchParams.get("scope")); return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }); }
    if (url.pathname === "/rest/v1/profile") {
      profileReads.push(url.search);
      return json({ id: FARMER_ID, name: "Thandi Nkosi", email: "thandi@example.org", role: "farm_user" });
    }
    return json({});
  });

  await page.goto("/#/admin");
  await page.locator("#loginEmail").fill("thandi@example.org");
  await page.locator("#loginPassword").fill("a-farmer-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  const notice = page.locator("#loginStaffOnly");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("This console is for AgroFlow staff. Farmers, please use the AgroFlow app.");
  // With no download links configured for the test build, it says who to ask instead.
  await expect(notice.getByRole("link", { name: "request a call" })).toBeVisible();

  // Still on the sign-in page, not in the console, and the session is not kept.
  await expect(page.locator("#appShell")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("sb-testproject-auth-token"))).toBeNull();
  // Only the session just created is ended: a global sign-out would end their phone's too.
  expect(signOutScopes).toEqual(["local"]);
  expect(profileReads.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("the public page links to staff sign-in and shows no console", async ({ page }) => {
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A smarter way to manage water/ })).toBeVisible({ timeout: 15000 });

  await expect(page.getByRole("link", { name: "Request a call", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get the app" })).toBeAttached();
  await expect(page.locator("#appShell, #nav, [data-act]")).toHaveCount(0);
  await expect(page.getByText(/Admin console|Open admin console/)).toHaveCount(0);

  await page.getByRole("link", { name: "Staff sign-in" }).first().click();
  await expect(page).toHaveURL(/#\/admin$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

// The built site serves public/admin/index.html at /admin/; the dev server's SPA fallback
// answers /admin/ with the console itself, so the file is opened by name here.
test("/admin/ forwards to staff sign-in", async ({ page }) => {
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/admin/index.html");
  await expect(page).toHaveURL(/\/#\/admin$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 15000 });
});

/* ------------------------------ 5. Forgot password ------------------------------ */

test("Forgot password sends a reset link back to this site", async ({ page }) => {
  const errors = captureErrors(page);
  const recover: { body: unknown; search: string }[] = [];
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(`${FAKE_SUPABASE}/**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && url.pathname === "/auth/v1/recover") {
      recover.push({ body: req.postDataJSON(), search: url.search });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
  });

  await page.goto("/#/admin");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();

  // A bad address is caught before anything is sent.
  await page.locator("#forgotEmail").fill("not-an-email");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator("#forgotError")).toHaveText("Enter the email address you sign in with.");
  expect(recover).toEqual([]);

  await page.locator("#forgotEmail").fill("admin@agroflow.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator("#forgotSent")).toContainText("If admin@agroflow.test has an AgroFlow staff account, a reset link is on its way.");
  expect(recover).toHaveLength(1);
  expect((recover[0]!.body as { email: string }).email).toBe("admin@agroflow.test");
  expect(decodeURIComponent(recover[0]!.search)).toContain("redirect_to=http://localhost:5179/?reset=1");

  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the reset page renders, checks the password and saves it", async ({ page }) => {
  const errors = captureErrors(page);
  const updates: unknown[] = [];
  // The signed-in session stands in for the recovery session a reset link creates.
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "PUT" && path === "/auth/v1/user") {
        updates.push(method);
        return { id: ADMIN_ID, aud: "authenticated", role: "authenticated", email: "admin@agroflow.test",
          app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T08:00:00Z" };
      }
      return undefined;
    },
  });
  await page.goto("/?reset=1");
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible({ timeout: 15000 });

  await page.locator("#resetPassword").fill("short");
  await page.locator("#resetConfirm").fill("short");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.locator("#resetError")).toHaveText("Use at least 8 characters.");

  await page.locator("#resetPassword").fill("a-long-new-password");
  await page.locator("#resetConfirm").fill("a-different-password");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.locator("#resetError")).toHaveText("The two passwords are not the same.");
  expect(updates).toEqual([]);

  await page.locator("#resetConfirm").fill("a-long-new-password");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.locator(".toast.toast-success")).toHaveText("Your password was changed.");
  await expect(page.locator("#appShell")).toBeVisible();
  await expect(page).not.toHaveURL(/reset=1/);
  expect(updates).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a used or expired reset link says so and goes to sign in", async ({ page }) => {
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/?reset=1");
  await expect(page.getByRole("heading", { name: "This reset link has expired" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Go to sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).not.toHaveURL(/reset=1/);
});

/* ------------------------------ 6. Unlink Telegram ------------------------------ */

test("Unlink Telegram on a farmer's profile asks first, then disconnects", async ({ page }) => {
  const errors = captureErrors(page);
  const calls: Calls = [];
  await usersPage(page, calls);

  await page.locator(`[data-act="view-user"][data-id="${FARMER_ID}"]`).first().click();
  const unlink = page.getByRole("button", { name: "Unlink Telegram" });
  await expect(unlink).toBeVisible();

  await unlink.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Disconnect Thandi Nkosi's Telegram?");
  await expect(dialog).toContainText("They can connect again with a new code");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);

  await unlink.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect Telegram" }).click();
  await expect(page.locator(".toast.toast-success"))
    .toHaveText("Thandi Nkosi's Telegram was disconnected. They can connect again with a new code.");
  expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([`/api/telegram/admin/link/${FARMER_ID}`]);
  expect(errors).toEqual([]);
});
