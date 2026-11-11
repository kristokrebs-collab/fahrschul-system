/**
 * A scan run: the list of charts → loaded in batches → every chart through the pre-filter and the setups → one honest
 * summary. Market-neutral (a `ScanSource` loads candles for stocks or crypto) and cooperative:
 *
 *  - Time slices: the analysis yields to the browser whenever a slice (`sliceMs`, 12 ms) is used up, so the page keeps
 *    scrolling and the cancel button keeps working while hundreds of charts are read. (The rules are cheap; a worker would
 *    only add a copy of every candle – the slicing is what keeps the page responsive.)
 *  - Progress and cancel: `onProgress` after every batch and slice, an `AbortSignal` that stops loading and analysing at once;
 *    an aborted run still returns what it found, marked `aborted`.
 *  - Loading runs ahead of the analysis (`parallel` batches in flight), the source's own throttle keeps the requests polite.
 *  - Nothing is rounded up: `requested`, `scanned`, `skipped` (with the reason of each), `failed` (with the reason of each)
 *    and the error rate are counted from what actually happened, and a chart answered from an old cache is counted as `stale`.
 */
import { scanSymbol, type ScanInput } from "./scan";
import type { SessionCtx } from "./setups";
import type { Hit, MarketKind, ScanCandle, ScanParams, SetupId, SkipReason, Stand } from "./types";

export interface ScanTarget {
  symbol: string;
  name?: string | null;
  /** Nasdaq financial status, when the listing has one */
  fin?: string | null;
}

export type LoadOutcome = { ok: true; candles: readonly ScanCandle[]; stand: Omit<Stand, "lastBar"> } | { ok: false; reason: string; message: string };

export interface ScanSource {
  kind: MarketKind;
  /** candle interval word ("1d", "5m") */
  interval: string;
  barMs: number;
  /** charts per `load` call */
  batchSize: number;
  load(batch: readonly ScanTarget[], signal: AbortSignal): Promise<Record<string, LoadOutcome>>;
  /** the session the opening range belongs to, from the candles that arrived (`undefined` = none) */
  sessionFor?(candles: readonly ScanCandle[], asOf: number): SessionCtx | undefined;
}

export interface ScanProgress {
  phase: "running" | "done" | "aborted";
  requested: number;
  /** charts decided so far (scanned + skipped + failed) */
  processed: number;
  scanned: number;
  skipped: number;
  failed: number;
  hits: number;
  batchesDone: number;
  batchesTotal: number;
}

export interface FailedChart {
  symbol: string;
  reason: string;
  message: string;
}

export interface ScanOutcome {
  status: "done" | "aborted";
  startedAt: number;
  finishedAt: number;
  requested: number;
  scanned: number;
  skipped: number;
  failed: number;
  /** scanned charts whose candles came from an old cache because the refresh failed */
  stale: number;
  skippedBy: Partial<Record<SkipReason, number>>;
  failedBy: Record<string, number>;
  failures: FailedChart[];
  hits: Hit[];
  /** failed / requested (0 when nothing was requested) */
  errorRate: number;
}

export interface ScanRunOptions {
  source: ScanSource;
  targets: readonly ScanTarget[];
  params: ScanParams;
  setups: readonly SetupId[];
  signal?: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
  now?: () => number;
  /** monotonic ms for the slicing (default `performance.now`) */
  clock?: () => number;
  sliceMs?: number;
  yieldToMain?: () => Promise<void>;
  /** batches loading at once (default 2) */
  parallel?: number;
}

export const HARD_CAP = 400;
const MAX_FAILURES_KEPT = 200;

