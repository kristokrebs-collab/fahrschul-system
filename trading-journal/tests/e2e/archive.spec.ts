/**
 * Datenarchiv (F26) and Squeeze-Beobachtung (F07) end to end, on a phone and on the desktop, against the market mock:
 *
 * - Einstellungen › Datenarchiv: off by default with the honest sentences (what is stored, nothing leaves the device, no part of
 *   backup / cloud sync, no server archive, gaps never filled); a seeded store shows its rows, the gap with its reason, exports a
 *   row as CSV exactly as stored, deletes a row after asking; switching it on starts the collector (the mock's premium / open
 *   interest rows appear) and the choice survives a reload;
 * - Markt › Squeeze-Beobachtung: empty without the archive (with the way to switch it on), a hot archive reads „Long-Seite
 *   überfüllt“ with three readings, values and thresholds, the thresholds written to `settings.squeeze` change the reading, the
 *   alert is off until it is switched on;
 * - axe (WCAG 2.1 A + AA) on both cards in the dark and the light theme, no horizontal scroll at 390 px, touch targets ≥ 44 px.
 *
 * The archive is written into IndexedDB with fixed times (the view) or times relative to the page's own clock a moment before
 * the check (the squeeze card's freshness rule) – no clock jumps, nothing that depends on the mock's time of day.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, screenshot, seed, stored } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CFG_KEY = "tj2-archive-cfg";

type Pt = { series: string; symbol: string; t: number; d: Record<string, number | string | null> };
type Tick = { t: number; iv: number; route: "direct"; res: Record<string, string>; states: boolean };

/** Writes points and ticks into the archive database (same schema as `src/market/archive/db.ts`), from inside the page. */
async function writeArchive(page: Page, points: Pt[], ticks: Tick[], clear = true): Promise<void> {
  await page.evaluate(
    ({ points, ticks, clear }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tj2-archive", 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("points")) db.createObjectStore("points", { keyPath: ["series", "symbol", "t"] });
          if (!db.objectStoreNames.contains("ticks")) db.createObjectStore("ticks", { keyPath: "t" });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["points", "ticks"], "readwrite");
          if (clear) {
            tx.objectStore("points").clear();
            tx.objectStore("ticks").clear();
          }
          for (const p of points) tx.objectStore("points").put(p);
          for (const t of ticks) tx.objectStore("ticks").put(t);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { points, ticks, clear },
  );
}

const MIN = 60_000;
const H = 60 * MIN;
const prem = (symbol: string, t: number, rate = 0.0001): Pt => ({ series: "premium", symbol, t, d: { mark: 80000, index: 80001, rate, next: t + 8 * H } });

/** Fixed history for the view: BTCUSDT funding at 0, 10 and 190 minutes (a 3 h hole with no tick in it), one OI row, one ETHUSDT row. */
async function seedView(page: Page): Promise<number> {
  const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);
  await writeArchive(
    page,
    [
      prem("BTCUSDT", T0),
      prem("BTCUSDT", T0 + 10 * MIN),
      prem("BTCUSDT", T0 + 190 * MIN),
      { series: "oi", symbol: "BTCUSDT", t: T0, d: { oi: 78000 } },
      { series: "oi", symbol: "ETHUSDT", t: T0, d: { oi: 410000 } },
    ],
    [0, 10, 190].map((m) => ({ t: T0 + m * MIN, iv: 10, route: "direct" as const, res: { BTCUSDT: "ok" }, states: false })),
  );
  return T0;
}

/** A hot archive that ends a moment ago on the page's own clock: funding +0,07 %, 70 % long, open interest +10 % in 4 h. */
async function seedHot(page: Page): Promise<void> {
  const rows = await page.evaluate(() => {
    const MIN = 60_000;
    const H = 60 * MIN;
    const now = Date.now();
    const out: Array<{ series: string; symbol: string; t: number; d: Record<string, number | string | null> }> = [];
    for (let i = 0; i <= 36; i++) {
      const t = now - 3 * MIN - (36 - i) * 10 * MIN;
      out.push({ series: "premium", symbol: "BTCUSDT", t, d: { mark: 80000, index: 80001, rate: 0.0007, next: t + 8 * H } });
      out.push({ series: "oi", symbol: "BTCUSDT", t, d: { oi: t >= now - 3 * H ? 1100 : 1000 } });
      out.push({ series: "lsAcc", symbol: "BTCUSDT", t, d: { long: 70, short: 30, ratio: 2.33 } });
      out.push({ series: "lsTopPos", symbol: "BTCUSDT", t, d: { long: 45, short: 55, ratio: 0.82 } });
    }
    return out;
  });
  const last = rows.reduce((m, r) => Math.max(m, r.t), 0);
  await writeArchive(page, rows, [{ t: last, iv: 10, route: "direct", res: { BTCUSDT: "ok" }, states: false }]);
}

