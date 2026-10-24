import { expect, test } from "@playwright/test";
import { captureErrors, FAKE_API, FAKE_SUPABASE } from "./mockBackend";

async function mockPublic(page: import("@playwright/test").Page) {
  await page.route(`${FAKE_SUPABASE}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route(`${FAKE_API}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test("the retired Experience route redirects to Get the app", async ({ page }) => {
  await mockPublic(page);
  await page.goto("/experience");
  await expect(page).toHaveURL(/\/get-the-app$/);
  await expect(page.getByRole("heading", { name: "Get the app" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Experience", exact: true })).toHaveCount(0);
  await expect(page.locator(".app-shots")).toBeVisible();
});

test("the public irrigation preview is visual-only and has Start, Stop and Reset", async ({ page }) => {
  const errors = captureErrors(page);
  const mutations: string[] = [];
  await mockPublic(page);
  page.on("request", (request) => {
    if (request.method() !== "GET") mutations.push(request.url());
  });
  await page.goto("/technology");
  const preview = page.locator("[data-irrigation-illustration]");
  await expect(preview).toContainText("Preview irrigation — simulated");
  await expect(preview.getByRole("button", { name: "Start demo" })).toBeEnabled();
  await expect(preview.getByRole("button", { name: "Stop demo" })).toBeDisabled();
  await expect(preview.getByRole("button", { name: "Reset demo" })).toBeEnabled();

  await preview.getByRole("button", { name: "Start demo" }).click();
  await expect(preview).toHaveAttribute("data-demo-state", "running");
  await preview.getByRole("button", { name: "Stop demo" }).click();
  await expect(preview).toHaveAttribute("data-demo-state", "stopped");
  await expect(preview.locator("[data-demo-status]")).toContainText("no real watering occurred");
  await preview.getByRole("button", { name: "Reset demo" }).click();
  await expect(preview).toHaveAttribute("data-demo-state", "ready");

  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the technology preview has no horizontal overflow at phone and desktop widths", async ({ page }) => {
  await mockPublic(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/technology");
    await expect(page.locator("[data-irrigation-illustration]")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }
});
