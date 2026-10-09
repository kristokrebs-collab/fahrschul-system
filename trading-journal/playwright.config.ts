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
 * Optional overrides (defaults unchanged): `PW_BASE_URL` runs the suite against a server that is already up (e.g. an
 * agent's own preview on another port) – no build, no `webServer`; `PW_OUTPUT_DIR` moves the test artifacts.
 */
const BASE_URL = process.env.PW_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // The container ships a pinned Chromium; keep Playwright from downloading its own.
    launchOptions: { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
    baseURL: BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    colorScheme: "dark",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  },
  webServer: BASE_URL
    ? undefined
    : {
        // personal edition at `/`, share edition at `/teilen/` (build:share writes dist/teilen after the personal build)
        command: "npm run build && npm run build:share && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
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
