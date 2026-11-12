/**
 * State of the strategy search („1.000 Varianten. Eine bleibt.“) on the Labor page: the per-viewer set-up (family, candle length, seed –
 * a convenience in localStorage), the running search (phase, real counts), the shown result and the candles it ran on (memory only,
 * for the animation and the current candidate), and the saved searches (localStorage, versioned, capped – the Labor's own way of
 * keeping runs). Market and period are the Labor's (`useLabor().cfg`); costs too.
 *
 * `startSearch()` loads the real candles – the Labor's loader for the trend family (`loadLabData`: cache first, closed bars only, fallbacks
 * named), 5-minute candles of Binance for the opening-range family (`orbSource.ts`, NO substitute data) – and runs the job on the lab worker
 * (`runSearch`). A `fixture` (tests, demo preview) skips the network and is labelled as demo data.
 */
import { create } from "zustand";
import { DEFAULT_FUNDING_RATE, estimatePages, feePreset, fundingModelOf, HIST_MS, isLabAbort, runSearch, type Bar, type EngineCfg, type HistInterval } from "@/domain/backtest/index";
import {
  candidateOf,
  DEFAULT_SEED,
  MIN_WINDOW_BARS,
  SEARCH_INTERVALS,
  SEARCH_MODEL_VERSION,
  SEARCH_WARMUP_BARS,
  SearchDataError,
  type Candidate,
  type SearchFamily,
  type SearchInterval,
  type SearchJobInput,
  type SearchResult,
} from "@/domain/lab/search";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { toRestError } from "@/market/sources/http";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { HISTORY_SOURCES, loadErrorKind, loadLabData, type HistorySource } from "../historySource";
import { PERIOD_DAYS, useLabor } from "../laborStore";
import { LABOR } from "../strings";
import { loadOrbCandles, OrbLoadError } from "./orbSource";
import { SEARCH } from "./strings";

export type SearchStatus = "idle" | "loading" | "running" | "done" | "error" | "cancelled";
export type FamilyChoice = "both" | SearchFamily;

export interface SearchCfg {
  family: FamilyChoice;
  interval: SearchInterval;
  seed: number;
}

export const DEFAULT_SEARCH_CFG: SearchCfg = { family: "both", interval: "4h", seed: DEFAULT_SEED };

/** Tage 5-Minuten-Kerzen der Eröffnungs-Range-Familie (und 2 Tage Vorlauf für EMA 50 und Volumenschnitt). */
export const ORB_DAYS = 60;
export const ORB_WARMUP_DAYS = 2;

/** Test / demo-preview data: candles handed in, no network. Always labelled as demo. */
export interface SearchFixture {
  trend?: { bars: readonly Bar[]; symbol: string; interval: SearchInterval };
  orb?: { bars: readonly Bar[]; symbol: string };
}

/** What is kept of a finished search: everything but the 1.000 curves and rows (they are recomputed from seed + candles). */
export type SearchSummary = Omit<SearchResult, "rows" | "curves"> & { id: string; at: number; period: string | null };

export const SAVED_MAX = 8;
const CFG_KEY = storageKey("labor-search-cfg");
const SAVED_KEY = storageKey("labor-search");

