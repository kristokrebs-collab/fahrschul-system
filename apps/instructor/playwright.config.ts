import { defineConfig } from "@playwright/test";
import { baseConfig } from "@fahrschul/testing";

/**
 * E2E-Konfiguration für apps/instructor (Muster aus apps/student, siehe
 * dortige playwright.config.ts). Gleicher Sandbox-Status wie Prompt 1/2:
 * `npx playwright install chromium` scheitert mit "Download failure,
 * code=1" (Egress-Policy blockiert den Chromium-Download), verifiziert am
 * 2026-07-23 erneut in dieser Sitzung. Die Specs unter e2e/ sind
 * geschrieben und strukturell korrekt, aber NICHT ausgeführt.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./e2e",
  use: {
    ...baseConfig.use,
    baseURL: process.env.INSTRUCTOR_APP_URL ?? "http://localhost:5174",
  },
  webServer: {
    command: "pnpm dev",
    port: 5174,
    reuseExistingServer: true,
  },
});
