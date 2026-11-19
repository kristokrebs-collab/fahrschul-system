/**
 * Long/Short-Tendenz (`src/domain/signals/bias.ts`): every condition's vote, the weights, the ladder gate, missing
 * data, the consistency with the check's verdict (never against a valid entry, "Stark" only with one), thresholds,
 * hysteresis and long/short symmetry — on hand-built checks, on random markets of the engine fixtures and on the e2e
 * synthetic market (long setup) and its mirror image (short setup).
 */
import { describe, expect, it } from "vitest";
import {
  BIAS_HYSTERESIS,
  BIAS_LABEL,
  BIAS_LEAN,
  BIAS_STRONG,
  BIAS_STRONG_CAP,
  BIAS_UNCONFIRMED,
  DEFAULT_BIAS_CFG,
  WHALE_NEUTRAL_TITLE,
  ageDecay,
  biasHoldText,
  biasLevel,
  biasMethodText,
  biasPercentText,
  biasValueText,
  computeBias,
  contributionImpact,
  mcbEventVote,
  ladderTiers,
  mcbVote,
  rawBiasLevel,
  roundToSum,
  rsiVote,
  rungWeights,
  sanitizeBiasCfg,
  waveVote,
  whalePeriodVote,
  whaleVote,
  zoneVote,
  type BiasLevel,
} from "@/domain/signals/bias";
import {
  DEFAULT_SIGNAL_CFG,
  computeSignals,
  resampleBars,
  sanitizeSignalCfg,
  signalsAt,
  SIGNAL_BARS,
  verdict,
  tfSeconds,
  withLivePrice,
  type Bar,
  type SignalCfg,
  type Signals,
  type TfCheck,
  type TraderReading,
  TRADERS_TITLE,
  type WhalePeriod,
  type WhaleReading,
  type WtEvent,
  type ZoneInfo,
} from "@/domain/signals";
import { SYNTH_LAST, synthKlines } from "../e2e/mocks/synth";
import { expectedSignals } from "../e2e/mocks/synthOracle";
import { synthBars } from "./signals.fixtures";

/** Hand-built checks carry no divergences / structure: those parts are off here (`signals.v2.test.ts` covers them). */
const PARTS_OFF = { div: { on: false }, sr: { on: false } } as const;
const CFG: SignalCfg = sanitizeSignalCfg({ ...DEFAULT_SIGNAL_CFG, ...PARTS_OFF });
const NO_WHALE: SignalCfg = sanitizeSignalCfg({ whale: { on: false }, ...PARTS_OFF });

function zone(pos: number): ZoneInfo {
  const z = pos > 0.525 ? "premium" : pos >= 0.475 ? "equilibrium" : "discount";
  return { hi: 90_000, lo: 80_000, pos, zone: z, deep: pos <= 0.05 || pos >= 0.95, eq: 85_000, bias: 0, brk: null, lux: true };
}

interface CheckOpts {
  long?: WtEvent;
  short?: WtEvent;
  rsi?: number;
  wt1?: number;
  wt2?: number;
  pos?: number;
}

function check(tf: string, o: CheckOpts = {}): TfCheck {
  const rsi = o.rsi ?? 50;
  const latest = o.long ?? o.short ?? null;
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi,
    rsiMa: rsi,
    wt: { kind: latest?.kind ?? null, barsAgo: latest?.barsAgo ?? null, long: o.long ?? null, short: o.short ?? null, wt1: o.wt1 ?? 0, wt2: o.wt2 ?? o.wt1 ?? 0 },
    zone: zone(o.pos ?? 0.5),
    longSignal: !!o.long,
    shortSignal: !!o.short,
    rsiLong: rsi <= 40,
    rsiShort: rsi >= 60,
  };
}

function period(p: string, o: Partial<WhalePeriod> = {}): WhalePeriod {
  return { period: p, at: 1_760_000_000_000, top: 55, retail: 50, topChg: 0, retailChg: 0, runLong: 0, runShort: 0, ...o };
}

type Sig = Pick<Signals, "checks" | "zone" | "whale">;
function sig(checks: (TfCheck | null)[], whale?: WhaleReading, zoneTf = "1h"): Sig {
  return { checks, zone: checks.find((c) => c?.tf === zoneTf) ?? null, whale };
}

/** Mirror image of a check: events swapped, wt negated, RSI → 100 − RSI, zone position → 1 − pos. */
function mirror(c: TfCheck): TfCheck {
  const flip = (e: WtEvent): WtEvent => (e ? { kind: ({ bottom: "top", buy: "sell", bull: "bear", top: "bottom", sell: "buy", bear: "bull" } as const)[e.kind], barsAgo: e.barsAgo } : null);
  return check(c.tf, { long: flip(c.wt.short), short: flip(c.wt.long), rsi: 100 - c.rsi, wt1: -c.wt.wt1, wt2: -c.wt.wt2, pos: 1 - c.zone.pos });
}
const mirrorPeriod = (p: WhalePeriod): WhalePeriod => ({ ...p, topChg: -p.topChg, retailChg: -p.retailChg, runLong: p.runShort, runShort: p.runLong });

