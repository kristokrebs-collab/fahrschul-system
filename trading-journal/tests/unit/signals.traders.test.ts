/**
 * Whale–Retail-Delta ("Retail rot", user decision 2026-10-08, "Delta wie bei Hyblock"): top-trader ACCOUNTS long % −
 * ALL-accounts long % on the 5-min series. Long: delta < `deltaRed` (0) OR fell ≥ `deltaFall` (1 pp) over `deltaWindow`
 * (1h); short mirrored. Reading fields, the 12-point sparkline, thresholds, the scorecard item, the knife point, the
 * snapshot round trip and the config key.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_CFG, parseSignalSnapshot, sanitizeSignalCfg, sanitizeWhaleCfg, signalCfgKey, snapshotPart, traderReading, tradersPart, type RatioSample, type TfCheck, type TraderReading, type TraderSeries } from "@/domain/signals";
import { WHALE_DELTA_NOTE, deltaRuleText, deltaText, ppText, signedPp } from "@/domain/signals/copy";
import { WHALE_DELTA_PP_MAX, WHALE_DELTA_WINDOWS } from "@/domain/signals/config";
import { DELTA_SPARK_POINTS, deltaMet, deltaSeriesOf, deltaWindowMs, readingDelta, traderLookbackMs } from "@/domain/signals/traders";

const M5 = 300_000;
const H = 3_600_000;
const END = 1_760_000_100_000 - (1_760_000_100_000 % M5);
const CFG = sanitizeSignalCfg(DEFAULT_SIGNAL_CFG);

/** `n` 5-min points ending at END, value(i) for i = points before the newest (0 = newest). */
function pts(n: number, value: (i: number) => number, step = M5): RatioSample[] {
  return Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k;
    return { time: END - i * step, longPct: Math.round(value(i) * 1e4) / 1e4 };
  });
}

/** The e2e `whale-long` shape with the new retail script: top accounts 65,4 − 0,1·i, all accounts 69,1 − 0,3·i. */
const RED: TraderSeries = { position: pts(25, (i) => 66 - 0.1 * i), account: pts(25, (i) => 65.4 - 0.1 * i), retail: pts(25, (i) => 69.1 - 0.3 * i) };
const cfgW = (w: Record<string, unknown>) => sanitizeSignalCfg({ whale: w });
const zone = (z: "premium" | "discount") => ({ tf: "1h", zone: { zone: z, pos: z === "discount" ? 0.2 : 0.8, hi: 1, lo: 0, deep: false } }) as unknown as TfCheck;
const reading = (o: Partial<TraderReading>): TraderReading => ({ at: END, position: 50, account: 50, retail: 50, retailPrev: null, retailChg: null, period: "5m", step: M5, ...o });

