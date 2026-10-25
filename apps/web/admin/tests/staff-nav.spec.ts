import { test, expect } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* The staff sidebar in the design brief's grouping (section 10), mapped to the pages that
   exist. Mocked backend only. */

const GROUPS = ["General", "Farm management", "Operations", "Support", "Analytics", "Drought & community", "Settings"];
const ORDER = ["Overview", "Enquiries", "Farmers", "Farms & zones", "Kits", "Maintenance", "Requests", "Alerts",
  "Reports", "Activity", "Drought & community", "Settings"];

test("the sidebar uses flat, labelled sections without losing any route", async ({ page }) => {
  const errors = captureErrors(page);
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.goto("/staff/#dashboard");
  await expect(page.locator("#nav button[data-page]")).toHaveCount(ORDER.length, { timeout: 15000 });
  const words = async (selector: string) => (await page.locator(selector).allInnerTexts()).map((s) => s.trim());
  expect(await words("#nav button[data-page]")).toEqual(ORDER);
  // textContent: the labels are capitalised by CSS only.
  expect((await page.locator("#nav .nav-group-label").allTextContents()).map((s) => s.trim())).toEqual(GROUPS);
  // A section is a named group for assistive technology; its pages are flat inside it.
  await expect(page.getByRole("group", { name: "Operations" }).getByRole("button", { name: "Kits" })).toBeVisible();
  await expect(page.locator("#nav details")).toHaveCount(0);
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

test("desktop sidebar collapse persists and the phone drawer traps focus, closes and scrolls", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/staff/#dashboard");
  const collapse = page.locator("#sidebarCollapse");
  await collapse.click();
  await expect(page.locator("#sidebar")).toHaveClass(/is-collapsed/);
  await expect(page.locator("#sidebar")).toHaveCSS("width", "72px");
  await expect(collapse).toHaveAttribute("aria-label", "Expand navigation");
  await page.locator('#nav button[data-page="dashboard"]').focus();
  await expect(page.locator("#sidebarTooltip")).toBeVisible();
  await expect(page.locator("#sidebarTooltip")).toHaveText("Overview");
  await page.reload();
  await expect(page.locator("#sidebar")).toHaveClass(/is-collapsed/);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator("#sidebar")).not.toHaveClass(/is-collapsed/);

  const toggle = page.locator("#sidebarToggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#sidebarClose")).toBeFocused();
  await page.locator("#sidebarClose").click();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".sidebar [data-logout]")).toBeFocused();
  await expect(page.locator(".sidebar .sub")).toHaveCount(0);
  await expect(page.locator(".side-account")).toContainText("Profile & settings");
  await expect(page.locator(".side-account")).toContainText("Notifications");
  await expect(page.locator(".side-account")).toContainText("Log out");

  await page.setViewportSize({ width: 390, height: 500 });
  await page.locator("#sidebar").evaluate((sidebar) => sidebar.scrollTo(0, sidebar.scrollHeight));
  await expect(page.locator(".side-account")).toBeVisible();
});
