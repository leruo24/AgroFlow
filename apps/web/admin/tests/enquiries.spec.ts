import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors, ADMIN_ID } from "./mockBackend";

/* Item 6c (part 3): the Enquiries tab. Mocked backend only. */

const base = {
  phone: "+27821234567", email: null, province: "Western Cape", town: "Ceres", farmSizeHa: 2,
  crops: ["potato"], cropsOther: null, bestTime: "morning", notes: null, createdAt: "2026-10-05T08:00:00Z",
  handledBy: null, handledByName: null, claimedAt: null, callbackAt: null, noAnswerCount: 0, outcome: null,
  reason: null, reasonOther: null, farmerProfileId: null, anonymisedAt: null, firstCalledAt: null, closedAt: null, callCount: 0,
};
const mine = { handledBy: ADMIN_ID, handledByName: "Test Admin", claimedAt: "2026-10-06T07:00:00Z" };

const ENQUIRIES = [
  { ...base, id: 1, fullName: "Nobody Yet", status: "new" },
  { ...base, ...mine, id: 2, fullName: "Ring Ring", status: "open", noAnswerCount: 3, callCount: 3 },
  { ...base, ...mine, id: 3, fullName: "Keen Farmer", email: "keen@example.com", status: "open", outcome: "wants", callCount: 1 },
  { ...base, ...mine, id: 4, fullName: "No Thanks", status: "lost", outcome: "not_interested", reason: "no_internet", callCount: 1 },
  { ...base, ...mine, id: 5, fullName: "Later Please", status: "open", outcome: "callback", callbackAt: "2026-10-01T08:00:00Z", callCount: 1 },
];

type Write = { path: string; body: Record<string, unknown> };

async function open(page: Page, at = "/#requests"): Promise<Write[]> {
  const writes: Write[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (r.method() === "POST" && url.pathname.startsWith("/api/")) {
      writes.push({ path: url.pathname, body: JSON.parse(r.postData() ?? "{}") });
    }
  });
  await mockBackend(page, {
    minDelayMs: 10, maxDelayMs: 40,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/admin/enquiries") return ENQUIRIES;
      if (method === "GET" && path === "/api/admin/enquiries/summary") return { waiting: 1, callbacksDue: 1 };
      if (method === "GET" && path.endsWith("/calls")) return [];
      if (method === "POST" && path.endsWith("/calls")) return { message: "Logged.", suggestClosing: false };
      if (method === "POST" && path === "/api/farmers/onboard") {
        return { message: "ok", profileId: "00000000-0000-4000-8000-0000000000f9", email: "keen@example.com",
          temporaryPassword: "Temp-1234", telegramDeepLink: null, telegramCode: null, telegramCodeExpiresAt: null, warning: null };
      }
      return undefined;
    },
  });
  await page.goto(at);
  return writes;
}

async function enquiriesTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /Enquiries/ }).click();
  await expect(page.locator('[data-enquiry="1"]')).toBeVisible({ timeout: 15000 });
}