describe("votes", () => {
  it("MCB event: rank / 3, halved every `signalLookback` bars", () => {
    expect(ageDecay(0, 3)).toBe(1);
    expect(ageDecay(3, 3)).toBeCloseTo(0.5, 12);
    expect(ageDecay(1, 3)).toBeCloseTo(Math.pow(0.5, 1 / 3), 12);
    expect(mcbEventVote({ kind: "bottom", barsAgo: 0 }, 3)).toBe(1);
    expect(mcbEventVote({ kind: "top", barsAgo: 0 }, 3)).toBe(1);
    expect(mcbEventVote({ kind: "buy", barsAgo: 0 }, 3)).toBeCloseTo(2 / 3, 12);
    expect(mcbEventVote({ kind: "bull", barsAgo: 0 }, 3)).toBeCloseTo(1 / 3, 12);
    expect(mcbEventVote({ kind: "bottom", barsAgo: 2 }, 3)).toBeLessThan(mcbEventVote({ kind: "bottom", barsAgo: 1 }, 3));
    expect(mcbEventVote(null, 3)).toBe(0);
  });

  it("wave: oversold and curling up → long, the mirror → short, mild against an event", () => {
    expect(waveVote(-60, -66, CFG)).toBeCloseTo(1, 12); // position −60 = full, slope +6 = full
    expect(waveVote(60, 66, CFG)).toBeCloseTo(-1, 12);
    expect(waveVote(-60, -54, CFG)).toBeCloseTo(0, 12); // oversold but still falling: cancels
    expect(waveVote(0, 0, CFG)).toBe(0);
    for (const [a, b] of [[-30, -32], [12, 15], [-80, -70], [5, 1]] as const) expect(waveVote(-a, -b, CFG)).toBeCloseTo(-waveVote(a, b, CFG), 12);
    // a rung: a fresh Bottom dominates, the wave only adds ≤ 0.3
    expect(mcbVote(check("30m", { long: { kind: "bottom", barsAgo: 0 }, wt1: 60, wt2: 66 }), CFG)).toBeCloseTo(1 - 0.3, 12);
    expect(mcbVote(check("30m", { wt1: -60, wt2: -66 }), CFG)).toBeCloseTo(0.3, 12);
    expect(mcbVote(check("30m", { long: { kind: "bottom", barsAgo: 0 }, wt1: -60, wt2: -66 }), CFG)).toBe(1); // clamped
    // both directions in the window: net
    const net = mcbVote(check("30m", { long: { kind: "bull", barsAgo: 0 }, short: { kind: "top", barsAgo: 0 } }), CFG);
    expect(net).toBeCloseTo(1 / 3 - 1, 12);
  });

  it("RSI 14: ≤ near-oversold +1, ≥ near-overbought −1, linear in between, 0 at 50", () => {
    expect(rsiVote(40, CFG)).toBe(1);
    expect(rsiVote(12, CFG)).toBe(1);
    expect(rsiVote(60, CFG)).toBe(-1);
    expect(rsiVote(88, CFG)).toBe(-1);
    expect(rsiVote(50, CFG)).toBe(0);
    expect(rsiVote(45, CFG)).toBeCloseTo(0.5, 12);
    expect(rsiVote(55, CFG)).toBeCloseTo(-0.5, 12);
    for (const r of [5, 33, 41.5, 47, 52.2, 63, 99]) expect(rsiVote(100 - r, CFG)).toBeCloseTo(-rsiVote(r, CFG), 12);
    // follows the configured bands (rsiNear 5 → 35 / 65)
    const tight = { ...CFG, rsiNear: 5 };
    expect(rsiVote(38, tight)).toBeCloseTo(0.8, 12); // (50 − 38) / 15
    expect(rsiVote(35, tight)).toBe(1);
    expect(rsiVote(NaN, CFG)).toBe(0);
  });

  it("premium/discount: by the position in the range, equilibrium band 0", () => {
    expect(zoneVote(0)).toBe(1);
    expect(zoneVote(1)).toBe(-1);
    expect(zoneVote(0.5)).toBe(0);
    expect(zoneVote(0.48)).toBe(0);
    expect(zoneVote(0.52)).toBe(0);
    expect(zoneVote(0.2375)).toBeCloseTo(0.5, 12);
    for (const p of [0.01, 0.1, 0.3, 0.46]) expect(zoneVote(1 - p)).toBeCloseTo(-zoneVote(p), 12);
    expect(zoneVote(-0.2)).toBe(1); // clamped
  });

  it("Top-Trader kaufen · Retail rot: run holds ±1, both readings ±0.75, one side ±0.5, opposite 0", () => {
    expect(whalePeriodVote(period("30m", { runLong: 3, topChg: 2, retailChg: -2 }), 2)).toBe(1);
    expect(whalePeriodVote(period("30m", { runShort: 2, topChg: -2, retailChg: 2 }), 2)).toBe(-1);
    expect(whalePeriodVote(period("30m", { runLong: 1, topChg: 1.2, retailChg: -0.8 }), 2)).toBe(0.75);
    expect(whalePeriodVote(period("30m", { topChg: 1.2, retailChg: 0 }), 2)).toBe(0.5); // only top traders buy
    expect(whalePeriodVote(period("30m", { topChg: 0, retailChg: -1 }), 2)).toBe(0.5); // only retail red
    expect(whalePeriodVote(period("30m", { topChg: 1, retailChg: 1 }), 2)).toBe(0); // top buy, retail green
    expect(whalePeriodVote(period("30m", { topChg: -0.4, retailChg: 0.02 }), 2)).toBe(-0.5); // tiny change = flat
    expect(whaleVote(null, { minRun: 2 })).toBeNull();
    expect(whaleVote({ periods: [], missing: ["30m"] }, { minRun: 2 })).toBeNull();
    const r: WhaleReading = { periods: [period("30m", { runLong: 2, topChg: 1, retailChg: -1 }), period("1h", { topChg: 1, retailChg: 0 })], missing: [] };
    expect(whaleVote(r, { minRun: 2 })).toBeCloseTo(0.75, 12); // mean of 1 and 0.5
    expect(whaleVote({ ...r, periods: r.periods.map(mirrorPeriod) }, { minRun: 2 })).toBeCloseTo(-0.75, 12);
  });
});

