/**
 * "Was wäre wenn" (F33) – replays ONE recorded trade on its own candles with a different stop / break-even / partial
 * take-profit / exit. Pure. It does not re-implement the position management: the scenario is handed to the backtest
 * engine (`runBacktest`, F65: stop in force → partial → target → time stop; stops win when stop and a take-profit share
 * a candle) with the recorded entry price as the fill, zero fees / slippage / funding.
 *
 * What is assumed (and shown in the UI):
 * - the entry fills at the RECORDED entry price; the candle it falls into counts completely (the path inside it is
 *   unknown, so a tight stop can count as hit by a low that came before the entry);
 * - R-multiples of break-even / partial / target / trailing refer to the VARIANT's own stop distance; the result is
 *   always given in R of the ORIGINAL stop distance, so the rows are comparable;
 * - money = result per unit × the recorded quantity (same position size in every variant), BEFORE fees and funding;
 * - "Ist-Ausstieg": what is still open at the recorded exit candle closes at the recorded exit price;
 * - inside one candle the engine cannot know the order: the stop wins (`ambiguous` marks such a trade).
 * Nothing here touches a stored trade.
 */
import { atrSeries } from "../backtest/bars";
import { runBacktest, MIN_RISK_FRAC } from "../backtest/engine";
import { EXIT_LABEL, type Bar, type BtTrade, type EngineCfg, type EntrySignal, type ExitReason, type PositionMgmt } from "../backtest/types";

