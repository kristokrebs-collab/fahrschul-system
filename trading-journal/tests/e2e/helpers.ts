/**
 * Shared e2e helpers: legacy fixture seeding, console-error collection (ignoring the container's blocked
 * Google-Fonts certificate) and screenshot paths under `/tmp/shots/`.
 */
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
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

/** The toast island (`role="status" aria-live="polite"`); the attribute pair keeps it apart from other `role="status"` nodes (e.g. WarnBanner). */
export const toast = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

export const shot = (info: TestInfo, name: string): string => `/tmp/shots/${info.project.name}-${name}.png`;

export async function screenshot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: shot(info, name), fullPage, animations: "disabled" as const });
}

/**
 * Asserts that the document never scrolls horizontally (mobile layouts). Compares against the root's `clientWidth`
 * too: under mobile emulation an overflowing page widens the layout viewport itself (`innerWidth` grows with the
 * content), so `scrollWidth <= innerWidth` alone would never fail.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [scrollWidth, width] = await page.evaluate(() => [document.documentElement.scrollWidth, Math.min(window.innerWidth, document.documentElement.clientWidth)]);
  expect(scrollWidth, `scrollWidth ${scrollWidth} > viewport width ${width}`).toBeLessThanOrEqual(width);
}

/** Asserts that a dialog's footer actions are on screen without scrolling (a sheet taller than the viewport hides them). */
export async function expectInViewport(page: Page, locator: Locator, what: string): Promise<void> {
  const box = await locator.boundingBox();
  const vp = await page.evaluate(() => ({ w: window.visualViewport?.width ?? window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight }));
  expect(box, `${what}: no box`).not.toBeNull();
  if (!box) return;
  expect(box.y >= 0 && box.y + box.height <= vp.h + 1 && box.x >= 0 && box.x + box.width <= vp.w + 1, `${what} at ${JSON.stringify(box)} outside ${vp.w}×${vp.h}`).toBe(true);
}

export const isMobile = (info: TestInfo): boolean => info.project.name === "mobile";