describe("weights and the weighted mean", () => {
  it("reuses the check's score points: MCB 65 split equally over the rungs (55 / n like the score), RSI 20, zone 15, whale = its weight", () => {
    expect(DEFAULT_BIAS_CFG).toEqual({ mcb: 65, rsi: 20, zone: 15, whale: null, div: null, sr: null });
    expect(rungWeights(4, 65)).toEqual([16.25, 16.25, 16.25, 16.25]);
    expect(rungWeights(3, 60)).toEqual([20, 20, 20]);
    expect(rungWeights(0, 65)).toEqual([]);
    const b = computeBias(sig([check("30m"), check("45m"), check("1h"), check("4h")], { periods: [period("30m", { topChg: 1, retailChg: -1 })], missing: [] }), CFG)!;
    expect(b.contributions.map((c) => [c.id, c.weight])).toEqual([
      ["mcb-30m", 16.25],
      ["mcb-45m", 16.25],
      ["mcb-1h", 16.25],
      ["mcb-4h", 16.25],
      ["rsi", 20],
      ["zone", 15],
      ["whale", 10],
    ]);
    expect(b.contributions.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 12);
    expect(b.contributions.map((c) => c.label)).toEqual(["MCB 30m · Basis", "MCB 45m · Bestätigung", "MCB 1h · stärker", "MCB 4h · stärker", "RSI 14", "Premium/Discount · 1h", "Top-Trader kaufen · Retail rot"]);
  });

  it("score = Σ weight · vote / Σ weight, with the ladder gate and RSI on the head rungs", () => {
    const checks = [
      check("30m", { long: { kind: "bottom", barsAgo: 0 }, rsi: 30 }),
      check("45m", { long: { kind: "buy", barsAgo: 1 }, rsi: 45 }),
      check("1h", { rsi: 52, wt1: -20, wt2: -23, pos: 0.3 }),
      check("4h", { short: { kind: "sell", barsAgo: 2 }, rsi: 64, wt1: 30, wt2: 31 }),
    ];
    const whale: WhaleReading = { periods: [period("30m", { topChg: 1, retailChg: 0.5 })], missing: [] };
    const b = computeBias(sig(checks, whale), CFG)!;
    expect(ladderTiers(checks, "long")).toBe(2);
    expect(ladderTiers(checks, "short")).toBe(0);
    // the 4h Verkauf is not confirmed by the rungs below it (no short signal on 30m) → counts ¼
    const gates = [{ long: true, short: true }, { long: true, short: false }, { long: true, short: false }, { long: false, short: false }];
    const mcb = checks.map((c, i) => mcbVote(c, CFG, gates[i]));
    expect(mcb[3]).toBeCloseTo(-BIAS_UNCONFIRMED * mcbEventVote({ kind: "sell", barsAgo: 2 }, 3) + 0.3 * waveVote(30, 31, CFG), 12);
    // RSI: the head = base + the rungs the ladder confirms (30m, 45m): strongest long − strongest short reading
    const rsi = Math.max(0, rsiVote(30, CFG), rsiVote(45, CFG)) - Math.max(0, -rsiVote(30, CFG), -rsiVote(45, CFG));
    expect(rsi).toBe(1);
    const expected = (16.25 * mcb.reduce((s, x) => s + x, 0) + 20 * rsi + 15 * zoneVote(0.3) + 10 * 0) / 110;
    expect(b.sum).toBeCloseTo(expected, 12);
    expect(b.score).toBe(b.sum); // a valid long, the sum leans long: no limit
    expect(b.limit).toBeNull();
    expect(b.valid).toEqual({ long: true, short: false });
    expect(b.contributions.find((c) => c.id === "rsi")).toMatchObject({ vote: 1, detail: "30m 30,0 · 45m 45,0 (≤ 40 Long, ≥ 60 Short)" });
    expect(b.contributions.find((c) => c.id === "mcb-4h")!.detail).toBe("Verkaufssignal (unbestätigt) · vor 2 · WT 30,0 ↓");
    expect(b.contributions.reduce((s, c) => s + contributionImpact(c), 0)).toBeCloseTo(b.sum, 12);
  });

  it("ladder gate: a higher rung's event counts fully only when every rung below confirms it (like the check)", () => {
    const open = { long: true, short: true };
    const c4h = check("4h", { long: { kind: "bottom", barsAgo: 0 } });
    expect(mcbVote(c4h, CFG)).toBe(1);
    expect(mcbVote(c4h, CFG, open)).toBe(1);
    expect(mcbVote(c4h, CFG, { long: false, short: true })).toBeCloseTo(BIAS_UNCONFIRMED, 12);
    expect(ladderTiers([check("30m", { long: { kind: "bull", barsAgo: 0 } }), null, check("1h", { long: { kind: "bottom", barsAgo: 0 } })], "long")).toBe(1);
    expect(ladderTiers([null, check("45m", { short: { kind: "top", barsAgo: 0 } })], "short")).toBe(0);
    // the same 4h Bottom: confirmed by 30m · 45m · 1h it counts fully, alone it is a trace
    const up = (tf: string) => check(tf, { long: { kind: "buy", barsAgo: 0 } });
    const chain = computeBias(sig([up("30m"), up("45m"), up("1h"), c4h]), NO_WHALE)!;
    const alone = computeBias(sig([check("30m"), check("45m"), check("1h"), c4h]), NO_WHALE)!;
    expect(chain.contributions.find((c) => c.id === "mcb-4h")!.vote).toBe(1);
    expect(alone.contributions.find((c) => c.id === "mcb-4h")!.vote).toBeCloseTo(BIAS_UNCONFIRMED, 12);
    expect(alone.contributions.find((c) => c.id === "mcb-4h")!.detail).toMatch(/^Bottom \(unbestätigt\) · jetzt/);
    expect(chain.contributions.find((c) => c.id === "mcb-4h")!.detail).toMatch(/^Bottom · jetzt/);
  });

  it("missing data is excluded, never a neutral vote; nothing left → null", () => {
    const allLong = (tf: string) => check(tf, { long: { kind: "bottom", barsAgo: 0 }, rsi: 25, wt1: -60, wt2: -66, pos: 0 });
    const b = computeBias(sig([allLong("30m"), allLong("45m"), allLong("1h"), null], { periods: [period("30m", { runLong: 2, topChg: 1, retailChg: -1 })], missing: ["1h"] }), CFG)!;
    expect(b.score).toBe(1); // the missing 4h rung does not pull towards 0
    const r4h = b.contributions.find((c) => c.id === "mcb-4h")!;
    expect(r4h).toMatchObject({ vote: null, share: 0, detail: "Zu wenig Kerzen", label: "MCB 4h · stärker" });
    expect(b.used).toBe(6);
    expect(b.total).toBe(7);
    // the Top-Trader-Kombi on, but no reading → a "keine Daten" row, excluded
    const nd = computeBias(sig([allLong("30m"), allLong("45m"), allLong("1h"), allLong("4h")], undefined), CFG)!;
    expect(nd.contributions.find((c) => c.id === "traders")).toMatchObject({ vote: null, share: 0, detail: "keine Daten", label: TRADERS_TITLE });
    expect(nd.score).toBe(1);
    // switched off → no row at all
    expect(computeBias(sig([allLong("30m")]), NO_WHALE)!.contributions.some((c) => c.id === "whale" || c.id === "traders")).toBe(false);
    // no zone check → the base's zone, like the check; no base either → zone excluded
    const baseZone = computeBias({ checks: [allLong("30m")], zone: null }, NO_WHALE)!;
    expect(baseZone.contributions.find((c) => c.id === "zone")).toMatchObject({ vote: 1, label: "Premium/Discount · 30m" });
    const noZone = computeBias({ checks: [null, allLong("45m")], zone: null }, NO_WHALE)!;
    expect(noZone.contributions.find((c) => c.id === "zone")).toMatchObject({ vote: null, share: 0, detail: "Zu wenig Kerzen" });
    expect(noZone.contributions.find((c) => c.id === "rsi")!.vote).toBeNull(); // the head is the missing base
    // nothing with data / weight
    expect(computeBias(null, CFG)).toBeNull();
    expect(computeBias({ checks: [null, null, null, null], zone: null }, CFG)).toBeNull();
    const zeroCfg = sanitizeSignalCfg({ whale: { on: false }, bias: { mcb: 0, rsi: 0, zone: 0 }, ...PARTS_OFF });
    expect(computeBias(sig([allLong("30m"), allLong("45m"), allLong("1h"), allLong("4h")]), zeroCfg)).toBeNull();
  });

  it("whale weight 0 = shown, never counted; settings.signals.bias overrides the points", () => {
    const zeroWhale = sanitizeSignalCfg({ whale: { weight: 0 }, ...PARTS_OFF });
    const r: WhaleReading = { periods: [period("30m", { runShort: 3, topChg: -2, retailChg: 2 })], missing: [] };
    const b = computeBias(sig([check("30m", { long: { kind: "bottom", barsAgo: 0 } }), check("45m"), check("1h"), check("4h")], r), zeroWhale)!;
    const row = b.contributions.find((c) => c.id === "whale")!;
    expect(row).toMatchObject({ vote: -1, weight: 0, share: 0, label: "Top-Trader verkaufen · Retail grün" });
    expect(row.detail).toMatch(/zählt nicht$/);
    expect(b.score).toBeGreaterThan(0);
    // overrides (kept through sanitizeSignalCfg as an unknown key)
    const custom = sanitizeSignalCfg({ bias: { mcb: "40", rsi: 30, zone: -5, whale: 25 }, ...PARTS_OFF });
    expect(sanitizeBiasCfg((custom as SignalCfg & { bias?: unknown }).bias)).toEqual({ mcb: 40, rsi: 30, zone: 0, whale: 25, div: null, sr: null });
    expect(sanitizeBiasCfg({ mcb: Infinity, rsi: 500, div: 12, sr: "x" })).toEqual({ mcb: 65, rsi: 100, zone: 15, whale: null, div: 12, sr: null });
    const c2 = computeBias(sig([check("30m"), check("45m"), check("1h"), check("4h")], r), custom)!;
    expect(c2.contributions.find((c) => c.id === "whale")!.weight).toBe(25);
    expect(c2.contributions.find((c) => c.id === "zone")!.share).toBe(0);
    expect(biasMethodText(custom)).toContain("MCB 40");
    expect(biasMethodText(CFG)).toContain("MCB 65 (zu gleichen Teilen auf 30m · 45m · 1h · 4h), RSI 20, Zone 15, Top-Trader-Kombi 10.");
    expect(biasMethodText(sanitizeSignalCfg({}))).toContain("Zone 15, Top-Trader-Kombi 10, Divergenzen 10, Support/Widerstand 10.");
    expect(biasMethodText(CFG)).toContain("nur voll, wenn alle Stufen darunter dieselbe Richtung bestätigen (sonst ¼)");
    expect(biasMethodText(CFG)).toContain("„Stark“ ab 75 % und nur mit gültigem Einstieg");
    expect(biasMethodText(CFG)).toContain("Die Stufe wechselt erst 2,5 % hinter der Grenze.");
  });

  it("zone: the check's reference — the base when the zone timeframe has too few bars", () => {
    const cfg1d = sanitizeSignalCfg({ whale: { on: false }, zoneTf: "1D" });
    const checks = [check("30m", { short: { kind: "top", barsAgo: 0 }, rsi: 66, pos: 0.69 }), check("45m"), check("1h", { pos: 0.14 }), check("4h")];
    const b = computeBias({ checks, zone: null }, cfg1d)!;
    const row = b.contributions.find((c) => c.id === "zone")!;
    expect(row).toMatchObject({ label: "Premium/Discount · 30m", detail: "Premium · 69 % der Range" });
    expect(row.vote).toBeCloseTo(zoneVote(0.69), 12);
    expect(row.share).toBeGreaterThan(0);
    // the verdict grades the same reference
    const v = verdict("short", checks, cfg1d, null);
    expect(v.zoneOk).toBe(true);
    expect(v.reasons.at(-1)!.text).toBe("Preis im Premium (30m)");
  });
});

