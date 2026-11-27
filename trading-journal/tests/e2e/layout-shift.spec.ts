/**
 * Layout stability of the long pages (Feinschliff Runde 8, Seiten B): late cards (lazy chunks, workers, candles that load) bring
 * their place with them, so nothing below them moves. Two measures per page, mobile + desktop, dark:
 *  - the `layout-shift` entries of the browser (the sum of the shifts without a recent input) stay at or below 0,02, and
 *  - the page does not grow after its first picture: the document height a moment after the heading and a few seconds later
 *    differ by less than 60 px (a skeleton of the finished size instead of a card that arrives bigger).
 * No clock jumps, no waiting for a time of day; the numbers are read at the end, not mid-animation.
 *
 * Runde 13 (Paket H): two blocks that fill AFTER the page stands – the breakout scanner of the Markt page (twelve cards that load, then
 * sort themselves) and the "Rechnung" under the calculator (a lazy chunk) – measured the same way while they do it.
 */
import { expect, test, type Page } from "@playwright/test";
import { pinClock, seed } from "./helpers";
import { BREAKOUT_NOW } from "./mocks/breakout";
import { mockBreakout } from "./mocks/breakoutRoutes";

// trades / setups / settings joined with the Budget-Schnitt (Runde 11): they are lazy chunks now, a direct landing must not jump either
const PAGES = ["markt", "analyse", "risiko", "coach", "labor", "studio", "plan", "aktien", "trades", "setups", "settings"] as const;
const PROJECTS = ["mobile", "desktop"];
const MAX_CLS = 0.02;
const MAX_GROWTH = 60;

