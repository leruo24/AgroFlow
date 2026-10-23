import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* AF-01 / B3-01 in the console (mocked backend): a rural farm is onboarded from its pin, a
 * failure halfway keeps every entry and only ever offers Retry with the same request id, and a
 * location problem is said beside the location. */

type Post = { path: string; body: Record<string, any> };

const DONE = {
  message: "Farmer onboarded successfully.", profileId: "00000000-0000-4000-8000-0000000000f9", email: "sesobe@example.org",
  temporaryPassword: "KX7P 4MRT", telegramDeepLink: null, telegramCode: null, telegramCodeExpiresAt: null, warning: null, farmId: 77,
  operation: { requestId: "x", status: "completed", lastStep: "handover", farmSaved: true, accountCreated: true, farmId: 77,
    profileId: "00000000-0000-4000-8000-0000000000f9", offer: "done", message: "done" },
};

async function openOnboarding(page: Page, onboard: (n: number, body: Record<string, any>) => { status: number; body: unknown }): Promise<Post[]> {
  const posts: Post[] = [];
  let n = 0;
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  // Registered after the mock, so it wins for this one route.
  await page.route("**/api/farmers/onboard", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    posts.push({ path: "/api/farmers/onboard", body });
    const answer = onboard(++n, body);
    await route.fulfill({ status: answer.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(answer.body) });
  });
  await page.goto("/staff/#onboarding");
  await page.locator('[data-field="fullName"]').fill("Synthetic Sesobe Farmer", { timeout: 15000 });
  await page.locator('[data-field="email"]').fill("sesobe@example.org");
  await page.locator('[data-field="phone"]').fill("082 123 4567");
  await page.locator('[data-act="onboarding-next"]').click();
  await page.locator('[data-field="farmName"]').fill("FarmTime");
  await page.locator('[data-field="location"]').fill("Sesobe");
  await page.locator('[data-field="farmSize"]').fill("0.02");
  await page.locator('[data-field="province"]').selectOption("North West");
  await page.locator('[data-field="latitude"]').fill("-25.0368");
  await page.locator('[data-field="longitude"]').fill("26.4337");
  await page.locator("[data-zone-count]").fill("1");
  await page.locator('[data-field="zone_name_0"]').fill("FarmTime Maize");
  await page.locator('[data-field="zone_crop_0"]').selectOption("maize");
  await page.locator('[data-field="zone_area_preset_0"]').selectOption("custom");
  await page.locator('[data-field="zone_area_m2_0"]').fill("100");
  return posts;
}

test("Sesobe is onboarded from its pin: the coordinates go with the first request", async ({ page }) => {
  const errors = captureErrors(page);
  const posts = await openOnboarding(page, () => ({ status: 200, body: DONE }));
  await page.locator('[data-act="onboarding-submit"]').click();
  await expect(page.locator("#handoverPassword")).toHaveText("KX7P 4MRT", { timeout: 15000 });

  expect(posts).toHaveLength(1);
  const farm = posts[0]!.body["farm"];
  expect(farm.latitude).toBeCloseTo(-25.0368, 4);
  expect(farm.longitude).toBeCloseTo(26.4337, 4);
  expect(farm.province).toBe("North West");
  expect(farm.location).toBe("Sesobe");
  expect(posts[0]!.body["requestId"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(errors).toEqual([]);
});

test("a failure halfway keeps the entries and Retry continues the same request, never Create again", async ({ page }) => {
  const posts = await openOnboarding(page, (n, body) => n === 1
    ? { status: 502, body: { error: "The sign-in service could not be reached. The farm is saved; press Retry to finish.", code: "account_not_created",
        operation: { requestId: body["requestId"], status: "failed", lastStep: "account", farmSaved: true, accountCreated: false, farmId: 77, profileId: null,
          offer: "retry", message: "The farm and its zones are saved, but not the farmer's account yet. Press Retry to finish; it continues the same farm." } } }
    : { status: 200, body: DONE });

  const submit = page.locator('[data-act="onboarding-submit"]');
  await submit.click();
  await expect(page.locator("#onboardingError")).toContainText("The farm and its zones are saved", { timeout: 15000 });
  await expect(submit).toHaveText("Retry (continues the same farm)");
  await expect(page.getByText(/create again/i)).toHaveCount(0);
  // Every entry is still there.
  await expect(page.locator('[data-field="farmName"]')).toHaveValue("FarmTime");
  await expect(page.locator('[data-field="latitude"]')).toHaveValue("-25.0368");

  await submit.click();
  await expect(page.locator("#handoverPassword")).toHaveText("KX7P 4MRT", { timeout: 15000 });
  expect(posts).toHaveLength(2);
  expect(posts[1]!.body["requestId"]).toBe(posts[0]!.body["requestId"]);
});

test("a location problem is said beside the location, with the entries kept", async ({ page }) => {
  await openOnboarding(page, () => ({ status: 400, body: {
    error: "'Sesobe' was not found by the town search. Nothing was saved. Pin the farm on the map or enter its coordinates.",
    code: "location_not_found", field: "location",
    operation: { requestId: "x", status: "failed", lastStep: "location", farmSaved: false, accountCreated: false, farmId: null, profileId: null,
      offer: "new_form", message: "Nothing was saved." } } }));
  await page.locator('[data-act="onboarding-submit"]').click();
  await expect(page.locator("#onboardingLocationError")).toContainText("was not found by the town search", { timeout: 15000 });
  await expect(page.locator('[data-act="onboarding-submit"]')).toHaveText("Onboard farmer");
  await expect(page.locator('[data-field="farmName"]')).toHaveValue("FarmTime");
});
