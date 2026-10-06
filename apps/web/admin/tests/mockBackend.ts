import type { Page, Route } from "@playwright/test";

/* A fake Supabase and a fake AgroFlow API, for Playwright.
 *
 * WHY RANDOM DELAYS
 * The navigation bug this suite exists for only shows up when responses
 * arrive OUT OF ORDER - a page clicked first answers last and paints over the
 * page clicked after it. A mock that answers instantly, or always in order,
 * would let a broken router pass. Each response here waits a random
 * 50-600 ms, seeded so a failure can be replayed.
 *
 * The data is empty-but-valid: every endpoint answers with the shape its page
 * expects, so a console error means the app did something wrong, not that the
 * mock was lazy.
 */

export const FAKE_SUPABASE = "https://testproject.supabase.co";
export const FAKE_API = "https://api.agroflow.test";

export const ADMIN_ID = "00000000-0000-4000-8000-000000000001";

// Supabase's default storage key is sb-<project-ref>-auth-token, where the
// ref is the first label of the URL's host.
const STORAGE_KEY = "sb-testproject-auth-token";

/** A small seeded PRNG (mulberry32), so a failing order can be replayed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MockOptions = {
  seed?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Override or add responses: return undefined to fall through. */
  respond?: (method: string, path: string, url: URL) => unknown | undefined;
  /** Force a specific delay for a request, to make a race deterministic.
      Return undefined to use the random delay. */
  delayFor?: (method: string, path: string, url: URL) => number | undefined;
};

export type MockLog = {
  requests: { method: string; url: string }[];
};

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });
}

/** What each API path answers by default. */
function defaultApiResponse(method: string, path: string): unknown {
  if (method !== "GET") return { ok: true, message: "Done." };

  if (path === "/api/admin/health") {
    return {
      overall: "ok",
      checkedAt: new Date().toISOString(),
      checks: [{ key: "api", name: "API", status: "ok", detail: "Running.", responseMs: null }],
    };
  }
  if (path.startsWith("/api/admin/activity")) {
    return path === "/api/admin/activity" || path === "/api/admin/activity/"
      ? { rows: [], total: 0, actions: [], actors: [] }
      : [];
  }
  if (path === "/api/admin/platform-config") return { groups: [] };
  if (path === "/api/admin/enquiries/summary") return { waiting: 0, callbacksDue: 0 };
  if (path === "/api/telegram/me") return { linked: false, alertsEnabled: true };
  if (path.startsWith("/api/admin/farms/") && path.endsWith("/report-schedule")) {
    return { farmId: 1, enabled: false, frequency: "weekly", reportTypes: ["water_usage"], zoneIds: null };
  }

  // Lists: users, farms, hardware, mqtt logins, report farms/zones, …
  return [];
}

export async function mockBackend(page: Page, options: MockOptions = {}): Promise<MockLog> {
  const rand = seeded(options.seed ?? 42);
  const min = options.minDelayMs ?? 50;
  const max = options.maxDelayMs ?? 600;
  const log: MockLog = { requests: [] };

  const delay = (method = "GET", path = "", url?: URL): Promise<void> => {
    const forced = url ? options.delayFor?.(method, path, url) : undefined;
    const ms = forced ?? min + Math.floor(rand() * (max - min));
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  // A signed-in admin session, already in storage before any script runs. Far
  // future expiry, so supabase-js never tries to refresh it over the network.
  await page.addInitScript(
    ({ key, id }) => {
      const now = Math.floor(Date.now() / 1000);
      window.localStorage.setItem(
        key,
        JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 3600 * 24 * 365,
          expires_at: now + 3600 * 24 * 365,
          user: {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: "admin@agroflow.test",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { key: STORAGE_KEY, id: ADMIN_ID },
  );

  await page.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    log.requests.push({ method, url: request.url() });

    if (method === "OPTIONS") return json(route, {});

    const custom = options.respond?.(method, url.pathname, url);
    await delay(method, url.pathname, url);
    if (custom !== undefined) return json(route, custom);

    // The admin's own profile: loadProfile() asks for one row.
    if (url.pathname === "/rest/v1/profile" && (url.searchParams.get("id") ?? "").includes(ADMIN_ID)) {
      return json(route, { id: ADMIN_ID, name: "Test Admin", email: "admin@agroflow.test", role: "admin" });
    }

    if (url.pathname.startsWith("/auth/v1/")) return json(route, {});

    return json(route, []);
  });

  await page.route(`${FAKE_API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    log.requests.push({ method, url: request.url() });

    if (method === "OPTIONS") return json(route, {});

    const custom = options.respond?.(method, url.pathname, url);
    await delay(method, url.pathname, url);
    return json(route, custom !== undefined ? custom : defaultApiResponse(method, url.pathname));
  });

  return log;
}

/** Collects console errors and uncaught page errors for the assertion at the end. */
export function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
