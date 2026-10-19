import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID } from "./mockBackend";

/* Admin polish, item 1: dismiss → history → restore on Home's attention
   cards, the Alerts list and the health warnings. The mock behaves like the
   server: a dismissal is a row; restore stamps it; nothing is deleted. */

type Row = {
  id: number; audience: "admin"; kind: string; itemKey: string; farmId: null; title: string; raisedAt: string | null;
  critical: boolean; conditionKey: string | null; dismissedByName: string; dismissedAt: string; note: string | null;
  restoredByName: string | null; restoredAt: string | null;
};

const ZONES = [{ id: 11, name: "Bed 1", farm_id: 1, crop_type: null, planting_date: null, area_m2: null, flow_rate_lpm: 1.5, status: "Active" }];
const FARMS = [{ farm_id: 1, name: "Alpha Farm", latitude: -33.9, longitude: 18.4, status: "Active" }];
const PENDING = [{ id: 5, farmer_id: "p1", farm_id: null, request_type: "new_farm", location: "Ceres", rough_size: 1,
  crop_type: "maize", notes: null, status: "pending", created_at: "2026-10-05T08:00:00Z", updated_at: "2026-10-05T08:00:00Z" }];
const ALERTS = [
  { id: 41, severity: "Critical", message: "Kit offline on Bed 1", status: "Open", created_at: "2026-10-06T06:00:00Z",
    zone: { id: 11, name: "Bed 1", farm: { farm_id: 1, name: "Alpha Farm", status: "Active", owner: { name: "Owner A", email: null } } } },
  { id: 42, severity: "Low", message: "Telegram not linked", status: "Open", created_at: "2026-10-06T07:00:00Z",
    zone: { id: 11, name: "Bed 1", farm: { farm_id: 1, name: "Alpha Farm", status: "Active", owner: { name: "Owner A", email: null } } } },
];
const HEALTH = {
  overall: "down", checkedAt: new Date().toISOString(),
  checks: [
    { key: "api", name: "API", status: "ok", detail: "Running.", responseMs: null },
    { key: "mqtt", name: "MQTT broker", status: "down", detail: "Could not be reached for 5 minutes.", responseMs: null },
    { key: "telegram", name: "Telegram", status: "warning", detail: "No bot token set.", responseMs: null },
  ],
};

async function open(page: Page, at: string, initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (r.method() === "POST" && url.pathname.startsWith("/api/admin/dismissals")) posts.push({ path: url.pathname, body: JSON.parse(r.postData() ?? "{}") });
  });
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/rest/v1/zone") return ZONES;
      if (method === "GET" && path === "/rest/v1/farm") return FARMS;
      if (method === "GET" && path === "/rest/v1/service_request") return PENDING;
      if (method === "GET" && path === "/rest/v1/alert") return ALERTS;
      if (method === "GET" && path === "/api/admin/health") return HEALTH;
      if (method === "GET" && path === "/api/admin/dismissals") return rows;
      if (method === "POST" && path === "/api/admin/dismissals") return { id: 0, message: "Dismissed." }; // replaced below
      const restore = path.match(/^\/api\/admin\/dismissals\/(\d+)\/(restore|condition-cleared)$/);
      if (method === "POST" && restore) {
        const row = rows.find((r) => r.id === Number(restore[1]));
        if (row) { row.restoredAt = new Date().toISOString(); row.restoredByName = restore[2] === "restore" ? "Test Admin" : "AgroFlow (the condition cleared)"; }
        return { id: Number(restore[1]), message: "Restored." };
      }
      return undefined;
    },
  });
  // A real row for each dismissal, as the server makes it.
  await page.route("**/api/admin/dismissals", async (route) => {
    const r = route.request();
    if (r.method() !== "POST") return route.fallback();
    const b = JSON.parse(r.postData() ?? "{}");
    const row: Row = { id: rows.length + 100, audience: "admin", kind: b.kind, itemKey: b.itemKey, farmId: null, title: b.title,
      raisedAt: b.raisedAt, critical: b.critical, conditionKey: b.conditionKey, dismissedByName: "Test Admin",
      dismissedAt: new Date().toISOString(), note: b.note, restoredByName: null, restoredAt: null };
    rows.push(row);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: row.id, message: "Dismissed." }) });
  });
  await page.goto(at);
  return { rows, posts };
}

