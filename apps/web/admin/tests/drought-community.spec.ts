import { expect, test, type Page } from "@playwright/test";
import { captureErrors, mockBackend } from "./mockBackend";

/* Drought & community for staff (docs/drought-community.md): farms in drought mode on Home and
 * in the bell, farmers' location problems, community report moderation (list, map, the
 * reporter for staff only, repeat false reporters, Hide with a reason), and the settings. */

const EVIDENCE = "../../../docs/test-evidence/drought-community";

const droughtFarms = [{
  farmId: 41, name: "Mahikeng (Simulated)", since: "2026-10-20T06:00:00Z", override: null, isSimulated: true,
  reason: "Drought mode on: tank about 20% full (drought line 25%); 2 mm of rain forecast over 7 days (less than 5 mm counts as dry); crop water use 6 mm a day forecast against 5 mm usual for this farm.",
}];
const notices = [{
  id: 5, farmId: 42, farmName: "Ottoshoop (Simulated)", kind: "location_wrong", farmerName: "Thabo M.",
  message: "The farmer says the saved place of the farm is wrong.", createdAt: "2026-10-20T07:10:00Z",
}];
const report = (over: Record<string, unknown>) => ({
  id: 1, category: "pest", subtype: "fall_armyworm", label: "Fall armyworm", severity: "moderate", description: null,
  latitude: -25.87, longitude: 25.64, radiusKm: 50, status: "active", fireState: null, escalated: false,
  createdAt: "2026-10-20T08:00:00Z", expiresAt: "2026-10-27T08:00:00Z", hiddenReason: null,
  reporterName: "Thabo M.", reporterEmail: "thabo@example.com", farmName: "Mahikeng (Simulated)",
  confirmations: 2, notifiedFarms: 3, reporterHiddenCount: 0, reporterTotal: 1, ...over,
});
const reports = [
  report({ id: 1 }),
  report({ id: 2, category: "fire", subtype: "veld_fire", label: "Veld fire", severity: "high", latitude: -25.75, longitude: 25.97,
    fireState: "spreading", escalated: true, radiusKm: 75, confirmations: 3, notifiedFarms: 6, description: "Smoke over the ridge" }),
  report({ id: 3, category: "water", subtype: "burst_pipe", label: "Burst pipe", severity: "low", status: "hidden",
    hiddenReason: "False report", reporterName: "K. Botha", reporterEmail: "kb@example.com", reporterHiddenCount: 3, reporterTotal: 4 }),
];
const settings = [
  { key: "drought.tank_low_fraction", value: 0.25, description: "Tank share below which drought mode can start", source: "AgroFlow setting (not an agronomic figure)", updatedAt: "2026-10-20T00:00:00Z" },
  { key: "drought.rain_sum_mm", value: 5, description: "Forecast rain over the week that counts as dry (mm)", source: "AgroFlow setting", updatedAt: "2026-10-20T00:00:00Z" },
  { key: "community.report_limit", value: 2, description: "Reports per farmer in the window", source: "AgroFlow setting", updatedAt: "2026-10-20T00:00:00Z" },
  { key: "community.radius_km.fire", value: 50, description: "Fire alert radius (km)", source: "AgroFlow setting", updatedAt: "2026-10-20T00:00:00Z" },
  { key: "fire.emergency_text", value: "your local emergency number (112 from a mobile phone)", description: "Who to call, in every fire message", source: "Set by staff", updatedAt: "2026-10-20T00:00:00Z" },
];

type Write = { method: string; path: string; body: unknown };

// Screenshots wait for the start-up splash to go and the panels' reveal animation to end.
async function settle(page: Page) {
  await page.locator("#agroflow-splash").waitFor({ state: "detached", timeout: 15_000 });
  await page.waitForTimeout(600);
}

