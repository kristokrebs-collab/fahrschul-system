import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", testMatch: /intro\.spec\.ts/, timeout: 90_000, workers: 2, reporter: [["list"]], outputDir: "/tmp/claude-0/-home-user-fahrschul-system/c08c90f1-79b3-50d1-98c3-934cf908459d/scratchpad/b1/pw-out",
  use: { launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }, baseURL: "http://127.0.0.1:5221", colorScheme: "dark", locale: "de-DE", timezoneId: "Europe/Berlin" },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
