/**
 * The e2e market of the Box-zu-Box specs (`tests/e2e/mocks/boxFixture.ts`, `mockMarket(…, { boxes: true })`): REAL
 * BTCUSDT bars shifted to "now" – one consistent market on 4h / 1D / 1W at every hour of the day, with Binance's
 * `/fapi/v1/klines` window semantics (startTime / endTime / limit).
 */
import { describe, expect, it } from "vitest";
import btc4h from "./fixtures/binance-btcusdt-4h.json";
import { BOX_CUT_4H, boxBars, boxFixture, selectKlines, type KlineRow } from "../e2e/mocks/boxFixture";

const H4 = 4 * 3_600_000;
const D = 24 * 3_600_000;
const W = 7 * D;
const FIX = (btc4h as { bars: number[][] }).bars;
/** a Monday 2026-10-12, every hour of the day (all six 4h slots, both sides of a slot boundary) */
const MONDAY = Date.UTC(2026, 9, 12);
const NOWS = Array.from({ length: 24 }, (_, h) => MONDAY + h * 3_600_000 + 17 * 60_000);

const gapFree = (ts: readonly number[], step: number) => ts.every((t, i) => i === 0 || t - ts[i - 1]! === step);

describe("box fixture: one market on 4h / 1D / 1W", () => {
  it.each(NOWS)("now = %i: the cut bar forms now, the days are the 4h bars' days, the weeks the days' weeks", (now) => {
    const m = boxBars(now);
    const h4 = m["4h"];
    const last = h4.at(-1)!;
    // 4h: real bars, gap-free, the cut bar forming now
    expect(gapFree(h4.map((b) => b.t), H4)).toBe(true);
    expect(last.t).toBeLessThanOrEqual(now);
    expect(last.t + H4).toBeGreaterThan(now);
    expect([last.o, last.h, last.l, last.c]).toEqual(FIX[BOX_CUT_4H]!.slice(1, 5));
    expect(m.live).toBe(last.c);
    // 1D: on the 00:00 UTC grid, gap-free, the forming day = today
    const days = m["1d"];
    expect(days.every((b) => b.t % D === 0)).toBe(true);
    expect(gapFree(days.map((b) => b.t), D)).toBe(true);
    expect(days.at(-1)!.t).toBe(Math.floor(now / D) * D);
    expect(days.at(-1)!.c).toBe(m.live);
    // every day the 4h bars cover is their aggregate (what the 4h chart shows)
    let checked = 0;
    for (const d of days) {
      const part = h4.filter((b) => b.t >= d.t && b.t < d.t + D);
      if (part.length === 0 || part[0]!.t !== d.t) continue;
      expect(d).toEqual({ t: d.t, o: part[0]!.o, h: Math.max(...part.map((b) => b.h)), l: Math.min(...part.map((b) => b.l)), c: part.at(-1)!.c });
      checked++;
    }
    expect(checked).toBeGreaterThan(240);
    expect(days.length).toBeGreaterThan(900);
    // 1W: Monday 00:00 UTC, gap-free, the forming week ends with the live price
    const weeks = m["1w"];
    expect(weeks.every((b) => new Date(b.t).getUTCDay() === 1 && b.t % D === 0)).toBe(true);
    expect(gapFree(weeks.map((b) => b.t), W)).toBe(true);
    expect(weeks.at(-1)!.c).toBe(m.live);
  });

  it("the served rows: strings like Binance, close time = open + interval − 1, the live price is the forming close", () => {
    const now = NOWS[9]!;
    const f = boxFixture(now);
    const rows = f.rows("4h", {})!;
    expect(rows).toHaveLength(500);
    const r = rows.at(-1)!;
    expect(r[6]).toBe(r[0] + H4 - 1);
    expect(Number(r[4])).toBe(f.live);
    expect(typeof r[1]).toBe("string");
    expect(f.rows("1m", {})).toBeNull();
    // the scanner's other markets: real bars at another moment and price level, deterministic
    const eth = f.rows("4h", { limit: 3 }, "ETHUSDT")!;
    expect(eth).toEqual(boxFixture(now).rows("4h", { limit: 3 }, "ETHUSDT"));
    expect(Number(eth[0]![4])).not.toBe(Number(rows[0]![4]));
  });
});

describe("Binance /fapi/v1/klines window semantics", () => {
  const all = Array.from({ length: 3000 }, (_, i) => [1_000 + i * 10] as unknown as KlineRow);
  const times = (rows: KlineRow[]) => rows.map((r) => r[0]);

  it("no window: the newest `limit` (default 500, at most 1500)", () => {
    expect(times(selectKlines(all, {}))).toEqual(times(all.slice(-500)));
    expect(selectKlines(all, { limit: 5000 })).toHaveLength(1500);
    expect(selectKlines(all, { limit: 0 })).toHaveLength(1);
  });

  it("endTime only: the newest `limit` bars that open at or before it", () => {
    expect(times(selectKlines(all, { endTime: 1_000 + 99 * 10, limit: 3 }))).toEqual([1_970, 1_980, 1_990]);
  });

  it("startTime: the FIRST `limit` bars from it (ascending), bounded by endTime", () => {
    expect(times(selectKlines(all, { startTime: 1_000 + 10 * 10, limit: 3 }))).toEqual([1_100, 1_110, 1_120]);
    expect(times(selectKlines(all, { startTime: 1_100, endTime: 1_115, limit: 10 }))).toEqual([1_100, 1_110]);
  });
});
