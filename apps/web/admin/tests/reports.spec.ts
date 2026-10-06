import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Item 4: the Reports page - fewer, real, useful. Mocked backend only. */

const FARMS = [
  { farm_id: 1, name: "Alpha Farm", owner_name: "Owner A" },
  { farm_id: 2, name: "Bravo Farm", owner_name: "Owner B" },
];

const ZONES = [{ zoneId: 21, name: "Tub 1", cropType: "Tomato" }];

const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);

const INSIGHTS = [
  {
    insight_type: "overwatering", message: "Tub 1 got about 2x more water than needed this week.", valid_for: today,
    data: { explanation: { summary: "This week the zone got about 2 times the water tomato used.", facts: [], rule: "More than 1.2 times what the crop used counts as too much.", confidence: "Medium", whatWouldChangeIt: "Shorter waterings." } },
    zone: { name: "Tub 1", farm: { farm_id: 2, name: "Bravo Farm", status: "Active" } },
  },
  {
    insight_type: "zone_offline", message: "No data from Tub 3 since 08:00 on 6 Oct.", valid_for: today, data: null,
    zone: { name: "Tub 3", farm: { farm_id: 1, name: "Alpha Farm", status: "Active" } },
  },
];

const SCHEDULE = {
  farmId: 2, enabled: true, frequency: "weekly", reportTypes: ["water_usage"], zoneIds: null, lastRunAt: null,
  description: "Automatic reports: Weekly (Water usage)", dayOfWeek: 3, perZonePdf: false, sendToHandler: false,
  adminChatEnabled: false, lastSentAt: "2026-10-01T05:00:00Z", nextSendAt: "2026-10-08T07:00:00+02:00",
  turnedOffBy: null, turnedOffAt: null, optionsAvailable: true,
};

function respond(method: string, path: string): unknown {
  if (method !== "GET") return undefined;
  if (path === "/api/farms") return FARMS;
  if (path === "/api/farmer/reports/zones") return ZONES;
  if (path.startsWith("/api/admin/farms/") && path.endsWith("/report-schedule")) return SCHEDULE;
  if (path === "/rest/v1/ai_recommendation") return INSIGHTS;
  return undefined;
}

test("Reports leads with farm reports, pre-filled, and has no hollow report types", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, { minDelayMs: 10, maxDelayMs: 40, respond });
  await page.goto("/#reports");

  const panels = page.locator(".panel h4");
  await expect(panels.first()).toHaveText("Farm reports", { timeout: 15000 });

  // The newest farm is pre-filled when none was picked before.
  await expect(page.locator("#liveFarm")).toHaveValue("2");
  await expect(page.locator("#liveZone option", { hasText: "Tub 1" })).toHaveCount(1);

  for (const gone of ["Device Performance", "Support Performance", "Hardware Downtime", "Platform Availability", "Device uptime"]) {
    await expect(page.locator("body")).not.toContainText(gone);
  }
  await expect(page.locator("body")).not.toContainText("No data in this range");

  expect(errors).toEqual([]);
});

test("Farms needing attention this week comes from the farmers' advice and opens with a Why", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 10, maxDelayMs: 40, respond });
  await page.goto("/#reports");

  const over = page.locator('[data-act="view-attention"][data-id="over"]');
  await expect(over).toContainText("1 farm over-watering", { timeout: 15000 });
  await expect(page.locator('[data-act="view-attention"][data-id="kits"]')).toContainText("1 farm with a kit offline or faulty");

  await over.click();
  const drawer = page.locator("#drawerPanel");
  await expect(drawer).toContainText("Bravo Farm · Tub 1");
  await expect(drawer.getByRole("button", { name: "Why am I seeing this?" })).toHaveCount(1);
});

test("Automatic reports: daily, a chosen day, per-zone PDFs, recipients, last/next, and a test send", async ({ page }) => {
  const posts: string[] = [];
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 40,
    respond: (method, path) => {
      if (method === "POST" && path.endsWith("/report-schedule/test")) {
        posts.push(path);
        return { sent: 1, failed: 0, skipped: 0, message: "Sent 1 test PDF to your own Telegram." };
      }
      return respond(method, path);
    },
  });
  await page.goto("/#reports");

  await expect(page.locator("#autoReportsSummary")).toContainText("Next send", { timeout: 15000 });
  await page.locator("#autoReportsEdit").click();

  const drawer = page.locator("#drawerPanel");
  const frequency = drawer.locator("#autoReportsFrequency option");
  await expect(frequency).toHaveText([
    "Off",
    "Daily, 07:00 - one page of today's actions",
    "Weekly, 07:00",
    "Monthly, on the 1st at 07:00",
  ]);
  await expect(drawer.locator("#autoReportsDay")).toHaveValue("3");
  await expect(drawer).toContainText("A tailored PDF for each zone");
  await expect(drawer).toContainText("The admin group chat");
  await expect(drawer).toContainText("Farm summary");

  await drawer.getByRole("button", { name: "Send test now" }).click();
  await expect(page.locator(".toast").last()).toContainText("Sent 1 test PDF to your own Telegram.");
  expect(posts).toEqual(["/api/admin/farms/2/report-schedule/test"]);
});
