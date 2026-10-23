import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Kits: a kit that was offline shows how many readings it is still uploading, from the
   "backlog" on its latest reading (firmware 1.7.0, migration 0060). Mocked backend only. */

const HARDWARE = [
  { hardware_id: 1, device_name: "Bed 1 kit", device_type: "ESP32", zone_id: 11, status: "Online", last_seen: "2026-10-23T08:00:00Z", created_at: "2026-10-01T08:00:00Z" },
  { hardware_id: 2, device_name: "Bed 2 kit", device_type: "ESP32", zone_id: 12, status: "Online", last_seen: "2026-10-23T08:00:00Z", created_at: "2026-10-01T08:00:00Z" },
];
const row = (hardwareId: number, offlineBacklog: number | null) => ({
  hardwareId, deviceId: `AF00000${hardwareId}`, deviceName: `Bed ${hardwareId} kit`, zoneId: 10 + hardwareId,
  zoneName: `Bed ${hardwareId}`, farmName: "Alpha Farm", online: true, lastSeen: "2026-10-23T08:00:00Z",
  firmwareVersion: "1.7.0", enrollmentStatus: "active", tokenStatus: "active", mqttUsername: null, offlineBacklog,
});

test("a kit still uploading its offline readings says how many; a kit with none says nothing", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/rest/v1/hardware") return HARDWARE;
      if (method === "GET" && path === "/api/admin/hardware") return [row(1, 12), row(2, 0)];
      return undefined;
    },
  });
  await page.goto("/staff/#hardware");
  await expect(page.locator('[data-backlog="1"]')).toHaveText("12 readings waiting to upload", { timeout: 15000 });
  await expect(page.locator('[data-backlog="2"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
