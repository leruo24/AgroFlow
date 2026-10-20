import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Item 0b: clicking quickly must never make the console "vibrate".
 *
 * The reported bug: click two sidebar items quickly and the page cycles
 * through several tabs on its own before settling. These tests click far
 * faster than a person, against a backend that answers in a random order, and
 * assert the only outcome that is correct - the LAST thing clicked wins, and
 * nothing moves afterwards.
 */

const NAV = [
  { id: "dashboard", label: "Home" },
  { id: "requests", label: "Requests" },
  { id: "users", label: "Farmers" },
  { id: "farms", label: "Farms & zones" },
  { id: "hardware", label: "Kits" },
  { id: "alerts", label: "Alerts" },
  { id: "droughtCommunity", label: "Drought & community" },
  { id: "maintenance", label: "Maintenance" },
  { id: "reports", label: "Reports" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

/** Records every hash change and every swap of #content, from page start. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __hashes: string[];
      __contentSwaps: number;
    };
    w.__hashes = [];
    w.__contentSwaps = 0;

    window.addEventListener("hashchange", () => w.__hashes.push(location.hash));

    // #content only exists once the signed-in shell renders, so watch the
    // whole document and count child-list changes ON #content itself.
    new MutationObserver((records) => {
      for (const r of records) {
        if ((r.target as HTMLElement).id === "content" && r.type === "childList") {
          w.__contentSwaps++;
          return;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function settled(page: Page): Promise<void> {
  // Long enough for the slowest mocked response (600 ms) several times over,
  // plus the page transition.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
}

async function openConsole(page: Page): Promise<string[]> {
  const errors = captureErrors(page);
  await instrument(page);
  await mockBackend(page, { seed: 7 });
  await page.goto("/staff/#dashboard");
  await expect(page.locator("#nav button[data-page]")).toHaveCount(NAV.length);
  await settled(page);
  return errors;
}

for (const seed of [7, 19, 101]) {
  test(`rapid sidebar clicks: the last click wins (seed ${seed})`, async ({ page }) => {
    const errors = captureErrors(page);
    await instrument(page);
    await mockBackend(page, { seed });
    await page.goto("/staff/#dashboard");
    await expect(page.locator("#nav button[data-page]")).toHaveCount(NAV.length);
    await settled(page);

    const hashesBefore = await page.evaluate(() => (window as any).__hashes.length);

    // Eight clicks inside a second, all different pages, so every click is a
    // real navigation.
    const sequence = ["requests", "farms", "alerts", "reports", "users", "activity", "hardware", "maintenance"];
    for (const id of sequence) {
      await page.locator(`#nav button[data-page="${id}"]`).click({ delay: 0 });
      await page.waitForTimeout(90);
    }

    const last = sequence[sequence.length - 1]!;
    const lastLabel = NAV.find((n) => n.id === last)!.label;

    await settled(page);

    // The final page is the last one clicked, everywhere it shows. One-shot
    // reads, not retrying assertions: a retrying check would pass on the
    // first instant the right page showed, even if a stale page replaced it
    // a moment later.
    expect(page.url()).toMatch(new RegExp(`#${last}$`));
    expect(await page.locator("#headerTitle").textContent()).toBe(lastLabel);
    expect(await page.locator(`#nav button[data-page="${last}"]`).getAttribute("class")).toMatch(/active/);
    expect(await page.locator("#content").getAttribute("data-page")).toBe(last);

    // No ping-pong: each click changes the hash at most once. The bug wrote
    // stale hashes back as old navigations finished, which fired extra
    // hashchange events for pages nobody had asked for any more.
    const hashes: string[] = await page.evaluate(() => (window as any).__hashes);
    const newHashes = hashes.slice(hashesBefore);
    expect(newHashes.length, `hash changes: ${newHashes.join(" ")}`).toBeLessThanOrEqual(sequence.length);
    expect(newHashes[newHashes.length - 1]).toBe(`#${last}`);

    // Nothing moves once it has settled.
    const swapsAtRest = await page.evaluate(() => (window as any).__contentSwaps);
    await page.waitForTimeout(1500);
    const swapsLater = await page.evaluate(() => (window as any).__contentSwaps);
    expect(swapsLater, "the page kept changing after it settled").toBe(swapsAtRest);

    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("clicking the page you are already on does nothing", async ({ page }) => {
  const errors = await openConsole(page);

  await page.locator('#nav button[data-page="farms"]').click();
  await settled(page);

  const hashes = await page.evaluate(() => (window as any).__hashes.length);
  const swaps = await page.evaluate(() => (window as any).__contentSwaps);

  for (let i = 0; i < 5; i++) {
    await page.locator('#nav button[data-page="farms"]').click({ delay: 0 });
  }
  await settled(page);

  expect(await page.evaluate(() => (window as any).__hashes.length)).toBe(hashes);
  expect(await page.evaluate(() => (window as any).__contentSwaps)).toBe(swaps);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("back and forward still work after rapid clicking", async ({ page }) => {
  const errors = await openConsole(page);

  for (const id of ["requests", "farms", "alerts"]) {
    await page.locator(`#nav button[data-page="${id}"]`).click();
    await settled(page);
  }

  await page.goBack();
  await settled(page);
  expect(page.url()).toMatch(/#farms$/);
  expect(await page.locator("#headerTitle").textContent()).toBe("Farms & zones");

  await page.goForward();
  await settled(page);
  expect(page.url()).toMatch(/#alerts$/);
  expect(await page.locator("#headerTitle").textContent()).toBe("Alerts");

  expect(errors, errors.join("\n")).toEqual([]);
});
