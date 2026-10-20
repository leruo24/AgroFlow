import { expect, test, type Page } from "@playwright/test";
import { captureErrors, mockBackend } from "./mockBackend";

/* The staff location picker (docs/drought-community.md, Part 3): province -> town search as
 * you type, limited to the province and tolerant of misspellings -> a draggable pin ->
 * coordinates checked against South Africa -> "Use my current location". In the register-farm
 * wizard, the onboarding page and the farm edit drawer (pre-filled). Farmers never see it.
 * Screenshots of each stage go to docs/test-evidence/drought-community/. */

const FARMER_ID = "00000000-0000-4000-8000-0000000000f1";
const EVIDENCE = "../../../docs/test-evidence/drought-community";

// Open-Meteo's answers for these places (checked on 2026-10-20).
const MAHIKENG = {
  name: "Mahikeng", detail: "Ngaka Modiri Molema District Municipality, North West",
  latitude: -25.86522, longitude: 25.64421, province: "North West", district: "Ngaka Modiri Molema District Municipality",
};
const MMABATHO = {
  name: "Mmabatho", detail: "Ngaka Modiri Molema District Municipality, North West",
  latitude: -25.85, longitude: 25.63333, province: "North West", district: "Ngaka Modiri Molema District Municipality",
};

type Search = { q: string; province: string | null };

