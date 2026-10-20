import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "../playwright.config";
import { defineConfig } from "@playwright/test";

/* Screenshots for a release write-up, not tests: the same dev server and fake hosts as the
 * test suite (playwright.config.ts), but only scripts/*.shots.ts, and no HTML report.
 *   npx playwright test --config scripts/screenshots.config.ts */
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: /.*\.shots\.ts$/,
  reporter: [["list"]],
  // The dev server runs from the admin app, not from scripts/.
  webServer: { ...(base.webServer as object), cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") } as typeof base.webServer,
});