test("the sidebar and Home show what needs a call, and lead to the Enquiries tab", async ({ page }) => {
  const errors = captureErrors(page);
  await open(page, "/#dashboard");

  await expect(page.locator('#nav button[data-page="requests"] .nav-badge')).toHaveText("2", { timeout: 15000 });
  await expect(page.locator(".attn-card", { hasText: "Call-backs due" })).toBeVisible();
  await expect(page.locator(".attn-card", { hasText: "Enquiries waiting for a call" })).toBeVisible();

  await page.locator(".attn-card", { hasText: "Call-backs due" }).click();
  await expect(page.getByRole("tab", { name: /Enquiries/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-enquiry="5"]')).toContainText("Call-back due");

  expect(errors).toEqual([]);
});

test("I'll handle this, then Not interested needs a reason - and words for Other", async ({ page }) => {
  const writes = await open(page);
  await enquiriesTab(page);

  await page.locator('[data-enquiry="1"]').getByText("I'll handle this").click();
  await expect.poll(() => writes.map((w) => w.path)).toContain("/api/admin/enquiries/1/claim");

  await page.locator('[data-enquiry="5"]').getByRole("button", { name: "Log call" }).click();
  const drawer = page.locator(".log-call");
  await drawer.getByLabel("Not interested").check();
  await page.locator("[data-drawer-confirm]").click();
  await expect(page.locator("body")).toContainText("Choose why they are not interested.");
  await expect(drawer).toBeVisible();

  await drawer.locator('[name="callReason"]').selectOption("other");
  await page.locator("[data-drawer-confirm]").click();
  await expect(page.locator("body")).toContainText("Say why, in a few words.");

  await drawer.locator('[name="callReasonOther"]').fill("Moving to the city");
  await drawer.locator('[name="callNote"]').fill("Polite, maybe next year.");
  await page.locator("[data-drawer-confirm]").click();

  await expect.poll(() => writes.map((w) => w.path)).toContain("/api/admin/enquiries/5/calls");
  const call = writes.find((w) => w.path === "/api/admin/enquiries/5/calls")!;
  expect(call.body).toEqual({ outcome: "not_interested", reason: "other", reasonOther: "Moving to the city",
    note: "Polite, maybe next year.", callbackAt: null });
  expect(JSON.stringify(call.body)).not.toContain(ADMIN_ID);
});

test("Call back later needs a future time and sends it", async ({ page }) => {
  const writes = await open(page);
  await enquiriesTab(page);

  await page.locator('[data-enquiry="3"]').getByRole("button", { name: "Log call" }).click();
  const drawer = page.locator(".log-call");
  await drawer.getByLabel("Call back later").check();
  await expect(drawer.locator("[data-call-when]")).toBeVisible();
  await page.locator("[data-drawer-confirm]").click();
  await expect(page.locator("body")).toContainText("Choose when to call back.");

  await drawer.locator('[name="callbackAt"]').fill("2099-01-15T09:30");
  await page.locator("[data-drawer-confirm]").click();
  await expect.poll(() => writes.map((w) => w.path)).toContain("/api/admin/enquiries/3/calls");
  const call = writes.find((w) => w.path === "/api/admin/enquiries/3/calls")!;
  expect(call.body.outcome).toBe("callback");
  expect(String(call.body.callbackAt)).toMatch(/^2099-01-15T/);
});

test("after three unanswered calls it offers Close; an ended enquiry offers Delete personal details", async ({ page }) => {
  const writes = await open(page);
  await enquiriesTab(page);

  await page.locator('[data-enquiry="2"]').getByText(/Close \(no answer ×3\)/).click();
  await page.locator("[data-drawer-confirm]").click();
  await expect.poll(() => writes.map((w) => w.path)).toContain("/api/admin/enquiries/2/close");

  await expect(page.locator('[data-enquiry="4"]')).toContainText("No reliable internet or WiFi");
  await page.locator('[data-enquiry="4"]').getByText("Delete personal details").click();
  await page.locator("[data-drawer-confirm]").click();
  await expect.poll(() => writes.map((w) => w.path)).toContain("/api/admin/enquiries/4/anonymise");
});

test("Start onboarding fills the onboarding form from the enquiry, and finishing it completes the enquiry", async ({ page }) => {
  const writes = await open(page);
  await enquiriesTab(page);

  await page.locator('[data-enquiry="3"]').getByText("Start onboarding").click();
  await expect(page.locator('[data-field="fullName"]')).toHaveValue("Keen Farmer", { timeout: 15000 });
  await expect(page.locator('[data-field="email"]')).toHaveValue("keen@example.com");
  await expect(page.locator('[data-field="phone"]')).toHaveValue("+27821234567");

  await page.locator('[data-act="onboarding-next"]').click();
  await expect(page.locator('[data-field="location"]')).toHaveValue("Ceres, Western Cape");
  await expect(page.locator('[data-field="farmSize"]')).toHaveValue("2");
  await page.locator('[data-field="farmName"]').fill("Keen Farm");
  await page.locator("[data-zone-count]").fill("1");
  await page.locator('[data-field="zone_name_0"]').fill("Tub 1");
  await page.locator('[data-field="zone_crop_0"]').selectOption("potato");
  await page.locator('[data-field="zone_area_preset_0"]').selectOption("tub");
  await page.locator('[data-act="onboarding-submit"]').click();

  await expect.poll(() => writes.map((w) => w.path)).toEqual(
    expect.arrayContaining(["/api/farmers/onboard", "/api/admin/enquiries/3/onboarded"]));
  const linked = writes.find((w) => w.path === "/api/admin/enquiries/3/onboarded")!;
  expect(linked.body).toEqual({ farmerProfileId: "00000000-0000-4000-8000-0000000000f9" });
});
