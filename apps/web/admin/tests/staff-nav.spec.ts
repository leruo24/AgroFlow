import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* The staff sidebar in the design brief's grouping (section 10), mapped to the pages that
   exist. Mocked backend only. */

const GROUPS = ["Farmers & farms", "Installations", "Support & requests", "Reports"];
const ORDER = ["Overview", "Enquiries", "Farmers", "Farms & zones", "Kits", "Maintenance", "Requests", "Alerts",
  "Reports", "Activity", "Drought & community", "Settings"];

test("the sidebar reads Overview / Enquiries / Farmers & farms / Installations / Support & requests / Reports / Drought & community / Settings", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/staff/#dashboard");
  await expect(page.locator("#nav button[data-page]")).toHaveCount(ORDER.length, { timeout: 15000 });
  const words = async (selector: string) => (await page.locator(selector).allInnerTexts()).map((s) => s.trim());
  expect(await words("#nav button[data-page]")).toEqual(ORDER);
  // textContent: the labels are capitalised by CSS only.
  expect((await page.locator("#nav .nav-group-label").allTextContents()).map((s) => s.trim())).toEqual(GROUPS);
  // A group is a named group for assistive technology; its pages are inside it.
  await expect(page.getByRole("group", { name: "Installations" }).getByRole("button", { name: "Kits" })).toBeVisible();
  await expect(page.locator("#headerTitle")).toHaveText("Overview");
  expect(errors).toEqual([]);
});

test("Enquiries and Support & requests open the two tabs of Requests, each with its own address", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/staff/#dashboard");
  await page.locator('#nav button[data-page="enquiries"]').click();
  await expect(page).toHaveURL(/#enquiries$/);
  await expect(page.getByRole("tab", { name: /Enquiries/ })).toHaveAttribute("aria-selected", "true", { timeout: 15000 });
  await expect(page.locator('#nav button[data-page="enquiries"]')).toHaveClass(/active/);

  // The other tab, from inside the page: the address and the sidebar follow.
  await page.getByRole("tab", { name: /Farm and zone requests/ }).click();
  await expect(page).toHaveURL(/#requests$/);
  await expect(page.locator('#nav button[data-page="requests"]')).toHaveClass(/active/);

  // A bookmark to #enquiries opens on Enquiries after a reload.
  await page.goto("/staff/#enquiries");
  await page.reload();
  await expect(page.getByRole("tab", { name: /Enquiries/ })).toHaveAttribute("aria-selected", "true", { timeout: 15000 });
});
