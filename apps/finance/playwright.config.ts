import { defineConfig } from "@playwright/test";
import { baseConfig } from "@fahrschul/testing";

/**
 * E2E-Konfiguration für apps/finance, gleiches Muster wie apps/student/
 * apps/office/apps/instructor. Playwright-Browser-Binaries konnten in
 * dieser Sandbox NICHT heruntergeladen werden (Egress-Policy blockiert
 * cdn.playwright.dev, verifiziert erneut am 2026-07-23 in dieser Sitzung
 * über `npx playwright install chromium` -> "Download failure, code=1").
 * Die Specs unter e2e/ sind geschrieben und strukturell korrekt, aber
 * NICHT ausgeführt.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./e2e",
  use: {
    ...baseConfig.use,
    baseURL: process.env.FINANCE_APP_URL ?? "http://localhost:5175",
  },
  webServer: {
    command: "pnpm dev",
    port: 5175,
    reuseExistingServer: true,
  },
});
