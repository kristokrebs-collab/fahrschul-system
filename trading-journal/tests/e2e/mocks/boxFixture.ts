/**
 * REAL Binance BTCUSDT.P bars for the Box-zu-Box e2e (`mockMarket(page, …, { boxes: true })`, P02 + box fix):
 * `tests/unit/fixtures/binance-btcusdt-{4h,1d}.json` served as `/fapi/v1/klines` rows, shifted so the 4h bar `cut4h`
 * is the forming bar of "now". One consistent market on every timeframe:
 *
 * - 4h: the fixture's bars 0…cut4h, every open time shifted by the same Δ (a multiple of 4h; the cut bar opens in the
 *   current 4h slot) – strictly ascending, gap-free.
 * - 1D: the UTC days of the SAME shifted 4h bars wherever they cover a whole day (the forming day = its 4h bars up to the
 *   forming one, close = the live price), older days from the daily fixture shifted by whole days (no hole, no overlap).
 * - 1W: the Monday-based weeks of those days (Binance weeks open Monday 00:00 UTC).
 * - Binance query semantics: `startTime` → the first `limit` bars from it (ascending), else the newest `limit` bars up to
 *   `endTime` / now; `limit` 1…1500 (default 500); nothing after the forming bar exists.
 * - Every live price of the replay (trades, book, tickers) is the forming 4h bar's close (`live`).
 * - Other symbols (the watchlist scanner): the same real bars at another moment and price level (deterministic per
 *   symbol).
 *
 * Node only (reads the fixtures with `fs`); pure otherwise – `tests/unit/mocks.boxFixture.test.ts` checks it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A Binance `/fapi/v1/klines` row. */
export type KlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];

export interface KlineQuery {
  limit?: number;
  startTime?: number;
  endTime?: number;
}

/** Real bars for the Box-zu-Box e2e (`boxes` option): rows per interval, shifted so `cut4h` is forming at `now`. */
export interface BoxFixture {
  /** `symbol`: BTCUSDT gets the cut as given; any other symbol (the watchlist scanner) a cut and price scale of its own */
  rows: (interval: string, q: KlineQuery, symbol?: string) => KlineRow[] | null;
  /** the forming 4h bar's close: every live price of the replay */
  live: number;
}

/** The 4h bar of the fixture that is forming "now" by default: 2026-10-11 00:00 UTC, an A+ range long at the support. */
export const BOX_CUT_4H = 1493;
const HOUR_MS = 3_600_000;
const H4 = 4 * HOUR_MS;
const D = 24 * HOUR_MS;
const W = 7 * D;
/** Binance weeks open Monday 00:00 UTC (the epoch was a Thursday). */
const weekOpen = (t: number): number => Math.floor((t - 4 * D) / W) * W + 4 * D;
const dayOpen = (t: number): number => Math.floor(t / D) * D;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "unit", "fixtures");
let cache: { h4: number[][]; d1: number[][] } | null = null;
function fixtures(): { h4: number[][]; d1: number[][] } {
  if (!cache) {
    const read = (n: string) => (JSON.parse(readFileSync(join(FIXTURES, n), "utf8")) as { bars: number[][] }).bars;
    cache = { h4: read("binance-btcusdt-4h.json"), d1: read("binance-btcusdt-1d.json") };
  }
  return cache;
}

