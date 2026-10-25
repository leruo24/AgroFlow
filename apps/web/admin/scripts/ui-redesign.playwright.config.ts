import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import baseConfig from "../playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: ".",
  testMatch: "ui-redesign.shots.ts",
  reporter: "list",
  webServer: {
    ...(baseConfig.webServer as object),
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  },
});
