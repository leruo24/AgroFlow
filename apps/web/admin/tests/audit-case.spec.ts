import { test, expect, type Page } from "@playwright/test";
import { mockBackend, captureErrors } from "./mockBackend";

/* Part B in the console (mocked backend): a farm with no kit reads "Awaiting installation", the
 * first installation is booked with no device, and the installer checklist records who, when and
 * measured vs estimated. What the drawer shows is always the server's answer. */

const FARM = { farm_id: 77, name: "FarmTime", owner_id: "f1", owner_name: "Synthetic Farmer", location: "Sesobe, North West",
  total_area: 0.02, status: "Active", updated_at: "2026-10-22T08:00:00Z", latitude: -25.0368, longitude: 26.4337,
  member_ids: ["f1"], member_count: 1, kit_count: 0 };

const check = (item: string, label: string, required: boolean, done = false, extra: Record<string, unknown> = {}) =>
  ({ item, label, done, required, whoCompletes: "installer", doneBy: null, doneAt: null, provenance: null, value: null, notes: null, ...extra });

function caseBody(state: { visit: boolean; flow: boolean }) {
  const where = state.visit
    ? { stage: "visit_booked", stageLabel: "Visit booked", nextAction: "Thabo Installer will install your kit.", whoActsNext: "installer", whoActsNextLabel: "Your installer", knownDate: "2026-10-30T07:00:00Z", dateLabel: "Visit booked" }
    : { stage: "ready_for_installation", stageLabel: "Ready for installation", nextAction: "AgroFlow staff will book your installation visit.", whoActsNext: "agroflow_staff", whoActsNextLabel: "AgroFlow staff", knownDate: null, dateLabel: "Waiting for booking" };
  return {
    caseId: 1, farmId: 77, farmName: "FarmTime", owner: null, nextAction: null, followUpAt: null,
    service: { status: "sponsored", statusLabel: "Sponsored", agreedAt: "2026-10-22T08:00:00Z", payer: "Sponsor", planDescription: null },
    enquiry: { id: 3, name: "Synthetic Farmer", status: "won" }, farmer: { id: "f1", name: "Synthetic Farmer", passwordChanged: true },
    visits: state.visit ? [{ id: 5, kind: "first_installation", scheduledFor: "2026-10-30T07:00:00Z", installerName: "Thabo Installer", installerProfileId: null,
      status: "booked", notes: null, createdAt: "2026-10-23T08:00:00Z", startedAt: null, completedAt: null }] : [],
    journey: {
      farmId: 77,
      setupProgress: { done: 4, total: 4, label: "Your details: 4 of 4", tasks: [] },
      installation: { stage: where.stage, label: where.stageLabel, text: state.visit ? "Installation: visit booked" : "Installation: waiting for booking", live: false },
      whereYouAreNow: { ...where, stageNumber: state.visit ? 6 : 5, stageCount: 8, steps: [], done: [], stillToDo: [] },
      zones: [{ zoneId: 25, name: "FarmTime Maize", commissionState: "pending", commissionedAt: null, irrigationMode: "manual", offerAutomatic: false, autoOfferAnswer: null,
        installerChecks: [
          check("kit_linked", "Kit linked to this zone", true),
          check("calibration", "Wet/dry soil calibration", true),
          state.flow ? check("flow_measured", "Flow measured", true, true, { doneBy: "Test Admin", doneAt: "2026-10-30T08:00:00Z", provenance: "measured", value: "6 L/min" })
                     : check("flow_measured", "Flow measured", true),
          check("run_limit", "Longest run (run limit) set", false),
          check("test_start_stop", "Test start and stop, acknowledged by the kit", true),
        ] }],
      helpRequests: [{ id: 9, topic: "tank_capacity", zoneId: null, note: null, status: "open", createdAt: "2026-10-23T08:00:00Z", resolvedAt: null, resolution: null, ownerName: "Test Admin" }],
      terms: { accepted: { all: true, termsAcceptedAt: "2026-10-23T08:00:00Z", privacyAcceptedAt: "2026-10-23T08:00:00Z" } },
    },
  };
}