/** A candle in milliseconds (the replay / excursion shape). */
export interface WhatIfBar {
  /** open time, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** What the simulation needs from a recorded trade. */
export interface WhatIfTrade {
  side: "long" | "short";
  /** (Ø) entry price */
  entry: number;
  /** the original stop – it defines the risk and R */
  stop: number;
  target: number | null;
  /** recorded exit price / time; `null` = unknown (the exit horizon "Ist-Ausstieg" is then not available) */
  exit: number | null;
  entryMs: number;
  exitMs: number | null;
  /** position quantity in base units, `null` = unknown (no money figure) */
  qty: number | null;
}

export type StopSpec = { kind: "factor"; value: number } | { kind: "price"; value: number };
export type TargetSpec = { kind: "keep" } | { kind: "none" } | { kind: "r"; value: number };
export type HorizonSpec = { kind: "actual" } | { kind: "runOn" } | { kind: "bars"; n: number };

export interface Scenario {
  id: string;
  label: string;
  /** default: the original stop */
  stop?: StopSpec;
  breakEven?: { afterR: number; to: "entry" | "net" };
  partial?: { atR: number; frac: number; thenBreakEven?: boolean };
  trail?: { kind: "atr" | "pct"; value: number; activateR: number };
  /** default: keep the recorded target */
  target?: TargetSpec;
  /** default: until the recorded exit */
  horizon?: HorizonSpec;
}

export interface ScenarioResult {
  id: string;
  label: string;
  status: "ok" | "skipped";
  /** German reason when `skipped` */
  why?: string;
  /** result in R of the ORIGINAL stop distance, before fees */
  r: number | null;
  /** result in the account currency (same quantity as the recorded trade), before fees; `null` without a quantity */
  money: number | null;
  /** the stop in force at the start / the target of the variant */
  stop: number | null;
  target: number | null;
  exitReason: ExitReason | null;
  /** German label of how it ended */
  exitLabel: string | null;
  exitPrice: number | null;
  /** open time (ms) of the candle the exit falls into */
  exitAt: number | null;
  /** candles in the trade */
  bars: number;
  /** stop and a take-profit lay in one candle's range: counted as the stop (conservative) */
  ambiguous: boolean;
  /** partial take-profit fills */
  partials: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Zero-cost engine: the scenario compares price paths, fees and funding are stated separately. */
const CFG: EngineCfg = {
  capital: 100_000,
  riskPct: 0.01,
  maxLeverage: 1_000_000,
  compounding: false,
  costs: { fees: { exchange: "none", makerBps: 0, takerBps: 0 }, slippage: { kind: "none" }, funding: { kind: "none" } },
};

const skipped = (s: Scenario, why: string, extra: Partial<ScenarioResult> = {}): ScenarioResult => ({
  id: s.id,
  label: s.label,
  status: "skipped",
  why,
  r: null,
  money: null,
  stop: null,
  target: null,
  exitReason: null,
  exitLabel: null,
  exitPrice: null,
  exitAt: null,
  bars: 0,
  ambiguous: false,
  partials: 0,
  ...extra,
});

/** Index of the candle that contains `at` (open ≤ at < open + interval), −1 when `at` lies outside the series. */
export function candleAt(bars: readonly Pick<WhatIfBar, "time">[], at: number, intervalMs: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && at < bars[found]!.time + intervalMs ? found : -1;
}

/** Why a recorded trade cannot be replayed with alternatives (German), or `null` when it can. */
export function whatIfBlocker(t: { entry: number | null; stop: number | null; side: string; status: string; exitDate?: string; exit: number | null }): string | null {
  if (t.status === "open") return "Der Trade läuft noch – Alternativen lassen sich erst nach dem Ausstieg durchrechnen.";
  if (!(fin(t.entry) && t.entry > 0)) return "Ohne Einstiegspreis gibt es nichts durchzurechnen.";
  if (!(fin(t.stop) && t.stop > 0)) return "Ohne Stopp gibt es kein R – trag den ursprünglichen Stopp im Trade nach.";
  const long = t.side !== "short";
  if (long ? t.stop >= t.entry : t.stop <= t.entry) return "Der Stopp liegt auf der falschen Seite des Einstiegs – korrigiere ihn im Trade.";
  if (!t.exitDate) return "Ohne Ausstiegszeit lässt sich der Verlauf nicht auf den Kerzen abgrenzen.";
  if (!(fin(t.exit) && t.exit > 0)) return "Ohne Ausstiegspreis gibt es keinen Ist-Verlauf zum Vergleichen.";
  return null;
}

/** Variant stop price from a spec; `null` + reason when it cannot be used. */
function variantStop(t: WhatIfTrade, spec: StopSpec | undefined): { stop: number } | { why: string } {
  const long = t.side === "long";
  const orig = Math.abs(t.entry - t.stop);
  const stop = !spec ? t.stop : spec.kind === "factor" ? (long ? t.entry - spec.value * orig : t.entry + spec.value * orig) : spec.value;
  if (!fin(stop) || stop <= 0) return { why: "Der Stopp ist keine gültige Zahl." };
  if (long ? stop >= t.entry : stop <= t.entry) return { why: long ? "Ein Long-Stopp muss unter dem Einstieg liegen." : "Ein Short-Stopp muss über dem Einstieg liegen." };
  if (!(Math.abs(t.entry - stop) > t.entry * MIN_RISK_FRAC)) return { why: "Der Stopp-Abstand ist zu klein (unter 0,05 % des Kurses)." };
  return { stop };
}

/** Engine candles for one replay: signal candle, the entry candle opened at the recorded entry, the exit candle closed at the recorded exit. */
interface Prepared {
  bars: Bar[];
  /** index of the signal candle (the one before the entry) and of the last candle of the window */
  signalIdx: number;
  last: number;
  /** index of the recorded exit candle (null = unknown) */
  exitIdx: number | null;
  secLen: number;
}

function prepare(t: WhatIfTrade, bars: readonly WhatIfBar[], intervalMs: number, horizon: HorizonSpec): Prepared | { why: string } {
  if (!bars.length) return { why: "Für den Zeitraum liegen keine Kerzen vor." };
  const ei = candleAt(bars, t.entryMs, intervalMs);
  if (ei < 0) return { why: "Die Kerzen decken den Einstiegszeitpunkt nicht ab." };
  const xi = t.exitMs != null ? candleAt(bars, t.exitMs, intervalMs) : -1;
  if (horizon.kind === "actual" && xi < 0) return { why: "Die Kerzen decken den Ausstiegszeitpunkt nicht ab." };
  const secLen = intervalMs / 1000;
  const eng: Bar[] = bars.map((b) => ({ t: b.time / 1000, o: b.open, h: b.high, l: b.low, c: b.close }));
  // the entry candle opens at the recorded fill; its range holds the fill
  const e = eng[ei]!;
  eng[ei] = { ...e, o: t.entry, h: Math.max(e.h, t.entry), l: Math.min(e.l, t.entry) };
  // the recorded exit: what is still open then closes at the recorded exit price
  if (xi >= 0 && t.exit != null && horizon.kind === "actual") {
    const x = eng[xi]!;
    eng[xi] = { ...x, c: t.exit, h: Math.max(x.h, t.exit), l: Math.min(x.l, t.exit) };
  }
  let signalIdx = ei - 1;
  if (signalIdx < 0) {
    // no candle before the entry: a flat stand-in carries the signal (it is never read)
    eng.unshift({ t: eng[0]!.t - secLen, o: t.entry, h: t.entry, l: t.entry, c: t.entry });
    signalIdx = 0;
  }
  const shift = signalIdx === ei - 1 ? 0 : 1;
  const exitIdx = xi >= 0 ? xi + shift : null;
  const lastAll = eng.length - 1;
  const last = horizon.kind === "actual" ? (exitIdx ?? lastAll) : horizon.kind === "bars" ? Math.min(lastAll, signalIdx + Math.max(1, Math.floor(horizon.n))) : lastAll;
  return { bars: eng, signalIdx, last: Math.max(last, signalIdx + 1), exitIdx, secLen };
}

function exitLabelOf(tr: BtTrade, horizon: HorizonSpec, atEnd: boolean): string {
  if (tr.reason === "end") return horizon.kind === "actual" && atEnd ? "Ist-Ausstieg (zum Ist-Kurs)" : "Ende der Kerzen";
  return EXIT_LABEL[tr.reason];
}

/** Runs one scenario on the recorded trade's candles. */
export function simulateScenario(trade: WhatIfTrade, bars: readonly WhatIfBar[], intervalMs: number, scenario: Scenario): ScenarioResult {
  const horizon: HorizonSpec = scenario.horizon ?? { kind: "actual" };
  if (!(fin(trade.entry) && trade.entry > 0) || !(fin(trade.stop) && trade.stop > 0)) return skipped(scenario, "Einstieg oder Stopp fehlen.");
  const vs = variantStop(trade, scenario.stop);
  if ("why" in vs) return skipped(scenario, vs.why);
  const stop = vs.stop;
  const prep = prepare(trade, bars, intervalMs, horizon);
  if ("why" in prep) return skipped(scenario, prep.why, { stop });
  const long = trade.side === "long";
  const risk = Math.abs(trade.entry - stop);
  const origRisk = Math.abs(trade.entry - trade.stop);
  let target: number | null;
  const ts = scenario.target ?? { kind: "keep" };
  if (ts.kind === "none") target = null;
  else if (ts.kind === "r") target = fin(ts.value) && ts.value > 0 ? trade.entry + (long ? 1 : -1) * ts.value * risk : null;
  else target = trade.target != null && (long ? trade.target > trade.entry : trade.target < trade.entry) ? trade.target : null;
  const manage: PositionMgmt = {};
  if (scenario.breakEven && fin(scenario.breakEven.afterR) && scenario.breakEven.afterR > 0) manage.breakEven = { after: { kind: "r", value: scenario.breakEven.afterR }, to: scenario.breakEven.to };
  if (scenario.partial && fin(scenario.partial.atR) && scenario.partial.atR > 0) manage.partial = { atR: scenario.partial.atR, frac: Math.min(0.95, Math.max(0.05, scenario.partial.frac)), thenBreakEven: scenario.partial.thenBreakEven };
  if (scenario.trail && fin(scenario.trail.value) && scenario.trail.value > 0) manage.trail = { kind: scenario.trail.kind, value: scenario.trail.value, activateR: Math.max(0, scenario.trail.activateR) };
  const signal: EntrySignal = { side: trade.side, stop, target, maxBars: horizon.kind === "bars" ? Math.max(1, Math.floor(horizon.n)) : null, tag: scenario.label, ...(Object.keys(manage).length ? { manage } : {}) };
  const res = runBacktest(
    prep.bars,
    { start: prep.signalIdx, signalAt: (i) => (i === prep.signalIdx ? signal : null) },
    CFG,
    { from: prep.signalIdx, to: prep.last, equity: false, atr: atrSeries(prep.bars), secLen: prep.secLen },
  );
  const tr = res.trades[0];
  if (!tr) return skipped(scenario, res.skippedRisk ? "Der Stopp-Abstand ist zu klein, um eine Position zu bemessen." : "Der Einstieg kam auf den Kerzen nicht zustande.", { stop, target });
  const perUnit = tr.qty > 0 ? tr.pnl / tr.qty : 0;
  const atEnd = prep.exitIdx != null && tr.exitIndex === prep.exitIdx;
  return {
    id: scenario.id,
    label: scenario.label,
    status: "ok",
    r: perUnit / origRisk,
    money: trade.qty != null && trade.qty > 0 ? perUnit * trade.qty : null,
    stop,
    target,
    exitReason: tr.reason,
    exitLabel: exitLabelOf(tr, horizon, atEnd),
    exitPrice: tr.exit,
    exitAt: prep.bars[tr.exitIndex]!.t * 1000,
    bars: tr.bars,
    ambiguous: tr.ambiguous === true,
    partials: tr.partials?.length ?? 0,
  };
}

/** The recorded rules replayed on the candles – the yardstick every variant is compared with. */
export const BASELINE: Scenario = { id: "base", label: "Nachrechnung mit deinen Regeln" };

/** Ready-made variants (each is one question: tighter / wider stop, break-even, partial, other target, run-on, trailing). */
export const PRESET_SCENARIOS: readonly Scenario[] = [
  { id: "tight", label: "Stopp enger (0,5× Abstand)", stop: { kind: "factor", value: 0.5 } },
  { id: "wide", label: "Stopp weiter (1,5× Abstand)", stop: { kind: "factor", value: 1.5 } },
  { id: "be1", label: "Break-even ab +1 R", breakEven: { afterR: 1, to: "entry" } },
  { id: "part1", label: "Hälfte bei +1 R, Rest mit Break-even", partial: { atR: 1, frac: 0.5, thenBreakEven: true } },
  { id: "tgt2", label: "Ziel bei +2 R", target: { kind: "r", value: 2 } },
  { id: "trail", label: "Trailing 1,5 × ATR ab +1 R", trail: { kind: "atr", value: 1.5, activateR: 1 } },
  { id: "runon", label: "Weiterlaufen bis Stopp oder Ziel", horizon: { kind: "runOn" } },
];

export interface WhatIfRun {
  base: ScenarioResult;
  results: ScenarioResult[];
}

/** Baseline + the given scenarios. */
export function runScenarios(trade: WhatIfTrade, bars: readonly WhatIfBar[], intervalMs: number, scenarios: readonly Scenario[]): WhatIfRun {
  return { base: simulateScenario(trade, bars, intervalMs, BASELINE), results: scenarios.map((s) => simulateScenario(trade, bars, intervalMs, s)) };
}

/** R difference to the baseline (`null` when one side is missing). */
export const deltaR = (r: ScenarioResult, base: ScenarioResult): number | null => (r.r != null && base.r != null ? r.r - base.r : null);

/**
 * The recorded outcome in comparable terms: the journal's own R / P&L (after fees) and the gross R of the price move
 * `entry → exit` against the original stop distance.
 */
export function recordedOutcome(t: WhatIfTrade, recorded: { r: number | null; pnl: number | null }): { r: number | null; pnl: number | null; grossR: number | null } {
  const orig = Math.abs(t.entry - t.stop);
  const grossR = t.exit != null && orig > 0 ? ((t.side === "long" ? 1 : -1) * (t.exit - t.entry)) / orig : null;
  return { r: recorded.r, pnl: recorded.pnl, grossR };
}

/** True when at least one OK scenario was decided by the conservative same-candle rule. */
export const anyAmbiguous = (run: WhatIfRun): boolean => [run.base, ...run.results].some((r) => r.ambiguous);
