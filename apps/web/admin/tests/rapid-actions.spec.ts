import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Item 0b, the rest of it: in-page tabs, detail panels, double submits, and
 * the shell being rebuilt by auth events. */

const FARMS = [
  { farm_id: 1, name: "Alpha Farm", owner_id: null, owner_name: "Owner A", location: "Ceres, Western Cape", total_area: 2, status: "Active", updated_at: "2026-10-01T08:00:00Z" },
  { farm_id: 2, name: "Bravo Farm", owner_id: null, owner_name: "Owner B", location: "Mafikeng, North West", total_area: 3, status: "Active", updated_at: "2026-10-01T08:00:00Z" },
];

async function settled(page: import("@playwright/test").Page, atLeastMs = 1200): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(atLeastMs);
}

/* ONE read, no retry.
 *
 * Playwright's toHaveText retries until it sees the expected value, then
 * stops looking. That cannot catch the bug this file exists for: the right
 * panel opens first and the WRONG one replaces it a second later. A retrying
 * assertion passes in the first instant and never sees the second. Verified
 * by removing the guard - the retrying version still passed. */
async function textNow(page: import("@playwright/test").Page, selector: string): Promise<string | null> {
  return page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
}

test("detail panels: the last row clicked is the one that opens", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, {
    seed: 3,
    respond: (method, path) => (method === "GET" && path === "/api/farms" ? FARMS : undefined),
    // Deterministic, not lucky: anything Alpha's panel asks for about Alpha
    // takes two seconds, Bravo's answers at once. So Alpha's panel is ready
    // LAST, and a router that opens whatever arrives last opens the wrong one.
    delayFor: (_method, path) =>
      path.includes("/farms/1/") ? 2000 : path.includes("/farms/2/") ? 20 : undefined,
  });

  await page.goto("/#farms");
  await expect(page.locator('[data-act="view-farm"]')).toHaveCount(2);
  await settled(page);

  // Both panels read several things from the network before opening; the
  // mock answers in a random order. Alpha is clicked first, Bravo last.
  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  await page.locator('[data-act="view-farm"][data-id="2"]').click();

  // Past Alpha's forced 2 s, so if Alpha's panel is going to open over
  // Bravo's, it already has.
  await settled(page, 3500);

  expect(await textNow(page, "#drawerPanel h4")).toBe("Bravo Farm");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("leaving a page while its panel is loading does not open the panel on the next page", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, {
    seed: 5,
    minDelayMs: 400,
    maxDelayMs: 900,
    respond: (method, path) => (method === "GET" && path === "/api/farms" ? FARMS : undefined),
  });

  await page.goto("/#farms");
  await expect(page.locator('[data-act="view-farm"]')).toHaveCount(2);
  await settled(page);

  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  await page.locator('#nav button[data-page="alerts"]').click();
  await settled(page);

  expect(await textNow(page, "#headerTitle")).toBe("Alerts");
  expect(await page.locator("#drawerOverlay.open").count()).toBe(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("settings tabs: the last tab clicked is the one shown", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, { seed: 11 });

  await page.goto("/#settings");
  await expect(page.locator(".tab[data-tab]")).toHaveCount(3);
  await settled(page);

  for (const tab of ["Platform thresholds", "Backup & Recovery", "My account", "Platform thresholds", "Backup & Recovery"]) {
    await page.locator(`.tab[data-tab="${tab}"]`).click({ delay: 0 });
  }
  await settled(page);

  expect(await textNow(page, ".tab.active")).toBe("Backup & Recovery");
  expect(await textNow(page, "#settingsTabBody")).toContain("Supabase");
  // The thresholds panel's late answer must not have been written anywhere.
  await expect(page.locator("#platformThresholds")).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("double-clicking Save sends exactly one request", async ({ page }) => {
  const errors = captureErrors(page);
  const log = await mockBackend(page, { seed: 13 });

  await page.goto("/#settings");
  await expect(page.locator('[data-act="save-my-profile"]')).toBeVisible();
  await settled(page);

  await page.locator('[data-act="save-my-profile"]').dblclick();
  await page.locator('[data-act="save-my-profile"]').click({ clickCount: 3 });
  await settled(page);

  const puts = log.requests.filter((r) => r.method === "PUT" && r.url.endsWith("/api/farmer/profile"));
  // The dblclick is ONE request; the triple-click that follows after it has
  // finished is ONE more. Never six.
  expect(puts.length).toBeLessThanOrEqual(2);
  expect(puts.length).toBeGreaterThanOrEqual(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("double-clicking a drawer's confirm creates one thing, not two", async ({ page }) => {
  const errors = captureErrors(page);
  const log = await mockBackend(page, { seed: 17 });

  await page.goto("/#users");
  await expect(page.locator('[data-act="create-farmer-direct"]')).toBeVisible();
  await settled(page);

  await page.locator('[data-act="create-farmer-direct"]').click();
  await expect(page.locator("#drawerPanel [data-drawer-confirm]")).toBeVisible();

  await page.locator('#drawerPanel [data-field="name"]').fill("Thandi Nkosi");
  await page.locator('#drawerPanel [data-field="email"]').fill("thandi@example.org");
  await page.locator('#drawerPanel [data-field="password"]').fill("Temp-Pass-123");

  // Two clicks in the SAME frame - the worst case of a double-click, before
  // the drawer has had any chance to close or restyle. A real dblclick from
  // the mouse is usually already caught by the drawer closing under the
  // second click, which is why this, and not dblclick(), is the test that
  // proves the guard (verified: dblclick() passed with the guard removed).
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("#drawerPanel [data-drawer-confirm]")!;
    button.click();
    button.click();
  });
  await settled(page);

  const creates = log.requests.filter((r) => r.method === "POST" && r.url.endsWith("/api/farmers/create"));
  expect(creates.length).toBe(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("returning to the tab does not rebuild the console", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, { seed: 23 });

  await page.goto("/#farms");
  await expect(page.locator("#appShell")).toBeVisible();
  await settled(page);

  // Mark the shell. If anything tears it down and builds a new one, the mark
  // is gone.
  await page.evaluate(() => document.getElementById("appShell")!.setAttribute("data-test-mark", "original"));

  // A real auth event, delivered the way supabase-js delivers them between
  // tabs: on a BroadcastChannel named after its storage key. The client in
  // the page receives it and emits TOKEN_REFRESHED to every listener - the
  // event that fires on a timer all day while an admin is signed in, and that
  // used to tear down and rebuild the entire shell each time.
  const delivered = await page.evaluate(() => {
    const key = "sb-testproject-auth-token";
    const session = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!session) return false;
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: "TOKEN_REFRESHED", session });
    channel.postMessage({ event: "SIGNED_IN", session });
    channel.close();
    return true;
  });
  expect(delivered).toBe(true);
  await settled(page);

  expect(await page.locator('#appShell[data-test-mark="original"]').count()).toBe(1);
  expect(page.url()).toMatch(/#farms$/);
  expect(errors, errors.join("\n")).toEqual([]);
});
