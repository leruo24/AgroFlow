import { test, expect, type Page } from "@playwright/test";
import { FAKE_API, FAKE_SUPABASE } from "./mockBackend";

/* The public pages take their facts from the API (release 2026-10-23), so they match the app:
   /service-pricing reads the staff-edited example price, /terms and /privacy the documents'
   text, version and date. With no answer they keep the bundled copy. Fake hosts only. */

async function api(page: Page, answers: Record<string, { body: string; type?: string; status?: number }>) {
  await page.route(`${FAKE_SUPABASE}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (route) => {
    const answer = answers[new URL(route.request().url()).pathname];
    return answer
      ? route.fulfill({ status: answer.status ?? 200, contentType: answer.type ?? "application/json", body: answer.body })
      : route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

const PRICE = JSON.stringify({ installationZar: 4500, monthlyZar: 650, zones: 2, label: "example for a 2-zone farm; final quote after a site visit" });

test("Service & pricing shows the staff-edited price, on a fresh load and after in-page navigation", async ({ page }) => {
  await api(page, { "/api/public/service-price": { body: PRICE } });
  await page.goto("/service-pricing");
  await expect(page.locator('[data-price="installation"]')).toContainText("R4,500");
  await expect(page.locator('[data-price="monthly"]')).toContainText("R650");

  await page.goto("/about");
  await page.locator("[data-service-menu] summary").click();
  await page.locator('.visual-header a[href="/service-pricing"]').click();
  await expect(page).toHaveURL(/\/service-pricing$/);
  await expect(page.locator('[data-price="installation"]')).toContainText("R4,500");
});

test("with no price from the API, Service & pricing keeps the published example", async ({ page }) => {
  await api(page, { "/api/public/service-price": { body: "{}", status: 503 } });
  await page.goto("/service-pricing");
  await expect(page.locator('[data-price="installation"]')).toContainText("R4,000");
  await expect(page.locator('[data-price="monthly"]')).toContainText("R610");
});

test("Terms shows the server's version and text; an approved document loses the draft banner", async ({ page }) => {
  await api(page, {
    "/api/public/legal": { body: JSON.stringify({ documents: [
      { key: "terms", title: "Terms of service", version: "1.0", date: "2026-11-01", status: "approved", statusLabel: "Approved", url: "" },
      { key: "privacy", title: "Privacy notice", version: "1.0", date: "2026-11-01", status: "approved", statusLabel: "Approved", url: "" },
    ] }) },
    "/api/public/legal/terms": { body: "# Terms of service\n\nThe approved text.", type: "text/markdown; charset=utf-8" },
  });
  await page.goto("/terms");
  await expect(page.locator("[data-legal-version]")).toContainText("1.0");
  await expect(page.locator("[data-legal-version] time")).toHaveAttribute("datetime", "2026-11-01");
  await expect(page.locator(".legal-document")).toContainText("The approved text.");
  await expect(page.locator("[data-legal-draft]")).toHaveCount(0);
});

test("a draft keeps its banner, and an answer that is not Markdown never replaces the document", async ({ page }) => {
  await api(page, {
    "/api/public/legal": { body: JSON.stringify({ documents: [
      { key: "privacy", title: "Privacy notice", version: "0.1-draft", date: "2026-10-23", status: "draft", statusLabel: "Draft – needs approval", url: "" },
    ] }) },
    "/api/public/legal/privacy": { body: "[]" },
  });
  await page.goto("/privacy");
  await expect(page.locator("[data-legal-draft]")).toBeVisible();
  await expect(page.locator(".legal-document")).not.toHaveText("[]");
  await expect(page.locator(".legal-document h2").first()).toBeVisible();
});
