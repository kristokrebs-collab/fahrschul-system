/**
 * Calibration against the user's TradingView screenshots (BITSTAMP:BTCUSD, 2026-10-07 ~19:07 UTC, MCB {WeloTrades}
 * "close 9 1 21 1 60 53 2 -60 -53 2 28 …", RSI 14 close with its MA 14, LuxAlgo SMC Premium/Discount).
 * Fixture: `fixtures/tv-bitstamp-btcusd.json` (the last 500 × 30m / 800 × 1h bars, fetched through the TradingView
 * connector; the running 19:00 bar = the screenshot legend). Every Bottom/Top label, the cross dots of the 30m window
 * Oct 1 12:30 – Oct 2 20:30, the RSI / RSI-MA / wt1 legend values and the zone boxes below are read off the screenshots.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_CFG, checkTf, luxZone, mcbSeries, rsi, sma, waveTrend, type Bar } from "@/domain/signals";
import tv from "./fixtures/tv-bitstamp-btcusd.json";

interface TfFixture {
  start: number;
  step: number;
  h: number[];
  l: number[];
  c: number[];
}

function bars(tf: "30m" | "1h"): Bar[] {
  const f = (tv as { tf: Record<string, TfFixture> }).tf[tf]!;
  return f.c.map((c, i) => ({ t: f.start + i * f.step, o: i ? f.c[i - 1]! : c, h: f.h[i]!, l: f.l[i]!, c }));
}

const at = (iso: string): number => Date.parse(iso) / 1000;
const cfg = DEFAULT_SIGNAL_CFG;

/** Bottom / Top labels of the MCB pane (bar open times, UTC). */
function labels(b: Bar[], from: string): string[] {
  const f = at(from);
  return mcbSeries(b, cfg)
    .filter((m) => (m.kind === "bottom" || m.kind === "top") && m.t >= f)
    .map((m) => `${new Date(m.t * 1000).toISOString().slice(5, 16)} ${m.kind}`);
}

