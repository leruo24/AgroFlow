import { test, expect } from "@playwright/test";
import { FAKE_API, mockBackend } from "./mockBackend";

/* A failing diagnostic is never shown as an outage (production, 2026-10-23: the weather and
   schema checks threw). Only a failed /api/public/ping says the server can't be reached.
   Mocked backend only; routes added after mockBackend take precedence. */

const HEALTH_WITH_ONE_WARNING = {
  overall: "warning",
  checkedAt: new Date().toISOString(),
  checks: [
    { key: "api", name: "API", status: "ok", detail: "Answering." },
    { key: "database", name: "Database", status: "ok", detail: "Connected." },
    { key: "weather", name: "Weather", status: "warning",
      detail: "Weather status unavailable: the check itself failed, so this says nothing about the forecasts. Reference health-weather in the API log." },
  ],
};

test("a weather check that fails is one card that needs attention, not an outage", async ({ page }) => {
  await mockBackend(page, { respond: (method, path) => (method === "GET" && path === "/api/admin/health" ? HEALTH_WITH_ONE_WARNING : undefined) });
  await page.goto("/staff/#dashboard");
  await expect(page.locator("#platformStatusText")).toHaveText("Needs attention", { timeout: 15000 });
  await expect(page.locator("#headerStatusChip")).toHaveText("1 needs attention");
  await expect(page.locator("#headerStatusChip")).toHaveClass(/status-chip-warn/);
  await expect(page.locator("#systemHealth")).toContainText("the check itself failed");
  await expect(page.locator("body")).not.toContainText("can't be reached");
});

test("the health route failing while the server answers its ping reads as a failed check, not an outage", async ({ page }) => {
  await mockBackend(page);
  await page.route(`${FAKE_API}/api/admin/health`, (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }));
  await page.goto("/staff/#dashboard");
  await expect(page.locator('[data-health-unavailable="check-failed"]')).toContainText("The server is up", { timeout: 15000 });
  await expect(page.locator("#platformStatusText")).toHaveText("Status check failed");
  await expect(page.locator("#headerStatusChip")).toHaveText("Status check failed");
  await expect(page.locator("body")).not.toContainText("can't be reached");
});

test("only when the ping fails too does it say the server can't be reached", async ({ page }) => {
  await mockBackend(page);
  await page.route(`${FAKE_API}/api/admin/health`, (r) => r.abort("connectionrefused"));
  await page.route(`${FAKE_API}/api/public/ping`, (r) => r.abort("connectionrefused"));
  await page.goto("/staff/#dashboard");
  await expect(page.locator('[data-health-unavailable="server-down"]')).toContainText("AgroFlow's server can't be reached", { timeout: 15000 });
  await expect(page.locator("#platformStatusText")).toHaveText("Server unreachable");
  await expect(page.locator("#headerStatusChip")).toHaveClass(/status-chip-bad/);
});
