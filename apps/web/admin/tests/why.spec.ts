import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* "Why am I seeing this?" is for farmers, in the app: the admin console shows no such link
 * or panel anywhere, not on Home's tiles and cards, not in an alert that has a stored
 * explanation. Mocked backend only - nothing touches the live database. */

const WHY = "Why am I seeing this?";

const ZONES_NEEDING_SETUP = {
  zone: [{ id: 11, name: "Bed 1", farm_id: 1, crop_type: null, planting_date: null, area_m2: null, flow_rate_lpm: 1.5, status: "Active" }],
  farm: [{ farm_id: 1, name: "Alpha Farm", latitude: -33.9, longitude: 18.4, status: "Active" }],
};

const ALERT_ROW = {
  id: 42,
  severity: "Critical",
  message: "Zone entered Critical: soil sensor reading 12.",
  status: "Open",
  created_at: "2026-10-06T06:00:00Z",
  zone: { id: 11, name: "Bed 1", farm: { farm_id: 1, name: "Alpha Farm", status: "Active", owner: { name: "Owner A", email: null } } },
};

const ALERT_EXPLANATION = {
  explanation: {
    summary: "The zone's soil sensor reading dropped very low.",
    facts: [{ label: "Soil sensor reading", value: "12", source: "your soil sensor" }],
    rule: "A zone is critical when its soil sensor reads below 20, or the kit measures 38 °C or hotter.",
    confidence: "High: this comes straight from your kit's own readings.",
    whatWouldChangeIt: "The alert closes by itself once readings are back out of the critical range.",
    technical: "Zone.CalculateHealthStatus = Critical (reading < 20 or temperature >= 38).",
  },
};

test("Home has no Why links on its tiles or Needs-attention cards", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, {
    minDelayMs: 10,
    maxDelayMs: 40,
    respond: (method, path) => {
      if (method !== "GET") return undefined;
      if (path === "/rest/v1/zone") return ZONES_NEEDING_SETUP.zone;
      if (path === "/rest/v1/farm") return ZONES_NEEDING_SETUP.farm;
      return undefined;
    },
  });

  await page.goto("/staff/#dashboard");
  await expect(page.locator(".attn-card", { hasText: "Zones missing setup" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(WHY)).toHaveCount(0);
  await expect(page.locator(".why-link, [data-act=\"why\"]")).toHaveCount(0);
  // And the copy no longer claims the engine cannot advise.
  await expect(page.locator("body")).not.toContainText("the engine cannot advise");
  expect(errors).toEqual([]);
});

test("an alert with a stored explanation still shows no Why panel in the console", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, {
    minDelayMs: 10,
    maxDelayMs: 40,
    respond: (method, path) => {
      if (method !== "GET") return undefined;
      if (path === "/rest/v1/alert") return [ALERT_ROW];
      if (path === "/rest/v1/explanation") return [ALERT_EXPLANATION];
      return undefined;
    },
  });

  await page.goto("/staff/#alerts");
  await page.locator('[data-act="view-alert"][data-id="42"]').first().click({ timeout: 15000 });
  const drawer = page.locator(".drawer, [role=dialog]").filter({ hasText: "Zone entered Critical" }).first();
  await expect(drawer).toContainText("Timeline");
  await expect(drawer).not.toContainText(WHY);
  await expect(drawer).not.toContainText("Technical (admins only)");
  expect(errors).toEqual([]);
});
