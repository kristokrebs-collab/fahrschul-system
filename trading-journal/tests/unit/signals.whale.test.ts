/** "Top-Trader kaufen · Retail rot": the condition on synthetic ratio series, grading, config, snapshots, draft strings. */
import { describe, expect, it } from "vitest";
import {
  applyWhale,
  bestVerdict,
  computeSignals,
  DEFAULT_SIGNAL_CFG,
  parseSignalSnapshot,
  ppText,
  sanitizeSignalCfg,
  sanitizeWhaleCfg,
  signalCfgKey,
  signalInfo,
  toSignalSnapshot,
  whaleCfgOf,
  whaleFromDraft,
  whalePeriod,
  whaleReading,
  whaleToDraft,
  whaleVerdict,
  type RatioSample,
  type SignalCfg,
  type Signals,
  type TfCheck,
  type WhaleSeries,
  type WtEvent,
  type ZoneInfo,
} from "@/domain/signals";
import { ladderBars, synthBars } from "./signals.fixtures";

const H = 3_600_000;
const M30 = 1_800_000;
const T0 = Date.UTC(2026, 9, 7, 0, 0);

/** Series from per-period values (oldest first), one snapshot per `step`. */
function series(top: number[], retail: number[], step = M30, t0 = T0): WhaleSeries {
  const pts = (v: number[]): RatioSample[] => v.map((longPct, i) => ({ time: t0 + i * step, longPct }));
  return { top: pts(top), retail: pts(retail) };
}
const endOf = (n: number, step = M30, t0 = T0): number => t0 + (n - 1) * step + 60_000;

const CFG: SignalCfg = sanitizeSignalCfg({ whale: { periods: ["30m", "1h"], minRun: 2, weight: 10 } });

describe("whalePeriod: runs over closed periods", () => {
  it("long run = periods with top ↑ and retail ↓ counted from the newest; changes over the last minRun periods", () => {
    // top 60 → 60.5 → 61 → 62 (↑↑↑ but the first step is ↑ too), retail 50 → 51 → 50 → 49 (↑ ↓ ↓)
    const s = series([60, 60.5, 61, 62], [50, 51, 50, 49]);
    const r = whalePeriod("30m", s, endOf(4), 2)!;
    expect(r).toMatchObject({ period: "30m", top: 62, retail: 49, runLong: 2, runShort: 0 });
    expect(r.topChg).toBeCloseTo(1.5, 10);
    expect(r.retailChg).toBeCloseTo(-2, 10);
  });

  it("short run is the mirror (top ↓, retail ↑); a flat step ends both runs", () => {
    const s = series([62, 61, 60, 60, 59, 58], [48, 49, 50, 50, 51, 52]);
    const r = whalePeriod("30m", s, endOf(6), 2)!;
    expect(r).toMatchObject({ runLong: 0, runShort: 2 });
    const flat = whalePeriod("30m", series([60, 61, 61], [50, 49, 49]), endOf(3), 2)!;
    expect(flat).toMatchObject({ runLong: 0, runShort: 0 });
  });

  it("only snapshots at or before the time count; a gap in the series stops the run", () => {
    const s = series([60, 61, 62, 63, 64], [50, 49, 48, 47, 46]);
    expect(whalePeriod("30m", s, endOf(3), 2)).toMatchObject({ top: 62, runLong: 2 });
    const gap: WhaleSeries = { top: s.top.filter((_, i) => i !== 2), retail: s.retail.filter((_, i) => i !== 2) };
    expect(whalePeriod("30m", gap, endOf(5), 2)).toMatchObject({ runLong: 1 }); // 3→4 contiguous, 1→3 is a gap
    const gap2: WhaleSeries = { top: s.top.filter((_, i) => i !== 3), retail: s.retail.filter((_, i) => i !== 3) };
    expect(whalePeriod("30m", gap2, endOf(5), 2)).toMatchObject({ runLong: 0 });
  });

  it("joins the two series by time and needs two common snapshots; stale data → null", () => {
    const s = series([60, 61, 62], [50, 49, 48]);
    expect(whalePeriod("30m", { top: s.top, retail: s.retail.slice(2) }, endOf(3), 2)).toBeNull();
    expect(whalePeriod("30m", s, endOf(3) + 2 * M30 + 4 * 60_000, 2)).not.toBeNull(); // within 2 periods + 5 min
    expect(whalePeriod("30m", s, endOf(3) + 2 * M30 + 6 * 60_000, 2)).toBeNull();
    expect(whalePeriod("30m", null, endOf(3), 2)).toBeNull();
    expect(whalePeriod("7m", s, endOf(3), 2)).toBeNull();
  });
});

