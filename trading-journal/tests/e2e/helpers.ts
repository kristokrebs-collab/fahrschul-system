/**
 * Shared e2e helpers: legacy fixture seeding, console-error collection (ignoring the container's blocked
 * Google-Fonts certificate) and screenshot paths under `/tmp/shots/`.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockMarket, type MarketScenario, type MockMarketOptions } from "./mocks/market";

export const fixture: Record<string, unknown> = JSON.parse(readFileSync(new URL("../fixtures/tj2-v0.json", import.meta.url), "utf8"));
export const fixtureJson = JSON.stringify(fixture);

/** Console noise that is environmental, never an app defect. */
// `Failed to load resource` is the browser's own line for aborted / blocked requests (offline scenarios), not app output.
const IGNORED = [/ERR_CERT_AUTHORITY_INVALID/, /fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /^Failed to load resource/];

export interface SeedOptions extends MockMarketOptions {
  scenario?: MarketScenario;
  /** extra localStorage entries (e.g. `tj2-ui`) */
  extra?: Record<string, unknown>;
  /** skip the legacy journal fixture → empty journal */
  empty?: boolean;
}

/** Seeds localStorage with the legacy fixture, marks the intro as seen and mocks the market. */
export async function seed(page: Page, opts: SeedOptions = {}): Promise<void> {
  await mockMarket(page, opts.scenario ?? "live", opts);
  await page.addInitScript(
    ({ fx, extra }) => {
      for (const [k, v] of Object.entries(fx)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      sessionStorage.setItem("tj2-intro", "1");
    },
    { fx: opts.empty ? {} : fixture, extra: opts.extra ?? {} },
  );
}

/** Collects page errors and console errors/warnings (React/Motion warnings count as defects). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(`${m.type()}: ${text}`);
  });
  return errors;
}

/** The toast island (`role="status" aria-live="polite"`); status pills also carry `role="status"`, hence the attribute pair. */
export const toast = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

export const shot = (info: TestInfo, name: string): string => `/tmp/shots/${info.project.name}-${name}.png`;

export async function screenshot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: shot(info, name), fullPage, animations: "disabled" as const });
}

/** Asserts that the document never scrolls horizontally (mobile layouts). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth, `scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}

export const isMobile = (info: TestInfo): boolean => info.project.name === "mobile";