describe("reading: delta, its change over the window, the sparkline", () => {
  it("delta = accounts − all accounts on the newest shared boundary; change over 1h; 12 points oldest first", () => {
    const r = traderReading(RED, CFG, END + 60_000)!;
    expect(r).toMatchObject({ at: END, account: 65.4, retail: 69.1, delta: -3.7, deltaPrev: -1.3, deltaChg: -2.4, deltaWindow: "1h" });
    expect(r.deltaSeries).toHaveLength(DELTA_SPARK_POINTS);
    expect(r.deltaSeries!.map((p) => p.delta)).toEqual([-1.5, -1.7, -1.9, -2.1, -2.3, -2.5, -2.7, -2.9, -3.1, -3.3, -3.5, -3.7]);
    expect(r.deltaSeries![0]!.time).toBe(END - 11 * M5);
    expect(r.deltaSeries!.at(-1)!.time).toBe(END);
    // the legacy comparison is still computed (all accounts rose 0,3 pp over 5m)
    expect(r.retailChg).toBeCloseTo(0.3, 9);
  });

  it("other windows (30m / 2h / 4h); a window the series does not reach → change null, the level stays", () => {
    expect(traderReading(RED, cfgW({ deltaWindow: "30m" }), END)).toMatchObject({ deltaWindow: "30m", deltaPrev: -2.5, deltaChg: -1.2 });
    expect(traderReading(RED, cfgW({ deltaWindow: "2h" }), END)).toMatchObject({ deltaWindow: "2h", deltaPrev: 1.1, deltaChg: -4.8 });
    expect(traderReading(RED, cfgW({ deltaWindow: "4h" }), END)).toMatchObject({ deltaWindow: "4h", delta: -3.7, deltaPrev: null, deltaChg: null });
    expect(deltaWindowMs({ deltaWindow: "4h" })).toBe(4 * H);
  });

  it("only points at or before the evaluation time; a missing all-accounts point is matched within one step; stale → no delta", () => {
    expect(traderReading(RED, CFG, END - 1)).toMatchObject({ delta: -3.5, deltaPrev: -1.1 });
    // all-accounts series one minute late on every boundary: still paired (tolerance one step)
    const late: TraderSeries = { ...RED, retail: RED.retail.map((p) => ({ ...p, time: p.time - 60_000 })) };
    expect(deltaSeriesOf(late, END)).toHaveLength(25);
    // no all-accounts data → no delta (accounts alone still read)
    const noRetail = traderReading({ ...RED, retail: [] }, CFG, END)!;
    expect(noRetail).toMatchObject({ account: 65.4, delta: null, deltaChg: null, deltaSeries: [] });
    // all three stale → no reading at all
    expect(traderReading(RED, CFG, END + 3 * M5 + 1)).toBeNull();
    // duplicate boundary keeps the later entry
    const dup = deltaSeriesOf({ account: [...RED.account, { time: END, longPct: 70 }], retail: RED.retail }, END);
    expect(dup.at(-1)).toEqual({ time: END, delta: 0.9 });
    expect(dup.filter((p) => p.time === END)).toHaveLength(1);
  });

  it("no float noise at a threshold; hand-built readings fall back to the definition", () => {
    const s: TraderSeries = { position: [], account: pts(13, (i) => (i === 0 ? 65.6 : 64.6)), retail: pts(13, () => 64.6) };
    const r = traderReading(s, CFG, END)!;
    expect(r.delta).toBe(1);
    expect(r.deltaChg).toBe(1);
    expect(readingDelta({ account: 65.6, retail: 69.1 })).toBe(-3.5);
    expect(readingDelta({ account: 65.6, retail: null })).toBeNull();
    expect(readingDelta({ account: 65.6, retail: 69.1, delta: null })).toBeNull();
    expect(readingDelta(null)).toBeNull();
  });

  it("history the market side needs for a back-dated reading", () => {
    expect(traderLookbackMs(CFG)).toBe(H); // 1h window = 12 sparkline points
    expect(traderLookbackMs(cfgW({ deltaWindow: "30m" }))).toBe(H);
    expect(traderLookbackMs(cfgW({ deltaWindow: "4h" }))).toBe(4 * H);
  });
});