export function sanitizeCfg(raw: unknown): SearchCfg {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SearchCfg>;
  return {
    family: r.family === "trend" || r.family === "orb" || r.family === "both" ? r.family : DEFAULT_SEARCH_CFG.family,
    interval: SEARCH_INTERVALS.includes(r.interval as SearchInterval) ? (r.interval as SearchInterval) : DEFAULT_SEARCH_CFG.interval,
    seed: typeof r.seed === "number" && Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 4_294_967_295 ? r.seed : DEFAULT_SEARCH_CFG.seed,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Saved searches: versioned wrapper; an entry of another model version or a broken one is dropped, not repaired. */
export function readSaved(): SearchSummary[] {
  const raw = readJson<{ v?: number; items?: unknown }>(SAVED_KEY, {});
  if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return [];
  const out: SearchSummary[] = [];
  for (const it of raw.items) {
    if (!isObj(it) || typeof it.id !== "string" || typeof it.at !== "number" || it.model !== SEARCH_MODEL_VERSION) continue;
    if (!Array.isArray(it.datasets) || it.datasets.length === 0 || !isObj(it.counts) || !isObj(it.verdict) || !Array.isArray((it.verdict as { checks?: unknown }).checks)) continue;
    if (it.winner !== null && !isObj(it.winner)) continue;
    out.push(it as unknown as SearchSummary);
  }
  return out.slice(0, SAVED_MAX);
}

function writeSaved(items: SearchSummary[]): void {
  writeJson(SAVED_KEY, { v: 1, items });
}

export const summaryOf = (r: SearchResult, period: string | null, at = Date.now()): SearchSummary => {
  const { rows: _rows, curves: _curves, ...rest } = r;
  void _rows;
  void _curves;
  const d = r.datasets[0]!;
  return { ...rest, id: `${r.families.join("+")}:${d.symbol}:${r.seed}:${Math.max(...r.datasets.map((x) => x.toT))}`, at, period };
};

interface SearchState {
  cfg: SearchCfg;
  status: SearchStatus;
  progress: number;
  load: { done: number; total: number };
  /** the real count of the running phase: „412 von 1.000 geprüft“ */
  checked: { phase: string; done: number; total: number };
  error: string | null;
  result: SearchResult | null;
  /** summary of the shown (or restored) search; `result` is null for a restored one */
  summary: SearchSummary | null;
  /** candles of the WINNER's family (memory only) */
  bars: readonly Bar[];
  candidate: Candidate | null;
  candidateBusy: boolean;
  candidateError: string | null;
  /** counts up per finished search (the animation plays once per run) */
  runSeq: number;
  /** measured wall time of the last search's computation (worker, ms) – shown in the caption; `null` for a restored one */
  computeMs: number | null;
  saved: SearchSummary[];
  setCfg(patch: Partial<SearchCfg>): void;
  show(id: string): void;
}

export const useSearch = create<SearchState>()((set, get) => ({
  cfg: sanitizeCfg(readJson(CFG_KEY, null)),
  status: "idle",
  progress: 0,
  load: { done: 0, total: 0 },
  checked: { phase: "load", done: 0, total: 0 },
  error: null,
  result: null,
  summary: null,
  bars: [],
  candidate: null,
  candidateBusy: false,
  candidateError: null,
  runSeq: 0,
  computeMs: null,
  saved: readSaved(),
  setCfg(patch) {
    const cfg = sanitizeCfg({ ...get().cfg, ...patch });
    writeJson(CFG_KEY, cfg);
    set({ cfg });
  },
  show(id) {
    const s = get().saved.find((x) => x.id === id);
    if (!s) return;
    set({ status: "done", result: null, summary: s, bars: [], candidate: null, candidateError: null, error: null, runSeq: get().runSeq + 1, computeMs: null });
  },
}));

let ctl: AbortController | null = null;
let lastUi = 0;

/** The engine of the run: the Labor's costs and account (fees, slippage, funding). */
function engineOf(fundingPoints: Parameters<typeof fundingModelOf>[0], funding: "history" | "flat" | "none"): EngineCfg {
  const cfg = useLabor.getState().cfg;
  const fee = feePreset(cfg.exchange);
  return {
    capital: cfg.capital,
    riskPct: cfg.riskPct / 100,
    maxLeverage: cfg.maxLeverage,
    compounding: true,
    costs: { fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps }, slippage: cfg.slippage, funding: funding === "none" ? { kind: "none" } : fundingModelOf(funding === "history" ? fundingPoints : null, DEFAULT_FUNDING_RATE) },
  };
}

/** Pages of Binance the trend family needs for a period (upper bound, without the cache). */
export function pagesNeeded(interval: SearchInterval, days: number, now = Date.now()): number {
  const ms = HIST_MS[interval as HistInterval];
  const from = now - days * 86_400_000 - SEARCH_WARMUP_BARS * ms;
  return estimatePages(interval as HistInterval, from, now);
}

function finish(result: SearchResult, bars: Partial<Record<SearchFamily, readonly Bar[]>>, period: string | null, nowMs: number | null, computeMs: number): void {
  const summary = summaryOf(result, period);
  const saved = [summary, ...useSearch.getState().saved.filter((s) => s.id !== summary.id)].slice(0, SAVED_MAX);
  writeSaved(saved);
  const w = result.winner;
  const wb = (w && bars[w.variant.family]) || [];
  const wd = result.datasets.find((d) => d.family === result.winnerFamily);
  // nur wer bestanden hat, bekommt einen Kandidaten – sonst gibt es nichts anzubieten
  const candidate = result.verdict.passed && w && wd ? candidateOf(wb, wd.interval, w.variant, nowMs, w.stop) : null;
  useSearch.setState((s) => ({ status: "done", progress: 1, result, summary, bars: wb, candidate, candidateError: null, error: null, saved, runSeq: s.runSeq + 1, computeMs }));
}

const IS_ABORT = (e: unknown): boolean => isLabAbort(e) || (e instanceof Error && e.name === "AbortError");

/**
 * Runs a search. With a `fixture` (tests, demo preview) the candles are handed in and labelled demo; otherwise the Labor's market and
 * period are loaded. A newer start aborts an older run.
 */
export async function startSearch(opts: { fixture?: SearchFixture; now?: number } = {}): Promise<void> {
  ctl?.abort();
  const mine = new AbortController();
  ctl = mine;
  const cfg = useSearch.getState().cfg;
  const lab = useLabor.getState().cfg;
  const now = opts.now ?? Date.now();
  const wantTrend = opts.fixture ? !!opts.fixture.trend : cfg.family !== "orb";
  const wantOrb = opts.fixture ? !!opts.fixture.orb : cfg.family !== "trend";
  useSearch.setState({ status: "loading", progress: 0, load: { done: 0, total: 0 }, checked: { phase: "load", done: 0, total: 0 }, error: null, result: null, summary: null, candidate: null, candidateError: null });
  try {
    const input: Partial<SearchJobInput> = {};
    const bars: Partial<Record<SearchFamily, readonly Bar[]>> = {};
    let nowForCandidate: number | null = now;
    let period: string | null = null;
    let engine: EngineCfg;
    if (opts.fixture) {
      engine = engineOf(null, "flat");
      nowForCandidate = null;
      const t = opts.fixture.trend;
      if (t) {
        const first = Math.min(SEARCH_WARMUP_BARS, Math.max(0, t.bars.length - MIN_WINDOW_BARS));
        input.trend = { bars: t.bars, interval: t.interval, fromMs: (t.bars[first]?.t ?? 0) * 1000, meta: { symbol: t.symbol, interval: t.interval, source: "fixture", fixture: true } };
        bars.trend = t.bars;
      }
      const o = opts.fixture.orb;
      if (o) {
        input.orb = { bars: o.bars, fromMs: ((o.bars[0]?.t ?? 0) + ORB_WARMUP_DAYS * 86_400) * 1000, meta: { symbol: o.symbol, interval: "5m", source: "fixture", fixture: true } };
        bars.orb = o.bars;
      }
    } else {
      period = lab.period;
      let funding: Awaited<ReturnType<typeof loadLabData>>["funding"] = null;
      let used: "history" | "flat" | "none" = lab.funding === "none" ? "none" : "flat";
      const step = (n: number, of: number) => (done: number, total: number) => {
        if (ctl === mine) useSearch.setState({ load: { done, total }, progress: total ? ((n + Math.min(1, done / total)) / of) * 0.1 : 0 });
      };
      const parts = (wantTrend ? 1 : 0) + (wantOrb ? 1 : 0);
      let n = 0;
      let trendLoaded: Awaited<ReturnType<typeof loadLabData>> | null = null;
      if (wantTrend) {
        const ms = HIST_MS[cfg.interval as HistInterval];
        const fromMs = now - PERIOD_DAYS[lab.period] * 86_400_000;
        trendLoaded = await loadLabData({ symbol: lab.symbol, intervals: [cfg.interval as HistInterval], from: fromMs - SEARCH_WARMUP_BARS * ms, to: now, funding: lab.funding === "history", signal: mine.signal, fallback: true, onProgress: step(n++, parts) });
        if (ctl !== mine) return;
        const tb = trendLoaded.data[cfg.interval as HistInterval] ?? [];
        funding = trendLoaded.funding;
        if (lab.funding === "history" && funding) used = "history";
        input.trend = { bars: tb, interval: cfg.interval, fromMs, meta: { symbol: lab.symbol, interval: cfg.interval, source: trendLoaded.source ?? "binance", fixture: false } };
        bars.trend = tb;
      }
      if (wantOrb) {
        const from = now - (ORB_DAYS + ORB_WARMUP_DAYS) * 86_400_000;
        const ob = await loadOrbCandles({ symbol: lab.symbol, from, to: now, signal: mine.signal, onProgress: step(n++, parts) });
        if (ctl !== mine) return;
        input.orb = { bars: ob, fromMs: now - ORB_DAYS * 86_400_000, meta: { symbol: lab.symbol, interval: "5m", source: "binance", fixture: false } };
        bars.orb = ob;
      }
      engine = engineOf(funding, used);
    }
    if (input.trend && input.trend.bars.length < MIN_WINDOW_BARS) {
      useSearch.setState({ status: "error", error: SEARCH.errors.noData });
      return;
    }
    useSearch.setState({ status: "running", progress: 0.1, checked: { phase: "prepare", done: 0, total: 1000 } });
    const t0 = performance.now();
    const result = await runSearch({ ...input, engine, seed: cfg.seed } as SearchJobInput, {
      signal: mine.signal,
      onSearchProgress: (p) => {
        // ≤ ~8 UI updates per second; the count is the real one of the worker
        const t = Date.now();
        if (ctl !== mine || t - lastUi < 120) return;
        lastUi = t;
        useSearch.setState({ progress: 0.1 + 0.9 * p.progress, checked: { phase: p.phase, done: p.done, total: p.total } });
      },
    });
    if (ctl !== mine) return;
    finish(result, bars, period, nowForCandidate, performance.now() - t0);
  } catch (e) {
    if (ctl !== mine) return;
    if (IS_ABORT(e)) {
      useSearch.setState({ status: "cancelled", error: SEARCH.cancelled, progress: 0 });
      return;
    }
    const file = IS_FILE_BUILD || isFileProtocol();
    let msg: string;
    if (e instanceof SearchDataError) msg = e.message;
    else if (e instanceof OrbLoadError) msg = `${e.message} ${SEARCH.errors.noSubstitute}`;
    else if (toRestError(e).kind === "offline") msg = LABOR.errors.offline;
    else {
      const kind = loadErrorKind(e);
      msg = kind === "blocked" ? (file ? LABOR.errors.blockedFile : LABOR.errors.blocked) : kind === "rate" ? LABOR.errors.rate : kind === "symbol" ? LABOR.errors.symbol : SEARCH.errors.failed;
    }
    useSearch.setState({ status: "error", error: msg, progress: 0 });
  } finally {
    if (ctl === mine) ctl = null;
  }
}

export function cancelSearch(): void {
  ctl?.abort();
}

/**
 * Re-checks the candidate of a passed search with fresh candles (a restored search has none in memory). Loads only what the
 * rules need: the warm-up plus the lookback (trend) or three days (opening range); closed bars only.
 */
export async function checkCandidate(): Promise<void> {
  const s = useSearch.getState();
  const sum = s.summary;
  const w = sum?.winner;
  if (!sum || !w || !sum.verdict.passed || s.candidateBusy) return;
  const d = sum.datasets.find((x) => x.family === sum.winnerFamily);
  if (!d || d.fixture) return;
  useSearch.setState({ candidateBusy: true, candidateError: null });
  try {
    const now = Date.now();
    let bars: readonly Bar[];
    if (w.variant.family === "orb") {
      bars = await loadOrbCandles({ symbol: d.symbol, from: now - 3 * 86_400_000, to: now });
    } else {
      const interval = d.interval as SearchInterval;
      const loaded = await loadLabData({ symbol: d.symbol, intervals: [interval as HistInterval], from: now - SEARCH_WARMUP_BARS * HIST_MS[interval as HistInterval], to: now, funding: false, fallback: true });
      bars = loaded.data[interval as HistInterval] ?? [];
    }
    useSearch.setState({ bars, candidate: candidateOf(bars, d.interval, w.variant, now, w.stop), candidateBusy: false });
  } catch (e) {
    useSearch.setState({ candidateBusy: false, candidateError: e instanceof OrbLoadError ? `${e.message} ${SEARCH.errors.noSubstitute}` : SEARCH.candidate.checkFailed });
  }
}

/** Source label of the stand line. */
export const sourceNameOf = (source: string): string => (source === "fixture" ? "Test-Vorlage (Demo)" : (HISTORY_SOURCES[source as HistorySource]?.stand ?? source));

/** Test hook. */
export function __resetSearch(): void {
  ctl?.abort();
  ctl = null;
  lastUi = 0;
  useSearch.setState({ cfg: DEFAULT_SEARCH_CFG, status: "idle", progress: 0, load: { done: 0, total: 0 }, checked: { phase: "load", done: 0, total: 0 }, error: null, result: null, summary: null, bars: [], candidate: null, candidateBusy: false, candidateError: null, runSeq: 0, computeMs: null, saved: [] });
}