describe("consistency with the check's verdict", () => {
  it("never against a valid entry: a sum pointing the other way is shown as 0 (Neutral)", () => {
    // valid short: 30m + 45m confirm (old small crosses), RSI 60 on the base — everything else leans long
    const up = { wt1: -60, wt2: -66 };
    const checks = [
      check("30m", { short: { kind: "bear", barsAgo: 2 }, rsi: 60, ...up }),
      check("45m", { short: { kind: "bear", barsAgo: 2 }, rsi: 30, ...up }),
      check("1h", { ...up, pos: 0 }),
      check("4h", up),
    ];
    const b = computeBias(sig(checks, { periods: [period("30m", { runLong: 3, topChg: 2, retailChg: -2 })], missing: [] }), CFG)!;
    expect(b.valid).toEqual({ long: false, short: true });
    expect(b.sum).toBeGreaterThan(BIAS_LEAN);
    expect(b.score).toBe(0);
    expect(b.level).toBe(0);
    expect(b.label).toBe("Neutral");
    expect(b.percent).toBe("50 %");
    expect(b.limit).toEqual({ kind: "entry", side: "short", text: "gültiger Short-Einstieg im Check: zeigt nicht Long" });
    // hysteresis cannot carry an opposite label either
    expect(computeBias(sig(checks), CFG, 1)!.level).toBe(0);
    // the mirror image: a valid long is never shown short
    const m = computeBias(sig(checks.map(mirror), { periods: [period("30m", { runShort: 3, topChg: -2, retailChg: 2 })], missing: [] }), CFG)!;
    expect(m.score).toBe(0);
    expect(m.limit).toMatchObject({ kind: "entry", side: "long" });
  });

  it("\"Stark\" only with a valid entry on that side: the score stops at 74 %, the label at \"Eher\"", () => {
    // 30m Bottom alone (ladder not confirmed → no valid entry), everything else long
    const checks = [check("30m", { long: { kind: "bottom", barsAgo: 0 }, rsi: 25, wt1: -60, wt2: -66 }), check("45m", { rsi: 30, wt1: -60, wt2: -66 }), check("1h", { wt1: -60, wt2: -66, pos: 0 }), check("4h", { wt1: -60, wt2: -66 })];
    const whale: WhaleReading = { periods: [period("30m", { runLong: 3, topChg: 2, retailChg: -2 })], missing: [] };
    const b = computeBias(sig(checks, whale), CFG)!;
    expect(b.valid.long).toBe(false);
    expect(b.sum).toBeGreaterThan(BIAS_STRONG);
    expect(b.score).toBe(BIAS_STRONG_CAP);
    expect(b).toMatchObject({ level: 1, label: "Eher Long", pct: 74, percent: "74 % Long" });
    expect(b.limit).toEqual({ kind: "strong", side: "long", text: "„Stark“ nur mit gültigem Long-Einstieg" });
    expect(computeBias(sig(checks, whale), CFG, 2)!.level).toBe(1); // a held "Stark" drops to "Eher" too
    // confirmed by 45m → a valid long: Stark, no limit
    const ok = computeBias(sig([checks[0]!, check("45m", { long: { kind: "buy", barsAgo: 0 }, rsi: 30, wt1: -60, wt2: -66 }), checks[2]!, checks[3]!], whale), CFG)!;
    expect(ok.valid.long).toBe(true);
    expect(ok).toMatchObject({ level: 2, label: "Stark Long", limit: null });
    expect(ok.score).toBe(ok.sum);
  });

  it("uses the verdicts of the snapshot when present", () => {
    const checks = [check("30m", { long: { kind: "bottom", barsAgo: 0 }, rsi: 25, wt1: -60, wt2: -66 }), check("45m", { rsi: 30 }), check("1h", { pos: 0 }), check("4h")];
    const s = { ...sig(checks), long: { ...verdict("long", checks, CFG, null), valid: true }, short: verdict("short", checks, CFG, null) };
    expect(computeBias(s, NO_WHALE)!.valid.long).toBe(true);
    expect(computeBias(sig(checks), NO_WHALE)!.valid.long).toBe(false);
  });

  it("random markets (engine fixtures): a valid entry is never shown opposite, \"Stark\" never without one", () => {
    const cfg = sanitizeSignalCfg({ ...DEFAULT_SIGNAL_CFG, whale: { on: false } });
    const SEC: Record<string, number> = { "30m": 1800, "45m": 2700, "1h": 3600, "4h": 14_400 };
    let valid = 0;
    let evals = 0;
    for (const seed of [2, 3]) {
      const src = synthBars(6000, seed, { sec: 900 });
      const bars: Record<string, Bar[]> = {};
      for (const tf of cfg.ladder) bars[tf] = resampleBars(src, 900, SEC[tf]!);
      const t0 = src[0]!.t;
      const tEnd = src[src.length - 1]!.t + 900;
      for (let at = (t0 + 170 * 14_400) * 1000; at < tEnd * 1000; at += 2 * 3600 * 1000) {
        const cut: Record<string, Bar[]> = {};
        for (const tf of cfg.ladder) cut[tf] = bars[tf]!.filter((x) => (x.t + SEC[tf]!) * 1000 <= at).slice(-500);
        const s = signalsAt(cut, cfg, at, at + 10 * 864e5);
        const b = s && computeBias(s, cfg);
        if (!s || !b) continue;
        evals++;
        if (Math.abs(b.level) === 2) expect(s[b.level > 0 ? "long" : "short"].valid, new Date(at).toISOString()).toBe(true);
        if (!s.best.valid || s.long.valid === s.short.valid) continue;
        valid++;
        const want = s.best.side === "long" ? 1 : -1;
        expect(Math.sign(b.score) * want, new Date(at).toISOString()).toBeGreaterThanOrEqual(0);
        expect(Math.sign(b.level) * want).toBeGreaterThanOrEqual(0);
      }
    }
    expect(evals).toBeGreaterThan(300);
    expect(valid).toBeGreaterThan(20);
  }, 60_000);

  it("review case (seed 3, 2025-12-18 11:15Z): a valid Short-Einstieg is not read \"Eher Long\"", () => {
    const cfg = sanitizeSignalCfg({ ...DEFAULT_SIGNAL_CFG, whale: { on: false }, ...PARTS_OFF });
    const src = synthBars(9000, 3, { sec: 900 });
    const at = Date.parse("2025-12-18T11:15:00Z");
    const SEC: Record<string, number> = { "30m": 1800, "45m": 2700, "1h": 3600, "4h": 14_400 };
    const cut: Record<string, Bar[]> = {};
    for (const tf of cfg.ladder) cut[tf] = resampleBars(src, 900, SEC[tf]!).filter((x) => (x.t + SEC[tf]!) * 1000 <= at).slice(-500);
    const s = signalsAt(cut, cfg, at, at + 10 * 864e5)!;
    expect(s.best).toMatchObject({ side: "short", valid: true, label: "Short-Einstieg" });
    const b = computeBias(s, cfg)!;
    expect(b.level).toBeLessThanOrEqual(0);
    expect(b.sum).toBeLessThan(0); // the gate alone fixes it: the unconfirmed 4h Bottom is a trace now
    expect(b.limit).toBeNull();
    const r4h = b.contributions.find((c) => c.id === "mcb-4h")!;
    expect(r4h.detail).toMatch(/^Bottom \(unbestätigt\)/);
    expect(Math.abs(contributionImpact(r4h))).toBeLessThan(0.1);
  });
});