async function openSettings(page: Page): Promise<void> {
  await openRoute(page, "/#settings", "Einstellungen");
  await expect(page.getByTestId("settings-archive-card")).toBeVisible({ timeout: 30_000 });
}

/** Goes to the app first (no archive page open), writes the archive, then moves on by the hash – the card reads what is there. */
async function seededRoute(page: Page, write: () => Promise<unknown>, hash: string, h1: string): Promise<void> {
  await page.goto("/#overview");
  await expect(page.locator("h1").first()).toBeAttached({ timeout: 30_000 });
  await write();
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await expect(page.getByRole("heading", { level: 1, name: h1 }).first()).toBeVisible({ timeout: 30_000 });
}

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(1200);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

test.describe("Datenarchiv (F26)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("off by default, says what it stores and what it is not – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await openSettings(page);
    const card = page.getByTestId("settings-archive-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole("switch", { name: "Archiv sammeln" })).toHaveAttribute("aria-checked", "false");
    await expect(card.getByTestId("archive-status")).toHaveText("Aus – es wird nichts gesammelt.");
    await expect(card.getByTestId("archive-what")).toContainText("Funding-Rate");
    await expect(card.getByTestId("archive-local")).toContainText("Nichts verlässt dein Gerät");
    await expect(card.getByTestId("archive-local")).toContainText("kein Teil von Backup oder Cloud-Sync");
    await expect(card.getByTestId("archive-limit")).toContainText("Kein Server-Archiv");
    await expect(card.getByTestId("archive-limit")).toContainText("nie gefüllt oder geschätzt");
    await expect(card.getByTestId("archive-options")).toHaveCount(0);
    await expect(card.getByTestId("archive-empty")).toBeVisible();
    await expect(card).toContainText("Keine professionelle Finanzberatung.");
    // nothing was stored by merely looking
    expect(await stored(page, CFG_KEY)).toBeNull();
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "archive-off", false);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a stored archive: rows, the gap with its reason, CSV export as stored, deletion after asking", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await seededRoute(page, () => seedView(page), "#settings", "Einstellungen");
    const card = page.getByTestId("settings-archive-card");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("archive-row")).toHaveCount(3, { timeout: 20_000 });
    await expect(card.getByTestId("archive-group")).toHaveCount(2);
    await expect(card.getByTestId("archive-totals")).toContainText("5 Einträge");
    const premium = card.locator('[data-testid="archive-row"][data-series="premium"]');
    await expect(premium).toContainText("3 Einträge");
    // 10 → 190 minutes: 3 h without a point and without a tick → the app was closed
    await expect(premium.getByTestId("archive-gap-summary")).toContainText("1 Lücke, zusammen 3 h", { timeout: 20_000 });
    await premium.getByRole("button", { name: "Lücken anzeigen" }).click();
    await expect(premium.getByTestId("archive-gap-list")).toContainText("App war zu oder pausiert – kein Abruf versucht");
    await expect(premium.getByTestId("archive-gap-list")).toContainText("3 h");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "archive-rows", false);

    // CSV: exactly the stored numbers, UTC time
    const download = page.waitForEvent("download");
    await premium.getByRole("button", { name: /als CSV/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^tj-archiv-premium-BTCUSDT-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (async () => {
      const stream = await file.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
      return Buffer.concat(chunks).toString("utf8");
    })();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("zeit_utc,epoch_ms,symbol,mark,index,rate,next");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`2026-10-20T10:00:00.000Z,${Date.UTC(2026, 9, 20, 10, 0, 0)},BTCUSDT,80000,80001,0.0001,${Date.UTC(2026, 9, 20, 18, 0, 0)}`);

    // delete one row: ask first, then it is gone from the overview and from the store
    const eth = card.locator('[data-testid="archive-row"][data-symbol="ETHUSDT"]');
    await eth.getByRole("button", { name: /löschen/ }).click();
    await expect(eth.getByText("Wirklich löschen?")).toBeVisible();
    await eth.getByRole("button", { name: "Ja" }).click();
    await expect(card.getByTestId("archive-row")).toHaveCount(2, { timeout: 15_000 });
    await expect(card.locator('[data-symbol="ETHUSDT"]')).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("switching it on starts the collector: the first reading appears, the choice survives a reload, switching off stops it", async ({ page }, info) => {
    const errors = collectErrors(page);
    // one symbol keeps the run short; the 15 s start delay is the collector's own
    await seed(page, { extra: { [CFG_KEY]: JSON.stringify({ v: 1, on: false, everyMin: 5, picked: ["BTCUSDT"], states: true, maxMb: 10 }) } });
    await openSettings(page);
    const card = page.getByTestId("settings-archive-card");
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("switch", { name: "Archiv sammeln" }).click();
    await expect(card.getByRole("switch", { name: "Archiv sammeln" })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByTestId("archive-options")).toBeVisible();
    expect(await stored<{ on: boolean }>(page, CFG_KEY)).toMatchObject({ on: true, picked: ["BTCUSDT"] });
    // the first tick comes after the start delay; the mock answers premiumIndex and openInterest
    await expect(card.getByTestId("archive-status")).toContainText("letzter Abruf", { timeout: 90_000 });
    await expect(card.locator('[data-testid="archive-row"][data-series="premium"]')).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-testid="archive-row"][data-series="oi"]')).toBeVisible();
    await expect(card.getByTestId("archive-totals")).toContainText("Einträge");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "archive-on", false);

    await page.reload();
    await expect(page.getByTestId("settings-archive-card").getByRole("switch", { name: "Archiv sammeln" })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await expect(page.getByTestId("settings-archive-card").locator('[data-testid="archive-row"][data-series="premium"]')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("settings-archive-card").getByRole("switch", { name: "Archiv sammeln" }).click();
    await expect(page.getByTestId("archive-status")).toHaveText("Aus – es wird nichts gesammelt.");
    expect(await stored<{ on: boolean }>(page, CFG_KEY)).toMatchObject({ on: false });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`barrierefrei und mit großen Tippflächen (${theme})`, async ({ page }, info) => {
      // switched off while the rows are scanned (a running collector would add points and change the gap), then on for the choices
      await seed(page, { extra: { "tj2-theme": JSON.stringify({ pref: theme, accent: "signal" }), [CFG_KEY]: JSON.stringify({ v: 1, on: false, everyMin: 10, picked: ["BTCUSDT"], states: false, maxMb: 25 }) } });
      await seededRoute(page, () => seedView(page), "#settings", "Einstellungen");
      await themeSettled(page);
      const card = page.getByTestId("settings-archive-card");
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByTestId("archive-row")).toHaveCount(3, { timeout: 20_000 });
      await expect(card.locator('[data-testid="archive-row"][data-series="premium"]').getByTestId("archive-gap-summary")).toContainText("1 Lücke", { timeout: 20_000 });
      await card.locator('[data-testid="archive-row"][data-series="premium"]').getByRole("button", { name: "Lücken anzeigen" }).click();
      await expectAccessible(page, '[data-testid="settings-archive-card"]', `Datenarchiv (${theme})`);
      await card.getByRole("switch", { name: "Archiv sammeln" }).click();
      await expect(card.getByTestId("archive-options")).toBeVisible();
      await expectAccessible(page, '[data-testid="settings-archive-card"]', `Datenarchiv mit Auswahl (${theme})`);
      if (hasTouch(info)) {
        const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="settings-archive-card"]' });
        expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
      }
    });
  }
});