describe("whaleReading / whaleVerdict", () => {
  it("reads every configured period; periods without data are listed as missing; off → null", () => {
    const r = whaleReading({ "30m": series([60, 61, 62], [50, 49, 48]) }, CFG, endOf(3))!;
    expect(r.periods.map((p) => p.period)).toEqual(["30m"]);
    expect(r.missing).toEqual(["1h"]);
    expect(whaleReading({}, CFG, endOf(3))).toBeNull();
    expect(whaleReading({ "30m": series([60, 61, 62], [50, 49, 48]) }, sanitizeSignalCfg({ whale: { on: false } }), endOf(3))).toBeNull();
  });

  it("holds when ANY period has a run ≥ minRun; shows the longest run (smaller period on a tie)", () => {
    const now = endOf(4, H);
    const r = whaleReading({ "30m": series([60, 61, 60, 61, 62, 63, 64, 63], [50, 49, 50, 49, 48, 47, 46, 47]), "1h": series([60, 61, 62, 63], [50, 49, 48, 47], H) }, CFG, now)!;
    const v = whaleVerdict("long", r, whaleCfgOf(CFG));
    // 30m: 7 snapshots up to 03:00 → 4 fitting steps; 1h: 3 → the longer 30m run is shown
    expect(v).toMatchObject({ ok: true, run: 4, need: 2, period: "30m", points: 10 });
    const tie = whaleReading({ "30m": series([60, 61, 62, 63, 64, 65, 66], [50, 51, 52, 53, 52, 51, 50]), "1h": series([60, 61, 62, 63], [50, 49, 48, 47], H) }, CFG, now)!;
    expect(whaleVerdict("long", tie, whaleCfgOf(CFG))).toMatchObject({ run: 3, period: "30m" });
    expect(whaleVerdict("short", r, whaleCfgOf(CFG))).toMatchObject({ ok: false, points: 0 });
  });
});

// ------------------------------------------------------------------ grading

function zone(z: Partial<ZoneInfo> = {}): ZoneInfo {
  return { hi: 86_000, lo: 80_000, pos: 0.2, zone: "discount", deep: false, eq: 83_000, bias: 0, brk: null, lux: true, ...z };
}
function check(tf: string, long: WtEvent | null, rsi = 35): TfCheck {
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi,
    rsiMa: rsi,
    wt: { kind: long?.kind ?? null, barsAgo: long?.barsAgo ?? null, long, short: null, wt1: -60, wt2: -58 },
    zone: zone(),
    longSignal: !!long,
    shortSignal: false,
    rsiLong: rsi <= 40,
    rsiShort: rsi >= 60,
  };
}
function sigOf(checks: TfCheck[]): Signals {
  const z = checks.find((c) => c.tf === "1h") ?? null;
  return { ...bestVerdict(checks, DEFAULT_SIGNAL_CFG, z), checks, zone: z, at: T0 };
}
const LONG2 = sigOf([check("30m", { kind: "bottom", barsAgo: 0 }), check("45m", { kind: "bull", barsAgo: 1 }), check("1h", null), check("4h", null)]);
const holds = (cfg = CFG) => whaleReading({ "30m": series([60, 61, 62], [50, 49, 48]) }, cfg, endOf(3))!;
const fails = (cfg = CFG) => whaleReading({ "30m": series([60, 59, 58], [50, 51, 52]) }, cfg, endOf(3))!;

