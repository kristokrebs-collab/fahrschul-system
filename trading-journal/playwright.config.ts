import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/** Samsung Internet on a Galaxy Tab S9/S10 Ultra (the user's device: 1692×978 CSS px at DPR 1.75, One UI taskbar). */
export const GALAXY_TAB_UA = "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36";

/** Touch tablet in landscape: mobile viewport semantics, touch events, coarse pointer, Samsung Internet UA. */
const galaxyTab = (width: number, height: number) => ({
  browserName: "chromium" as const,
  viewport: { width, height },
  screen: { width, height },
  deviceScaleFactor: 1.75,
  isMobile: true,
  hasTouch: true,
  userAgent: GALAXY_TAB_UA,
});

/**
 * Two production previews (P14): the default build at `baseURL` (local-only: no `VITE_SUPABASE_*`), and the same app
 * built against the Supabase mock of `tests/e2e/mocks/supabase.ts` (`npm run build:e2e-cloud`) at `CLOUD_URL` – the
 * Konto, Preise, Börse and Community specs run there. Optional overrides: `PW_BASE_URL` / `PW_CLOUD_BASE_URL` run the
 * suite against servers that are already up (e.g. an agent's own previews on other ports) – no build, no `webServer`;
 * `PW_OUTPUT_DIR` moves the test artifacts.
 */
const BASE_URL = process.env.PW_BASE_URL;
export const CLOUD_URL = process.env.PW_CLOUD_BASE_URL ?? "http://127.0.0.1:4174";
const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PINNED_CHROMIUM = process.env.PW_CHROMIUM ?? (existsSync(CONTAINER_CHROMIUM) ? CONTAINER_CHROMIUM : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // The container ships a pinned Chromium (`PW_CHROMIUM` or the default path when it exists); elsewhere – CI after
    // `npx playwright install chromium` – Playwright's own browser is used.
    launchOptions: { executablePath: PINNED_CHROMIUM },
    baseURL: BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    colorScheme: "dark",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  webServer: BASE_URL
    ? undefined
    : [
        {
          // personal edition at `/`, share edition at `/teilen/` (build:share writes dist/teilen after the personal build)
          command: "npm run build && npm run build:share && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
          url: "http://127.0.0.1:4173",
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
        ...(process.env.PW_CLOUD_BASE_URL
          ? []
          : [
              {
                // the cloud edition against the Supabase mock (vite only – the typecheck runs in the first build)
                command: "npm run build:e2e-cloud && npx vite preview --outDir dist-e2e-cloud --host 127.0.0.1 --port 4174 --strictPort",
                url: "http://127.0.0.1:4174",
                reuseExistingServer: !process.env.CI,
                timeout: 240_000,
              },
            ]),
      ],
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    // portrait tablet with a mouse (iPad-Air-sized window)
    { name: "tablet-portrait", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
    // the user's Galaxy Tab (touch, landscape) and a 1280×800 touch tablet
    { name: "tablet", use: galaxyTab(1692, 978) },
    { name: "tablet-1280", use: galaxyTab(1280, 800) },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