test.describe("Squeeze-Beobachtung (F07)", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  async function openMarkt(page: Page): Promise<void> {
    await expect(page.getByTestId("markt-view")).toBeVisible({ timeout: 30_000 });
    const card = page.getByTestId("markt-squeeze");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 30_000 });
  }

  test("without an archive: says what it reads and leads to where it is switched on", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openRoute(page, "/#markt", "Markt");
    await openMarkt(page);
    const card = page.getByTestId("markt-squeeze");
    await expect(card.getByTestId("squeeze-empty")).toContainText("liest das Datenarchiv, und das ist aus", { timeout: 20_000 });
    await expect(card.getByTestId("squeeze-lead")).toContainText("kein Handelssignal und keine Prognose");
    await expect(card.getByTestId("squeeze-no-advice")).toContainText("Keine professionelle Finanzberatung.");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "squeeze-empty", false);
    await card.getByRole("button", { name: "Zum Datenarchiv" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("settings-archive-card")).toBeVisible({ timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a hot archive: crowded long side with three readings, values and thresholds – the thresholds change the reading", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await seededRoute(page, () => seedHot(page), "#markt", "Markt");
    await openMarkt(page);
    const card = page.getByTestId("markt-squeeze");
    const head = card.getByTestId("squeeze-headline");
    await expect(head).toHaveAttribute("data-state", "watch", { timeout: 30_000 });
    await expect(head).toHaveAttribute("data-side", "long");
    await expect(head).toContainText("BTCUSDT · Long-Seite überfüllt · 3 von 3 Messwerten");
    await expect(card.getByTestId("squeeze-signal-funding")).toContainText("+0,070 % je Abrechnung");
    await expect(card.getByTestId("squeeze-signal-funding")).toContainText("Schwelle: ≥ 0,050 % oder ≤ −0,050 % je Abrechnung");
    await expect(card.getByTestId("squeeze-signal-oi")).toContainText("+10,0 % in 4 h");
    await expect(card.getByTestId("squeeze-signal-accounts")).toContainText("Long 70,0 % · Short 30,0 %");
    await expect(card.getByTestId("squeeze-context")).toContainText("Box-Kontext");
    await expect(card.getByTestId("squeeze-sample")).toContainText("Stichprobe");
    await expect(card.getByTestId("squeeze-stand")).toContainText("Quelle: Datenarchiv dieses Geräts");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "squeeze-hot", false);

    // thresholds: all three must hold, and the funding bar goes above the 0,07 % → calm, written to settings.squeeze at once
    await card.getByTestId("squeeze-tune").click();
    const funding = card.getByLabel("Funding ab (% je Abrechnung)");
    await funding.fill("0,08");
    await funding.press("Enter");
    await expect.poll(async () => (await stored<{ squeeze?: { fundingPct?: number } }>(page, "tj2-settings"))?.squeeze?.fundingPct).toBe(0.08);
    await card.getByRole("radio", { name: "3 von 3" }).click();
    await expect(head).toHaveAttribute("data-state", "calm", { timeout: 15_000 });
    await expect(head).toContainText("Ruhig – 2 von 3 nötigen Messwerten");
    await expect(card.getByTestId("squeeze-signal-funding")).toHaveAttribute("data-met", "false");
    const settings = await stored<{ squeeze?: Record<string, unknown> }>(page, "tj2-settings");
    expect(settings?.squeeze).toMatchObject({ v: 1, fundingPct: 0.08, minMet: 3, alerts: false });

    // the alert stays off until the switch is turned on
    const sw = card.getByRole("switch", { name: "Alarm bei neuer Beobachtung" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect.poll(async () => (await stored<{ squeeze?: { alerts?: boolean } }>(page, "tj2-settings"))?.squeeze?.alerts).toBe(true);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`barrierefrei und mit großen Tippflächen (${theme})`, async ({ page }, info) => {
      await seed(page, { boxes: true, extra: { "tj2-theme": JSON.stringify({ pref: theme, accent: "signal" }) } });
      await seededRoute(page, () => seedHot(page), "#markt", "Markt");
      await themeSettled(page);
      await openMarkt(page);
      const card = page.getByTestId("markt-squeeze");
      await expect(card.getByTestId("squeeze-headline")).toHaveAttribute("data-state", "watch", { timeout: 30_000 });
      await card.getByTestId("squeeze-tune").click();
      await expectAccessible(page, '[data-testid="markt-squeeze"]', `Squeeze-Beobachtung (${theme})`);
      if (hasTouch(info)) {
        const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="markt-squeeze"]' });
        expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
      }
    });
  }
});