async function installLeafletStub(page: Page) {
  await page.addInitScript(() => {
    let mapClick: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;
    let markerPoint = { lat: 0, lng: 0 };
    let dragEnd: (() => void) | undefined;
    // No map tiles in tests: the pin is drawn as a plain marker in the middle of the canvas
    // so the screenshots show where it is.
    const drawPin = () => {
      const canvas = document.querySelector<HTMLElement>("[data-map-canvas]");
      if (!canvas) return;
      let pin = canvas.querySelector<HTMLElement>("[data-test-pin]");
      if (!pin) {
        pin = document.createElement("div");
        pin.dataset["testPin"] = "1";
        pin.style.cssText = "position:relative;top:45%;text-align:center;font:600 13px system-ui;color:#184d35";
        canvas.appendChild(pin);
      }
      pin.textContent = `📍 ${markerPoint.lat.toFixed(5)}, ${markerPoint.lng.toFixed(5)} (map tiles are not loaded in tests)`;
    };
    const marker = {
      setLatLng: ([lat, lng]: [number, number]) => { markerPoint = { lat, lng }; drawPin(); return marker; },
      getLatLng: () => markerPoint,
      addTo: () => { drawPin(); return marker; },
      on: (name: string, handler: () => void) => { if (name === "dragend") dragEnd = handler; return marker; },
    };
    const map = {
      setView: () => map,
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

// The API's town search, faked: "Mafeking" (the old spelling) finds Mahikeng, but only in
// North West or with no province.
function townSearch(searches: Search[]) {
  return (url: URL) => {
    const q = url.searchParams.get("q") ?? "";
    const province = url.searchParams.get("province");
    searches.push({ q, province });
    if (province && province !== "North West") return [];
    if (/^maf|^mah/i.test(q)) return [MAHIKENG];
    if (/^mma/i.test(q)) return [MMABATHO];
    return [];
  };
}

async function openFarmWizard(page: Page, searches: Search[], writes: { path: string; body: Record<string, unknown> }[]) {
  await installLeafletStub(page);
  await mockBackend(page, {
    minDelayMs: 1,
    maxDelayMs: 3,
    respond: (method, path, url) => {
      if (method === "GET" && path === "/api/farms") return [];
      if (method === "GET" && path === "/api/users/farmers") return [{ id: FARMER_ID, name: "Owner A", email: "a@example.com", phone: null }];
      if (method === "GET" && path === "/api/admin/locations/search") return townSearch(searches)(url);
      if (method === "GET" && path === "/api/admin/locations/reverse") return {
        locality: "Mahikeng", district: "Ngaka Modiri Molema District Municipality", province: "North West", country: "South Africa", displayName: "Mahikeng",
      };
      if (method === "POST" && path === "/api/farms/register") return { farm_id: 41, message: "Registered." };
      if (method === "PUT" && path === "/api/admin/farms/41/location") return { message: "Location saved." };
      return undefined;
    },
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["POST", "PUT"].includes(request.method()) && (path === "/api/farms/register" || path.startsWith("/api/admin/farms/"))) {
      writes.push({ path, body: JSON.parse(request.postData() ?? "{}") });
    }
  });
  await page.goto("/#farms");
  await page.locator('[data-act="add-farm"]').click();
  const wizard = page.locator('[data-wizard="register-farm"]');
  await wizard.locator(".picker-option", { hasText: "Owner A" }).click();
  await wizard.locator("[data-wizard-next]").click();
  return wizard;
}

test("province, then 'Mafeking' as you type finds Mahikeng in North West; the pin and coordinates follow", async ({ page }) => {
  const errors = captureErrors(page);
  const searches: Search[] = [];
  const wizard = await openFarmWizard(page, searches, []);
  const picker = wizard.locator("[data-map-pick]");
  await expect(picker.locator("[data-map-province] option")).toHaveCount(10);   // "Choose" + the nine
  await picker.locator("[data-map-province]").selectOption("North West");
  await picker.locator("[data-map-province]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-location-1-province-1366.png` });

  await picker.locator("[data-map-query]").pressSequentially("Mafeking", { delay: 20 });   // no Search button
  const result = picker.locator("[data-map-results] .map-search-result");
  await expect(result).toHaveCount(1);
  await expect(result).toContainText("Mahikeng");
  await expect(result).toContainText("Ngaka Modiri Molema District Municipality, North West");
  expect(searches.at(-1)).toEqual({ q: "Mafeking", province: "North West" });
  // As you type, but not on every key: a pause first.
  expect(searches.length).toBeLessThan("Mafeking".length);
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-location-2-town-1366.png` });

  await result.click();
  await expect(picker.locator("[data-map-results]")).toBeHidden();
  await expect(picker.locator("[data-map-lat]")).toHaveValue("-25.86522");
  await expect(picker.locator("[data-map-lng]")).toHaveValue("25.64421");
  await expect(picker.locator("[data-map-town]")).toHaveValue("Mahikeng");
  await expect(wizard.locator('[data-field="location"]')).toHaveValue(/Mahikeng/);

  // Dragging the pin to the farm itself updates the coordinates.
  await page.evaluate(() => (window as unknown as { __markerDrag: (lat: number, lng: number) => void }).__markerDrag(-25.8712, 25.6518));
  await expect(picker.locator("[data-map-lat]")).toHaveValue("-25.8712");
  await expect(picker.locator("[data-map-lng]")).toHaveValue("25.6518");
  await expect(picker.locator("[data-map-status]")).toContainText("-25.87120, 25.65180");
  await picker.locator("[data-map-canvas]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-location-3-pin-1366.png` });
  await picker.locator("[data-map-pair]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${EVIDENCE}/admin-location-4-coordinates-1366.png` });
  expect(errors).toEqual([]);
});

test("the province limits the search: Mahikeng is not in Gauteng", async ({ page }) => {
  const searches: Search[] = [];
  const wizard = await openFarmWizard(page, searches, []);
  const picker = wizard.locator("[data-map-pick]");
  await picker.locator("[data-map-province]").selectOption("Gauteng");
  await picker.locator("[data-map-query]").fill("Mahikeng");
  await expect(picker.locator("[data-map-status]")).toContainText("No matching town was found in Gauteng");
  expect(searches.at(-1)).toEqual({ q: "Mahikeng", province: "Gauteng" });
  // Changing the province searches again.
  await picker.locator("[data-map-province]").selectOption("North West");
  await expect(picker.locator("[data-map-results] .map-search-result")).toHaveCount(1);
  expect(searches.at(-1)).toEqual({ q: "Mahikeng", province: "North West" });
});

test("coordinates outside South Africa are refused, in the picker and on save", async ({ page }) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const wizard = await openFarmWizard(page, [], writes);
  const picker = wizard.locator("[data-map-pick]");
  await picker.locator("[data-map-pair]").fill("-25.86, 45.64");          // a longitude in the Indian Ocean
  await picker.locator("[data-map-pair]").press("Tab");
  await expect(picker.locator("[data-map-status]")).toContainText("outside South Africa");
  await expect(picker.locator("[data-map-lat]")).toHaveValue("");
  await picker.locator("[data-map-lat]").fill("25.86");                     // the sign left off
  await picker.locator("[data-map-lng]").fill("25.64");
  await picker.locator("[data-map-lng]").press("Tab");
  await expect(picker.locator("[data-map-status]")).toContainText("outside South Africa");
  await wizard.locator('[data-field="farmName"]').fill("Wrong Sign Farm");
  await wizard.locator('[data-field="farmSize"]').fill("1");
  await wizard.locator('[data-field="location"]').fill("Mahikeng, North West");
  await wizard.locator("[data-wizard-next]").click();
  await wizard.locator('[data-field="zone_name_0"]').fill("Bed 1");
  await wizard.locator('[data-field="zone_crop_0"]').selectOption("tomato");
  await wizard.locator('[data-field="zone_area_preset_0"]').selectOption("small");
  await wizard.locator("[data-wizard-next]").click();
  await wizard.locator("[data-wizard-confirm]").click();
  await expect(page.locator(".toast").last()).toContainText("outside South Africa");
  expect(writes).toEqual([]);
});

test("registering saves the province and town with the coordinates", async ({ page }) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const wizard = await openFarmWizard(page, [], writes);
  const picker = wizard.locator("[data-map-pick]");
  await picker.locator("[data-map-province]").selectOption("North West");
  await picker.locator("[data-map-query]").fill("Mmabatho");
  await picker.locator("[data-map-results] .map-search-result").first().click();
  await wizard.locator('[data-field="farmName"]').fill("Mmabatho Farm");
  await wizard.locator('[data-field="farmSize"]').fill("1");
  await wizard.locator("[data-wizard-next]").click();
  await wizard.locator('[data-field="zone_name_0"]').fill("Bed 1");
  await wizard.locator('[data-field="zone_crop_0"]').selectOption("tomato");
  await wizard.locator('[data-field="zone_area_preset_0"]').selectOption("small");
  await wizard.locator("[data-wizard-next]").click();
  await wizard.locator("[data-wizard-confirm]").click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]!.path).toBe("/api/farms/register");
  expect(writes[0]!.body["farm"]).toMatchObject({ latitude: -25.85, longitude: 25.63333 });
  expect(writes[1]).toEqual({
    path: "/api/admin/farms/41/location",
    body: { province: "North West", town: "Mmabatho", latitude: -25.85, longitude: 25.63333 },
  });
});

