import { expect, test, type Page } from "@playwright/test";
import { captureErrors, mockBackend } from "./mockBackend";

const FARMER_ID = "00000000-0000-4000-8000-0000000000f1";

async function installLeafletStub(page: Page) {
  await page.addInitScript(() => {
    let mapClick: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;
    let markerPoint = { lat: 0, lng: 0 };
    let dragEnd: (() => void) | undefined;
    const marker = {
      setLatLng: ([lat, lng]: [number, number]) => { markerPoint = { lat, lng }; return marker; },
      getLatLng: () => markerPoint,
      addTo: () => marker,
      on: (name: string, handler: () => void) => { if (name === "dragend") dragEnd = handler; return marker; },
    };
    const map = {
      setView: ([lat, lng]: [number, number]) => {
        (window as unknown as { __lastMapView: [number, number] }).__lastMapView = [lat, lng];
        return map;
      },
      on: (name: string, handler: typeof mapClick) => { if (name === "click") mapClick = handler; return map; },
      invalidateSize: () => undefined,
      remove: () => undefined,
    };
    (window as unknown as { L: unknown }).L = {
      map: () => map,
      tileLayer: () => ({ addTo: () => undefined }),
      marker: ([lat, lng]: [number, number]) => { markerPoint = { lat, lng }; return marker; },
    };
    (window as unknown as { __mapClick: (lat: number, lng: number) => void }).__mapClick = (lat, lng) => mapClick?.({ latlng: { lat, lng } });
    (window as unknown as { __markerDrag: (lat: number, lng: number) => void }).__markerDrag = (lat, lng) => {
      markerPoint = { lat, lng };
      dragEnd?.();
    };
  });
}

async function openFarmWizard(page: Page, writes: unknown[], reverseResult = true) {
  await installLeafletStub(page);
  await mockBackend(page, {
    minDelayMs: 1,
    maxDelayMs: 3,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/farms") return [];
      if (method === "GET" && path === "/api/users/farmers") return [{ id: FARMER_ID, name: "Owner A", email: "a@example.com", phone: null }];
      if (method === "GET" && path === "/api/admin/locations/search") return [
        { name: "Sesobe", detail: "Moses Kotane, North West, South Africa", latitude: -25.037, longitude: 26.434 },
        { name: "Sesobe", detail: "Another district, North West, South Africa", latitude: -25.137, longitude: 26.534 },
      ];
      if (method === "GET" && path === "/api/admin/locations/reverse" && !reverseResult) return {};
      if (method === "GET" && path === "/api/admin/locations/reverse") return {
        locality: "Sesobe", district: "Moses Kotane", province: "North West", country: "South Africa", displayName: "Sesobe, North West",
      };
      if (method === "POST" && path === "/api/farms/register") return {};
      return undefined;
    },
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/farms/register") {
      writes.push(JSON.parse(request.postData() ?? "{}"));
    }
  });
  await page.goto("/staff/#farms");
  await page.locator('[data-act="add-farm"]').click();
  const wizard = page.locator('[data-wizard="register-farm"]');
  await wizard.locator(".picker-option", { hasText: "Owner A" }).click();
  await wizard.locator("[data-wizard-next]").click();
  return wizard;
}

test("decimal and DMS coordinates normalise without losing southern latitude", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 1, maxDelayMs: 2 });
  await page.goto("/");
  const parsed = await page.evaluate(async () => {
    const coordinates = await import("/src/lib/coordinates.ts");
    return {
      decimal: coordinates.parseCoordinatePair("-25.037, 26.434"),
      dms: coordinates.parseCoordinatePair("25° 02′ 13″ S, 26° 26′ 02″ E"),
      invalidLatitude: coordinates.parseCoordinatePair("-95, 26.434"),
      invalidOrder: coordinates.parseCoordinatePair("26° 26′ 02″ E, 25° 02′ 13″ S"),
    };
  });
  expect(parsed.decimal).toEqual({ latitude: -25.037, longitude: 26.434 });
  expect(parsed.dms?.latitude).toBeCloseTo(-25.03694, 4);
  expect(parsed.dms?.longitude).toBeCloseTo(26.43389, 4);
  expect(parsed.invalidLatitude).toBeNull();
  expect(parsed.invalidOrder).toBeNull();
});

