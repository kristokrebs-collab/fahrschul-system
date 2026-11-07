/**
 * "Top-Trader: Netto Long/Short" – the complete Wal-Karte (C3) on the Markt page, on a KNOWN market: the mocked Binance REST serves
 * the script `slide-account` (`mocks/synth.ts`): the top-trader POSITION series flips from net long to net short 60 periods ago
 * (one jump), the ACCOUNT series slides from 55 % to 46 % long over the same 60 periods, so the alert rule's Vorwarnung and
 * Bestätigung fall on it. 500 hourly points = 20 days and 18 hours. The expectation comes from the app's own pure functions
 * (`replayWhale`, `findNetGaps`, …) on the same rows; the marks are checked against the engine, not against a copy of its rules.
 * NOT checked against real Binance values (fapi.binance.com answers 451 from the sandbox network) – fixtures only.
 * Covered: the series switch (headline, provenance, marks follow), the three provenance lines, the marks on the curve and in the
 * crosshair, the stored history (rows seeded in the device's IndexedDB: a gap between them and the live series stays a gap – the
 * crosshair names it, nothing is interpolated), the ranges 7 / 30 / 90, storing on the device and the stored-only state when
 * Binance gives nothing, the switch that stops storing, the two-step delete, the CSV, no layout jump (CLS ≤ 0,02, the card keeps its
 * size when the series or the range changes), touch targets ≥ 44 px, axe in dark and light, nothing sideways.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { replayWhale } from "../../src/domain/alerts/replay";
import type { NetPoint } from "../../src/domain/signals";
import { findNetGaps, netStampText } from "../../src/domain/signals/netSeries";
import { collectErrors, expectNoHorizontalScroll, hasTouch, isMobile, pinClock, seed, utcToday } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { synthRatios, type RatioKind, type RatioScript } from "./mocks/synth";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const AT = () => utcToday(6, 3);
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CARD = "markt-trader-net";
const SCRIPT: RatioScript = "slide-account";
const DB = "tj2-net-archive";
const OFF = { "tj2-net-archive-cfg": JSON.stringify({ v: 1, on: false }) };

interface Opened {
  card: Locator;
  now: number;
  /** the newest hourly point of the mocked series */
  newest: number;
}

interface OpenOpts {
  light?: boolean;
  /** localStorage entries (the switch of the archive) */
  extra?: Record<string, unknown>;
  /** rows for the device's archive (written after the first load, the page is then loaded again) */
  stored?: { series: "position" | "account"; rows: Array<{ t: number; long: number; price: number | null }> };
  afterSeed?: () => Promise<unknown>;
  /** measure the layout shift (the sum without a recent input) */
  cls?: boolean;
  script?: RatioScript;
}

/** Writes rows into the card's IndexedDB (the schema of `src/market/netArchive.ts`: store `rows`, key `[series, symbol, t]`). */
async function writeRows(page: Page, series: string, rows: Array<{ t: number; long: number; price: number | null }>): Promise<void> {
  await page.evaluate(
    async ({ db, series, rows }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(db, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("rows")) open.result.createObjectStore("rows", { keyPath: ["series", "symbol", "t"] });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const d = open.result;
          const tx = d.transaction("rows", "readwrite");
          for (const r of rows) tx.objectStore("rows").put({ series, symbol: "BTCUSDT", t: r.t, l: r.long, p: r.price, s: 3_600_000 });
          tx.oncomplete = () => {
            d.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { db: DB, series, rows },
  );
}

/** How many rows the card has stored for a series (BTCUSDT). */
const stored = (page: Page, series: string): Promise<number> =>
  page.evaluate(
    (s) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("tj2-net-archive", 1);
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const d = open.result;
          if (!d.objectStoreNames.contains("rows")) {
            d.close();
            return resolve(0);
          }
          const r = d.transaction("rows").objectStore("rows").count(IDBKeyRange.bound([s, "BTCUSDT", -Infinity], [s, "BTCUSDT", Infinity]));
          r.onsuccess = () => {
            d.close();
            resolve(r.result);
          };
        };
      }),
    series,
  );