describe("whale row", () => {
  it("a zero vote or no data reads neutral, not \"kaufen · Retail rot\"; zero shows both runs", () => {
    const flat: WhaleReading = { periods: [period("30m", { runLong: 1, runShort: 1, topChg: 1, retailChg: 1 })], missing: ["1h"] };
    const b = computeBias(sig([check("30m"), check("45m"), check("1h"), check("4h")], flat), CFG)!;
    const row = b.contributions.find((c) => c.id === "whale")!;
    expect(row.vote).toBe(0);
    expect(row.label).toBe(WHALE_NEUTRAL_TITLE);
    expect(row.detail).toBe("Top-Trader +1,0 pp · Retail +1,0 pp · Long 1× · Short 1× in Folge (30m, mind. 2) · 1h: keine Daten");
    // without any reading the row is the Top-Trader-Kombi's "keine Daten" row
    expect(computeBias(sig([check("30m")]), CFG)!.contributions.find((c) => c.id === "traders")!.label).toBe(TRADERS_TITLE);
    const short = computeBias(sig([check("30m")], { periods: [period("30m", { runShort: 2, topChg: -1, retailChg: 1 })], missing: [] }), CFG)!;
    expect(short.contributions.find((c) => c.id === "whale")).toMatchObject({ label: "Top-Trader verkaufen · Retail grün", vote: -1 });
    expect(short.contributions.find((c) => c.id === "whale")!.detail).toMatch(/· 2× in Folge \(30m, mind\. 2\)$/);
  });
});

