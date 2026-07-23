import { defineConfig, devices } from "@playwright/test";

/**
 * Geteilte Playwright-Basiskonfiguration für App-level E2E-Tests
 * (Prompt 1-4). Für Prompt 0 (diese Session) nicht ausgeführt – hier ist nur
 * die gemeinsame Grundlage hinterlegt, damit spätere Prompts nicht erneut
 * bei null anfangen. Einzelne Apps importieren und erweitern diese Config
 * mit ihrer eigenen baseURL/webServer-Konfiguration.
 */
export const baseConfig = defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

export default baseConfig;
