import { test, expect, type Page } from "@playwright/test";
import { FAKE_API, FAKE_SUPABASE, mockBackend } from "./mockBackend";
import path from "node:path";
test.describe.configure({ mode: "parallel" });
const evidence = path.resolve("../../../docs/test-evidence/visual-redesign");
const routes = [
  "/",
  "/solutions",
  "/how-it-works",
  "/technology",
  "/about",
  "/get-the-app",
  "/contact",
  "/service-pricing",
  "/terms",
  "/privacy",
];
async function publicMocks(page: Page) {
  await page.route(`${FAKE_SUPABASE}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route(`${FAKE_API}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}
test("public deep links refresh independently, redirect Experience and preserve browser Back and legacy staff entries", async ({
  page,
}) => {
  test.setTimeout(120000);
  await publicMocks(page);
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("#publicTitle")).toBeVisible();
    if (route === "/terms" || route === "/privacy")
      await expect(
        page.locator(`.visual-footer a[href="${route}"]`),
      ).toBeVisible();
    else
      await expect(
        page.locator('.visual-header a[aria-current="page"]'),
      ).toHaveAttribute("href", route);
    await page.reload();
    await expect(page.locator("#publicTitle")).toBeVisible();
    if (route === "/terms" || route === "/privacy") {
      await expect(page.locator(".legal-document")).toContainText("0.1-draft");
      await page.locator("#agroflow-splash").waitFor({ state: "detached" });
      await page.screenshot({
        path: path.join(evidence, `public-${route.slice(1)}-en-1366.png`),
        fullPage: true,
      });
    }
    expect(
      await page
        .locator(".visual-brand img")
        .first()
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    ).toBe(true);
  }
  await page.goto("/experience");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#publicTitle")).toHaveText("Smart irrigation for small farms.");
  await expect(page.getByRole("link", { name: "Experience", exact: true })).toHaveCount(0);
  await page.goto("/about");
  await page.locator("[data-service-menu] summary").click();
  await page.locator('.visual-header a[href="/solutions"]').click();
  await expect(page).toHaveURL(/\/solutions$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
  await page.goto("/#about");
  await expect(page).toHaveURL(/\/about$/);
  await page.goto("/#/admin");
  await expect(page).toHaveURL(/\/staff\//);
  await expect(page.locator("#loginForm .auth-brand img")).toHaveAttribute(
    "src",
    "/brand/agroflow-icon-192.png",
  );
});
test("phone menu opens with keyboard, focuses a destination and closes with Escape", async ({
  page,
}) => {
  await publicMocks(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  const menu = page.locator("[data-public-menu]");
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-public-menu-close]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
});
test("public header keeps routes and preferences in one responsive navigation bar", async ({ page }) => {
  await publicMocks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const header = page.locator(".visual-header");
  await expect(header.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(header.getByText("Our services", { exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "About", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Contact", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "Get the app", exact: true })).toHaveAttribute("href", "/get-the-app");
  await expect(page.locator("[data-public-menu]")).toBeHidden();
  await expect(page.locator(".visual-header-inner")).toHaveCSS("min-height", "76px");
  await expect(page.locator(".visual-header .appearance-control legend")).toHaveCSS("position", "absolute");

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator("[data-public-menu]")).toBeVisible();
  await page.locator("[data-public-menu]").click();
  await expect(page.locator("#publicNav")).toHaveClass(/is-open/);
  await expect(page.locator("[data-public-language]")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test("theme persists locally, follows System and honours reduced motion", async ({
  page,
}) => {
  await publicMocks(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator('[data-appearance-choice="light"]').click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator('[data-appearance-choice="system"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.locator('[data-appearance-choice="light"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-appearance-choice="system"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-appearance-choice="dark"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".visual-hero .premium-photo img")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".visual-hero .premium-photo img")).toHaveAttribute(
    "alt",
    "",
  );
});
test("catalogue marks simulation, leaves acceptance unchecked and blocks fake continuation", async ({
  page,
}) => {
  await publicMocks(page);
  await page.goto("/component-catalogue");
  await expect(page.locator(".visual-catalogue")).toContainText("Simulated");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }).last(),
  ).toBeDisabled();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await expect(page.locator("[data-state]")).toHaveCount(5);
  await expect(page.locator("[data-command-phase]")).toHaveCount(8);
  await expect(
    page.locator('[data-command-phase="kit_confirmed_start"]'),
  ).toContainText("Kit confirmed start");
});
for (const lang of ["en", "af", "tn"])
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
  ]) {
    test(`visual evidence ${lang} ${viewport.width}`, async ({ page }) => {
      test.setTimeout(90000);
      await publicMocks(page);
      await page.setViewportSize(viewport);
      await page.addInitScript((language) => {
        localStorage.setItem("agroflow_public_language", language);
        localStorage.setItem("agroflow_appearance", "light");
      }, lang);
      for (const route of ["/", "/about", "/contact", "/component-catalogue"]) {
        await page.goto(route);
        await expect(page.locator(".visual-header")).toBeVisible();
        await page.locator("#agroflow-splash").waitFor({ state: "detached" });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: path.join(
            evidence,
            `public-${route.slice(1) || "home"}-${lang}-${viewport.width}.png`,
          ),
          fullPage: true,
        });
      }
      await page.goto("/");
      await page.locator("#agroflow-splash").waitFor({ state: "detached" });
      await page.evaluate(() => {
        const samples = [
          ...document.querySelectorAll<HTMLElement>(".visual-site *"),
        ]
          .filter((el) =>
            [...el.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            ),
          )
          .map((el) => ({
            el,
            size: parseFloat(getComputedStyle(el).fontSize),
            line: parseFloat(getComputedStyle(el).lineHeight),
          }));
        for (const { el, size, line } of samples) {
          el.style.fontSize = `${size * 2}px`;
          el.style.lineHeight = `${Number.isFinite(line) ? line * 2 : size * 3}px`;
        }
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: path.join(
          evidence,
          `public-home-${lang}-${viewport.width}-text200.png`,
        ),
        fullPage: true,
      });
    });
  }