describe("applyWhale: grading", () => {
  it("holds + weight → score + weight and a valid entry one strength higher (label follows)", () => {
    expect(LONG2.long).toMatchObject({ valid: true, strength: 2, label: "Starker Long-Einstieg" });
    const g = applyWhale(LONG2, holds(), CFG);
    expect(g.long.score).toBe(Math.min(100, LONG2.long.score + 10));
    expect(g.long).toMatchObject({ strength: 3, label: "Sehr starker Long-Einstieg", whale: { ok: true, points: 10 } });
    expect(g.long.reasons.at(-1)).toEqual({ text: "Top-Trader kaufen · Retail rot (2× 30m/1h)", ok: true });
    expect(g.whale?.periods).toHaveLength(1);
    // the short side does not hold → unchanged grade, but carries the reading
    expect(g.short).toMatchObject({ score: LONG2.short.score, strength: 0, whale: { ok: false, points: 0 } });
    expect(g.short.reasons.at(-1)).toEqual({ text: "Top-Trader verkaufen · Retail grün (2× 30m/1h)", ok: false });
    expect(g.best.side).toBe("long");
  });

  it("score is capped at 100, strength at 4; an invalid entry gets points but no strength", () => {
    const heavy = sanitizeSignalCfg({ whale: { weight: 30 } });
    const max = { ...LONG2, long: { ...LONG2.long, score: 95, strength: 4 as const } };
    expect(applyWhale(max, holds(heavy), heavy).long).toMatchObject({ score: 100, strength: 4 });
    const invalid = sigOf([check("30m", { kind: "bottom", barsAgo: 0 }), check("45m", null), check("1h", null), check("4h", null)]);
    expect(invalid.long.valid).toBe(false);
    const g = applyWhale(invalid, holds(), CFG);
    expect(g.long).toMatchObject({ valid: false, strength: 0, score: invalid.long.score + 10, label: invalid.long.label });
  });

  it("weight 0 = shown and stored only; not held = no change in score / strength", () => {
    const info = sanitizeSignalCfg({ whale: { weight: 0 } });
    const g = applyWhale(LONG2, holds(info), info);
    expect(g.long).toMatchObject({ score: LONG2.long.score, strength: 2, label: LONG2.long.label, whale: { ok: true, points: 0 } });
    const f = applyWhale(LONG2, fails(), CFG);
    expect(f.long).toMatchObject({ score: LONG2.long.score, strength: 2, whale: { ok: false } });
  });

  it("without a reading (no data, switched off) the evaluation comes back unchanged — the other journal's grade", () => {
    expect(applyWhale(LONG2, null, CFG)).toBe(LONG2);
    expect(applyWhale(LONG2, holds(), sanitizeSignalCfg({ whale: { on: false } }))).toBe(LONG2);
    const b15 = synthBars(2600, 42);
    const sig = computeSignals(ladderBars(b15), DEFAULT_SIGNAL_CFG, (b15.at(-1)!.t + 900) * 1000)!;
    expect(applyWhale(sig, null, DEFAULT_SIGNAL_CFG)).toEqual(sig);
  });
});

describe("config", () => {
  it("defaults on, 30m + 1h, 2 periods, weight 10; DEFAULT_SIGNAL_CFG stays the other journal's (no whale key)", () => {
    expect("whale" in DEFAULT_SIGNAL_CFG).toBe(false);
    expect(whaleCfgOf(DEFAULT_SIGNAL_CFG)).toEqual({ on: true, periods: ["30m", "1h"], minRun: 2, weight: 10 });
    expect(sanitizeSignalCfg({}).whale).toEqual({ on: true, periods: ["30m", "1h"], minRun: 2, weight: 10 });
  });

  it("sanitises: periods filtered / sorted / unique, minRun 1…6, weight 0…30, unknown keys kept", () => {
    expect(sanitizeWhaleCfg({ on: false, periods: ["1h", "30m", "1h", "45m", 7], minRun: "9", weight: -3, x: 1 })).toEqual({ on: false, periods: ["30m", "1h"], minRun: 6, weight: 0, x: 1 });
    expect(sanitizeWhaleCfg({ periods: [], minRun: 0, weight: 99 })).toMatchObject({ periods: ["30m", "1h"], minRun: 1, weight: 30 });
    expect(sanitizeWhaleCfg("nope")).toMatchObject({ on: true });
  });

  it("the whale settings are part of the evaluation key", () => {
    expect(signalCfgKey(sanitizeSignalCfg({}))).toBe(signalCfgKey(DEFAULT_SIGNAL_CFG));
    expect(signalCfgKey(sanitizeSignalCfg({ whale: { weight: 5 } }))).not.toBe(signalCfgKey(DEFAULT_SIGNAL_CFG));
    expect(signalCfgKey(sanitizeSignalCfg({ whale: { on: false } }))).not.toBe(signalCfgKey(DEFAULT_SIGNAL_CFG));
  });

  it("the info panel documents the grading", () => {
    const rows = signalInfo(CFG).rows;
    expect(rows.find((r) => r.k === "Top-Trader · Retail")?.v).toContain("+10 Score, gültiger Einstieg +1 Stärke");
    expect(signalInfo(sanitizeSignalCfg({ whale: { on: false } })).rows.some((r) => r.k === "Top-Trader · Retail")).toBe(false);
    expect([ppText(1.24), ppText(-0.85), ppText(0), ppText(NaN)]).toEqual(["+1,2 pp", "−0,9 pp", "±0,0 pp", "–"]);
  });
});