interface NumBar {
  /** open time, ms UTC */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Bars grouped by `open(t)` (ascending input → ascending output). */
function aggregate(src: readonly NumBar[], open: (t: number) => number): NumBar[] {
  const out: NumBar[] = [];
  for (const b of src) {
    const t = open(b.t);
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
    } else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  return out;
}

/** Binance `/fapi/v1/klines` window semantics over ascending rows. */
export function selectKlines<T extends { 0: number }>(all: readonly T[], q: KlineQuery): T[] {
  const limit = Math.max(1, Math.min(1500, Math.round(q.limit ?? 500)));
  const inRange = all.filter((r) => (q.startTime == null || r[0] >= q.startTime) && (q.endTime == null || r[0] <= q.endTime));
  return q.startTime != null ? inRange.slice(0, limit) : inRange.slice(-limit);
}

/** Numeric bars per interval for one market (exported for the unit test). */
export function boxBars(now: number, cut4h = BOX_CUT_4H): { "4h": NumBar[]; "1d": NumBar[]; "1w": NumBar[]; live: number } {
  const { h4, d1 } = fixtures();
  const cut = Math.max(100, Math.min(h4.length - 1, cut4h));
  const fixAt = h4[cut]![0]! * 1000; // open of the bar that is forming "now"
  // one shift for the whole market: a multiple of 4h (the cut bar opens in the current 4h slot) …
  const shift = Math.floor(now / H4) * H4 - fixAt;
  // … and its whole-day part for the daily fixture before the 4h coverage
  const dayShift = Math.floor(shift / D) * D;
  const bars4h: NumBar[] = h4.slice(0, cut + 1).map(([t, o, h, l, c]) => ({ t: t! * 1000 + shift, o: o!, h: h!, l: l!, c: c! }));
  const firstWholeDay = Math.ceil(bars4h[0]!.t / D) * D;
  const older: NumBar[] = d1.map(([t, o, h, l, c]) => ({ t: t! * 1000 + dayShift, o: o!, h: h!, l: l!, c: c! })).filter((b) => b.t < firstWholeDay);
  const days = [...older, ...aggregate(bars4h.filter((b) => b.t >= firstWholeDay), dayOpen)];
  return { "4h": bars4h, "1d": days, "1w": aggregate(days, weekOpen), live: h4[cut]![4]! };
}

function boxSeries(now: number, cut4h: number, scale: number): { rows: (interval: string, q: KlineQuery) => KlineRow[] | null; live: number } {
  const bars = boxBars(now, cut4h);
  // prices scaled per market (6 significant digits); the volume follows the bar's range (a plausible histogram)
  const px = (v: number): string => (v * scale).toPrecision(6);
  const toRow = (b: NumBar, iv: number): KlineRow => {
    const v = (((b.h - b.l) / b.c) * 40_000).toFixed(3);
    return [b.t, px(b.o), px(b.h), px(b.l), px(b.c), v, b.t + iv - 1, (Number(v) * b.c * scale).toFixed(2), 1000, (Number(v) / 2).toFixed(3), ((Number(v) / 2) * b.c * scale).toFixed(2), "0"];
  };
  const by: Record<string, KlineRow[]> = { "4h": bars["4h"].map((b) => toRow(b, H4)), "1d": bars["1d"].map((b) => toRow(b, D)), "1w": bars["1w"].map((b) => toRow(b, W)) };
  return {
    live: Number(px(bars.live)),
    rows(interval, q) {
      const all = by[interval];
      return all ? selectKlines(all, q) : null;
    },
  };
}

export function boxFixture(now: number, cut4h = BOX_CUT_4H): BoxFixture {
  const btc = boxSeries(now, cut4h, 1);
  const bySymbol = new Map<string, ReturnType<typeof boxSeries>>([["BTCUSDT", btc]]);
  return {
    live: btc.live,
    rows(interval, q, symbol = "BTCUSDT") {
      let ser = bySymbol.get(symbol);
      if (!ser) {
        // another market: the same real bars at another moment and price level (deterministic per symbol)
        let h = 0x811c9dc5;
        for (let i = 0; i < symbol.length; i++) h = Math.imul(h ^ symbol.charCodeAt(i), 0x01000193) >>> 0;
        ser = boxSeries(now, cut4h - 30 - (h % 700), [0.031, 0.0021, 0.0074, 0.000029, 0.0000026, 0.00011, 0.00043, 0.0019][h % 8]!);
        bySymbol.set(symbol, ser);
      }
      return ser.rows(interval, q);
    },
  };
}
