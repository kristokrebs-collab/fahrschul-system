/**
 * State of a run of the optimiser (memory only, one run at a time) and the trial log of this device (localStorage, a
 * convenience with an upper limit and rotation, `@/domain/evolve` `protocol.ts`).
 *
 * `start` builds the job input from the strategies and their candles (candles shared by several strategies are sent to the
 * worker once), starts the run (`startEvolve`: Web Worker, else tiny slices on the page) and mirrors its snapshots. When the
 * run is done its proposals are stored as OPEN proposals in `settings.evolve` and the trials are counted per strategy – that is
 * all the run ever writes; deciding a proposal is the user's click (`actions.ts`).
 */
import { create } from "zustand";
import type { BarsBy } from "@/domain/backtest/index";
import { appendEntries, bookToJson, EMPTY_LOG, parseBook, weightsOf, DEFAULT_OPTS, type EvolveRun, type LogBook, type LogEntry, type MultiInput, type MultiResult, type MultiSnapshot, type Power, type RunState, type StrategyInput, type Throttle, startEvolve, MAX_STRATEGIES } from "@/domain/evolve";
import { storageKey } from "@/store/storage";
import { addRunResult, evolveNow, priorFor, setPower as savePower } from "./actions";
import type { CandleSet, StrategyEntry } from "./types";

export type RunStatus = "idle" | "starting" | "running" | "paused" | "stopping" | "done" | "error";

export const DEFAULT_BUDGET = 400;
const LOG_KEY = storageKey("evolve-log");

function readBook(): LogBook {
  try {
    const raw = globalThis.localStorage?.getItem(LOG_KEY);
    return raw ? parseBook(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

let writeTimer: ReturnType<typeof setTimeout> | undefined;
function writeBookSoon(book: LogBook, now = false): void {
  const write = (): void => {
    try {
      globalThis.localStorage?.setItem(LOG_KEY, JSON.stringify(bookToJson(book)));
    } catch {
      /* private mode / quota: the log works for this session only */
    }
  };
  clearTimeout(writeTimer);
  if (now) write();
  else writeTimer = setTimeout(write, 1500);
}

export interface StartArgs {
  entries: readonly StrategyEntry[];
  candles: Readonly<Record<string, CandleSet | undefined>>;
  budget?: number;
  seed: number;
  power: Power;
  /** test hook: run on the page */
  inline?: boolean;
}

interface EvolveStore {
  status: RunStatus;
  snapshot: MultiSnapshot | null;
  result: MultiResult | null;
  /** ids and names of the strategies of the run */
  run: { id: string; name: string }[];
  throttle: Throttle | null;
  via: "worker" | "inline" | null;
  error: string | null;
  seed: number | null;
  startedAt: number | null;
  book: LogBook;
  start(a: StartArgs): void;
  pause(): void;
  resume(): void;
  stop(): void;
  abort(): void;
  setPower(p: Power): void;
}

let current: EvolveRun | null = null;

function inputOf(a: StartArgs): MultiInput | null {
  const datasets: Record<string, BarsBy> = {};
  const keyOf = new Map<CandleSet, string>();
  const strategies: StrategyInput[] = [];
  const testShare = 1 - DEFAULT_OPTS.trainFrac - DEFAULT_OPTS.holdoutFrac;
  for (const e of a.entries.slice(0, MAX_STRATEGIES)) {
    const c = a.candles[e.id];
    if (!c) return null;
    let k = keyOf.get(c);
    if (!k) {
      k = `ds${keyOf.size + 1}`;
      keyOf.set(c, k);
      datasets[k] = c.data;
    }
    strategies.push({
      id: e.id,
      name: e.name,
      datasetKey: k,
      base: e.config,
      signal: e.signal,
      symbol: e.symbol,
      fromMs: c.fromMs,
      engine: e.engine,
      maxTrials: a.budget ?? DEFAULT_BUDGET,
      priorTrials: priorFor(e.id, c.toMs, testShare * (c.toMs - c.fromMs)),
      weights: weightsOf(evolveNow().learn),
    });
  }
  return strategies.length ? { datasets, strategies, seed: a.seed } : null;
}

export const useEvolve = create<EvolveStore>()((set, get) => ({
  status: "idle",
  snapshot: null,
  result: null,
  run: [],
  throttle: null,
  via: null,
  error: null,
  seed: null,
  startedAt: null,
  book: readBook(),
  start(a) {
    if (current) return;
    const input = inputOf(a);
    if (!input) {
      set({ status: "error", error: "Für mindestens eine Strategie fehlen die Kerzen." });
      return;
    }
    const startedAt = Date.now();
    const ctx = input.strategies.map((s) => ({ sid: s.id, prior: s.priorTrials, dataTo: a.candles[s.id]!.toMs }));
    set({ status: "starting", snapshot: null, result: null, error: null, run: input.strategies.map((s) => ({ id: s.id, name: s.name })), seed: a.seed, startedAt, throttle: null });
    const run = startEvolve(
      input,
      {
        onProgress(snap: MultiSnapshot, entries: LogEntry[]) {
          let book = get().book;
          if (entries.length) {
            const by = new Map<string, LogEntry[]>();
            for (const e of entries) by.set(e.sid, [...(by.get(e.sid) ?? []), e]);
            book = { ...book };
            for (const [sid, es] of by) book[sid] = appendEntries(book[sid] ?? EMPTY_LOG, es);
            writeBookSoon(book);
          }
          set({ snapshot: snap, book });
        },
        onState(s: RunState) {
          if (s === "running") set({ status: "running" });
          else if (s === "paused") set({ status: "paused" });
          else if (s === "stopping") set({ status: "stopping" });
          if (current?.via) set({ via: current.via });
        },
        onThrottle: (t) => set({ throttle: t }),
      },
      { power: a.power, mode: a.inline ? "inline" : "auto" },
    );
    current = run;
    set({ via: run.via });
    void run.done.then(async (out) => {
      if (current !== run) return;
      current = null;
      writeBookSoon(get().book, true);
      if (out.kind === "done") {
        set({ result: out.result, snapshot: out.snap, status: "done", via: run.via });
        const drafts = out.result.strategies.flatMap((s) => s.proposals);
        const lineage = out.result.strategies.map((s) => {
          const c = ctx.find((x) => x.sid === s.id);
          return { sid: s.id, trials: s.trials, prior: c?.prior ?? 0, dataTo: c?.dataTo ?? 0 };
        });
        await addRunResult(drafts, lineage, Date.now());
      } else if (out.kind === "error") set({ status: "error", error: out.message });
      else set({ status: "idle", snapshot: null, result: null });
    });
  },
  pause: () => current?.pause(),
  resume: () => current?.resume(),
  stop: () => {
    if (current && get().status !== "done") {
      set({ status: "stopping" });
      current.stop();
    }
  },
  abort() {
    current?.abort();
  },
  setPower(p) {
    current?.setPower(p);
    void savePower(p);
  },
}));

/** Test hook: forget everything (and stop a run). */
export function __resetEvolve(): void {
  current?.abort();
  current = null;
  clearTimeout(writeTimer);
  useEvolve.setState({ status: "idle", snapshot: null, result: null, run: [], throttle: null, via: null, error: null, seed: null, startedAt: null, book: {} });
}