test("'Use my current location' reads the GPS only when pressed", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -25.86, longitude: 25.64 });
  const wizard = await openFarmWizard(page, [], []);
  const picker = wizard.locator("[data-map-pick]");
  await expect(picker.locator("[data-map-lat]")).toHaveValue("");          // not read on its own
  await picker.locator("[data-map-gps]").click();
  await expect(picker.locator("[data-map-lat]")).toHaveValue("-25.86");
  await expect(picker.locator("[data-map-lng]")).toHaveValue("25.64");
});

async function openEditDrawer(page: Page, saved: { path: string; body: Record<string, unknown> }[]) {
  await installLeafletStub(page);
  await mockBackend(page, {
    minDelayMs: 1,
    maxDelayMs: 3,
    respond: (method, path, url) => {
      if (method === "GET" && path === "/api/farms") return [{
        farm_id: 7, name: "Mahikeng (Simulated)", owner_id: FARMER_ID, owner_name: "Owner A",
        location: "Mahikeng, North West", total_area: 2, status: "Active",
        updated_at: "2026-10-01T08:00:00Z", latitude: -25.86522, longitude: 25.64421,
      }];
      // The saved province and town (0053), read straight from the farm table.
      if (method === "GET" && path === "/rest/v1/farm" && (url.searchParams.get("select") ?? "").includes("province")) {
        return [{ province: "North West", town: "Mahikeng" }];
      }
      if (method === "GET" && path === "/api/admin/locations/search") return townSearch([])(url);
      if (method === "GET" && path === "/api/admin/locations/reverse") return {};
      if (method === "PUT" && path === "/api/farms/7/location") return { ok: true };
      if (method === "PUT" && path === "/api/admin/farms/7/location") return { message: "Location saved." };
      return undefined;
    },
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT" && path.endsWith("/7/location")) saved.push({ path, body: JSON.parse(request.postData() ?? "{}") });
  });
  await page.goto("/#farms");
  await page.locator('[data-act="view-farm"][data-id="7"]').click();
  await page.locator('[data-act="edit-farm-location"]').click();
  return page.locator("#drawerPanel");
}