describe("rounding", () => {
  it("largest remainder: shares add up to 100, contributions to the rounded sum", () => {
    expect(roundToSum([100 / 3, 100 / 3, 100 / 3])).toEqual([34, 33, 33]);
    expect(roundToSum([16.25, 16.25, 16.25, 16.25, 20, 15])).toEqual([17, 16, 16, 16, 20, 15]);
    expect(roundToSum([-5.2, 3.7])).toEqual([-5, 4]);
    expect(roundToSum([0, 0, 0])).toEqual([0, 0, 0]);
    expect(roundToSum([])).toEqual([]);
    // the review's long setup: weights 6+12+18+24+18+14+9 = 101 → now always 100
    const shares = [5.9, 11.8, 17.7, 23.6, 17.7, 14.4, 8.9];
    expect(roundToSum(shares).reduce((a, x) => a + x, 0)).toBe(Math.round(shares.reduce((a, x) => a + x, 0)));
    // a real bias: the rows' rounded contributions add up to the rounded sum
    const b = computeBias(expectedSignals(Date.now(), Date.now(), 84_199, "whale-long"), CFG)!;
    const pct = roundToSum(b.contributions.map((c) => c.share * 100));
    expect(pct.reduce((a, x) => a + x, 0)).toBe(100);
    const cents = roundToSum(b.contributions.map((c) => contributionImpact(c) * 100));
    expect(cents.reduce((a, x) => a + x, 0)).toBe(Math.round(b.sum * 100));
  });
});