for (const key of PAGES) {
  test(`${key}: kein Springen nach dem Laden (CLS und Seitenhöhe)`, async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
    test.setTimeout(90_000);
    await seed(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`/#${key}`);
    await expect(page.locator(`[data-page="${key}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 30_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    await page.waitForTimeout(1200);
    const first = await height();
    await page.waitForTimeout(5000);
    const last = await height();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(last - first, `${key}: die Seite wuchs von ${first} auf ${last} px`).toBeLessThan(MAX_GROWTH);
    expect(cls, `${key}: Layout-Verschiebung ${cls.toFixed(4)}`).toBeLessThanOrEqual(MAX_CLS);
  });
}

/* ------------------------------------------------------------------------------------------------------------------------------------
 * Berichte (Runde 13, Paket B): the page the user saw jump. Measured where he looks at it – the Galaxy Tab (1692×978) and the phone
 * (390×844) – with the main thread slowed down 4× (CDP), so the late cards really arrive late: the report of a finished week with
 * trades (the page's start), the RUNNING week (Heute abschließen beside Frag dein Journal) and an empty journal. The Transaktionsbuch
 * stays folded as it is for everyone who has not opened it (opened, it grows with its rows by design – `ledger.spec.ts`).
 * ---------------------------------------------------------------------------------------------------------------------------------- */
const DAY = 86_400_000;
/** Wed 2026-10-14 12:30 Berlin: the newest finished week is KW 41, the running one KW 42. */
const WED = Date.UTC(2026, 9, 14, 10, 30);
const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

/** Thirteen closed trades, one per day up to today: wins and losses, long and short, one without a stop, some with a reason / note / tag. */
function weeks(now: number): Record<string, unknown>[] {
  return Array.from({ length: 13 }, (_, d) => {
    const at = now - d * DAY - 5 * 3_600_000;
    const win = d % 3 !== 0;
    const short = d % 5 === 0;
    const entry = 60_000;
    return {
      id: `ls_${d}`,
      account: "scalp",
      timeframe: "1h",
      target: short ? entry - 1400 : entry + 1400,
      fees: 1,
      pnlManual: null,
      checks: { "g:trigger": true, "g:stop": true },
      conviction: 3,
      followedPlan: d % 4 !== 0,
      emotion: "Ruhig",
      reason: d % 2 ? "Ausbruch über das Vortageshoch mit Volumen, Retest gehalten." : "",
      notes: d === 3 ? "Stopp zu eng gesetzt, nächstes Mal weiter weg" : "",
      tags: d === 3 ? ["ausbruch"] : undefined,
      chart: "",
      pnl: null,
      r: null,
      mistakes: [],
      side: short ? "short" : "long",
      status: "closed",
      date: local(at),
      exitDate: local(at + 3_600_000),
      pair: d % 2 ? "BTC/USDT" : "ETH/USDT",
      entry,
      stop: d === 2 ? null : short ? entry + 600 : entry - 600,
      exit: short ? (win ? entry - 900 : entry + 600) : win ? entry + 900 : entry - 600,
      size: 5000,
      leverage: 3,
      setups: ["s_bo"],
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at + 3_600_000).toISOString(),
    };
  });
}

const BERICHTE = [
  { name: "fertige Woche mit Trades", hash: "berichte", key: "2026-W41", filled: true },
  { name: "laufende Woche (Heute abschließen neben Frag dein Journal)", hash: "berichte?p=2026-W42", key: "2026-W42", filled: true },
  { name: "leeres Journal", hash: "berichte", key: "", filled: false },
] as const;

async function throttle(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

for (const c of BERICHTE) {
  test(`berichte · ${c.name}: kein Springen beim Laden (CLS und Seitenhöhe, 4× gedrosselt)`, async ({ page }, info) => {
    test.skip(!["mobile", "tablet"].includes(info.project.name), "390×844 + Galaxy Tab 1692×978");
    test.setTimeout(120_000);
    const clock = await pinClock(page, WED);
    await seed(page, { clock: clock.now, foldsClosed: true, empty: !c.filled, extra: c.filled ? { "tj2-trades": weeks(clock.now()) } : {} });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await throttle(page, 4);
    await page.goto(`/#${c.hash}`);
    await expect(page.locator(`[data-page="berichte"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 60_000 });
    await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
    if (c.key) await expect(page.getByTestId("berichte-view")).toHaveAttribute("data-key", c.key);
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    await page.waitForTimeout(1200);
    const first = await height();
    // the late cards (idle queue, lazy chunks) arrive within these seconds on a 4× slower main thread
    await page.waitForTimeout(7000);
    const last = await height();
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    await throttle(page, 1);
    // the cards this case is about did arrive (the measure is not taken on an unfinished page)
    if (c.filled) await expect(page.getByTestId("journal-cards")).toHaveCount(1);
    await expect(page.getByTestId("ask-journal")).toHaveCount(1, { timeout: 20_000 });
    if (c.key === "2026-W42") await expect(page.getByTestId("day-close")).toHaveCount(1);
    expect(Math.abs(last - first), `berichte (${c.name}): die Seite ging von ${first} auf ${last} px`).toBeLessThan(MAX_GROWTH);
    expect(cls, `berichte (${c.name}): Layout-Verschiebung ${cls.toFixed(4)}`).toBeLessThanOrEqual(MAX_CLS);
  });
}

test("markt · Ausbruch-Scanner: der Lauf (laden, füllen, sortieren) verschiebt nichts – Plätze, Blockhöhe und Verschiebungen im Block", async ({ page }, info) => {
  test.skip(![...PROJECTS, "tablet"].includes(info.project.name), "mobile + desktop + Galaxy-Tab");
  test.setTimeout(90_000);
  const clock = await pinClock(page, BREAKOUT_NOW);
  await seed(page, { clock: clock.now });
  await mockBreakout(page, () => "binance", clock.now);
  // the candles are held back until the picture "before" is taken: twelve empty places, on screen
  let release = (): void => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("https://fapi.binance.com/fapi/v1/klines?*", async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("interval") === "5m" && !u.searchParams.has("startTime")) await gate;
    await route.fallback();
  });
  await page.goto("/#markt");
  const block = page.getByTestId("breakout-section");
  await expect(block).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  /** where every part of the block stands, relative to the block (the page above it is long and still settles – that is not this block) */
  const picture = () =>
    block.evaluate((el) => {
      const o = el.getBoundingClientRect();
      const box = (n: Element) => {
        const r = n.getBoundingClientRect();
        return [Math.round(r.left - o.left), Math.round(r.top - o.top), Math.round(r.width), Math.round(r.height)];
      };
      return { height: Math.round(o.height), cells: Array.from(el.querySelectorAll(".bo-cell")).map(box), parts: Array.from(el.children).map(box) };
    });
  // bring the block on screen by script (no input event: every shift after it counts)
  await block.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(block).toHaveAttribute("data-phase", "scanning", { timeout: 15_000 });
  await page.waitForTimeout(1200); // the twelve places have come in (45 ms apart)
  const before = await picture();
  expect(before.cells).toHaveLength(12);
  // from here on: sum the shifts INSIDE the block, then let the candles arrive
  await block.evaluate((el) => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources: { node: Node | null }[] }[]) {
        // only what moved inside the block while the block itself stood still (the block as a source = the page above it moved it)
        const inside = e.sources.length > 0 && e.sources.every((s) => s.node && s.node !== el && el.contains(s.node));
        if (!e.hadRecentInput && inside) w.__cls += e.value;
      }
    }).observe({ type: "layout-shift" });
  });
  release();
  await expect(block).toHaveAttribute("data-phase", "done", { timeout: 30_000 });
  await expect(page.locator("[data-testid=breakout-card][data-best]")).toHaveCount(1);
  await page.waitForTimeout(2500); // the sort spring and the reveals are over
  const after = await picture();
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(after.height, "Höhe des Blocks").toBe(before.height);
  // the twelve places and every part of the block stand exactly where they stood before a single candle arrived
  expect(after.cells).toEqual(before.cells);
  expect(after.parts).toEqual(before.parts);
  expect(cls, `Layout-Verschiebung im Block ${cls.toFixed(4)}`).toBeLessThanOrEqual(MAX_CLS);
});

test("risiko · Rechnung: sie kommt nach (Lazy-Chunk) und verschiebt dabei nichts", async ({ page }, info) => {
  test.skip(![...PROJECTS, "tablet"].includes(info.project.name), "mobile + desktop + Galaxy-Tab");
  test.setTimeout(90_000);
  await seed(page);
  // the chunk of the "Rechnung" arrives late: the reserved place has to hold until then
  await page.route(/\/assets\/CalcBill-[^/]+\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  await page.goto("/#risiko");
  const calc = page.getByTestId("risk-calc");
  await expect(calc).toBeAttached({ timeout: 30_000 });
  await calc.scrollIntoViewIfNeeded();
  await calc.getByRole("textbox", { name: "Einstieg", exact: true }).fill("100");
  await calc.getByRole("textbox", { name: "Stop", exact: true }).fill("95");
  // from here on no input: the shifts of the late chunk count in full (the 500 ms grace of the typing is over before it arrives)
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift" });
  });
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await expect(calc.getByTestId("risk-bill")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.documentElement.scrollHeight);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(Math.abs(after - before), `die Seite änderte ihre Höhe von ${before} auf ${after} px`).toBeLessThan(MAX_GROWTH);
  expect(cls, `Layout-Verschiebung ${cls.toFixed(4)}`).toBeLessThanOrEqual(MAX_CLS);
});