test("the edit drawer opens pre-filled with the saved province, town and coordinates", async ({ page }) => {
  const saved: { path: string; body: Record<string, unknown> }[] = [];
  const drawer = await openEditDrawer(page, saved);
  await expect(drawer.locator("[data-map-province]")).toHaveValue("North West");
  await expect(drawer.locator("[data-map-query]")).toHaveValue("Mahikeng");
  await expect(drawer.locator("[data-map-town]")).toHaveValue("Mahikeng");
  await expect(drawer.locator("[data-map-lat]")).toHaveValue("-25.86522");
  await expect(drawer.locator("[data-map-lng]")).toHaveValue("25.64421");
  await page.screenshot({ path: `${EVIDENCE}/admin-location-edit-prefilled-1366.png` });
  await page.evaluate(() => (window as unknown as { __markerDrag: (lat: number, lng: number) => void }).__markerDrag(-25.87, 25.65));
  await drawer.locator("[data-drawer-confirm]").click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[0]).toMatchObject({ path: "/api/farms/7/location", body: { latitude: -25.87, longitude: 25.65 } });
  expect(saved[1]).toEqual({ path: "/api/admin/farms/7/location", body: { province: "North West", town: "Mahikeng", latitude: -25.87, longitude: 25.65 } });
});

test("the edit drawer refuses a point outside South Africa", async ({ page }) => {
  const saved: { path: string; body: Record<string, unknown> }[] = [];
  const drawer = await openEditDrawer(page, saved);
  await drawer.locator("[data-map-lat]").fill("-25.86");
  await drawer.locator("[data-map-lng]").fill("-25.64");                  // west instead of east
  await drawer.locator("[data-drawer-confirm]").click();
  await expect(page.locator(".toast").last()).toContainText("outside South Africa");
  expect(saved).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the picker fits a 390 px screen: province, town, pin, coordinates", async ({ page }) => {
    const wizard = await openFarmWizard(page, [], []);
    const picker = wizard.locator("[data-map-pick]");
    await picker.locator("[data-map-province]").selectOption("North West");
    await picker.locator("[data-map-province]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/admin-location-1-province-390.png` });
    await picker.locator("[data-map-query]").fill("Mafeking");
    await expect(picker.locator("[data-map-results] .map-search-result")).toHaveCount(1);
    await page.screenshot({ path: `${EVIDENCE}/admin-location-2-town-390.png` });
    await picker.locator("[data-map-results] .map-search-result").click();
    await page.evaluate(() => (window as unknown as { __markerDrag: (lat: number, lng: number) => void }).__markerDrag(-25.8712, 25.6518));
    await picker.locator("[data-map-canvas]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/admin-location-3-pin-390.png` });
    await picker.locator("[data-map-gps]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/admin-location-4-coordinates-390.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