test("staff theme and phone drawer keep existing routes", async ({ page }) => {
  await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/#dashboard");
  await expect(page.locator(".sidebar")).toContainText("AgroFlow");
  await expect(page.locator(".sidebar")).toContainText("Staff Console");
  await page.locator("#avatarBtn").click();
  await page.locator('[data-appearance-choice="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(13, 27, 36)",
  );
  await expect(page.locator("#avatarMenu")).toHaveCSS(
    "background-color",
    "rgb(23, 42, 54)",
  );
  await expect(page.locator("#avatarMenu a").first()).toHaveCSS(
    "color",
    "rgb(237, 246, 250)",
  );
  await page.screenshot({
    path: path.join(evidence, "staff-390-dark.png"),
    fullPage: true,
  });
});
for (const lang of ["en", "af", "tn"])
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
  ]) {
    test(`staff evidence ${lang} ${viewport.width}`, async ({ page }) => {
      test.setTimeout(60000);
      await mockBackend(page, { minDelayMs: 5, maxDelayMs: 20 });
      await page.setViewportSize(viewport);
      await page.addInitScript((language) => {
        localStorage.setItem("agroflow_public_language", language);
        localStorage.setItem("agroflow_appearance", "light");
      }, lang);
      await page.goto("/staff/#dashboard");
      await expect(page.locator("#appShell")).toBeVisible();
      await page.locator("#agroflow-splash").waitFor({ state: "detached" });
      await page.screenshot({
        path: path.join(
          evidence,
          `staff-dashboard-${lang}-${viewport.width}.png`,
        ),
        fullPage: true,
      });
      await page.goto("/staff/#onboarding");
      await expect(page.locator(".onboarding-panel").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: path.join(
          evidence,
          `staff-onboarding-${lang}-${viewport.width}.png`,
        ),
        fullPage: true,
      });
    });
  }
