/**
 * A saved simulation of the Zeitmaschine (A3): the record that is kept in IndexedDB (and – only while signed in – in the cloud
 * table `simulations`, migration 0011). Pure: building, checking and mapping records; no storage, no network.
 *
 * What a record holds, and why:
 *  - `simulationId` = `sim_` + a hash of everything the figures depend on (model version, symbol, candle length, plan, options
 *    with seed / runs / time stop, costs, start time, the data hash and the trade). The same inputs give the same id; another seed,
 *    another plan or other candles give another one. The id therefore proves WHICH simulation a position or a trade points at.
 *  - `modelVersion`: bump `MODEL_VERSION` whenever the arithmetic of the simulation changes (the golden test of the figures fails
 *    until it is done on purpose).
 *  - `dataHash` / `dataBars` / `dataFromMs` / `dataToMs` / `source` / `fetchedAt`: the candles it was computed from and their stand.
 *  - `costs`, `plan`, `options`: the assumptions; `size` = runs × time stop.
 *  - `metrics`: the key figures (small, shown at the trade and stored in the cloud); `resultHash`: a hash of the figures so a
 *    recomputation from seed + candles can say "identical" or "different".
 *  - `result`: the whole `TmResult` (device only, never sent to the cloud). Without it (a record that came from the cloud) the
 *    figures are still there; the full picture needs a recomputation with the same seed and the same candles.
 * A simulation is a way to look at a plan, not a forecast.
 */
import type { CostModel } from "../backtest/types";
import { canon, dataHashOf, sha256Hex } from "./hash";
import { TM_RUNS, isTmInterval, type TmInput, type TmInterval, type TmOptions, type TmPlan, type TmResult, type TmVerdictTone } from "./types";

/** Version of the simulation arithmetic. A change of any figure for the same inputs REQUIRES a new value here. */
export const MODEL_VERSION = "zeitmaschine/1";

/** What the model covers and what it does not – shown in the card, never hidden. */
export const MODEL_SCOPE = {
  included: [
    "Neu gemischte Sitzungen aus den echten Kerzen des Marktes (Block-Bootstrap, gleiche Tageszeit, Schwankung „wie heute“).",
    "Gebühren (Maker/Taker), eine feste Slippage pro Ein- und Ausstieg und – bei Krypto-Perpetuals – pauschales Funding.",
    "Stop vor Ziel innerhalb einer Kerze, Lücken über den Stop (Ausführung zur Eröffnung), Zeitstopp, optional Break-even und Trailing.",
    "Ein fester Zufallsstartwert (Seed): dieselben Eingaben ergeben dieselben Zahlen.",
  ],
  missing: [
    "Spread (Geld-Brief-Abstand): nur die pauschale Slippage, kein echter Orderbuch-Spread.",
    "Liquidität und Orderbuchtiefe: keine Teilausführung, kein Marktpreiseinfluss großer Aufträge.",
    "Marktregime: Trend, Seitwärtsphase und Krise werden nicht getrennt; die ganze Historie wird gemischt.",
    "Nachrichten, Termine, Handelsaussetzungen, Korrelation zu anderen Märkten.",
    "Margin, Liquidation, Steuern, Ausfälle der Börse.",
  ],
  note: "Eine Simulation ist keine Prognose: sie zeigt, was dein Plan in neu gemischten Kerzen der Vergangenheit getan hätte – nicht, was kommt.",
} as const;

export type SimulationSyncState = "local" | "pending" | "synced";

/** The figures kept with a simulation (small enough for the cloud row). Shares are 0…1, R in R of the planned risk. */
export interface SimMetrics {
  /** simulated sessions that were played (skipped ones left out) */
  runs: number;
  targetP: number;
  stopP: number;
  neitherP: number;
  movedP: number;
  targetLo: number;
  targetHi: number;
  stopLo: number;
  stopHi: number;
  expectancyR: number;
  expectancyLo: number;
  expectancyHi: number;
  costR: number;
  worstR: number;
  p5R: number;
  medianR: number;
  p95R: number;
  bestR: number;
  /** target in R */
  targetR: number;
  verdictId: string;
  verdictTone: TmVerdictTone;
  verdict: string;
  /** earlier occasions on the real candles */
  historyN: number;
  historyTargetP: number | null;
  historyStopP: number | null;
  historyExpectancyR: number | null;
}