async function installLeafletStub(page: Page) {
  // No map tiles in tests: each report is drawn as a dot on a plain box, by its coordinates.
  await page.addInitScript(() => {
    let box: HTMLElement | null = null;
    // Roughly Mahikeng to Ottoshoop: longitude 25.3 to 26.3 across, latitude -25.4 to -26.2 down.
    const toXY = ([lat, lng]: [number, number]) => ({ x: (lng - 25.3) * 100, y: ((-25.4 - lat) / 0.8) * 100 });
    const layer = (c: [number, number], o: Record<string, unknown>, circle: boolean) => {
      const l = {
        addTo: () => {
          if (!box) return l;
          const d = document.createElement("div");
          const { x, y } = toXY(c);
          const size = circle ? Number(o["radius"]) / 250 : 12;
          d.style.cssText = `position:absolute;left:calc(${x}% - ${size / 2}px);top:calc(${y}% - ${size / 2}px);width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${String(o["color"])};background:${circle ? "transparent" : String(o["color"])}`;
          box.appendChild(d);
          return l;
        },
        bindTooltip: () => l,
      };
      return l;
    };
    (window as unknown as { L: unknown }).L = {
      map: (el: HTMLElement) => {
        box = el;
        el.style.position = "relative";
        const map = { setView: () => map, on: () => map, invalidateSize: () => undefined, remove: () => undefined };
        return map;
      },
      tileLayer: () => ({ addTo: () => undefined }),
      marker: () => ({ setLatLng() { return this; }, getLatLng: () => ({ lat: 0, lng: 0 }), addTo() { return this; }, on() { return this; } }),
      circle: (c: [number, number], o: Record<string, unknown>) => layer(c, o, true),
      circleMarker: (c: [number, number], o: Record<string, unknown>) => layer(c, o, false),
    };
  });
}

async function open(page: Page, writes: Write[], hash = "#droughtCommunity") {
  await installLeafletStub(page);
  await mockBackend(page, {
    minDelayMs: 1,
    maxDelayMs: 3,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/admin/drought-farms") return droughtFarms;
      if (method === "GET" && path === "/api/admin/staff-notices") return notices;
      if (method === "GET" && path === "/api/admin/community/reports") return reports;
      if (method === "GET" && path === "/api/admin/settings/drought-community") return settings;
      if (method === "PUT" && path === "/api/admin/farms/41/drought") return { active: false, reason: "Drought mode off (set by hand)." };
      if (method === "POST" && path === "/api/admin/staff-notices/5/resolve") return { message: "Closed." };
      if (method === "POST" && path === "/api/admin/community/reports/1/hide") return { message: "Hidden." };
      if (method === "PUT" && path === "/api/admin/settings/drought-community") return { message: "Saved 1 setting(s).", settings };
      return undefined;
    },
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["POST", "PUT"].includes(request.method()) && (path.includes("/drought") || path.includes("/staff-notices") || path.includes("/community") || path.includes("/settings/"))) {
      writes.push({ method: request.method(), path, body: JSON.parse(request.postData() ?? "{}") });
    }
  });
  await page.goto(`/staff/${hash}`);
}