describe("rule: Retail rot (long) / Retail grün (short)", () => {
  const w = { deltaRed: 0, deltaFall: 1 };
  it("long: negative OR fell ≥ 1 pp; short mirrored: positive OR rose ≥ 1 pp; nothing → keine Daten", () => {
    expect(deltaMet("long", -0.1, 0.5, w)).toBe(true); // negative
    expect(deltaMet("long", 2, -1, w)).toBe(true); // positive but falling 1 pp
    expect(deltaMet("long", 2, -0.9, w)).toBe(false); // falling, not enough
    expect(deltaMet("long", 0, 0, w)).toBe(false); // exactly 0 is not "below"
    expect(deltaMet("long", 3, null, w)).toBe(false);
    expect(deltaMet("long", null, -1.5, w)).toBe(true);
    expect(deltaMet("short", 0.1, -0.5, w)).toBe(true);
    expect(deltaMet("short", -2, 1, w)).toBe(true);
    expect(deltaMet("short", -2, 0.9, w)).toBe(false);
    expect(deltaMet("short", 0, 0, w)).toBe(false);
    expect(deltaMet("long", null, null, w)).toBeNull();
    expect(deltaMet("short", null, null, w)).toBeNull();
  });

  it("thresholds: deltaRed mirrored for short, deltaFall 0 = any fall", () => {
    expect(deltaMet("long", -1.5, 0, { deltaRed: -2, deltaFall: 1 })).toBe(false);
    expect(deltaMet("long", -2.5, 0, { deltaRed: -2, deltaFall: 1 })).toBe(true);
    expect(deltaMet("short", 1.5, 0, { deltaRed: -2, deltaFall: 1 })).toBe(false);
    expect(deltaMet("short", 2.5, 0, { deltaRed: -2, deltaFall: 1 })).toBe(true);
    expect(deltaMet("long", 5, -0.1, { deltaRed: 0, deltaFall: 0 })).toBe(true);
    expect(deltaMet("long", 5, 0, { deltaRed: 0, deltaFall: 0 })).toBe(false);
    expect(deltaMet("long", 5, -2.9, { deltaRed: 0, deltaFall: 3 })).toBe(false);
  });

  it("the scorecard item: label, value like Hyblock, raw = the delta; short mirrored", () => {
    const long = tradersPart("long", traderReading(RED, CFG, END), zone("discount"), CFG)!;
    const it = long.items.find((i) => i.id === "retail")!;
    expect(it).toEqual({ id: "retail", label: "Whale–Retail-Delta rot · < 0 oder fällt ≥ 1 pp (1h)", value: "−3,7 pp · 1h −2,4", raw: -3.7, met: true });
    expect(long).toMatchObject({ met: 4, ok: true, label: "Top-Trader long · Retail rot" });
    const short = tradersPart("short", traderReading(RED, CFG, END), zone("premium"), CFG)!;
    expect(short.items.find((i) => i.id === "retail")).toMatchObject({ label: "Whale–Retail-Delta grün · > 0 oder steigt ≥ 1 pp (1h)", met: false });
    // the mirror image (100 − x): positive and rising → short met, long not
    const mirror: TraderSeries = { position: RED.position.map((p) => ({ ...p, longPct: 100 - p.longPct })), account: RED.account.map((p) => ({ ...p, longPct: 100 - p.longPct })), retail: RED.retail.map((p) => ({ ...p, longPct: 100 - p.longPct })) };
    const m = traderReading(mirror, CFG, END)!;
    expect(m).toMatchObject({ delta: 3.7, deltaChg: 2.4 });
    expect(tradersPart("short", m, zone("premium"), CFG)!).toMatchObject({ met: 4, ok: true });
    expect(tradersPart("long", m, zone("premium"), CFG)!.items.find((i) => i.id === "retail")!.met).toBe(false);
    // thresholds from the settings reach the label and the rule
    const strict = cfgW({ deltaRed: -5, deltaFall: 3, deltaWindow: "2h" });
    const p = tradersPart("long", traderReading(RED, strict, END), zone("discount"), strict)!;
    expect(p.items.find((i) => i.id === "retail")).toMatchObject({ label: "Whale–Retail-Delta rot · < −5 oder fällt ≥ 3 pp (2h)", value: "−3,7 pp · 2h −4,8", met: true });
    const strict30 = cfgW({ deltaRed: -5, deltaFall: 3, deltaWindow: "30m" });
    expect(tradersPart("long", traderReading(RED, strict30, END), zone("discount"), strict30)!.items.find((i) => i.id === "retail")!.met).toBe(false);
  });

  it("no data: keine Daten (never a fail); a hand-built reading without the fields uses accounts − all accounts", () => {
    const none = tradersPart("long", reading({ account: null, retail: null }), zone("discount"), CFG)!;
    expect(none.items.find((i) => i.id === "retail")).toMatchObject({ value: "keine Daten", raw: null, met: null });
    const hand = tradersPart("long", reading({ account: 65.6, retail: 69.1 }), zone("discount"), CFG)!;
    expect(hand.items.find((i) => i.id === "retail")).toMatchObject({ value: "−3,5 pp", raw: -3.5, met: true });
  });

});

describe("texts", () => {
  it("values like Hyblock: −3,5 pp · 1h −2,1; signed with U+2212 and ±0,0", () => {
    expect(deltaText(-3.5, -2.1, "1h")).toBe("−3,5 pp · 1h −2,1");
    expect(deltaText(2.04, 0.05, "30m")).toBe("+2,0 pp · 30m +0,1");
    expect(deltaText(-3.5, null, "1h")).toBe("−3,5 pp");
    expect(deltaText(null, -1.2, "1h")).toBe("1h −1,2 pp");
    expect(deltaText(null, null, "1h")).toBe("keine Daten");
    expect(signedPp(-0.04)).toBe("±0,0");
    expect(signedPp(-0.85)).toBe("−0,9");
    expect(ppText(1.25)).toBe("+1,3 pp");
    expect(deltaRuleText("long", { deltaRed: 0, deltaFall: 1, deltaWindow: "1h" })).toBe("< 0 oder fällt ≥ 1 pp (1h)");
    expect(deltaRuleText("short", { deltaRed: 0, deltaFall: 1, deltaWindow: "1h" })).toBe("> 0 oder steigt ≥ 1 pp (1h)");
    expect(deltaRuleText("short", { deltaRed: 1.5, deltaFall: 0.5, deltaWindow: "4h" })).toBe("> −1,5 oder steigt ≥ 0,5 pp (4h)");
    expect(WHALE_DELTA_NOTE).toContain("Binance-Kohorten, nicht Hyblocks eigene");
  });
});

