import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Config of the interaction audit (`tests/audit`, Launch-Audit Paket D1) – NOT part of `npm run e2e` or the CI. The audit is a
 * crawl that needs running previews (own ports, see the header of `tests/audit/interactionAudit.spec.ts`), so there is no
 * `webServer`. Same pinned-Chromium rule as `playwright.config.ts`.
 */
const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PINNED_CHROMIUM = process.env.PW_CHROMIUM ?? (existsSync(CONTAINER_CHROMIUM) ? CONTAINER_CHROMIUM : undefined);

export default defineConfig({
  testDir: "tests/audit",
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results-audit",
  timeout: 55 * 60_000,
  fullyParallel: true,
  workers: Number(process.env.PW_AUDIT_WORKERS ?? 3),
  retries: 0,
  reporter: [["list"]],
  // Playwright's default navigation timeout is "none": one `goto`/`reload` that never reaches `load` (a blocked third-party asset, a
  // loaded machine) froze a whole persona for the rest of the 55 minutes. Every navigation and action is bounded here instead; the crawl
  // catches the errors and records them on the screen.
  use: { launchOptions: { executablePath: PINNED_CHROMIUM }, colorScheme: "dark", locale: "de-DE", timezoneId: "Europe/Berlin", navigationTimeout: 45_000, actionTimeout: 20_000 },
});
