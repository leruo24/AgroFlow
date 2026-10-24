import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";
import { kitLabelHtml, kitSetupCardHtml, setupNetworkName, setupNetworkPassword } from "../src/ui/kitSetupCard";

/* The kit setup card, label and wizard (fix/kit-setup-info): the hotspot details without Serial
   Monitor. Mocked backend only. */

const FARMS = [{ farm_id: 1, name: "Alpha Farm", owner_id: "f1", owner_name: "Owner A", location: "Mafikeng, North West",
  total_area: 1, status: "Active", updated_at: "2026-10-01T08:00:00Z" }];
const HARDWARE = [
  { hardware_id: 5, device_name: "Bed 1 kit", device_type: "ESP32", zone_id: 11, status: "Online", last_seen: "2026-10-23T08:00:00Z", created_at: "2026-10-01T08:00:00Z" },
  { hardware_id: 6, device_name: "Bed 2 kit", device_type: "ESP32", zone_id: 12, status: "Offline", last_seen: null, created_at: "2026-10-23T07:00:00Z" },
];
const inAnHour = new Date(Date.now() + 3600_000).toISOString();
const adminRow = (id: number, deviceId: string | null, extra: Record<string, unknown> = {}) => ({
  hardwareId: id, deviceId, deviceName: `Kit ${id}`, zoneId: 6 + id, zoneName: `Bed ${id - 4}`, farmName: "Alpha Farm", online: !!deviceId,
  lastSeen: null, firmwareVersion: "1.7.1", enrollmentStatus: deviceId ? "active" : "enrolled", tokenStatus: "active", mqttUsername: null,
  setupNetworkName: deviceId ? setupNetworkName(deviceId) : null, setupNetworkPassword: deviceId ? setupNetworkPassword(deviceId) : null, ...extra,
});

async function kitsPage(page: Page, admin = [adminRow(5, "0123456789AB"), adminRow(6, null, { enrollmentCode: "K7M2P9QX", enrollmentCodeExpiresAt: inAnHour })]) {
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/rest/v1/hardware") return HARDWARE;
      if (method === "GET" && path === "/api/admin/hardware") return admin;
      if (method === "GET" && path === "/api/farms") return FARMS;
      return undefined;
    },
  });
  await page.goto("/staff/#hardware");
  await expect(page.locator('[data-act="view-device"][data-id="5"]')).toBeVisible({ timeout: 15000 });
}

test("the setup card shows the right hotspot for a known device ID", () => {
  const html = kitSetupCardHtml({ deviceId: "0123456789ab" });
  expect(html).toContain("0123456789AB");
  expect(html).toContain("AgroFlow-Setup-89AB");
  expect(html).toContain("AF-6789AB");
  expect(html).toContain("192.168.4.1");
  expect(kitSetupCardHtml({ deviceId: null })).toContain("Known when the kit first connects");
});

test("the label has the device ID, hotspot, password and a QR code, and never the enrollment code", async () => {
  const html = await kitLabelHtml({ deviceId: "0123456789AB", zoneId: 11, zoneName: "Bed 1", farmName: "Alpha Farm" }, "https://app.agroflow.test");
  expect(html).toContain('data-label-field="deviceId">0123456789AB');
  expect(html).toContain('data-label-field="network">AgroFlow-Setup-89AB');
  expect(html).toContain('data-label-field="password">AF-6789AB');
  expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="QR code: open this kit in the AgroFlow app" data-label-qr>/);
  expect(html).toContain("@page { size: A6 portrait");
  expect(html).not.toMatch(/enrol/i);
  expect(html).not.toMatch(/<script/i);
});