test("Home: dismiss a card, Undo, dismiss again, find it under Dismissed and restore it", async ({ page }) => {
  const errors = captureErrors(page);
  const { rows, posts } = await open(page, "/#dashboard");
  const card = page.locator(".attn-item", { hasText: "Zones missing setup" });
  await expect(card).toBeVisible({ timeout: 15000 });

  // Not critical: no note asked.
  await card.getByRole("button", { name: /Dismiss: Zones missing setup/ }).click();
  await expect(page.locator(".attn-item", { hasText: "Zones missing setup" })).toHaveCount(0);
  expect(posts[0].body).toMatchObject({ kind: "attention", itemKey: "go-zones-setup", critical: false, note: null });
  expect(JSON.stringify(posts[0].body)).not.toContain(ADMIN_ID);

  // Undo within 5 s restores it.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => posts.map((p) => p.path)).toContain(`/api/admin/dismissals/${rows[0].id}/restore`);
  await expect(page.locator(".attn-item", { hasText: "Zones missing setup" })).toBeVisible();

  // Dismiss again; it is listed under Dismissed with who and Restore.
  await page.locator(".attn-item", { hasText: "Zones missing setup" }).getByRole("button", { name: /Dismiss/ }).click();
  await expect(page.locator(".attn-item", { hasText: "Zones missing setup" })).toHaveCount(0);
  await page.locator('[data-surface="attention"][data-view="dismissed"]').click();
  const history = page.locator(".dismiss-history li", { hasText: "Zones missing setup" }).last();
  await expect(history).toContainText("by Test Admin");
  await history.getByRole("button", { name: "Restore" }).click();
  await page.locator('[data-surface="attention"][data-view="active"]').click();
  await expect(page.locator(".attn-item", { hasText: "Zones missing setup" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a critical card asks for a note, records what it was made of, and comes back when that changes", async ({ page }) => {
  const { rows, posts } = await open(page, "/#dashboard");
  const card = page.locator(".attn-item", { hasText: "New requests waiting" });
  await expect(card).toBeVisible({ timeout: 15000 });

  await card.getByRole("button", { name: /Dismiss/ }).click();
  await page.locator('.drawer [data-field="note"]').fill("Called the farmer");
  await page.locator("[data-drawer-confirm]").click();
  await expect(page.locator(".attn-item", { hasText: "New requests waiting" })).toHaveCount(0);
  expect(posts[0].body).toMatchObject({ itemKey: "go-requests-pending", critical: true, note: "Called the farmer", conditionKey: "requests:5" });

  // Another request arrives: the condition is different, so the card is back.
  rows[0].conditionKey = "requests:4";   // as if dismissed when only request 4 was waiting
  await page.reload();
  await expect(page.locator(".attn-item", { hasText: "New requests waiting" })).toBeVisible({ timeout: 15000 });
  // And the stale dismissal is closed, as AgroFlow - never deleted.
  await expect.poll(() => posts.map((p) => p.path)).toContain(`/api/admin/dismissals/${rows[0].id}/condition-cleared`);
});

test("Alerts: dismiss one, it moves to Dismissed with its time and who, Restore brings it back", async ({ page }) => {
  const { posts } = await open(page, "/#alerts");
  await expect(page.locator("tr", { hasText: "Telegram not linked" })).toBeVisible({ timeout: 15000 });

  await page.locator("tr", { hasText: "Telegram not linked" }).getByRole("button", { name: /Dismiss/ }).click();
  await expect(page.locator("tr", { hasText: "Telegram not linked" })).toHaveCount(0);
  expect(posts[0].body).toMatchObject({ kind: "alert", critical: false });

  await page.locator('[data-surface="alerts"][data-view="all"]').click();
  await expect(page.locator("tr", { hasText: "Kit offline on Bed 1" })).toBeVisible();
  const history = page.locator(".dismiss-history li", { hasText: "Telegram not linked" });
  await expect(history).toContainText("Raised");
  await expect(history).toContainText("Dismissed");
  await history.getByRole("button", { name: "Restore" }).click();
  await page.locator('[data-surface="alerts"][data-view="active"]').click();
  await expect(page.locator("tr", { hasText: "Telegram not linked" })).toBeVisible();
});

test("Health: a down check asks for a note; the warning leaves the grid and is in Dismissed", async ({ page }) => {
  const { posts } = await open(page, "/#dashboard");
  const mqtt = page.locator(".health-card", { hasText: "MQTT broker" });
  await expect(mqtt).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".health-card", { hasText: "API" }).getByRole("button", { name: /Dismiss/ })).toHaveCount(0);   // OK checks have none

  await mqtt.getByRole("button", { name: /Dismiss/ }).click();
  await page.locator("[data-drawer-confirm]").click();
  await expect(page.locator(".health-card", { hasText: "MQTT broker" })).toHaveCount(0);
  expect(posts[0].body).toMatchObject({ kind: "health", itemKey: "mqtt", critical: true, conditionKey: "down" });

  await page.locator('[data-surface="health"][data-view="dismissed"]').click();
  await expect(page.locator(".dismiss-history li", { hasText: "MQTT broker" })).toBeVisible();
});