describe("TradingView calibration (Bitstamp BTCUSD screenshots, 2026-10-07)", () => {
  it("MCB defaults are the WeloTrades inputs: close, channel 9, average 21, signal SMA 2, levels ±53/±60, reversal range 28", () => {
    expect(cfg).toMatchObject({ wtSource: "close", wtChannel: 9, wtAverage: 21, wtSignal: 2, wtOb: 53, wtObStrong: 60, wtOs: -53, wtOsStrong: -60, revRange: 28, rsiLen: 14, rsiMaLen: 14 });
  });

  it("1h: RSI 34.95 / MA 29.61 and wt1 −49 at the last bar (legend)", () => {
    const b = bars("1h");
    const r = rsi(b.map((x) => x.c), 14);
    expect(r.at(-1)!).toBeCloseTo(34.95, 2);
    expect(sma(r, 14).at(-1)!).toBeCloseTo(29.61, 2);
    expect(Math.round(waveTrend(b, cfg).wt1.at(-1)!)).toBe(-49);
  });

  it("30m: RSI 42.86 / MA 30.53 and wt1 −28 at the last bar (legend; the running bar moved by a few dollars)", () => {
    const b = bars("30m");
    const r = rsi(b.map((x) => x.c), 14);
    expect(Math.abs(r.at(-1)! - 42.86)).toBeLessThan(0.05);
    expect(sma(r, 14).at(-1)!).toBeCloseTo(30.53, 2);
    expect(Math.round(waveTrend(b, cfg).wt1.at(-1)!)).toBe(-28);
  });

  it("1h: every Bottom/Top label of the visible window Sep 8 – Oct 4", () => {
    const got = labels(bars("1h"), "2026-09-08T00:00Z").filter((s) => s < "10-04");
    expect(got).toEqual([
      "09-08T14:00 bottom",
      "09-09T09:00 top",
      "09-09T23:00 bottom",
      "09-11T00:00 bottom",
      "09-14T19:00 top",
      "09-15T15:00 bottom",
      "09-17T05:00 top",
      "09-17T09:00 top",
      "09-18T11:00 top",
      "09-20T09:00 bottom",
      "09-21T01:00 top",
      "09-23T05:00 top",
      "09-25T02:00 top",
      "09-28T10:00 bottom",
      "09-30T07:00 bottom",
    ]);
  });

  it("30m: every Bottom/Top label of the visible window Sep 29 – Oct 7", () => {
    expect(labels(bars("30m"), "2026-09-28T23:00Z")).toEqual([
      "09-29T08:30 top",
      "09-29T13:30 top",
      "09-30T07:00 bottom",
      "10-04T10:30 top",
      "10-04T23:30 top",
      "10-06T14:00 top",
      "10-06T15:00 top",
      "10-07T00:30 bottom",
    ]);
  });

  it("30m: the red/green cross dots Oct 1 12:30 – Oct 2 20:30 (wt2 = SMA 2 of wt1; 3 or 4 would shift them)", () => {
    const b = bars("30m");
    const crosses = (signal: number): string[] => {
      const { wt1, wt2 } = waveTrend(b, { ...cfg, wtSignal: signal });
      const out: string[] = [];
      for (let i = 1; i < b.length; i++) {
        if (b[i]!.t < at("2026-10-01T12:00Z") || b[i]!.t > at("2026-10-02T21:00Z")) continue;
        if (wt1[i - 1]! <= wt2[i - 1]! && wt1[i]! > wt2[i]!) out.push(`${new Date(b[i]!.t * 1000).toISOString().slice(8, 16)} G`);
        if (wt1[i - 1]! >= wt2[i - 1]! && wt1[i]! < wt2[i]!) out.push(`${new Date(b[i]!.t * 1000).toISOString().slice(8, 16)} R`);
      }
      return out;
    };
    const seen = ["01T12:30 R", "01T13:30 G", "01T19:00 R", "01T20:00 G", "01T20:30 R", "01T22:00 G", "02T00:00 R", "02T01:30 G", "02T05:00 R", "02T08:00 G", "02T13:00 R", "02T20:30 G"];
    const got = crosses(2);
    for (const s of seen) expect(got).toContain(s);
    expect(crosses(3)).not.toContain("01T20:00 G");
    expect(crosses(4)).not.toContain("02T05:00 R");
  });

  it("LuxAlgo zones at the last 30m bar: Discount 82 734–82 931, Equilibrium 84 607–84 804, Premium 86 480–86 677 (boxes ±20 $)", () => {
    const z = luxZone(bars("30m").slice(-500), cfg.swingLookback)!;
    const r = z.hi - z.lo;
    expect(z.lux).toBe(true);
    expect(z.zone).toBe("discount");
    expect(Math.abs(z.lo - 82_734)).toBeLessThan(20);
    expect(Math.abs(z.lo + 0.05 * r - 82_914)).toBeLessThan(25);
    expect(Math.abs(z.lo + 0.475 * r - 84_594)).toBeLessThan(25);
    expect(Math.abs(z.lo + 0.525 * r - 84_783)).toBeLessThan(25);
    expect(Math.abs(z.hi - 0.05 * r - 86_445)).toBeLessThan(40);
  });

  it("the check at the last bar: 1h and 30m in Discount, 30m RSI not yet near oversold, 1h small bull cross", () => {
    const c30 = checkTf("30m", bars("30m"), cfg)!;
    const c1h = checkTf("1h", bars("1h"), cfg)!;
    expect(c30.zone.zone).toBe("discount");
    expect(c1h.zone.zone).toBe("discount");
    expect(c30.rsiLong).toBe(false); // 42.8 > 40
    expect(c1h.rsiLong).toBe(true); // 34.9 ≤ 40
    // 1h: the 15:00 Bottom is outside the 3-bar look-back (17–19 h); the running bar is a small green cross (wt1 −48.7 > wt2 −50.1)
    expect(c1h.wt.long?.kind).toBe("bull");
    expect(c1h.longSignal).toBe(true);
  });
});
