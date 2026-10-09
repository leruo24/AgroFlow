import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID } from "./mockBackend";

/* Item 6c: farm and zone requests - [I'll handle this] → [Mark complete],
   a list that reads clearly and fits, and completion by the wizard that
   carries the request out. Mocked backend only. */

const FARMER_NO_NAME = "00000000-0000-4000-8000-0000000000f1";
const FARMER_NAMED = "00000000-0000-4000-8000-0000000000f2";

const REQUESTS = [
  { id: 1, farmer_id: FARMER_NO_NAME, farm_id: null, request_type: "new_farm", location: "Ceres, Western Cape",
    rough_size: 2, crop_type: "potato", notes: "Near the river, a long note that should wrap rather than push the table sideways at all.",
    status: "pending", created_at: "2026-10-05T08:00:00Z", updated_at: "2026-10-05T08:00:00Z" },
  { id: 2, farmer_id: FARMER_NAMED, farm_id: 5, request_type: "new_zone", location: "Mafikeng",
    rough_size: 0.5, crop_type: "tomato", notes: null,
    status: "pending", created_at: "2026-10-04T08:00:00Z", updated_at: "2026-10-04T08:00:00Z" },
];

const HANDLING = [
  { id: "1", handledBy: ADMIN_ID, handledByName: "Test Admin", claimedAt: "2026-10-06T07:00:00Z",
    resolvedBy: null, resolvedByName: null, resolvedAt: null, escalatedAt: null },
  { id: "2", handledBy: ADMIN_ID, handledByName: "Test Admin", claimedAt: "2026-10-06T07:00:00Z",
    resolvedBy: null, resolvedByName: null, resolvedAt: null, escalatedAt: null },
];

type Write = { method: string; path: string; body: Record<string, unknown> };

async function open(page: Page): Promise<Write[]> {
  const writes: Write[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    // Writes only: the wizard's recommendation preview is a read sent as POST.
    if (r.method() !== "GET" && r.method() !== "OPTIONS" && url.pathname.startsWith("/api/")
        && !url.pathname.endsWith("/recommended-settings/preview")) {
      writes.push({ method: r.method(), path: url.pathname, body: JSON.parse(r.postData() ?? "{}") });
    }
  });
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 40,
    respond: (method, path, url) => {
      if (method === "GET" && path === "/rest/v1/service_request") return REQUESTS;
      if (method === "GET" && path === "/rest/v1/profile" && !(url.searchParams.get("id") ?? "").includes(ADMIN_ID)) {
        return [
          { id: FARMER_NO_NAME, name: "", email: "noname@example.com" },
          { id: FARMER_NAMED, name: "Thandi Nkosi", email: "thandi@example.com" },
        ];
      }
      if (method === "GET" && path === "/rest/v1/farm") return [{ farm_id: 5, name: "Alpha Farm" }];
      if (method === "GET" && path === "/api/admin/handling/requests") return HANDLING;
      if (method === "GET" && path === "/api/users/farmers") {
        return [{ id: FARMER_NO_NAME, name: "noname@example.com", email: "noname@example.com", phone: null }];
      }
      if (method === "PUT" && path.startsWith("/api/admin/requests/")) return { id: 1, status: "completed", message: "Status updated." };
      if (method === "POST" && path === "/api/farms/register") return {};
      if (method === "POST" && path === "/api/farms/5/zones") return { message: "Zone added." };
      return undefined;
    },
  });
  await page.goto("/#requests");
  await expect(page.locator("tr", { hasText: "noname@example.com" })).toBeVisible({ timeout: 15000 });
  return writes;
}

test("the list shows the email when there is no name, a clear request type, and fits 1366 px", async ({ page }) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1366, height: 800 });
  await open(page);

  await expect(page.locator("body")).not.toContainText("(no name on file)");
  await expect(page.locator("tbody")).not.toContainText("New farm request");
  await expect(page.locator(".request-status-select")).toHaveCount(0);

  const first = page.locator("tr", { hasText: "noname@example.com" });
  await expect(first).toContainText("New farm");
  await expect(page.locator("tr", { hasText: "Thandi Nkosi" })).toContainText("New zone");

  // No horizontal scrollbar: the table is no wider than its box.
  const overflow = await page.locator(".table-wrap").first().evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  expect(errors).toEqual([]);
});

test("Mark complete asks for an optional note and sends it - never who did it", async ({ page }) => {
  const writes = await open(page);

  await page.locator("tr", { hasText: "Thandi Nkosi" }).getByRole("button", { name: "Mark complete" }).click();
  await page.locator('.drawer [data-field="note"]').fill("Zone added on site.");
  await page.locator("[data-drawer-confirm]").click();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ method: "PUT", path: "/api/admin/requests/2/status",
    body: { status: "completed", note: "Zone added on site." } });
  expect(JSON.stringify(writes[0].body)).not.toContain(ADMIN_ID);
});

test("Set up the farm opens the wizard prefilled from the request, and saving it completes the request", async ({ page }) => {
  const writes = await open(page);

  await page.locator("tr", { hasText: "noname@example.com" }).getByText("Set up the farm").click();
  const wiz = page.locator('[data-wizard="register-farm"]');
  await expect(wiz).toBeVisible({ timeout: 15000 });
  await expect(wiz.locator(".picker-option.is-selected")).toContainText("noname@example.com");
  await wiz.locator("[data-wizard-next]").click();

  await expect(wiz.locator('[data-field="location"]')).toHaveValue("Ceres, Western Cape");
  await expect(wiz.locator('[data-field="farmSize"]')).toHaveValue("2");
  await wiz.locator('[data-field="farmName"]').fill("River Farm");
  await wiz.locator("[data-wizard-next]").click();

  await expect(wiz.locator('[data-field="zone_crop_0"]')).toHaveValue("potato");
  await wiz.locator('[data-field="zone_area_preset_0"]').selectOption("field");
  await wiz.locator('[data-field="zone_area_m2_0"]').fill("200");
  await wiz.locator("[data-wizard-next]").click();
  await wiz.locator("[data-wizard-confirm]").click();

  await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`)).toEqual([
    "POST /api/farms/register",
    "PUT /api/admin/requests/1/status",
  ]);
  expect(writes[1].body).toMatchObject({ status: "completed", note: 'Completed by registering the farm "River Farm".' });
});

test("Add the zone adds it to the farm, prefilled, and completes the request", async ({ page }) => {
  const writes = await open(page);

  await page.locator("tr", { hasText: "Thandi Nkosi" }).getByText("Add the zone").click();
  const box = page.locator("#addZonesContainer");
  await expect(box.locator('[data-field="zone_crop_0"]')).toHaveValue("tomato");

  // A missing size keeps the drawer open with what was typed.
  await box.locator('[data-field="zone_name_0"]').fill("Tub 2");
  await page.locator("[data-drawer-confirm]").click();
  await expect(page.locator("body")).toContainText("Choose how big zone 1 is.");
  await expect(box.locator('[data-field="zone_name_0"]')).toHaveValue("Tub 2");

  await box.locator('[data-field="zone_area_preset_0"]').selectOption("small");
  await page.locator("[data-drawer-confirm]").click();

  await expect.poll(() => writes.map((w) => `${w.method} ${w.path}`)).toEqual([
    "POST /api/farms/5/zones",
    "PUT /api/admin/requests/2/status",
  ]);
  expect((writes[0].body as { zones: Record<string, unknown>[] }).zones[0]).toMatchObject({ name: "Tub 2", cropType: "tomato", areaM2: 0.2 });
  expect(writes[1].body).toMatchObject({ status: "completed", note: "Completed by adding Tub 2." });
});
