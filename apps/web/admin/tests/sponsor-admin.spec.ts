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

test("Forgot password on the console is an email link for staff, and says to check spam", async ({ page }) => {
  const errors = captureErrors(page);
  const posts: { path: string; body: Record<string, string> }[] = [];
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.method() === "POST" && path === "/api/auth/forgot-password") {
      posts.push({ path, body: req.postDataJSON() as Record<string, string> });
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors,
        body: JSON.stringify({ message: "If this account has Telegram linked, we've sent a code. No Telegram? Ask your AgroFlow field officer to reset it." }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" });
  });

  await page.goto("/#/admin");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByText("We email you a link to choose a new password.")).toBeVisible();
  // Staff never use Telegram: no code box on the console.
  await expect(page.locator("#forgotCode")).toHaveCount(0);

  // A bad address is caught before anything is sent.
  await page.locator("#forgotEmail").fill("not-an-email");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator("#forgotError")).toHaveText("Enter the email address you sign in with.");
  expect(posts).toEqual([]);

  await page.locator("#forgotEmail").fill("admin@agroflow.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator("#forgotSent")).toHaveText(
    "If admin@agroflow.test is an AgroFlow staff account, a reset link is on its way. Check your inbox and your spam folder. The link works once.");
  expect(posts).toEqual([{ path: "/api/auth/forgot-password", body: { email: "admin@agroflow.test", redirectTo: "http://localhost:5179/?reset=1" } }]);

  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(errors).toEqual([]);
});

/* --------------------------- 5b. Admin resets a farmer's password --------------------------- */

const NO_TELEGRAM_ID = "00000000-0000-4000-8000-0000000000fb";

async function resetPage(page: Page, calls: Calls): Promise<void> {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (path.includes("reset-password")) calls.push({ method, path });
      if (method === "GET" && path === "/api/users") {
        return [...USERS, { id: NO_TELEGRAM_ID, name: "Sipho Dlamini", email: "sipho@example.org", phone: null, role: "farm_user",
          created_at: "2026-09-12T08:00:00Z", farm_id: 2, farm_name: "Dlamini Farm", telegram_linked: false, telegram_alerts_enabled: false }];
      }
      if (method === "POST" && path === `/api/admin/farmers/${FARMER_ID}/reset-password`) {
        return { sentByTelegram: true, temporaryPassword: null, message: "A new temporary password was sent to the farmer's Telegram. It works for 72 hours." };
      }
      if (method === "POST" && path === `/api/admin/farmers/${NO_TELEGRAM_ID}/reset-password`) {
        return { sentByTelegram: false, temporaryPassword: "KX7P 4MRT",
          message: "Shown once, not stored. Read it to the farmer: it works for 72 hours and must be changed at first sign-in." };
      }
      return undefined;
    },
  });
  await page.goto("/#users");
  await expect(page.locator("#content")).toHaveAttribute("data-page", "users", { timeout: 15000 });
}

test("Reset password asks first; a linked farmer gets it by Telegram and the admin never sees it", async ({ page }) => {
  const errors = captureErrors(page);
  const calls: Calls = [];
  await resetPage(page, calls);

  await page.locator(`[data-act="reset-password"][data-id="${FARMER_ID}"]`).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Reset Thandi Nkosi's password?");
  await expect(dialog).toContainText("A new temporary password goes to their Telegram.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(calls).toEqual([]);

  await page.locator(`[data-act="reset-password"][data-id="${FARMER_ID}"]`).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset password" }).click();
  await expect(page.locator(".toast.toast-success")).toContainText("sent to the farmer's Telegram");
  await expect(page.locator("#confirmDialogCode")).toHaveCount(0);
  expect(calls).toEqual([{ method: "POST", path: `/api/admin/farmers/${FARMER_ID}/reset-password` }]);
  expect(errors).toEqual([]);
});

test("Reset password for a farmer with no Telegram shows the new one once, in groups of four", async ({ page }) => {
  const errors = captureErrors(page);
  const calls: Calls = [];
  await resetPage(page, calls);

  // From the farmer's profile drawer this time.
  await page.locator(`[data-act="view-user"][data-id="${NO_TELEGRAM_ID}"]`).first().click();
  await page.locator(`button[data-act="reset-password"][data-id="${NO_TELEGRAM_ID}"]`).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("You will see a new temporary password once, to read out to them.");
  await ask.getByRole("button", { name: "Reset password" }).click();

  await expect(page.locator("#confirmDialogCode")).toHaveText("KX7P 4MRT");
  const shown = page.getByRole("alertdialog");
  await expect(shown).toContainText("New temporary password for Sipho Dlamini");
  await expect(shown).toContainText("works for 72 hours and must be changed at first sign-in");
  await expect(shown.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await shown.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#confirmDialogCode")).toHaveCount(0);
  expect(calls).toHaveLength(1);
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
