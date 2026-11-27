/**
 * Layout stability of the long pages (Feinschliff Runde 8, Seiten B): late cards (lazy chunks, workers, candles that load) bring
 * their place with them, so nothing below them moves. Two measures per page, mobile + desktop, dark:
 *  - the `layout-shift` entries of the browser (the sum of the shifts without a recent input) stay at or below 0,02, and
 *  - the page does not grow after its first picture: the document height a moment after the heading and a few seconds later
 *    differ by less than 60 px (a skeleton of the finished size instead of a card that arrives bigger).
 * No clock jumps, no waiting for a time of day; the numbers are read at the end, not mid-animation.
 */
import { expect, test, type Page } from "@playwright/test";
import { pinClock, seed } from "./helpers";

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