describe("labels, percent, hysteresis", () => {
  it("thresholds: Neutral < 0.15 ≤ Eher < 0.5 ≤ Stark, symmetric", () => {
    expect(BIAS_LEAN).toBe(0.15);
    expect(BIAS_STRONG).toBe(0.5);
    const cases: [number, BiasLevel][] = [
      [0, 0],
      [0.149, 0],
      [0.15, 1],
      [0.499, 1],
      [0.5, 2],
      [1, 2],
    ];
    for (const [s, l] of cases) {
      expect(rawBiasLevel(s), `${s}`).toBe(l);
      expect(rawBiasLevel(-s), `${-s}`).toBe(-l || 0);
    }
    expect(Object.values(BIAS_LABEL)).toEqual(expect.arrayContaining(["Stark Short", "Eher Short", "Neutral", "Eher Long", "Stark Long"]));
  });

  it("hysteresis: a level holds within ±0.05 of its interval, a clear move changes it", () => {
    expect(BIAS_HYSTERESIS).toBe(0.05);
    expect(biasLevel(0.17, 0)).toBe(0); // Neutral holds up to 0.20
    expect(biasLevel(0.21, 0)).toBe(1);
    expect(biasLevel(0.12, 1)).toBe(1); // Eher Long holds down to 0.10
    expect(biasLevel(0.09, 1)).toBe(0);
    expect(biasLevel(0.53, 1)).toBe(1);
    expect(biasLevel(0.56, 1)).toBe(2);
    expect(biasLevel(0.46, 2)).toBe(2);
    expect(biasLevel(0.44, 2)).toBe(1);
    expect(biasLevel(-0.12, -1)).toBe(-1);
    expect(biasLevel(-0.17, 0)).toBe(0);
    expect(biasLevel(0.6, -2)).toBe(2); // a jump across several levels goes straight there
    expect(biasLevel(0.17)).toBe(1); // no previous level = raw
    // label sequence of a hovering score: no flicker
    let prev: BiasLevel | null = null;
    const labels = [0.14, 0.16, 0.149, 0.152, 0.18, 0.21, 0.16, 0.13, 0.11, 0.08].map((s) => (prev = biasLevel(s, prev)));
    expect(labels).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
    // computeBias carries it
    const z = (pos: number) => sig([check("30m", { pos })], undefined, "30m");
    const zoneOnly = sanitizeSignalCfg({ whale: { on: false }, ladder: ["30m"], zoneTf: "30m", bias: { mcb: 0, rsi: 0, zone: 100 } });
    const s17 = 0.475 - 0.17 * 0.475; // zone vote 0.17
    expect(computeBias(z(s17), zoneOnly)!.label).toBe("Eher Long");
    expect(computeBias(z(s17), zoneOnly, 0)!.label).toBe("Neutral");
    expect(computeBias(z(s17), zoneOnly, 0)!.hold).toBe("gehalten: wechselt erst ab 60 %");
    expect(computeBias(z(s17), zoneOnly)!.hold).toBe("");
  });

  it("hold text: says where a held label changes (the explainer shows it next to the sum)", () => {
    expect(biasHoldText(0.12, 1)).toBe("gehalten: wechselt erst unter 55 %");
    expect(biasHoldText(-0.12, -1)).toBe("gehalten: wechselt erst unter 55 %");
    expect(biasHoldText(0.53, 1)).toBe("gehalten: wechselt erst ab 77,5 %");
    expect(biasHoldText(0.47, 2)).toBe("gehalten: wechselt erst unter 72,5 %");
    expect(biasHoldText(-0.18, 0)).toBe("gehalten: wechselt erst ab 60 %");
    expect(biasHoldText(0.3, 1)).toBe("");
    expect(biasHoldText(0.05, 0)).toBe("");
  });

  it("percent and text alternative", () => {
    expect(biasPercentText(0.28)).toBe("64 % Long");
    expect(biasPercentText(-0.4)).toBe("70 % Short");
    expect(biasPercentText(0)).toBe("50 %");
    expect(biasPercentText(0.004)).toBe("50 %");
    expect(biasValueText(0.28, 1)).toBe("Eher Long, 64 %");
    expect(biasValueText(-0.8, -2)).toBe("Stark Short, 90 %");
    expect(biasValueText(0.06, 0)).toBe("Neutral, 53 % Long");
    expect(biasValueText(0, 0)).toBe("Neutral, 50 %");
    const b = computeBias(sig([check("30m", { pos: 0.2, rsi: 45 }), check("45m"), check("1h", { pos: 0.2 }), check("4h")]), NO_WHALE)!;
    expect(b.percent).toBe(biasPercentText(b.score));
    expect(b.valueText).toBe(biasValueText(b.score, b.level));
    expect(b.pct).toBe(Math.round(50 + 50 * Math.abs(b.score)));
  });
});