test("Home's Needs attention and the bell show drought farms and location problems", async ({ page }) => {
  const errors = captureErrors(page);
  await open(page, [], "#dashboard");
  const queue = page.locator(".attn-section");
  await expect(queue.getByText("Farms in drought mode")).toBeVisible();
  await expect(queue.getByText("Location problems from farmers")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${EVIDENCE}/admin-home-needs-attention-1366.png` });
  await page.locator("#bellBtn").click();
  await expect(page.locator('#bellMenu [data-bell="drought"]')).toContainText("1");
  await expect(page.locator('#bellMenu [data-bell="notices"]')).toContainText("Location problems from farmers");
  await page.locator('#bellMenu [data-bell="drought"]').click();
  await expect(page.locator("#content")).toHaveAttribute("data-page", "droughtCommunity");
  expect(errors).toEqual([]);
});

test("moderation: list and map, the reporter for staff, repeat false reporters, hide with a reason", async ({ page }) => {
  const writes: Write[] = [];
  const errors = captureErrors(page);
  await open(page, writes);
  const content = page.locator("#content");
  await expect(content.getByText("Fall armyworm")).toBeVisible();
  await expect(content.getByText("thabo@example.com").first()).toBeVisible();
  await expect(content.getByText("3 of 4 hidden")).toBeVisible();            // a repeat false reporter
  await expect(content.getByText("(widened)")).toBeVisible();                 // fire escalated at 3+ confirmations
  // Stored values in plain words: severity, status and the fire's state.
  const table = page.locator(".panel", { hasText: "Points are rounded" }).locator("table");
  await expect(table.getByText("Moderate", { exact: true })).toBeVisible();
  await expect(table.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(table.getByText(/Spreading/)).toBeVisible();
  for (const raw of ["moderate", "active", "spreading", "under_control"]) await expect(table.getByText(raw, { exact: true })).toHaveCount(0);
  await expect(content.locator("[data-community-map] div")).toHaveCount(4);  // two active reports: circle + dot each
  await settle(page);
  await page.locator("[data-community-map]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-moderation-map-1366.png` });
  await page.locator(".panel", { hasText: "Points are rounded" }).locator("table").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-moderation-list-1366.png` });

  await content.locator('[data-act="hide-report"][data-id="1"]').click();
  const drawer = page.locator("#drawerPanel");
  await drawer.locator("[data-drawer-confirm]").click();
  await expect(page.locator(".toast").last()).toContainText("Say why");
  await drawer.locator('[data-field="hideReason"], input[name="hideReason"], [data-name="hideReason"]').first().fill("Duplicate of an earlier report");
  await drawer.locator("[data-drawer-confirm]").click();
  await expect.poll(() => writes.find((w) => w.path.endsWith("/hide"))?.body).toEqual({ reason: "Duplicate of an earlier report" });
  // Hidden and closed reports have no Hide button.
  await expect(content.locator('[data-act="hide-report"][data-id="3"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("drought mode can be switched by staff, and a location notice fixed and closed", async ({ page }) => {
  const writes: Write[] = [];
  await open(page, writes);
  const content = page.locator("#content");
  await expect(content.getByText("tank about 20% full")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${EVIDENCE}/admin-drought-farms-1366.png` });
  await content.locator('[data-act="drought-mode"][data-id="41"][data-mode="off"]').click();
  await expect.poll(() => writes.find((w) => w.path === "/api/admin/farms/41/drought")?.body).toEqual({ mode: "off" });
  await expect(content.locator('[data-act="edit-farm-location"][data-id="42"]')).toBeVisible();
  await content.locator('[data-act="resolve-notice"][data-id="5"]').click();
  await expect.poll(() => writes.some((w) => w.path === "/api/admin/staff-notices/5/resolve")).toBe(true);
});

test("settings: only what changed is saved, typed as numbers; an empty number is refused", async ({ page }) => {
  const writes: Write[] = [];
  await open(page, writes);
  const radius = page.locator('[data-setting="community.radius_km.fire"]');
  await radius.fill("");                                                   // a number box cannot hold letters
  await page.locator('[data-act="save-dc-settings"]').click();
  await expect(page.locator(".toast").last()).toContainText("must be a number");
  await radius.fill("60");
  await page.locator('[data-act="save-dc-settings"]').click();
  await expect.poll(() => writes.find((w) => w.path === "/api/admin/settings/drought-community")?.body)
    .toEqual({ settings: [{ key: "community.radius_km.fire", value: 60 }] });
  await settle(page);
  await page.locator('[data-act="save-dc-settings"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-settings-1366.png` });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the moderation page fits 390 px", async ({ page }) => {
    await open(page, []);
    await expect(page.locator("#content").getByText("Fall armyworm")).toBeVisible();
    await settle(page);
    await page.locator("[data-community-map]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/admin-moderation-390.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
