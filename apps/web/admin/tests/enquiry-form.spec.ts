import { test, expect, type Page } from "@playwright/test";
import { FAKE_API, FAKE_SUPABASE, captureErrors } from "./mockBackend";

/* Item 6c: the public "Get a call back" form on the landing page. A visitor
   with no session; the API is mocked - nothing reaches a real server. */

async function landing(page: Page, reply: { status: number; body: unknown }): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route(`${FAKE_SUPABASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, async (route) => {
    const r = route.request();
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204 });
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/public/enquiries") {
      sent.push(JSON.parse(r.postData() ?? "{}"));
      return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Interested in AgroFlow? Get a call back" })).toBeVisible({ timeout: 15000 });
  return sent;
}

async function fill(page: Page): Promise<void> {
  const form = page.locator("#enquiryForm");
  await form.locator('[name="fullName"]').fill("Thandi Nkosi");
  await form.locator('[name="phone"]').fill("082 123 4567");
  await form.locator('[name="province"]').selectOption("Western Cape");
  await form.locator('[name="town"]').fill("Ceres");
  await form.locator('[name="farmSizeHa"]').fill("2");
  await form.locator('input[name="crops"][value="potato"]').check();
  await form.locator('input[name="crops"][value="other"]').check();
  await form.locator('[name="cropsOther"]').fill("Spinach");
  await form.locator('input[name="bestTime"][value="morning"]').check();
}

test("a visitor asks for a call back and is thanked", async ({ page }) => {
  const errors = captureErrors(page);
  const sent = await landing(page, { status: 200, body: { message: "Thank you, a representative will call you within 2 working days." } });

  await page.getByRole("button", { name: "Ask for a call" }).click();
  await fill(page);
  await page.locator("#enquiryForm").getByLabel(/I agree that AgroFlow may contact me/).check();
  await page.locator("#enquiryForm").getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Thank you, a representative will call you within 2 working days.")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    fullName: "Thandi Nkosi", phone: "082 123 4567", province: "Western Cape", town: "Ceres", farmSizeHa: 2,
    crops: ["potato", "other"], cropsOther: "Spinach", bestTime: "morning", consent: true, website: "",
  });

  // The honeypot is there for bots but not for people.
  await expect(page.locator('[name="website"]')).not.toBeInViewport();
  expect(errors).toEqual([]);
});

test("without the POPIA consent nothing is sent", async ({ page }) => {
  const sent = await landing(page, { status: 200, body: {} });
  await page.getByRole("button", { name: "Ask for a call" }).click();
  await fill(page);
  await page.locator("#enquiryForm").getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".enquiry-error")).toHaveText("Please tick the box to agree that we may contact you about this enquiry.");
  expect(sent).toHaveLength(0);
});

test("the server's own reason is shown when it refuses", async ({ page }) => {
  await landing(page, { status: 429, body: { error: "Too many enquiries from this connection. Please try again in an hour." } });
  await page.goto("/#enquire");
  await expect(page.locator("#enquiryForm")).toBeVisible({ timeout: 15000 });
  await fill(page);
  await page.locator("#enquiryForm").getByLabel(/I agree that AgroFlow may contact me/).check();
  await page.locator("#enquiryForm").getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".enquiry-error")).toHaveText("Too many enquiries from this connection. Please try again in an hour.");
});