describe("symmetry", () => {
  it("a mirrored evaluation gives the negated score and the mirrored label", () => {
    const checks = [
      check("30m", { long: { kind: "bottom", barsAgo: 1 }, rsi: 33, wt1: -55, wt2: -58, pos: 0.12 }),
      check("45m", { long: { kind: "bull", barsAgo: 0 }, rsi: 41, wt1: -20, wt2: -22, pos: 0.4 }),
      check("1h", { short: { kind: "bear", barsAgo: 2 }, rsi: 57, wt1: 15, wt2: 12, pos: 0.3 }),
      check("4h", { rsi: 49, wt1: -5, wt2: -4, pos: 0.6 }),
    ];
    const whale: WhaleReading = { periods: [period("30m", { runLong: 1, topChg: 0.8, retailChg: -0.6 }), period("1h", { topChg: 0.4 })], missing: [] };
    const a = computeBias(sig(checks, whale), CFG)!;
    const b = computeBias(sig(checks.map(mirror), { ...whale, periods: whale.periods.map(mirrorPeriod) }), CFG)!;
    expect(b.score).toBeCloseTo(-a.score, 12);
    expect(b.level).toBe(-a.level || 0);
    expect(b.label).toBe(a.label.replace("Long", "Short"));
    expect(b.pct).toBe(a.pct);
    a.contributions.forEach((c, i) => expect(b.contributions[i]!.vote! + c.vote!).toBeCloseTo(0, 12));
  });

  it("synthetic market: the e2e long setup is Stark Long once its candles closed, its mirror image the same strength short", () => {
    // the turn of the e2e market sits on the forming candle at its anchor; 46 min later the base (30m) and the required
    // 45m candle have both closed with it, whatever the anchor's place in the 45m grid
    const anchor = Date.now();
    const now = anchor + 46 * 60_000;
    const SOURCE: Record<string, { interval: string; sec: number }> = { "30m": { interval: "15m", sec: 900 }, "45m": { interval: "15m", sec: 900 }, "1h": { interval: "1h", sec: 3600 }, "4h": { interval: "4h", sec: 14_400 } };
    const build = (flip: boolean, at: number, cfg: SignalCfg, traders?: TraderReading) => {
      const bars: Record<string, Bar[]> = {};
      const m = (x: string) => (flip ? 2 * SYNTH_LAST - Number(x) : Number(x));
      for (const tf of cfg.ladder) {
        const s = SOURCE[tf]!;
        const src: Bar[] = synthKlines(s.interval, { limit: s.interval === "15m" ? 1500 : 499 }, anchor, at).map((r) => ({ t: r[0] / 1000, o: m(r[1]), h: flip ? m(r[3]) : m(r[2]), l: flip ? m(r[2]) : m(r[3]), c: m(r[4]) }));
        const factor = tfSeconds(tf) / s.sec;
        const rung = factor === 1 ? src.slice(-SIGNAL_BARS) : resampleBars(src.slice(-(SIGNAL_BARS + 1) * factor), s.sec, s.sec * factor).slice(-SIGNAL_BARS);
        bars[tf] = withLivePrice(rung, tfSeconds(tf), SYNTH_LAST, at) as Bar[];
      }
      return computeSignals(bars, cfg, at, { traders })!;
    };
    // top traders 66 % / 65 % long, the Whale–Retail-Delta red (−3,7 pp, −2,4 over the hour): the Top-Trader-Kombi 4 of 4
    // for the long side (discount)
    const traders: TraderReading = { at: now, position: 66, account: 65.4, retail: 69.1, retailPrev: 68.8, retailChg: 0.3, period: "5m", step: 300_000, delta: -3.7, deltaPrev: -1.3, deltaChg: -2.4, deltaWindow: "1h" };
    const sig = build(false, now, CFG, traders);
    expect(sig.long.valid).toBe(true);
    expect(["confirmed", "strong"]).toContain(sig.long.state);
    const long = computeBias(sig, CFG)!;
    expect(long.label).toBe("Stark Long");
    expect(long.state).toBe(sig.long.state);
    expect(long.score).toBeGreaterThan(0.7);
    for (const id of ["mcb-30m", "mcb-45m", "mcb-1h", "rsi", "zone", "traders"]) expect(long.contributions.find((c) => c.id === id)!.vote, id).toBeGreaterThan(0.5);
    // the same price path mirrored around the live price (whale off: exact mirror)
    const up = computeBias(build(false, now, NO_WHALE), NO_WHALE)!;
    const down = computeBias(build(true, now, NO_WHALE), NO_WHALE)!;
    expect(up.level).toBe(2);
    expect(down.level).toBe(-2);
    expect(down.label).toBe("Stark Short");
    // MCB and RSI mirror exactly; the zone is the check's own: the ported LuxAlgo swing logic finds no pivot on the
    // mirrored path and falls back to the 120-bar range (premium 90 % vs discount 8 %) — still a strong opposite vote
    up.contributions.forEach((c, i) => {
      const d = down.contributions[i]!;
      if (c.id === "zone") {
        expect(c.vote!).toBeGreaterThan(0.7);
        expect(d.vote!).toBeLessThan(-0.7);
      } else expect(d.vote! + c.vote!, c.id).toBeCloseTo(0, 9);
    });
    expect(Math.abs(down.score + up.score)).toBeLessThan(0.01);
  });
});
