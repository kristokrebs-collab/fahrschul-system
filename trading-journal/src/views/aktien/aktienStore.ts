/**
 * State of the Aktien page (memory, plus the user's scanner choices per device): the scanner's preferences and thresholds,
 * the run that is going or the last one, and the ticker picked for the analysis slots. The run itself is
 * `scanRunner.ts`; this store only starts it, keeps its progress and result, and stops it.
 */
import { create } from "zustand";
import { defaultParamsFor, sanitizeParams, type MarketKind, type ScanMode, type ScanOutcome, type ScanParams, type ScanProgress } from "@/domain/scanner";
import { storageKey, readJson, writeJson } from "@/store/storage";
import type { UnavailableReason } from "@/market/stocks/types";
import { DEFAULT_PREFS, prepareAndRun, type RunDeps, type RunMeta, type ScanPrefs } from "./scanRunner";

const PREFS_KEY = storageKey("aktien-scan");

export type RunState =
  | { status: "idle" }
  | { status: "running"; progress: ScanProgress | null; startedAt: number }
  | { status: "done" | "aborted"; outcome: ScanOutcome; meta: RunMeta }
  | { status: "error"; stage: "universe" | "empty"; reason: UnavailableReason | null; message: string };

export const paramsKey = (market: MarketKind, mode: ScanMode): string => `${market}:${mode}`;

interface Stored {
  prefs: ScanPrefs;
  params: Record<string, ScanParams>;
}

function load(): Stored {
  const raw = readJson<{ prefs?: Partial<ScanPrefs>; params?: Record<string, unknown> } | null>(PREFS_KEY, null);
  const p = raw?.prefs ?? {};
  const prefs: ScanPrefs = {
    market: p.market === "crypto" ? "crypto" : "stock",
    mode: p.mode === "orb" ? "orb" : "daily",
    daily: { flag: p.daily?.flag !== false, rsi: p.daily?.rsi !== false },
    stock: {
      source: p.stock?.source === "watchlist" || p.stock?.source === "custom" ? p.stock.source : "directory",
      cap: typeof p.stock?.cap === "number" ? p.stock.cap : DEFAULT_PREFS.stock.cap,
      block: typeof p.stock?.block === "number" && p.stock.block >= 1 ? Math.round(p.stock.block) : 1,
      custom: typeof p.stock?.custom === "string" ? p.stock.custom.slice(0, 600) : "",
    },
    crypto: { top: typeof p.crypto?.top === "number" ? p.crypto.top : DEFAULT_PREFS.crypto.top },
    rank: p.rank === "metric" || p.rank === "symbol" ? p.rank : "turnover",
  };
  const params: Record<string, ScanParams> = {};
  for (const [k, v] of Object.entries(raw?.params ?? {})) params[k] = sanitizeParams(v);
  return { prefs, params };
}

interface AktienState {
  prefs: ScanPrefs;
  /** thresholds edited by the user, per market and mode (absent = the defaults of that market and mode) */
  params: Record<string, ScanParams>;
  run: RunState;
  /** the ticker picked for the analysis slots */
  selected: string | null;
  setPrefs(patch: Partial<ScanPrefs>): void;
  setParams(market: MarketKind, mode: ScanMode, p: ScanParams): void;
  resetParams(market: MarketKind, mode: ScanMode): void;
  start(watchlistStocks: readonly string[], deps?: RunDeps): Promise<void>;
  abort(): void;
  select(symbol: string | null): void;
}

let controller: AbortController | null = null;
const initial = load();

export const useAktien = create<AktienState>((set, get) => {
  const persist = (): void => {
    const { prefs, params } = get();
    writeJson(PREFS_KEY, { prefs, params });
  };
  return {
    prefs: initial.prefs,
    params: initial.params,
    run: { status: "idle" },
    selected: null,
    setPrefs: (patch) => {
      set((s) => ({ prefs: { ...s.prefs, ...patch } }));
      persist();
    },
    setParams: (market, mode, p) => {
      set((s) => ({ params: { ...s.params, [paramsKey(market, mode)]: sanitizeParams(p) } }));
      persist();
    },
    resetParams: (market, mode) => {
      set((s) => {
        const next = { ...s.params };
        delete next[paramsKey(market, mode)];
        return { params: next };
      });
      persist();
    },
    start: async (watchlistStocks, deps) => {
      if (get().run.status === "running") return;
      const ctrl = new AbortController();
      controller = ctrl;
      const { prefs } = get();
      const params = get().params[paramsKey(prefs.market, prefs.mode)] ?? defaultParamsFor(prefs.market, prefs.mode);
      set({ run: { status: "running", progress: null, startedAt: (deps?.now ?? Date.now)() } });
      let result: Awaited<ReturnType<typeof prepareAndRun>>;
      try {
        result = await prepareAndRun(prefs, params, watchlistStocks, ctrl.signal, (progress) => {
          if (controller === ctrl) set((s) => (s.run.status === "running" ? { run: { ...s.run, progress } } : s));
        }, deps);
      } catch (e) {
        if (controller === ctrl) set({ run: { status: "error", stage: "universe", reason: null, message: e instanceof Error && e.message ? e.message : "Der Scan ist unerwartet abgebrochen." } });
        return;
      }
      if (controller !== ctrl) return;
      if (!result.ok) set({ run: { status: "error", stage: result.stage, reason: result.stage === "universe" ? result.reason : null, message: result.message } });
      else set({ run: { status: result.outcome.status, outcome: result.outcome, meta: result.meta } });
    },
    abort: () => {
      controller?.abort();
    },
    select: (symbol) => set({ selected: symbol }),
  };
});

/** Tests: back to a clean state (memory only; the stored choices are left to the test). */
export function resetAktienForTests(): void {
  controller?.abort();
  controller = null;
  useAktien.setState({ prefs: DEFAULT_PREFS, params: {}, run: { status: "idle" }, selected: null });
}