describe("snapshot (trade.signal)", () => {
  it("stores the side's condition with the per-period readings", () => {
    const g = applyWhale(LONG2, holds(), CFG);
    const s = toSignalSnapshot(g, "long", CFG, { mode: "live" });
    expect(s.whale).toEqual({ ok: true, run: 2, need: 2, period: "30m", topChg: 2, retailChg: -2, points: 10, periods: [{ period: "30m", top: 62, retail: 48, topChg: 2, retailChg: -2, run: 2 }] });
    expect(toSignalSnapshot(g, "short", CFG).whale).toMatchObject({ ok: false, run: 0, points: 0 });
    expect(s.strength).toBe(3);
  });

  it("on but no data at that time → whale: null (keine Daten); off → no field", () => {
    expect(toSignalSnapshot(LONG2, "long", CFG).whale).toBeNull();
    expect("whale" in toSignalSnapshot(LONG2, "long", sanitizeSignalCfg({ whale: { on: false } }))).toBe(false);
  });

  it("parsing: old snapshots without the field stay valid and get none; null survives; garbage is dropped; round trip", () => {
    const old = { at: "2026-09-30T10:15:00.000Z", side: "long", score: 75, strength: 2, tiers: 2, label: "Starker Long-Einstieg", valid: true, rsiOk: true, zoneOk: false, zone: "discount", tfs: [] };
    const p = parseSignalSnapshot(old)!;
    expect(p).toEqual(old);
    expect("whale" in p).toBe(false);
    expect(parseSignalSnapshot({ ...old, whale: null })!.whale).toBeNull();
    expect("whale" in parseSignalSnapshot({ ...old, whale: "x" })!).toBe(false);
    expect("whale" in parseSignalSnapshot({ ...old, whale: { run: 2 } })!).toBe(false);
    expect(parseSignalSnapshot({ ...old, whale: { ok: true, run: "3", need: 2, periods: [{ period: "1h", top: "61.5", retail: 48, run: 3 }, { nope: 1 }] } })!.whale).toMatchObject({
      ok: true,
      run: 3,
      need: 2,
      period: "1h",
      points: 0,
      periods: [{ period: "1h", top: 61.5, retail: 48, topChg: 0, retailChg: 0, run: 3 }],
    });
    const stored = toSignalSnapshot(applyWhale(LONG2, holds(), CFG), "long", CFG, { mode: "retro" });
    expect(parseSignalSnapshot(JSON.parse(JSON.stringify(stored)))).toEqual(JSON.parse(JSON.stringify(stored)));
  });
});

describe("settings draft strings", () => {
  it("whaleToDraft shows what the engine runs with; whaleFromDraft merges over the stored object", () => {
    expect(whaleToDraft(undefined)).toEqual({ sgWhale: "on", sgWhalePeriods: "30m,1h", sgWhaleMin: "2", sgWhaleWeight: "10" });
    expect(whaleToDraft({ whale: { on: false, periods: ["4h", "15m"], minRun: 3, weight: 0 } })).toEqual({ sgWhale: "", sgWhalePeriods: "15m,4h", sgWhaleMin: "3", sgWhaleWeight: "0" });
    const r = whaleFromDraft({ sgWhale: "on", sgWhalePeriods: "1h,30m,bogus", sgWhaleMin: "9", sgWhaleWeight: "15" }, { whale: { keep: 1, on: false } });
    expect(r).toEqual({ ok: true, whale: { keep: 1, on: true, periods: ["30m", "1h"], minRun: 6, weight: 15 } });
    expect(whaleFromDraft({ sgWhalePeriods: "" }, undefined)).toEqual({ ok: false, field: "sgWhalePeriods" });
    expect(whaleFromDraft({ sgWhaleMin: "x" }, undefined)).toEqual({ ok: false, field: "sgWhaleMin" });
    expect(whaleFromDraft({}, undefined)).toEqual({ ok: true, whale: { on: true, periods: ["30m", "1h"], minRun: 2, weight: 10 } });
  });
});
