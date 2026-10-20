import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID } from "./mockBackend";

/* Item 5: whoever acts is on the record. Mocked backend only. */

const OTHER_ADMIN = "00000000-0000-4000-8000-0000000000bb";

const alertRow = (id: number, message: string) => ({
  id, severity: "Critical", message, status: "Open", created_at: "2026-10-06T06:00:00Z",
  zone: { id: 11, name: "Bed 1", farm: { farm_id: 1, name: "Alpha Farm", status: "Active", owner: { name: "Owner A", email: null } } },
});

const ALERTS = [alertRow(41, "Nobody has this one"), alertRow(42, "Thandi has this one")];

const HANDLING = [
  { id: "42", handledBy: OTHER_ADMIN, handledByName: "Thandi", claimedAt: "2026-10-06T07:00:00Z",
    resolvedBy: null, resolvedByName: null, resolvedAt: null, escalatedAt: null },
];

function captureWrites(page: Page): { url: string; body: string }[] {
  const writes: { url: string; body: string }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/admin/handling/")) {
      writes.push({ url: new URL(r.url()).pathname, body: r.postData() ?? "" });
    }
  });
  return writes;
}

async function open(page: Page) {
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 40,
    respond: (method, path) => {
      if (method === "GET" && path === "/rest/v1/alert") return ALERTS;
      if (method === "GET" && path === "/api/admin/handling/alerts") return HANDLING;
      if (method === "POST" && path.includes("/api/admin/handling/")) return { message: "Done." };
      return undefined;
    },
  });
  await page.goto("/staff/#alerts");
  await expect(page.locator("tr", { hasText: "Thandi has this one" })).toBeVisible({ timeout: 15000 });
}

test("there is no Assign picker anywhere - only I'll handle this, or Take over", async ({ page }) => {
  const errors = captureErrors(page);
  await open(page);

  await expect(page.locator('[data-act^="assign-"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Assign to");

  const mine = page.locator("tr", { hasText: "Nobody has this one" });
  await expect(mine.getByText("I'll handle this")).toBeVisible();
  const theirs = page.locator("tr", { hasText: "Thandi has this one" });
  await expect(theirs).toContainText("Thandi");
  await expect(theirs.getByText("Take over")).toBeVisible();

  expect(errors).toEqual([]);
});

test("claiming and resolving send what was done - never who did it", async ({ page }) => {
  const writes = captureWrites(page);
  await open(page);

  await page.locator("tr", { hasText: "Nobody has this one" }).getByText("I'll handle this").click();
  await expect.poll(() => writes.length).toBe(1);

  await page.locator("tr", { hasText: "Nobody has this one" }).locator('[data-act="resolve-alert"]').click();
  await expect.poll(() => writes.length).toBe(2);

  expect(writes[0].url).toBe("/api/admin/handling/alerts/41/claim");
  expect(writes[1].url).toBe("/api/admin/handling/alerts/41/action");
  for (const w of writes) {
    expect(w.body).not.toContain(ADMIN_ID);
    expect(w.body.toLowerCase()).not.toMatch(/actor|profile|handled_?by|resolved_?by/);
  }
  expect(JSON.parse(writes[1].body)).toMatchObject({ action: "resolve" });
});

test("taking over asks for a reason, and sends it", async ({ page }) => {
  const writes = captureWrites(page);
  await open(page);

  await page.locator("tr", { hasText: "Thandi has this one" }).getByText("Take over").click();
  const drawer = page.locator("#drawerPanel");
  await expect(drawer).toContainText("Thandi is handling this");
  await drawer.locator('input[data-field="reason"]').fill("Farmer called me directly");
  await drawer.getByRole("button", { name: "Take over" }).click();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].url).toBe("/api/admin/handling/alerts/42/take-over");
  expect(JSON.parse(writes[0].body)).toEqual({ reason: "Farmer called me directly" });
});