async function open(page: Page) {
  const state = { visit: false, flow: false };
  const posts: { path: string; body: Record<string, any> }[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if ((r.method() === "POST" || r.method() === "PUT") && url.pathname.startsWith("/api/admin/")) posts.push({ path: url.pathname, body: JSON.parse(r.postData() ?? "{}") });
  });
  await mockBackend(page, {
    minDelayMs: 5, maxDelayMs: 20,
    respond: (method, path) => {
      if (method === "GET" && path === "/api/farms") return [FARM];
      if (method === "GET" && path === "/api/admin/farms/77/case") return caseBody(state);
      if (method === "POST" && path === "/api/admin/farms/77/visits") { state.visit = true; return { id: 5, status: "booked" }; }
      if (method === "POST" && path === "/api/admin/zones/25/checklist/flow_measured") { state.flow = true; return { commissionedNow: false, value: "6 L/min" }; }
      return undefined;
    },
  });
  await page.goto("/staff/#farms");
  return { posts };
}

test("a farm with no kit is awaiting installation, and its case books the first installation with no device", async ({ page }) => {
  const errors = captureErrors(page);
  const { posts } = await open(page);
  await expect(page.locator('[data-act="view-farm"][data-id="77"]')).toContainText("Awaiting installation", { timeout: 15000 });
  await page.locator('[data-act="view-farm"][data-id="77"]').click();
  await expect(page.locator(".drawer")).toContainText("Not installed yet");
  await expect(page.locator(".drawer")).not.toContainText("Gateway");

  await page.locator('[data-act="open-case"][data-id="77"]').click();
  await expect(page.locator('[data-testid="case-where"]')).toContainText("Waiting for booking", { timeout: 15000 });
  await expect(page.locator('[data-act="case-book-visit"]')).toHaveText("Book first installation");

  await page.locator('#drawerPanel [data-field="visitWhen"]').fill("2026-10-30T09:00");
  await page.locator('#drawerPanel [data-field="visitInstaller"]').fill("Thabo Installer");
  await page.locator('[data-act="case-book-visit"]').click();
  await expect(page.locator('[data-testid="case-where"]')).toContainText("Thabo Installer will install your kit.", { timeout: 15000 });
  await expect(page.locator('[data-testid="case-visits"]')).toContainText("Thabo Installer");
  const booking = posts.find((p) => p.path === "/api/admin/farms/77/visits")!;
  expect(booking.body["installerName"]).toBe("Thabo Installer");
  expect(booking.body["scheduledFor"]).toMatch(/^2026-10-30T/);
  expect(errors).toEqual([]);
});

test("the installer checklist records a measured flow and shows who and when", async ({ page }) => {
  const { posts } = await open(page);
  await page.locator('[data-act="view-farm"][data-id="77"]').click({ timeout: 15000 });
  await page.locator('[data-act="open-case"][data-id="77"]').click();
  const row = page.locator('[data-check="25-flow_measured"]');
  await expect(row).toContainText("To do", { timeout: 15000 });
  const flow = row.locator('[data-field="flow_25"]');
  await flow.fill("6");
  // The case drawer is rendered from async API state. Confirm that the current input—not a
  // just-replaced drawer node—holds the measurement before submitting it.
  await expect(flow).toHaveValue("6");
  await row.locator('[data-act="case-check"]').click();
  await expect(page.locator('[data-check="25-flow_measured"]')).toContainText("6 L/min", { timeout: 15000 });
  await expect(page.locator('[data-check="25-flow_measured"]')).toContainText("measured");
  await expect(page.locator('[data-check="25-flow_measured"]')).toContainText("Test Admin");
  const rec = posts.find((p) => p.path === "/api/admin/zones/25/checklist/flow_measured")!;
  expect(rec.body).toEqual({ provenance: "measured", flowRateLpm: 6 });
  // The help request is listed with its owner.
  await expect(page.locator('[data-testid="case-help"]')).toContainText("Tank size");
});
