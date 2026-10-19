/**
 * Ausgang je Signal (F32), the part that needs candles: loads the real candles AFTER each archived entry signal through the lab's
 * history source (Binance USDⓈ-M klines through the market layer's REST clients and budget, closed bars cached in IndexedDB) and
 * reads the outcome with the pure `evaluateSignal` (`@/domain/missed`). Only on demand: nothing is fetched until the trader asks
 * („Ausgänge berechnen“); the source is imported lazily with the click, so the pages with a button do not carry the loader.
 *
 * Results are computed, not stored as facts. The one thing kept is a small versioned cache of FINAL results
 * (`tj2-signal-outcomes`, `{ v, items: { [signalId]: { fp, o } } }`, at most `CACHE_CAP`, only ids still in the archive): a target
 * or stop that was reached never changes, so a reload shows it at once without a request. The key is the signal id plus a
 * fingerprint of everything the reading used (time, side, marks, rules version); an open or unusable result is always recomputed.
 *
 * Failures are per market and honest: a market the exchange does not know, a blocked route or an exhausted budget turn the
 * affected signals into `unusable` with the reason (not cached, retried by the next click).
 */
import { useSyncExternalStore } from "react";
import { atrPctAt } from "@/domain/excursion";
import { evaluateSignal, isFinalOutcome, needsAtr, OUTCOME_HORIZON_MS, OUTCOME_RULES_VERSION, outcomeBlocker, unusable, type OutcomeBar, type OutcomeMap, type SignalOutcome } from "@/domain/missed/outcome";
import type { SignalEvent } from "@/domain/missed/archive";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const OUTCOME_CACHE_KEY = storageKey("signal-outcomes");
export const OUTCOME_CACHE_CAP = 300;
const BAR_MS = 900_000;
const HOUR = 3_600_000;
/** Warm-up of the ATR(14) on 1h candles before the earliest signal. */
const ATR_LEAD_MS = 20 * HOUR;

export type OutcomeStatus = "idle" | "loading" | "done" | "error";

export interface OutcomeState {
  status: OutcomeStatus;
  outcomes: OutcomeMap;
  /** ms the last run finished */
  at: number | null;
  /** loader progress, pages */
  progress: { done: number; total: number } | null;
  error: string | null;
}

/** Everything the reading of one event used (the cache key beside the id). */
export const outcomeFingerprint = (e: Pick<SignalEvent, "at" | "side" | "price" | "stop" | "target" | "symbol">): string => `${OUTCOME_RULES_VERSION}|${e.at}|${e.side}|${e.symbol}|${e.price ?? ""}|${e.stop ?? ""}|${e.target ?? ""}`;

interface CacheItem {
  fp: string;
  o: SignalOutcome;
}

/** Tolerant read of the cache (`{}` for anything unreadable or of another version). */
export function parseOutcomeCache(raw: unknown): Record<string, CacheItem> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const w = raw as { v?: unknown; items?: unknown };
  if (w.v !== OUTCOME_RULES_VERSION || !w.items || typeof w.items !== "object" || Array.isArray(w.items)) return {};
  const out: Record<string, CacheItem> = {};
  for (const [id, it] of Object.entries(w.items as Record<string, unknown>)) {
    const o = it as { fp?: unknown; o?: unknown } | null;
    if (!o || typeof o.fp !== "string" || !o.o || typeof o.o !== "object") continue;
    const so = o.o as Partial<SignalOutcome>;
    if (so.kind === "target" || so.kind === "stop" || so.kind === "open" || so.kind === "unusable") out[id] = { fp: o.fp, o: { ...unusable(""), ...so } as SignalOutcome };
  }
  return out;
}

/** The cached FINAL outcomes that still fit their event. */
export function cachedOutcomes(events: readonly SignalEvent[]): Map<string, SignalOutcome> {
  const cache = parseOutcomeCache(readJson<unknown>(OUTCOME_CACHE_KEY, null));
  const out = new Map<string, SignalOutcome>();
  for (const e of events) {
    const hit = cache[e.id];
    if (hit && hit.fp === outcomeFingerprint(e) && isFinalOutcome(hit.o)) out.set(e.id, hit.o);
  }
  return out;
}

function writeCache(events: readonly SignalEvent[], outcomes: ReadonlyMap<string, SignalOutcome>): void {
  const items: Record<string, CacheItem> = {};
  let n = 0;
  for (const e of events) {
    const o = outcomes.get(e.id);
    if (o && isFinalOutcome(o) && n < OUTCOME_CACHE_CAP) {
      items[e.id] = { fp: outcomeFingerprint(e), o };
      n++;
    }
  }
  try {
    writeJson(OUTCOME_CACHE_KEY, { v: OUTCOME_RULES_VERSION, items });
  } catch {
    /* the cache is a convenience */
  }
}

/* ------------------------------------------------------------------ store */

const EMPTY: OutcomeState = { status: "idle", outcomes: new Map(), at: null, progress: null, error: null };
let state: OutcomeState = EMPTY;
const listeners = new Set<() => void>();
let running = false;

