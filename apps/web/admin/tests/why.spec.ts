import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Item 2c: "Why am I seeing this?" in the admin console.
 *
 * Every KPI tile and Needs-attention card explains what it counts and why it
 * is highlighted; an alert shows its own stored explanation; admins see the
 * technical line. Mocked backend only - nothing touches the live database. */

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

test("Home: every KPI tile and the Needs-attention card explain themselves, with the technical line for admins", async ({ page }) => {
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

  // Six tiles on Home, each with its own link, plus the attention card's.
  await expect(page.locator(".kpi-item .why-link")).toHaveCount(6);
  await expect(page.locator(".attn-item .why-link")).toHaveCount(1);

  // The link is beside the card, never inside it.
  await expect(page.locator(".attn-card .why-link, .card .why-link")).toHaveCount(0);

  await page.locator(".attn-item", { hasText: "Zones missing setup" }).getByRole("button", { name: WHY }).click();
  const drawer = page.locator(".drawer, [role=dialog]").filter({ hasText: WHY }).first();
  await expect(drawer).toContainText("Zones missing setup: 1. Advice for these zones is less certain until the missing detail is added.");
  await expect(drawer).toContainText("What this counts");
  await expect(drawer).toContainText("Technical (admins only)");
  await expect(drawer).toContainText("planting_date");

  // And the copy no longer claims the engine cannot advise (item 2).
  await expect(page.locator("body")).not.toContainText("the engine cannot advise");

  expect(errors).toEqual([]);
});

test("an alert opens with its own stored explanation", async ({ page }) => {
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
  await expect(drawer).toContainText(WHY);
  await expect(drawer).toContainText("The zone's soil sensor reading dropped very low.");
  await expect(drawer).toContainText("Soil sensor reading");
  await expect(drawer).toContainText("Technical (admins only)");

  expect(errors).toEqual([]);
});

test("an alert with no stored explanation shows no Why section - never a generic one", async ({ page }) => {
  await mockBackend(page, {
    minDelayMs: 10,
    maxDelayMs: 40,
    respond: (method, path) => (method === "GET" && path === "/rest/v1/alert" ? [ALERT_ROW] : undefined),
  });

  await page.goto("/staff/#alerts");
  await page.locator('[data-act="view-alert"][data-id="42"]').first().click({ timeout: 15000 });

  const drawer = page.locator(".drawer, [role=dialog]").filter({ hasText: "Zone entered Critical" }).first();
  await expect(drawer).toContainText("Timeline");
  await expect(drawer).not.toContainText(WHY);
});
