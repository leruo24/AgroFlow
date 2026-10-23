import { test, expect } from "@playwright/test";
import { FAKE_API, FAKE_SUPABASE } from "./mockBackend";

/* About (B3-06): who built AgroFlow, the project sponsor, and the one way to reach the team.
   Fake hosts only. */
test.beforeEach(async ({ page }) => {
  await page.route(`${FAKE_SUPABASE}/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${FAKE_API}/**`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
});

test("About names the team, UCT INF3003W Team 2 and the project sponsor; contact is the Request a call form only", async ({ page }) => {
  await page.goto("/about");
  const main = page.locator("#publicContent");
  for (const name of ["Lubaelihle Msuku", "Leruo Matlhatsi", "Olwethu Nkabinde", "Philisile Tyobeka"]) await expect(main).toContainText(name);
  await expect(main).toContainText("Team 2 of INF3003W at the University of Cape Town (UCT)");
  await expect(main).toContainText("Mafikeng Cisco Edge Centre");
  const contact = page.locator("[data-about-contact]");
  await expect(contact.getByRole("link", { name: /Request a call/ })).toHaveAttribute("href", "/contact#enquire");
  // No personal contact details anywhere on the page.
  const text = await main.innerText();
  expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  expect(text).not.toMatch(/(\+27|\b0)\s?\d{2}\s?\d{3}\s?\d{4}\b/);
  expect(await main.locator('a[href^="mailto:"], a[href^="tel:"]').count()).toBe(0);
});

test("the About additions are there in Afrikaans and Setswana too", async ({ page }) => {
  for (const [lang, team] of [["af", "Die span"], ["tn", "Setlhopha"]] as const) {
    await page.goto("/about");
    await page.locator("[data-public-language]").selectOption(lang);
    await expect(page.locator("#publicContent")).toContainText(team);
    await expect(page.locator("#publicContent")).toContainText("Mafikeng Cisco Edge Centre");
  }
});
