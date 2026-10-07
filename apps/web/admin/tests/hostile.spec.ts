import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockBackend, captureErrors } from "./mockBackend";

/* Part 2 adversarial sweep: names a person or an attacker might type are
   shown as text - never run - and an export never turns one into a live
   spreadsheet formula. Mocked backend only. */

const XSS_IMG = `<img src=x onerror="window.__xss=1">`;
const XSS_SCRIPT = `<script>window.__xss=1</script>`;
const FORMULA = `=HYPERLINK("http://evil.example","click")`;

const FARMS = [
  { farm_id: 1, name: XSS_IMG, owner_id: "f1", owner_name: FORMULA, location: "Kroonstad Sôre, Free State",
    total_area: 1, status: "Active", updated_at: "2026-10-01T08:00:00Z" },
  { farm_id: 2, name: "Ngqeleni 🌱 ' OR 1=1 --", owner_id: "f2", owner_name: "x".repeat(500), location: "Ngqeleni, Eastern Cape",
    total_area: 2, status: "Active", updated_at: "2026-10-01T08:00:00Z" },
];

const ACTIVITY = {
  rows: [
    { id: 1, createdAt: "2026-10-06T07:00:00Z", actorName: FORMULA, action: "farm.archived", summary: XSS_SCRIPT,
      entityType: "farm", entityId: "1", farmId: 1, farmName: "@SUM(1+1)", details: "{}" },
    { id: 2, createdAt: "2026-10-06T08:00:00Z", actorName: "Thandi", action: "farm.restored", summary: "-12%",
      entityType: "farm", entityId: "2", farmId: 2, farmName: "-cmd|' /C calc'!A0", details: "{}" },
  ],
  total: 2, actions: ["farm.archived", "farm.restored"], actors: [],
};

test("hostile farm names are shown as text and never run", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 30,
    respond: (method, path) => (method === "GET" && path === "/api/farms" ? FARMS : undefined),
  });
  await page.goto("/#farms");
  await expect(page.locator('[data-act="view-farm"][data-id="1"]')).toContainText(XSS_IMG, { timeout: 15000 });
  await expect(page.locator('[data-act="view-farm"][data-id="2"]')).toContainText("Ngqeleni 🌱 ' OR 1=1 --");

  await page.locator('[data-act="view-farm"][data-id="1"]').click();
  await expect(page.locator(".drawer")).toContainText(XSS_IMG);

  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the activity CSV neutralises formulas and keeps plain negative numbers", async ({ page }) => {
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 30,
    respond: (method, path) => (method === "GET" && path.startsWith("/api/admin/activity") && !path.includes("/farm/") ? ACTIVITY : undefined),
  });
  await page.goto("/#activity");
  await expect(page.locator("body")).toContainText(XSS_SCRIPT, { timeout: 15000 });
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  const download = page.waitForEvent("download");
  await page.locator('[data-act="export-activity-csv"]').first().click();
  const csv = readFileSync(await (await download).path(), "utf-8");

  expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  expect(csv).toContain(`"'@SUM(1+1)"`);
  expect(csv).toContain(`"'-cmd|' /C calc'!A0"`);
  expect(csv).toContain(`"-12%"`);
  expect(csv).not.toMatch(/(^|,)"=/m);
});