test("search preserves multiple results and map, marker and coordinate entry stay synchronised", async ({ page }) => {
  const errors = captureErrors(page);
  const wizard = await openFarmWizard(page, []);
  await wizard.locator("[data-map-query]").fill("Sesobe, North West");
  await wizard.locator("[data-map-search] button").click();
  await expect(wizard.locator("[data-map-results] .map-search-result")).toHaveCount(2);
  await wizard.locator("[data-map-results] .map-search-result").nth(1).click();
  await expect(wizard.locator("[data-map-lat]")).toHaveValue("-25.137");
  await expect(wizard.locator("[data-map-lng]")).toHaveValue("26.534");

  await page.evaluate(() => (window as unknown as { __mapClick: (lat: number, lng: number) => void }).__mapClick(-25.04, 26.44));
  await expect(wizard.locator("[data-map-lat]")).toHaveValue("-25.04");
  await expect(wizard.locator("[data-map-dms]")).toContainText("S");
  await page.evaluate(() => (window as unknown as { __markerDrag: (lat: number, lng: number) => void }).__markerDrag(-25.041, 26.441));
  await expect(wizard.locator("[data-map-lat]")).toHaveValue("-25.041");

  await wizard.locator("[data-map-pair]").fill("25° 02′ 13″ S, 26° 26′ 02″ E");
  await wizard.locator("[data-map-pair]").press("Tab");
  await expect(wizard.locator("[data-map-lat]")).toHaveValue(/-25\.0369/);
  const view = await page.evaluate(() => (window as unknown as { __lastMapView: [number, number] }).__lastMapView);
  expect(view[0]).toBeLessThan(0);
  expect(errors).toEqual([]);
});

test("a farm can be registered from coordinates without a street address", async ({ page }) => {
  const writes: unknown[] = [];
  const wizard = await openFarmWizard(page, writes, false);
  await wizard.locator('[data-field="farmName"]').fill("Coordinate Farm");
  await wizard.locator('[data-field="farmSize"]').fill("1");
  await wizard.locator("[data-map-pair]").fill("-25.037, 26.434");
  await wizard.locator("[data-map-pair]").press("Tab");
  await wizard.locator('[data-field="location"]').fill("");
  await wizard.locator("[data-wizard-next]").click();
  await wizard.locator('[data-field="zone_name_0"]').fill("Seedling Area");
  await wizard.locator('[data-field="zone_crop_0"]').selectOption("tomato");
  await wizard.locator('[data-field="zone_area_preset_0"]').selectOption("small");
  await wizard.locator("[data-wizard-next]").click();
  await expect(wizard.locator("#registerFarmReview")).toContainText("25°");
  await wizard.locator("[data-wizard-confirm]").click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0] as { farm: Record<string, unknown> }).farm).toMatchObject({
    location: "", latitude: -25.037, longitude: 26.434,
  });
});

test("saved farm coordinates populate the edit map and remain authoritative", async ({ page }) => {
  await installLeafletStub(page);
  let saved: Record<string, unknown> | null = null;
  await mockBackend(page, {
    minDelayMs: 1,
    maxDelayMs: 3,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/farms") return [{
        farm_id: 7, name: "Saved Farm", owner_id: FARMER_ID, owner_name: "Owner A",
        location: "Sesobe, North West", total_area: 2, status: "Active",
        updated_at: "2026-10-01T08:00:00Z", latitude: -25.037, longitude: 26.434,
      }];
      if (method === "GET" && path === "/api/admin/locations/reverse") return {};
      if (method === "PUT" && path === "/api/farms/7/location") return { ok: true };
      return undefined;
    },
  });
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/farms/7/location") {
      saved = JSON.parse(request.postData() ?? "{}");
    }
  });
  await page.goto("/staff/#farms");
  await page.locator('[data-act="view-farm"][data-id="7"]').click();
  await page.locator('[data-act="edit-farm-location"]').click();
  const drawer = page.locator("#drawerPanel");
  await expect(drawer.locator("[data-map-lat]")).toHaveValue("-25.037");
  await expect(drawer.locator("[data-map-dms]")).toContainText("25° 02′ 13″ S");
  await drawer.locator("[data-map-pair]").fill("-25.04365, 26.43489");
  await drawer.locator("[data-map-pair]").press("Tab");
  await drawer.locator("[data-drawer-confirm]").click();
  await expect.poll(() => saved).not.toBeNull();
  expect(saved).toMatchObject({ latitude: -25.04365, longitude: 26.43489 });
});