export interface SimulationRecord {
  v: 1;
  simulationId: string;
  /** ISO time the record was made */
  createdAt: string;
  tradeId: string | null;
  symbol: string;
  interval: TmInterval;
  plan: TmPlan;
  options: TmOptions;
  costs: CostModel;
  startMs: number | null;
  seed: number;
  modelVersion: string;
  dataHash: string;
  dataBars: number;
  dataFromMs: number | null;
  dataToMs: number | null;
  source: string | null;
  fetchedAt: number | null;
  size: { runs: number; horizon: number };
  metrics: SimMetrics;
  resultHash: string;
  /** the whole result (device only); `null` after a record came from the cloud */
  result: TmResult | null;
  sync: SimulationSyncState;
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;

export function metricsOf(r: TmResult): SimMetrics {
  const s = r.sim;
  const h = r.history;
  const hp = h.n >= 10;
  return {
    runs: s.runs,
    targetP: r4(s.target.p),
    stopP: r4(s.stop.p),
    neitherP: r4(s.neither.p),
    movedP: r4(s.moved.p),
    targetLo: r4(s.target.lo),
    targetHi: r4(s.target.hi),
    stopLo: r4(s.stop.lo),
    stopHi: r4(s.stop.hi),
    expectancyR: r4(s.expectancy.mean),
    expectancyLo: r4(s.expectancy.lo),
    expectancyHi: r4(s.expectancy.hi),
    costR: r4(s.costR),
    worstR: r4(s.cases.worst),
    p5R: r4(s.cases.p5),
    medianR: r4(s.cases.median),
    p95R: r4(s.cases.p95),
    bestR: r4(s.cases.best),
    targetR: r4(r.targetR),
    verdictId: r.verdict.id,
    verdictTone: r.verdict.tone,
    verdict: r.verdict.text.slice(0, 240),
    historyN: h.n,
    historyTargetP: hp ? r4(h.target.p) : null,
    historyStopP: hp ? r4(h.stop.p) : null,
    historyExpectancyR: hp && h.expectancy ? r4(h.expectancy.mean) : null,
  };
}

/**
 * A fingerprint of the figures of a result: counts and values rounded to six places (a last-bit difference of `Math.exp` between two
 * browsers must not read as "a different simulation"). The same seed, plan, options, costs and candles give the same hash.
 */
export function resultHashOf(r: TmResult): string {
  const s = r.sim;
  const h = r.history;
  return sha256Hex(
    canon({
      m: MODEL_VERSION,
      seed: r.seed,
      runs: s.runs,
      skipped: s.skipped,
      k: [s.target.k, s.stop.k, s.neither.k, s.moved.k],
      exp: [r6(s.expectancy.mean), r6(s.expectancy.sd)],
      costR: r6(s.costR),
      cases: [r6(s.cases.worst), r6(s.cases.p5), r6(s.cases.median), r6(s.cases.p95), r6(s.cases.best)],
      hist: s.hist.bins.map((b) => b.n),
      fan: [r6(s.endR.p5), r6(s.endR.p50), r6(s.endR.p95)],
      hn: [h.n, h.target.k, h.stop.k, h.neither.k, h.openAtEnd, h.unfilled],
      verdict: r.verdict.id,
    }),
  );
}

/** The id of a simulation: a hash of everything the figures depend on, and of the trade it belongs to. */
export function simulationIdOf(input: TmInput, dataHash: string, tradeId: string | null): string {
  const { symbol, interval, plan, costs, startMs } = input;
  const opts: TmOptions = { runs: input.runs, seed: input.seed, horizon: input.horizon, method: input.method, blockLen: input.blockLen, drift: input.drift, vol: input.vol, trigger: input.trigger, validBars: input.validBars, manage: input.manage };
  return `sim_${sha256Hex(canon({ m: MODEL_VERSION, symbol, interval, plan, costs, startMs, opts, dataHash, tradeId })).slice(0, 32)}`;
}

export interface RecordMeta {
  tradeId?: string | null;
  source?: string | null;
  fetchedAt?: number | null;
  /** epoch ms; default `Date.now()` */
  now?: number;
}

/** The record of a finished run. `input` is what the run was given (its candles give the data hash). */
export function buildRecord(input: TmInput, result: TmResult, meta: RecordMeta = {}): SimulationRecord {
  const tradeId = meta.tradeId ?? null;
  const dataHash = dataHashOf(input.bars);
  return {
    v: 1,
    simulationId: simulationIdOf(input, dataHash, tradeId),
    createdAt: new Date(meta.now ?? Date.now()).toISOString(),
    tradeId,
    symbol: input.symbol,
    interval: input.interval,
    plan: { ...input.plan },
    options: result.options,
    costs: input.costs,
    startMs: input.startMs,
    seed: result.seed,
    modelVersion: MODEL_VERSION,
    dataHash,
    dataBars: input.bars.length,
    dataFromMs: result.pool.fromMs,
    dataToMs: result.pool.toMs,
    source: meta.source ?? null,
    fetchedAt: meta.fetchedAt ?? null,
    size: { runs: result.sim.runs, horizon: result.sim.horizon },
    metrics: metricsOf(result),
    resultHash: resultHashOf(result),
    result,
    sync: "local",
  };
}

/** Same inputs, same figures? (`result` of a recomputation against a saved record.) */
export function sameFigures(record: Pick<SimulationRecord, "resultHash">, again: TmResult): boolean {
  return record.resultHash === resultHashOf(again);
}

/* ------------------------------------------------------------------------------------------------ reading what was stored */

const HEX64 = /^[0-9a-f]{64}$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nn = (v: unknown): number | null => (isNum(v) ? v : null);

function metricsFrom(v: unknown): SimMetrics | null {
  if (!isObj(v)) return null;
  const need = ["runs", "targetP", "stopP", "neitherP", "movedP", "targetLo", "targetHi", "stopLo", "stopHi", "expectancyR", "expectancyLo", "expectancyHi", "costR", "worstR", "p5R", "medianR", "p95R", "bestR", "targetR", "historyN"] as const;
  for (const k of need) if (!isNum(v[k])) return null;
  if (!isStr(v.verdictId, 40) || !isStr(v.verdict, 300)) return null;
  const tone = v.verdictTone;
  if (tone !== "win" && tone !== "loss" && tone !== "warn" && tone !== "mute") return null;
  const m = v as unknown as SimMetrics;
  return { ...m, verdictTone: tone, historyTargetP: nn(v.historyTargetP), historyStopP: nn(v.historyStopP), historyExpectancyR: nn(v.historyExpectancyR) };
}

function planFrom(v: unknown): TmPlan | null {
  if (!isObj(v) || (v.side !== "long" && v.side !== "short") || !isNum(v.entry) || !isNum(v.stop) || !isNum(v.target)) return null;
  return { side: v.side, entry: v.entry, stop: v.stop, target: v.target };
}

/** A stored value as a record, or `null` when it is not one (an unreadable record is skipped, never repaired). */
export function parseRecord(v: unknown): SimulationRecord | null {
  if (!isObj(v) || v.v !== 1) return null;
  if (!isStr(v.simulationId, 80) || !/^sim_[0-9a-f]{20,64}$/.test(v.simulationId)) return null;
  if (!isStr(v.createdAt, 40) || !Number.isFinite(Date.parse(v.createdAt))) return null;
  const tradeId = v.tradeId == null ? null : isStr(v.tradeId, 80) && v.tradeId ? v.tradeId : undefined;
  if (tradeId === undefined) return null;
  if (!isStr(v.symbol, 40) || !v.symbol || !isTmInterval(v.interval)) return null;
  const plan = planFrom(v.plan);
  const metrics = metricsFrom(v.metrics);
  if (!plan || !metrics || !isObj(v.options) || !isObj(v.costs)) return null;
  if (!isNum(v.seed) || !isStr(v.modelVersion, 40) || typeof v.dataHash !== "string" || !HEX64.test(v.dataHash) || typeof v.resultHash !== "string" || !HEX64.test(v.resultHash)) return null;
  if (!isNum(v.dataBars) || !isObj(v.size) || !isNum(v.size.runs) || !isNum(v.size.horizon)) return null;
  const result = isObj(v.result) && v.result.v === 1 && isObj(v.result.sim) && isObj(v.result.history) ? (v.result as unknown as TmResult) : null;
  const sync = v.sync === "synced" || v.sync === "pending" ? v.sync : "local";
  return {
    v: 1,
    simulationId: v.simulationId,
    createdAt: v.createdAt,
    tradeId,
    symbol: v.symbol,
    interval: v.interval,
    plan,
    options: v.options as unknown as TmOptions,
    costs: v.costs as unknown as CostModel,
    startMs: nn(v.startMs),
    seed: v.seed,
    modelVersion: v.modelVersion,
    dataHash: v.dataHash,
    dataBars: v.dataBars,
    dataFromMs: nn(v.dataFromMs),
    dataToMs: nn(v.dataToMs),
    source: isStr(v.source, 120) ? v.source : null,
    fetchedAt: nn(v.fetchedAt),
    size: { runs: v.size.runs, horizon: v.size.horizon },
    metrics,
    resultHash: v.resultHash,
    result,
    sync,
  };
}

/* ------------------------------------------------------------------------------------------------ cloud row (table `simulations`) */

export interface SimulationRow {
  id: string;
  trade_id: string | null;
  symbol: string;
  interval: TmInterval;
  seed: number;
  model_version: string;
  data_hash: string;
  data_bars: number;
  data_from: string | null;
  data_to: string | null;
  source: string | null;
  runs: number;
  horizon: number;
  plan: TmPlan;
  costs: CostModel;
  metrics: SimMetrics & { options: TmOptions; startMs: number | null; fetchedAt: number | null };
  result_hash: string;
  client_created_at: string;
}

const iso = (ms: number | null): string | null => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** The row for the cloud: figures and hashes only – never the paths or the list of occasions. `user_id` is added by the adapter. */
export function toRow(r: SimulationRecord): SimulationRow {
  return {
    id: r.simulationId,
    trade_id: r.tradeId,
    symbol: r.symbol,
    interval: r.interval,
    seed: r.seed,
    model_version: r.modelVersion,
    data_hash: r.dataHash,
    data_bars: r.dataBars,
    data_from: iso(r.dataFromMs),
    data_to: iso(r.dataToMs),
    source: r.source,
    runs: Math.max(1, Math.min(100_000, r.options.runs || r.size.runs || TM_RUNS)),
    horizon: Math.max(1, Math.min(400, r.size.horizon)),
    plan: r.plan,
    costs: r.costs,
    // the options the recomputation needs ride along inside `metrics` (the table has no column for them)
    metrics: { ...r.metrics, options: r.options, startMs: r.startMs, fetchedAt: r.fetchedAt },
    result_hash: r.resultHash,
    client_created_at: r.createdAt,
  };
}

/** A cloud row as a record without its result (`sync: "synced"`); `null` when the row is not readable. */
export function fromRow(row: unknown): SimulationRecord | null {
  if (!isObj(row) || !isObj(row.metrics)) return null;
  const m = row.metrics;
  const { options, startMs, fetchedAt, ...metrics } = m;
  const t = (x: unknown): number | null => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null);
  return parseRecord({
    v: 1,
    simulationId: row.id,
    createdAt: row.client_created_at ?? row.created_at,
    tradeId: row.trade_id ?? null,
    symbol: row.symbol,
    interval: row.interval,
    plan: row.plan,
    options,
    costs: row.costs,
    startMs: startMs ?? null,
    seed: row.seed,
    modelVersion: row.model_version,
    dataHash: row.data_hash,
    dataBars: row.data_bars,
    dataFromMs: t(row.data_from),
    dataToMs: t(row.data_to),
    source: row.source ?? null,
    fetchedAt: fetchedAt ?? null,
    size: { runs: row.runs, horizon: row.horizon },
    metrics,
    resultHash: row.result_hash,
    result: null,
    sync: "synced",
  });
}