test("every kit's drawer has the card; the enrollment code only while it is valid and unused", async ({ page }) => {
  const errors = captureErrors(page);
  await kitsPage(page);
  await page.locator('[data-act="view-device"][data-id="5"]').click();
  const claimed = page.locator('[data-kit-card][data-hardware-id="5"]');
  await expect(claimed.locator('[data-kit-field="deviceId"]')).toHaveText("0123456789AB");
  await expect(claimed.locator('[data-kit-field="network"]')).toHaveText("AgroFlow-Setup-89AB");
  await expect(claimed.locator('[data-kit-field="password"]')).toHaveText("AF-6789AB");
  await expect(claimed.locator('[data-kit-field="status"]')).toHaveText("Online");
  await expect(claimed.locator('[data-kit-field="code"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.locator('[data-act="view-device"][data-id="6"]').click();
  const waiting = page.locator('[data-kit-card][data-hardware-id="6"]');
  await expect(waiting.locator('[data-kit-field="deviceId"]')).toContainText("Known when the kit first connects");
  await expect(waiting.locator('[data-kit-field="code"]')).toHaveText("K7M2P9QX");
  await expect(waiting.locator('[data-kit-field="expires"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("Copy puts the value on the clipboard, and Print kit label opens the label", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await kitsPage(page);
  await page.locator('[data-act="view-device"][data-id="5"]').click();
  await page.locator('[data-kit-card][data-hardware-id="5"] [aria-label="Copy the setup Wi-Fi password"]').click();
  await expect(page.locator("body")).toContainText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("AF-6789AB");

  const [label] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator('[data-kit-card][data-hardware-id="5"] [data-act="print-kit-label"]').click(),
  ]);
  await expect(label.locator('[data-label-field="deviceId"]')).toHaveText("0123456789AB");
  await expect(label.locator('[data-label-field="network"]')).toHaveText("AgroFlow-Setup-89AB");
  await expect(label.locator('[data-label-field="password"]')).toHaveText("AF-6789AB");
  await expect(label.locator("body")).not.toContainText("K7M2P9QX");
});

test("the wizard's Review and success screens show the card, which fills in once the kit claims", async ({ page }) => {
  let claimed = false;
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/rest/v1/hardware") return HARDWARE;
      if (method === "GET" && path === "/api/farms") return FARMS;
      if (method === "GET" && path === "/api/users/farmers") return [{ id: "f1", name: "Owner A", email: "a@example.com", phone: null }];
      if (method === "GET" && path === "/api/farmer/reports/zones") return [{ zoneId: 11, name: "Bed 1", farmId: 1, cropType: "potato" }];
      if (method === "POST" && path === "/api/devices/enroll") return { hardwareId: 77, enrollmentCode: "K7M2P9QX", expiresAt: inAnHour };
      if (method === "GET" && path === "/api/admin/hardware") {
        // The first poll: not claimed yet. Then the kit claims with its device ID.
        const row = claimed ? adminRow(77, "A1B2C3D4E5F6") : adminRow(77, null, { enrollmentCode: "K7M2P9QX", enrollmentCodeExpiresAt: inAnHour });
        claimed = true;
        return [row];
      }
      return undefined;
    },
  });
  await page.goto("/staff/#hardware");
  await page.locator('[data-act="register-hardware"]').click();
  const wiz = page.locator('[data-wizard="register-hardware"]');
  await wiz.locator(".picker-option", { hasText: "Owner A" }).click();
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator(".picker-option", { hasText: "Alpha Farm" }).click();
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator(".picker-option", { hasText: "Bed 1" }).click();
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator("[data-wizard-next]").click();

  const review = wiz.locator("#kitReview [data-kit-card]");
  await expect(review.locator('[data-kit-field="code"]')).toContainText("Created when you confirm");
  await expect(review.locator('[data-kit-field="deviceId"]')).toContainText("Known when the kit first connects");
  await expect(review.locator(".kit-card-steps li")).toHaveCount(3);

  await wiz.locator("[data-wizard-confirm]").click();
  const result = page.locator("#kitSetupResult");
  await expect(result.locator('[data-kit-field="code"]')).toHaveText("K7M2P9QX");
  await expect(result.locator(".kit-card-steps li").first()).toContainText("Join the kit's Wi-Fi");
  // Filled in by itself once the kit has claimed (it polls every 5 s).
  await expect(page.locator("[data-kit-claimed]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#kitSetupResult [data-kit-field="network"]')).toHaveText("AgroFlow-Setup-E5F6");
  await expect(page.locator('#kitSetupResult [data-kit-field="password"]')).toHaveText("AF-D4E5F6");
  await expect(page.locator('#kitSetupResult [data-kit-field="code"]')).toHaveCount(0);
});

test("the kit card has Reconnect or reset, with the printable guide; the label says how to change Wi-Fi", async ({ page }) => {
  await kitsPage(page);
  await page.locator('[data-act="view-device"][data-id="5"]').click();
  const help = page.locator('[data-kit-card][data-hardware-id="5"] [data-kit-help]');
  await help.locator("summary").click();
  await expect(help).toContainText("Change Wi-Fi");
  await expect(help).toContainText("off and on 3 times quickly");
  await expect(help).toContainText("5 times quickly");
  await expect(help).toContainText("new enrollment code");
  const link = help.locator("[data-kit-guide-link]");
  await expect(link).toHaveAttribute("href", "/guides/reconnect-or-reset-your-kit.html");

  const [guide] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await expect(guide.locator("h1")).toHaveText("Reconnect or reset your AgroFlow kit");
  await expect(guide.locator('[data-guide-section="wifi"]')).toBeVisible();
  await expect(guide.locator('[data-guide-section="move"]')).toBeVisible();
  await expect(guide.locator("[data-guide-warning]")).toContainText("does not water until AgroFlow staff");

  const label = await kitLabelHtml({ deviceId: "0123456789AB" }, "https://app.agroflow.test");
  expect(label).toContain("Changing Wi-Fi? Open the app → Kit, or switch off/on 3 times.");
  expect(label).not.toMatch(/enrol/i);
});
