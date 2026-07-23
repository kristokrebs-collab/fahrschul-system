import { defineConfig } from "@playwright/test";
import { baseConfig } from "@fahrschul/testing";

/**
 * E2E-Konfiguration für apps/student, aufbauend auf der geteilten
 * Basiskonfiguration aus packages/testing (Prompt 0). WICHTIG (ehrlich
 * dokumentiert, siehe docs/student-app-final-qa.md): die Playwright-
 * Browser-Binaries konnten in dieser Sandbox NICHT heruntergeladen werden
 * (Egress-Policy des Proxys lehnt cdn.playwright.dev ab, analog zum
 * Docker-Registry-Block aus Prompt 0) – diese Specs sind geschrieben und
 * strukturell korrekt, wurden in dieser Sitzung aber NICHT ausgeführt.
 * Voraussetzung zum Ausführen: `pnpm --filter @fahrschul/student exec
 * playwright install chromium` in einer Umgebung mit Netzwerkzugriff auf
 * cdn.playwright.dev, dann `pnpm --filter @fahrschul/student test:e2e`
 * bei laufendem apps/api (Port 4000) und Vite-Dev-Server (Port 5173).
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./e2e",
  use: {
    ...baseConfig.use,
    baseURL: process.env.STUDENT_APP_URL ?? "http://localhost:5173",
  },
  webServer: {
    command: "pnpm dev",
    port: 5173,
    reuseExistingServer: true,
  },
});
