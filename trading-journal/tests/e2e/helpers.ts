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

/**
 * Seeds localStorage with the legacy fixture, marks the intro as seen and mocks the market. The data is written ONCE
 * per browser context (marker `__e2e-seeded`), so a reload or a second tab sees what the app saved, never the seed again.
 */
export async function seed(page: Page, opts: SeedOptions = {}): Promise<void> {
  await mockMarket(page, opts.scenario ?? "live", opts);
  await page.addInitScript(
    ({ fx, extra }) => {
      sessionStorage.setItem("tj2-intro", "1");
      if (localStorage.getItem("__e2e-seeded")) return;
      for (const [k, v] of Object.entries(fx)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      localStorage.setItem("__e2e-seeded", "1");
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

/** Touch projects (`mobile`, `tablet`, `tablet-1280`): touch events and a coarse pointer. */
export const hasTouch = (info: TestInfo): boolean => !!info.project.use.hasTouch;

/** The touch tablets in landscape (`tablet` = the user's Galaxy Tab 1692×978, `tablet-1280`). */
export const isTouchTablet = (info: TestInfo): boolean => hasTouch(info) && info.project.name.startsWith("tablet");

/** Seeds an empty journal (no fixture) for specs that build their own data. */
export async function seedRaw(page: Page, entries: Record<string, unknown>, opts: SeedOptions = {}): Promise<void> {
  await seed(page, { ...opts, empty: true, extra: { ...entries, ...(opts.extra ?? {}) } });
}

/** Parsed `localStorage[key]` of the page (null when absent). */
export async function stored<T = unknown>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, key) as Promise<T | null>;
}

/** Scrolls the document until `locator` is rendered (deferred / content-visibility cells mount while scrolling). */
export async function scrollUntilVisible(page: Page, locator: Locator, timeout = 10_000): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await locator.count()) > 0 && (await locator.first().isVisible())) return true;
        await page.evaluate(() => window.scrollBy({ top: Math.round(window.innerHeight * 0.7), behavior: "instant" }));
        return false;
      },
      { timeout, intervals: [150] },
    )
    .toBe(true);
  await locator.first().scrollIntoViewIfNeeded();
}

export interface TouchKit {
  /** one finger from `from` to `to` in `ms` (moves every ~8 ms, a 120 Hz digitiser), optional hold before release */
  drag(from: { x: number; y: number }, to: { x: number; y: number }, ms: number, opts?: { holdMs?: number; startHoldMs?: number }): Promise<void>;
  /** a fast throw: 110 px in ~48 ms (≈ 2300 px/s) */
  flick(from: { x: number; y: number }, dx: number, dy: number): Promise<void>;
  /** a slow pull: `dy` px over 640 ms, held 150 ms before release (velocity ≈ 0) */
  slowPull(from: { x: number; y: number }, dx: number, dy: number): Promise<void>;
  tap(at: { x: number; y: number }): Promise<void>;
}

/**
 * CDP touch gestures (`Input.dispatchTouchEvent`) with EXPLICIT timestamps: headless CDP round trips space the
 * events 30–60 ms apart, so without them every flick reads as a slow drag (the physics hooks compute velocity from
 * event time stamps).
 */
export async function touchKit(page: Page): Promise<TouchKit> {
  const cdp = await page.context().newCDPSession(page);
  let t = 0;
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }], timestamp: t });
  const drag: TouchKit["drag"] = async (from, to, ms, opts = {}) => {
    t = Math.max(t, Date.now() / 1000);
    await send("touchStart", from.x, from.y);
    if (opts.startHoldMs) {
      await page.waitForTimeout(opts.startHoldMs);
      t += opts.startHoldMs / 1000;
    }
    const steps = Math.max(2, Math.round(ms / 8.33));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      t += ms / 1000 / steps;
      await send("touchMove", from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    }
    if (opts.holdMs) {
      await page.waitForTimeout(opts.holdMs);
      t += opts.holdMs / 1000;
      await send("touchMove", to.x, to.y);
    }
    t += 0.004;
    await send("touchEnd", to.x, to.y);
  };
  return {
    drag,
    flick: (from, dx, dy) => drag(from, { x: from.x + dx, y: from.y + dy }, 48),
    slowPull: (from, dx, dy) => drag(from, { x: from.x + dx, y: from.y + dy }, 640, { holdMs: 150 }),
    tap: async (at) => {
      t = Math.max(t, Date.now() / 1000);
      await send("touchStart", at.x, at.y);
      t += 0.06;
      await send("touchEnd", at.x, at.y);
    },
  };
}

/** Centre of a locator's box (throws when it has none). */
export async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no bounding box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Opens `Trade eintragen` from the dock and waits until the form takes input: during the open morph the sheet body is
 * `inert` for a frame or two, and a `fill` in that window types into nothing (a click waits until the field is hittable).
 */
export async function openTradeEditor(page: Page): Promise<Locator> {
  await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" }).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();
  await editor.locator("#f-entry").click();
  return editor;
}