function set(next: Partial<OutcomeState>): void {
  state = { ...state, ...next };
  for (const l of [...listeners]) l();
}

export const getOutcomeState = (): OutcomeState => state;
export function subscribeOutcomes(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
export const useOutcomeState = (): OutcomeState => useSyncExternalStore(subscribeOutcomes, getOutcomeState, getOutcomeState);

/** Events the outcome applies to: entries with a direction. */
export const outcomeEvents = (events: readonly SignalEvent[]): SignalEvent[] => events.filter((e) => e.entry && e.side != null);

/** Shows the cached final outcomes without any request (a reload keeps what was computed). Cheap; safe to call on mount. */
export function primeOutcomes(events: readonly SignalEvent[]): void {
  if (state.status === "loading") return;
  const hit = cachedOutcomes(outcomeEvents(events));
  if (!hit.size) return;
  // keep what an earlier run of this session already computed
  const merged = new Map(state.outcomes);
  let changed = false;
  for (const [id, o] of hit) {
    if (!merged.has(id)) {
      merged.set(id, o);
      changed = true;
    }
  }
  if (changed) set({ outcomes: merged });
}

const LOAD_ERROR: Readonly<Record<string, string>> = {
  blocked: "Die Marktdaten sind von hier aus gerade nicht erreichbar.",
  rate: "Das Abfrage-Budget ist erschöpft – später noch einmal.",
  symbol: "Dieser Markt ist bei Binance (USDⓈ-M) nicht bekannt.",
  failed: "Die Kerzen konnten nicht geladen werden.",
};

/** Candles → outcome bars. */
const toOutBars = (bars: readonly { t: number; o: number; h: number; l: number; c: number }[]): OutcomeBar[] => bars.map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c }));

/**
 * Computes the outcomes of `events` (entries with a direction). Loads candles per market, one market after the other; a market
 * that fails marks only its own signals. Resolves with the outcomes of this run; the shared state is updated along the way.
 */
export async function computeOutcomes(events: readonly SignalEvent[], now: number = Date.now()): Promise<OutcomeMap> {
  if (running) return state.outcomes;
  running = true;
  const wanted = outcomeEvents(events);
  const outcomes = new Map<string, SignalOutcome>(cachedOutcomes(wanted));
  set({ status: "loading", outcomes: new Map(outcomes), progress: { done: 0, total: 0 }, error: null });
  try {
    const bySymbol = new Map<string, SignalEvent[]>();
    for (const e of wanted) {
      if (outcomes.has(e.id)) continue;
      const blocked = outcomeBlocker(e);
      if (blocked) {
        outcomes.set(e.id, unusable(blocked));
        continue;
      }
      const list = bySymbol.get(e.symbol);
      if (list) list.push(e);
      else bySymbol.set(e.symbol, [e]);
    }
    const { loadLabData, loadErrorKind } = await import("@/views/labor/historySource");
    let failed = 0;
    for (const [symbol, list] of bySymbol) {
      const first = Math.min(...list.map((e) => e.at));
      const last = Math.max(...list.map((e) => e.at));
      try {
        const base = await loadLabData({
          symbol,
          intervals: ["15m"],
          from: Math.floor(first / BAR_MS) * BAR_MS,
          to: Math.min(now, last + OUTCOME_HORIZON_MS),
          funding: false,
          onProgress: (done, total) => set({ progress: { done, total } }),
        });
        const bars = toOutBars(base.data["15m"] ?? []);
        let h1: OutcomeBar[] = [];
        if (list.some(needsAtr)) {
          const hist = await loadLabData({ symbol, intervals: ["1h"], from: Math.floor((first - ATR_LEAD_MS) / HOUR) * HOUR, to: Math.min(now, last), funding: false });
          h1 = toOutBars(hist.data["1h"] ?? []);
        }
        for (const e of list) {
          const atrPct = needsAtr(e) ? atrPctAt(h1, e.at, HOUR, 14) : null;
          outcomes.set(e.id, evaluateSignal(e, bars, { now, atrPct, intervalMs: BAR_MS }));
        }
      } catch (err) {
        failed += list.length;
        const reason = LOAD_ERROR[loadErrorKind(err)] ?? LOAD_ERROR.failed!;
        for (const e of list) outcomes.set(e.id, unusable(reason));
      }
      set({ outcomes: new Map(outcomes) });
    }
    writeCache(wanted, outcomes);
    set({ status: "done", outcomes: new Map(outcomes), at: Date.now(), progress: null, error: failed ? `${failed} Signal${failed === 1 ? "" : "e"} ohne Marktdaten – die Gründe stehen an den Signalen.` : null });
    return outcomes;
  } catch {
    set({ status: "error", progress: null, error: "Die Berechnung ist fehlgeschlagen – bitte noch einmal versuchen." });
    return state.outcomes;
  } finally {
    running = false;
  }
}

/** Tests: forget the state. */
export function __resetOutcomes(): void {
  state = EMPTY;
  running = false;
  listeners.clear();
}
