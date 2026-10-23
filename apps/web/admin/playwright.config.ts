import { defineConfig, devices } from "@playwright/test";

/* Admin console end-to-end tests.
 *
 * NOTHING HERE TOUCHES A LIVE SYSTEM. The dev server is started with fake
 * hosts for Supabase and the AgroFlow API, set as process variables - Vite
 * gives variables that already exist priority over .env files, so the real
 * .env is never read for these runs and could not leak into one. Every request
 * to those fake hosts is answered by tests/mockBackend.ts.
 */
export const FAKE_SUPABASE = "https://testproject.supabase.co";
export const FAKE_API = "https://api.agroflow.test";
// PW_PORT lets two checkouts (two git worktrees) run their suites at the same time.
const PORT = Number(process.env["PW_PORT"] ?? 5179);

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../../docs/test-evidence/admin-playwright", open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1366, height: 768 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    // A port of its own, so a developer's `npm run dev` on 5173 is untouched.
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // vite.config.ts has `open: true` for developers; a test run must not
      // pop a browser window on every invocation. Vite honours BROWSER=none.
      BROWSER: "none",
      VITE_SUPABASE_URL: FAKE_SUPABASE,
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_AGROFLOW_API_BASE: FAKE_API,
    },
  },
});