describe("snapshot and config", () => {
  it("the stored traders part carries delta, change and window (additive); parse round trip; malformed values", () => {
    const part = tradersPart("long", traderReading(RED, CFG, END), zone("discount"), CFG)!;
    const stored = snapshotPart(part);
    expect(stored).toMatchObject({ id: "traders", met: 4, period: "5m", delta: -3.7, deltaChg: -2.4, deltaWindow: "1h" });
    expect(stored.items.find((i) => i.id === "retail")).toEqual({ id: "retail", met: true, raw: -3.7 });
    const base = { at: new Date(END).toISOString(), side: "long", score: 80, strength: 3, tiers: 2, label: "Long", valid: true, rsiOk: true, zoneOk: true, reasons: [], tfs: [] };
    const round = parseSignalSnapshot(JSON.parse(JSON.stringify({ ...base, parts: [stored] })))!;
    expect(round.parts![0]).toMatchObject({ delta: -3.7, deltaChg: -2.4, deltaWindow: "1h" });
    // older snapshots (no delta fields) stay as they were; malformed values → null / dropped; unknown keys kept
    const older: Record<string, unknown> = { ...stored };
    for (const k of ["delta", "deltaChg", "deltaWindow"]) delete older[k];
    const old = parseSignalSnapshot(JSON.parse(JSON.stringify({ ...base, parts: [older] })))!;
    expect(old.parts![0]).not.toHaveProperty("delta");
    expect(old.parts![0]).not.toHaveProperty("deltaChg");
    expect(old.parts![0]).toMatchObject({ id: "traders", met: 4, period: "5m" });
    const bad = parseSignalSnapshot({ ...base, parts: [{ ...stored, delta: "x", deltaChg: "1.5", deltaWindow: 7, extra: 1 }] })!;
    expect(bad.parts![0]).toMatchObject({ delta: null, deltaChg: 1.5, extra: 1 });
    expect("deltaWindow" in bad.parts![0]!).toBe(false);
    // no reading → no delta fields
    expect(snapshotPart(tradersPart("long", null, zone("discount"), CFG)!)).not.toHaveProperty("delta");
  });

  it("sanitised and clamped; part of the evaluation key", () => {
    expect(sanitizeWhaleCfg({})).toMatchObject({ deltaRed: 0, deltaFall: 1, deltaWindow: "1h" });
    expect(sanitizeWhaleCfg({ deltaRed: "-2,5".replace(",", "."), deltaFall: "3", deltaWindow: "4h" })).toMatchObject({ deltaRed: -2.5, deltaFall: 3, deltaWindow: "4h" });
    expect(sanitizeWhaleCfg({ deltaRed: 99, deltaFall: -1, deltaWindow: "45m" })).toMatchObject({ deltaRed: WHALE_DELTA_PP_MAX, deltaFall: 0, deltaWindow: "1h" });
    expect(sanitizeWhaleCfg({ deltaRed: -99, deltaFall: 99 })).toMatchObject({ deltaRed: -WHALE_DELTA_PP_MAX, deltaFall: WHALE_DELTA_PP_MAX });
    expect(sanitizeWhaleCfg({ deltaRed: "x", deltaFall: null })).toMatchObject({ deltaRed: 0, deltaFall: 1 });
    expect(WHALE_DELTA_WINDOWS).toEqual(["30m", "1h", "2h", "4h"]);
    const base = signalCfgKey(CFG);
    for (const w of [{ deltaRed: -1 }, { deltaFall: 2 }, { deltaWindow: "30m" }]) expect(signalCfgKey(cfgW(w)), JSON.stringify(w)).not.toBe(base);
    expect(signalCfgKey(cfgW({ deltaRed: 0, deltaFall: 1, deltaWindow: "1h" }))).toBe(base);
  });
});