async function openMarkt(page: Page, opts: OpenOpts = {}): Promise<Opened> {
  const at = AT();
  const clock = await pinClock(page, at);
  const anchor = at - 60_000;
  if (opts.cls) {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
  }
  await seed(page, { synth: { ratios: opts.script ?? SCRIPT, anchor }, clock: clock.now, extra: { ...(opts.light ? { "tj2-theme": JSON.stringify("light") } : {}), ...(opts.extra ?? {}) } });
  await opts.afterSeed?.();
  await page.goto("/#markt");
  await expect(page.locator('[data-page="markt"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
  if (opts.stored) {
    // the first load opens the database; then the rows go in and the page is read again
    await expect(page.getByTestId(CARD)).toHaveAttribute("data-state", /^(ok|none|loading|stale|short)$/, { timeout: 25_000 });
    await page.getByTestId("trader-net-archive").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("trader-net-archive")).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
    await writeRows(page, opts.stored.series, opts.stored.rows);
    // (a reload restores the scroll position, and the page's own skeleton leaving then counts as a shift: back to the top first)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.reload();
    await expect(page.locator('[data-page="markt"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
  }
  const card = page.getByTestId(CARD);
  await card.scrollIntoViewIfNeeded();
  return { card, now: at, newest: Math.floor(at / HOUR) * HOUR };
}

/** The oracle: the marks the alert engine gives for the mocked rows of a series (with the gaps of `findNetGaps`). */
function expectedMarks(kind: RatioKind, now: number, script: RatioScript = SCRIPT, before: NetPoint[] = []) {
  const live: NetPoint[] = synthRatios(kind, "1h", { limit: 500 }, script, now).map((r) => ({ t: Number(r.timestamp), net: 2 * Number(r.longAccount) * 100 - 100, longPct: Number(r.longAccount) * 100, price: null, s: HOUR }));
  const all = [...before, ...live];
  const gaps = findNetGaps(all, HOUR);
  return replayWhale(
    all.map((p) => ({ t: p.t, longPct: p.longPct })),
    { symbol: "BTCUSDT", breaks: gaps.map((g) => g.index + 1) },
  );
}

/** `n` stored hourly rows ending `gapMs` before the first live point (a stretch of green, 56 % long). */
function storedRows(newest: number, n: number, gapMs: number) {
  const liveFirst = newest - 499 * HOUR;
  const last = liveFirst - gapMs;
  return Array.from({ length: n }, (_, i) => ({ t: last - (n - 1 - i) * HOUR, long: 56 + 0.5 * Math.sin(i * 0.7), price: 68_000 + i }));
}

const pad = (w: number) => (w < 480 ? { l: 36, r: 46 } : { l: 42, r: 58 });
/** x (CSS px inside the plot) of a time, for a plot showing `[tMin, tMax]` */
const xOf = (w: number, t: number, tMin: number, tMax: number): number => {
  const p = pad(w);
  return p.l + ((t - tMin) / (tMax - tMin)) * (w - p.l - p.r);
};

async function pointAt(page: Page, plot: Locator, info: Parameters<typeof isMobile>[0], x: number, y = 0.45): Promise<void> {
  // (a mouse move to a point outside the window sends no pointer event: bring the plot into view first)
  await plot.scrollIntoViewIfNeeded();
  const b = (await plot.boundingBox())!;
  if (isMobile(info)) await plot.tap({ position: { x, y: b.height * y } });
  else await page.mouse.move(b.x + x, b.y + b.height * y);
}

const ready = async (card: Locator) => {
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
};

const markTexts = (marks: ReturnType<typeof expectedMarks>) => marks.map((m) => `${m.label} ${netStampText(m.t)}`);

test.describe("Wal-Karte (C3): Top-Trader netto on the Markt page", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("series switch: Positionen gives the jump's Bestätigung, Konten the Vorwarnung and the Bestätigung of the slide; headline, provenance and marks follow; the card keeps its size", async ({ page }) => {
    const errors = collectErrors(page);
    const { card, now } = await openMarkt(page);
    await ready(card);
    const plot = card.getByTestId("trader-net-plot");
    const pos = expectedMarks("top-position", now);
    const acc = expectedMarks("top-account", now);
    expect(pos.map((m) => m.event), "oracle: the jump is one Bestätigung").toEqual(["red_confirm"]);
    expect(acc.map((m) => m.event), "oracle: the slide has a Vorwarnung, then the Bestätigung").toEqual(["red_warn", "red_confirm"]);
    // Positionen (default)
    await expect(card).toHaveAttribute("data-series", "position");
    await expect(plot).toHaveAttribute("data-marks", String(pos.length));
    await expect(card.getByTestId("trader-net-title")).toHaveText(/^Top-Trader \(Binance\) sind seit \d\d\.\d\d\. netto Short/);
    await expect(card.getByTestId("trader-net-prov-source")).toContainText("topLongShortPositionRatio");
    const heightPos = (await card.boundingBox())!.height;
    // Konten
    const group = card.getByRole("radiogroup", { name: "Reihe" });
    await expect(group.getByRole("radio")).toHaveCount(2);
    await group.getByRole("radio", { name: "Konten" }).click();
    await expect(card).toHaveAttribute("data-series", "account");
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 15_000 });
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
    await expect(plot).toHaveAttribute("data-marks", String(acc.length));
    await expect(plot).toHaveAccessibleName(new RegExp(`Marken der Alarm-Regel: 2 Marken \\(Rot-Vorwarnung \\d\\d\\.\\d\\d\\., Rot-Bestätigung \\d\\d\\.\\d\\d\\.\\)\\.$`));
    await expect(card.getByTestId("trader-net-title")).toHaveText(/^Top-Trader \(Binance, nach Konten\) sind seit \d\d\.\d\d\. netto Short/);
    await expect(card.getByTestId("trader-net-prov-source")).toContainText("topLongShortAccountRatio");
    await expect(card.getByTestId("trader-net-prov-cohort")).toContainText("Anteil der Konten mit Long-Position");
    expect(Math.abs((await card.boundingBox())!.height - heightPos), "the card keeps its size when the series changes").toBeLessThan(1.5);
    // and back
    await group.getByRole("radio", { name: "Positionen" }).click();
    await expect(card).toHaveAttribute("data-series", "position");
    await expect(plot).toHaveAttribute("data-marks", String(pos.length));
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
    expect(Math.abs((await card.boundingBox())!.height - heightPos)).toBeLessThan(1.5);
    expect(errors.filter((e) => !/willReadFrequently/.test(e))).toEqual([]);
  });

  test("provenance: Quelle, Kohorte and Messzeit are three lines, the time is the newest point of the series", async ({ page }, info) => {
    const { card, newest } = await openMarkt(page);
    await ready(card);
    const prov = card.getByTestId("trader-net-provenance");
    await expect(prov.locator("dt")).toHaveText(["Quelle", "Kohorte", "Messzeit"]);
    await expect(card.getByTestId("trader-net-prov-source")).toHaveText("Binance Futures, öffentliche Statistik (topLongShortPositionRatio), direkt");
    await expect(card.getByTestId("trader-net-prov-cohort")).toHaveText("Obere 20 % der Konten nach Einsatz · Long-Anteil der Positionsgrößen");
    // the newest hourly point, in UTC, aged against the pinned clock (06:03, so under five minutes: "gerade eben")
    await expect(card.getByTestId("trader-net-prov-time")).toHaveText(new RegExp(`^${netStampText(newest).replace(/\./g, "\\.")} UTC \\((gerade eben|vor \\d+ Min\\.)\\) · neuer Wert alle 1 Std\\.$`));
    // the three lines keep their rows: two lines on a phone, one from sm up, never more
    const heights = await prov.locator("dd").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    const line = await prov.locator("dd").first().evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
    // (the phone's row keeps room for two lines: 2,75 em)
    for (const h of heights) expect(h, `provenance row ${h}px (line ${line}px)`).toBeLessThanOrEqual(isMobile(info) ? 2.75 * 11 + 1 : line + 1);
    // never "Wale" / "Glassnode" as a name or source
    expect((await card.innerText()).replace(/keine On-Chain-Wale/g, "")).not.toMatch(/Wal(e|s)\b|Glassnode/i);
  });

  test("the marks sit on the curve: the crosshair names the Vorwarnung and the Bestätigung of the account slide where it stands on them", async ({ page }, info) => {
    const { card, now } = await openMarkt(page);
    await ready(card);
    const plot = card.getByTestId("trader-net-plot");
    await card.getByRole("radiogroup", { name: "Reihe" }).getByRole("radio", { name: "Konten" }).click();
    await expect(plot).toHaveAttribute("data-marks", "2");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
    const acc = expectedMarks("top-account", now);
    const b = (await plot.boundingBox())!;
    const tMin = Math.floor(now / HOUR) * HOUR - 499 * HOUR;
    const tMax = Math.floor(now / HOUR) * HOUR;
    const tip = card.getByTestId("trader-net-tip");
    const texts = markTexts(acc);
    for (const [i, m] of acc.entries()) {
      await pointAt(page, plot, info, xOf(b.width, m.t, tMin, tMax));
      await expect(tip).toHaveCSS("opacity", "1");
      // a pixel is more than one point wide on a phone: the arrow keys take the last steps to the exact point
      await plot.focus();
      const mark = card.getByTestId("trader-net-tip-mark");
      for (const key of [...Array(6).fill("ArrowLeft"), ...Array(12).fill("ArrowRight")] as string[]) {
        if ((await mark.textContent()) === texts[i]) break;
        await page.keyboard.press(key);
      }
      await expect(mark).toHaveText(texts[i]!);
    }
    // a point without a mark: the line is empty
    await pointAt(page, plot, info, xOf(b.width, tMin + 100 * HOUR, tMin, tMax));
    await expect(card.getByTestId("trader-net-tip-mark")).toHaveText("");
    await page.screenshot({ path: info.outputPath(`wal-${info.project.name}-marks.png`), clip: (await card.boundingBox())! });
  });

  test("keyboard: the arrow keys walk the points and say the mark; Home / End / Escape work; the readout is announced politely", async ({ page }, info) => {
    const { card, now } = await openMarkt(page);
    await ready(card);
    const plot = card.getByTestId("trader-net-plot");
    const pos = expectedMarks("top-position", now);
    await plot.focus();
    await page.keyboard.press("End");
    await expect(card.getByTestId("trader-net-tip")).toContainText(/Netto −\d+,\d Pkt\./);
    // 59 periods back from the newest is the first net-short point: the jump's Bestätigung stands there
    for (let i = 0; i < 59; i++) await page.keyboard.press("ArrowLeft");
    await expect(card.getByTestId("trader-net-tip-mark")).toHaveText(markTexts(pos)[0]!);
    await expect(plot.locator("[aria-live=polite]")).toContainText("Rot-Bestätigung");
    await page.keyboard.press("ArrowLeft");
    await expect(card.getByTestId("trader-net-tip-mark")).toHaveText("");
    await page.keyboard.press("Escape");
    await expect(card.getByTestId("trader-net-tip")).toHaveCSS("opacity", "0");
    void info;
  });

  test("stored history with a gap: both are drawn, the gap stays a gap – the crosshair names it, no value is made up", async ({ page }, info) => {
    const at = AT();
    const newest = Math.floor(at / HOUR) * HOUR;
    const rows = storedRows(newest, 361, 10 * DAY);
    const { card, now } = await openMarkt(page, { extra: OFF, stored: { series: "position", rows } });
    await ready(card);
    const plot = card.getByTestId("trader-net-plot");
    // 361 stored points + 500 live points, one gap of ten days between them
    await expect(plot).toHaveAttribute("data-points", "861");
    await expect(plot).toHaveAttribute("data-gaps", "1");
    await expect(plot).toHaveAccessibleName(/1 Lücke ohne Messwerte\.$/);
    // the headline is about the newest run – the live series – and says so: no flip is dated across the gap
    await expect(card.getByTestId("trader-net-title")).toHaveText(/^Top-Trader \(Binance\) sind seit \d\d\.\d\d\. netto Short – im geladenen Verlauf von 20 Tagen erstmals\.$/);
    await expect(card.getByTestId("trader-net-line")).toHaveText(/^Verlauf: 45 Tage \(861 Punkte, davon 361 aus dem Speicher\), 1 Lücke · neue Werte im Abstand 1 Std\. · Zeiten in UTC$/);
    // the marks: the alert rule starts again after the gap (the oracle says the same)
    const exp = expectedMarks("top-position", now, SCRIPT, rows.map((r) => ({ t: r.t, net: 2 * r.long - 100, longPct: r.long, price: r.price, s: HOUR })));
    await expect(plot).toHaveAttribute("data-marks", String(exp.length));
    expect(exp.every((m) => m.t > newest - 499 * HOUR), "oracle: nothing is dated inside or before the gap").toBe(true);
    // the ranges: 7 and 30 can be taken (45 days of history), 90 is shown but not offered; "Alles" carries the real length
    const range = card.getByRole("radiogroup", { name: "Zeitraum" });
    await expect(range.getByRole("radio", { name: "Alles · 45 Tage" })).toBeChecked();
    await expect(range.getByRole("radio", { name: "30 Tage" })).toBeEnabled();
    await expect(range.getByRole("radio", { name: "90 Tage" })).toBeDisabled();
    // the crosshair in the middle of the gap
    const b = (await plot.boundingBox())!;
    const tMin = rows[0]!.t;
    const tMax = newest;
    const liveFirst = newest - 499 * HOUR;
    const gapMid = (rows[rows.length - 1]!.t + liveFirst) / 2;
    await pointAt(page, plot, info, xOf(b.width, gapMid, tMin, tMax));
    const tip = card.getByTestId("trader-net-tip");
    await expect(tip).toHaveCSS("opacity", "1");
    await expect(tip).toContainText("Lücke");
    await expect(tip).toContainText(/ohne Messwerte/);
    await expect(tip).toContainText("nichts ergänzt");
    // ... and on a stored point before it, a real value
    await pointAt(page, plot, info, xOf(b.width, tMin + 20 * HOUR, tMin, tMax));
    await expect(tip).toContainText(/Netto \+\d+,\d Pkt\. · Long 5\d,\d %/);
    await expect(tip).not.toContainText("Lücke");
    // the gap is painted (a faint band the paper / the dark ground does not have): pixels of the dashed edges exist between the two runs
    const painted = await plot.locator("canvas").first().evaluate(
      (c: HTMLCanvasElement, f: { from: number; to: number }) => {
        const ctx = c.getContext("2d")!;
        const dpr = c.width / c.clientWidth;
        const w = Math.max(1, Math.round((f.to - f.from) * dpr));
        const d = ctx.getImageData(Math.round(f.from * dpr), Math.round(c.height * 0.25), w, 4).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 8) lit++;
        return lit;
      },
      { from: xOf(b.width, rows[rows.length - 1]!.t, tMin, tMax) + 2, to: xOf(b.width, liveFirst, tMin, tMax) - 2 },
    );
    expect(painted, "the gap band is painted").toBeGreaterThan(10);
    await page.screenshot({ path: info.outputPath(`wal-${info.project.name}-gap.png`), clip: (await card.boundingBox())! });
    // 30 Tage: the live series and the last days before the gap fall away – only live points remain inside 30 days of the newest one
    await range.getByRole("radio", { name: "30 Tage" }).click();
    await expect(plot).toHaveAttribute("data-points", /^(5\d\d|6\d\d)$/);
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
  });

  test("storing: the card keeps what it shows on this device; when Binance gives nothing the stored history is shown, marked as such", async ({ page }, info) => {
    const { card } = await openMarkt(page);
    await ready(card);
    const arch = card.getByTestId("trader-net-archive");
    await arch.scrollIntoViewIfNeeded();
    await expect(arch).toHaveAttribute("data-recording", "on");
    // one point per hour of the live series (500) – polled, the write follows the first picture
    await expect.poll(() => stored(page, "position"), { timeout: 10_000 }).toBeGreaterThanOrEqual(490);
    expect(await stored(page, "account"), "the series that was not shown is not stored").toBe(0);
    await expect(card.getByTestId("trader-net-archive-line")).toContainText(/Gespeichert auf diesem Gerät: 20 Tage \(500 Punkte\), keine Lücke · wächst mit jedem Besuch\./);
    // the next visit: Binance's position series is gone (network error) – the stored history takes over, and says so
    await page.route("https://fapi.binance.com/futures/data/topLongShortPositionRatio**", (route) => route.abort("failed"));
    await page.reload();
    await expect(page.locator('[data-page="markt"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
    const again = page.getByTestId(CARD);
    await again.scrollIntoViewIfNeeded();
    await expect(again).toHaveAttribute("data-state", "archive", { timeout: 30_000 });
    await expect(again.getByText("gespeichert", { exact: true })).toBeVisible();
    await expect(again.getByTestId("trader-net-line")).toHaveText("Binance liefert gerade nichts – gezeigt wird der Verlauf, den dieses Gerät gespeichert hat.");
    await expect(again.getByTestId("trader-net-prov-source")).toHaveText("Gespeicherter Verlauf auf diesem Gerät – Binance liefert gerade nichts");
    const plot = again.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
    expect(Number(await plot.getAttribute("data-points"))).toBeGreaterThanOrEqual(490);
    await expect(again.getByTestId("trader-net-kpi-net-value")).toHaveText(/^−\d+,\d Pkt\.$/);
    await page.screenshot({ path: info.outputPath(`wal-${info.project.name}-archive-state.png`), clip: (await again.boundingBox())! });
  });

  test("the switch stops the storing; the delete is two steps; CSV carries the points and the gap as a comment", async ({ page }, info) => {
    const at = AT();
    const newest = Math.floor(at / HOUR) * HOUR;
    const rows = storedRows(newest, 120, 5 * DAY);
    const { card } = await openMarkt(page, { extra: OFF, stored: { series: "position", rows } });
    await ready(card);
    const arch = card.getByTestId("trader-net-archive");
    await arch.scrollIntoViewIfNeeded();
    await expect(arch).toHaveAttribute("data-recording", "off");
    await expect(arch).toHaveAttribute("data-stored", "120");
    await expect(card.getByTestId("trader-net-archive-line")).toContainText("Speichern ist aus");
    // nothing new was stored while it is off (only the 120 seeded rows)
    expect(await stored(page, "position")).toBe(120);
    // CSV
    const download = page.waitForEvent("download");
    await card.getByTestId("trader-net-archive-csv").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("top-trader-netto-position-BTCUSDT.csv");
    const text = (await (await import("node:fs/promises")).readFile((await file.path())!, "utf8")).split("\n");
    expect(text[0]).toBe("zeit_utc,long_prozent,netto_punkte,preis,herkunft");
    expect(text.filter((l) => l.endsWith(",gespeichert"))).toHaveLength(120);
    expect(text.filter((l) => l.endsWith(",geladen"))).toHaveLength(500);
    expect(text.filter((l) => l.startsWith("# Lücke ohne Messwerte:"))).toHaveLength(1);
    // delete: a question first, "Abbrechen" keeps everything
    await card.getByTestId("trader-net-archive-delete").click();
    await expect(card.getByTestId("trader-net-archive-sure")).toContainText("Gespeicherten Verlauf wirklich löschen?");
    await card.getByTestId("trader-net-archive-no").click();
    await expect(card.getByTestId("trader-net-archive-sure")).toHaveCount(0);
    expect(await stored(page, "position")).toBe(120);
    await card.getByTestId("trader-net-archive-delete").click();
    await card.getByTestId("trader-net-archive-yes").click();
    await expect(arch).toHaveAttribute("data-stored", "0", { timeout: 10_000 });
    expect(await stored(page, "position")).toBe(0);
    await expect(card.getByTestId("trader-net-archive-line")).toHaveText("Speichern ist aus – nichts gespeichert.");
    await expect(card.getByTestId("trader-net-archive-delete")).toBeDisabled();
    // the plot lost the stored part, kept the live one
    await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-points", "500");
    await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-gaps", "0");
    void info;
  });

  test("the switch comes on again: storing starts with the next picture", async ({ page }) => {
    const { card } = await openMarkt(page, { extra: OFF });
    await ready(card);
    const arch = card.getByTestId("trader-net-archive");
    await arch.scrollIntoViewIfNeeded();
    expect(await stored(page, "position")).toBe(0);
    await card.getByRole("switch", { name: "Verlauf auf diesem Gerät merken" }).click();
    await expect(arch).toHaveAttribute("data-recording", "on");
    await expect.poll(() => stored(page, "position"), { timeout: 10_000 }).toBeGreaterThanOrEqual(490);
  });

  test("no layout jump: CLS ≤ 0,02 while the card arrives and the series and ranges change; the page does not grow when the card arrives", async ({ page }) => {
    const rows = storedRows(Math.floor(AT() / HOUR) * HOUR, 200, 3 * DAY);
    const { card } = await openMarkt(page, { cls: true, extra: OFF, stored: { series: "position", rows } });
    const grow = await page.evaluate(() => document.documentElement.scrollHeight);
    await ready(card);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(after - grow, `the page grew from ${grow} to ${after} px`).toBeLessThan(60);
    const before = (await card.boundingBox())!.height;
    const series = card.getByRole("radiogroup", { name: "Reihe" });
    const range = card.getByRole("radiogroup", { name: "Zeitraum" });
    await series.getByRole("radio", { name: "Konten" }).click();
    await expect(card).toHaveAttribute("data-series", "account");
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 15_000 });
    await range.getByRole("radio", { name: "7 Tage" }).click();
    await series.getByRole("radio", { name: "Positionen" }).click();
    await expect(card).toHaveAttribute("data-series", "position");
    await range.getByRole("radio", { name: /^Alles/ }).click();
    await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
    await page.waitForTimeout(800);
    expect(Math.abs((await card.boundingBox())!.height - before), "the card's height is the same in every state").toBeLessThan(1.5);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `Layout-Verschiebung ${cls.toFixed(4)}`).toBeLessThanOrEqual(0.02);
  });

  test("the card keeps its box without Binance data and without history (the reason, no plot, three provenance lines)", async ({ page }) => {
    // first the card without data (nothing is stored then), then, on a second page, the same card with data
    const none = await openMarkt(page, {
      extra: OFF,
      afterSeed: () => page.route("https://fapi.binance.com/futures/data/topLongShortPositionRatio**", (route) => (new URL(route.request().url()).searchParams.get("period") === "1h" ? route.abort("failed") : route.fallback())),
    });
    await expect(none.card).toHaveAttribute("data-state", "none", { timeout: 30_000 });
    await expect(none.card.getByTestId("trader-net-empty")).toBeVisible();
    await expect(none.card.getByTestId("trader-net-plot")).toHaveCount(0);
    await expect(none.card.getByTestId("trader-net-provenance").locator("dt")).toHaveCount(3);
    const without = (await none.card.boundingBox())!;
    const page2 = await page.context().newPage();
    const withData = await openMarkt(page2);
    await ready(withData.card);
    const sized = (await withData.card.boundingBox())!;
    expect(Math.abs(without.height - sized.height), `card ${sized.height} px with data, ${without.height} px without`).toBeLessThan(4);
    expect(Math.abs(without.width - sized.width)).toBeLessThan(1.5);
    await page2.close();
  });

  test("the loading state shows the thinking orb in the plot's box", async ({ page }) => {
    // the position series answers late (held until the test lets it go): the card says it is loading, with the orb, and keeps the box
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { card } = await openMarkt(page, {
      extra: OFF,
      afterSeed: () =>
        page.route("https://fapi.binance.com/futures/data/topLongShortPositionRatio**", async (route) => {
          await gate;
          await route.fallback();
        }),
    });
    await expect(card).toHaveAttribute("data-state", "loading", { timeout: 20_000 });
    const box = card.getByTestId("trader-net-empty");
    await expect(box.locator("[data-thinking-orb='search']")).toBeVisible();
    await expect(box).toContainText("Top-Trader-Daten werden geladen");
    await expect(card.getByTestId("trader-net-kpi-net-value")).toHaveText("–");
    release();
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  });

  test("reduced motion: the finished plot with its marks is there at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { card } = await openMarkt(page);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    const plot = card.getByTestId("trader-net-plot");
    await expect(plot).toHaveAttribute("data-drawn", "true");
    await expect(plot).toHaveAttribute("data-marks", "1");
  });

  test("touch targets and accessibility (dark): ≥ 44 px, axe finds nothing, nothing scrolls sideways", async ({ page }) => {
    const rows = storedRows(Math.floor(AT() / HOUR) * HOUR, 200, 3 * DAY);
    const { card } = await openMarkt(page, { extra: OFF, stored: { series: "position", rows } });
    await ready(card);
    await card.getByTestId("trader-net-archive").scrollIntoViewIfNeeded();
    if (hasTouch(test.info())) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: `[data-testid="${CARD}"]` });
      expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
    }
    const res = await new AxeBuilder({ page }).include(`[data-testid="${CARD}"]`).withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    // the delete question too
    await card.getByTestId("trader-net-archive-delete").click();
    const res2 = await new AxeBuilder({ page }).include(`[data-testid="${CARD}"]`).withTags(TAGS).analyze();
    expect(res2.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`)).toEqual([]);
    await expectNoHorizontalScroll(page);
  });

  test("light theme: axe finds nothing on paper, a screenshot is kept", async ({ page }, info) => {
    const rows = storedRows(Math.floor(AT() / HOUR) * HOUR, 200, 3 * DAY);
    const { card } = await openMarkt(page, { light: true, extra: OFF, stored: { series: "position", rows } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await ready(card);
    await card.scrollIntoViewIfNeeded();
    const res = await new AxeBuilder({ page }).include(`[data-testid="${CARD}"]`).withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`wal-${info.project.name}-light.png`), clip: (await card.boundingBox())! });
    await expectNoHorizontalScroll(page);
  });
});