const defaultClock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const defaultYield = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function chunk<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export async function runScan(o: ScanRunOptions): Promise<ScanOutcome> {
  const now = o.now ?? Date.now;
  const clock = o.clock ?? defaultClock;
  const sliceMs = o.sliceMs ?? 12;
  const yieldNow = o.yieldToMain ?? defaultYield;
  const parallel = Math.max(1, o.parallel ?? 2);
  const targets = o.targets.slice(0, HARD_CAP);
  const batches = chunk(targets, Math.max(1, o.source.batchSize));
  const startedAt = now();
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  if (o.signal?.aborted) ctrl.abort();
  else o.signal?.addEventListener("abort", onAbort, { once: true });

  const out: ScanOutcome = { status: "done", startedAt, finishedAt: startedAt, requested: targets.length, scanned: 0, skipped: 0, failed: 0, stale: 0, skippedBy: {}, failedBy: {}, failures: [], hits: [], errorRate: 0 };
  let batchesDone = 0;
  const progress = (phase: ScanProgress["phase"]): void =>
    o.onProgress?.({ phase, requested: out.requested, processed: out.scanned + out.skipped + out.failed, scanned: out.scanned, skipped: out.skipped, failed: out.failed, hits: out.hits.length, batchesDone, batchesTotal: batches.length });

  const fail = (symbol: string, reason: string, message: string): void => {
    out.failed++;
    out.failedBy[reason] = (out.failedBy[reason] ?? 0) + 1;
    if (out.failures.length < MAX_FAILURES_KEPT) out.failures.push({ symbol, reason, message });
  };

  const start = (i: number): Promise<Record<string, LoadOutcome>> =>
    o.source.load(batches[i]!, ctrl.signal).catch((): Record<string, LoadOutcome> => Object.fromEntries(batches[i]!.map((t) => [t.symbol, { ok: false, reason: "network", message: "Der Abruf ist fehlgeschlagen." } as LoadOutcome])));
  const pending = new Map<number, Promise<Record<string, LoadOutcome>>>();
  for (let i = 0; i < Math.min(parallel, batches.length); i++) pending.set(i, start(i));

  progress("running");
  let sliceStart = clock();
  try {
    for (let i = 0; i < batches.length; i++) {
      if (ctrl.signal.aborted) break;
      const loaded = await pending.get(i)!;
      pending.delete(i);
      const next = i + parallel;
      if (next < batches.length && !ctrl.signal.aborted) pending.set(next, start(next));
      if (ctrl.signal.aborted) break;
      for (const target of batches[i]!) {
        if (ctrl.signal.aborted) break;
        const r = loaded[target.symbol];
        if (!r) fail(target.symbol, "bad-response", "Die Quelle hat dieses Kürzel nicht beantwortet.");
        else if (!r.ok) fail(target.symbol, r.reason, r.message);
        else {
          const asOf = r.stand.fetchedAt ?? r.stand.receivedAt;
          const session = o.setups.includes("orb") ? o.source.sessionFor?.(r.candles, asOf) : undefined;
          const input: ScanInput = {
            symbol: target.symbol,
            name: target.name ?? null,
            fin: target.fin ?? null,
            interval: o.source.interval,
            barMs: o.source.barMs,
            candles: r.candles,
            asOf,
            ...(session ? { session } : {}),
            stand: { ...r.stand, lastBar: null },
          };
          const s = scanSymbol(input, o.params, o.setups);
          if (s.skipped) {
            out.skipped++;
            out.skippedBy[s.skipped] = (out.skippedBy[s.skipped] ?? 0) + 1;
          } else {
            out.scanned++;
            if (r.stand.stale) out.stale++;
            out.hits.push(...s.hits);
          }
        }
        if (clock() - sliceStart >= sliceMs) {
          progress("running");
          await yieldNow();
          sliceStart = clock();
        }
      }
      if (ctrl.signal.aborted) break;
      batchesDone++;
      progress("running");
    }
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
  }
  if (ctrl.signal.aborted) out.status = "aborted";
  ctrl.abort(); // nothing is left to wait for: release anything still in flight
  out.finishedAt = now();
  out.errorRate = out.requested ? out.failed / out.requested : 0;
  progress(out.status);
  return out;
}
