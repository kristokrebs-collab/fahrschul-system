/**
 * Ausgang je Signal (F32), the part that needs candles: loads the real candles AFTER each archived entry signal through the lab's
 * history source (Binance USDⓈ-M klines through the market layer's REST clients and budget, closed bars cached in IndexedDB) and
 * reads the outcome with the pure `evaluateSignal` (`@/domain/missed`). The source is imported lazily with the first run, so the
 * pages that show outcomes do not carry the loader.
 *
 * WHEN it runs: automatically (`signalAuto.ts`: a few signals at a time, in idle moments, only for what has no final outcome and,
 * for an open one, only with newer candles) and on „Neu berechnen“ (`computeOutcomes(events)`: every signal without a final
 * outcome, at once). Both go through this one function and the same lab budget – the automatic run is a subset of the click.
 *
 * Results are computed, not stored as facts. The one thing kept is a small versioned cache (`tj2-signal-outcomes`,
 * `{ v, items: { [signalId]: { fp, o, at? } }, last? }`, at most `CACHE_CAP`, only ids still in the archive): a FINAL result (target
 * or stop reached) never changes, so a reload shows it at once and never loads it again; an `open` result is kept with the time it
 * was read, so a reload shows it too and reads it again only when a newer candle exists. The key is the signal id plus a fingerprint
 * of everything the reading used (time, side, marks, rules version). An unusable result is never cached.
 *
 * Failures are per market and honest: a market the exchange does not know, a blocked route or an exhausted budget turn the
 * affected signals into `unusable` with the reason (never counted as a result, retried later by the automatic run, at once by
 * the click). A run the browser interrupts (tab in the background) stops quietly and leaves the rest for later.
 */
import { useSyncExternalStore } from "react";
import { atrPctAt } from "@/domain/excursion";
import { newestClosedBar, type Attempt } from "@/domain/missed/autoplan";
import { evaluateSignal, isFinalOutcome, needsAtr, OUTCOME_HORIZON_MS, OUTCOME_RULES_VERSION, outcomeBlocker, unusable, type OutcomeBar, type OutcomeMap, type SignalOutcome } from "@/domain/missed/outcome";
import type { SignalEvent } from "@/domain/missed/archive";
import type { Source } from "@/market/types";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const OUTCOME_CACHE_KEY = storageKey("signal-outcomes");
export const OUTCOME_CACHE_CAP = 300;
const BAR_MS = 900_000;
const HOUR = 3_600_000;
/** Warm-up of the ATR(14) on 1h candles before the earliest signal. */
const ATR_LEAD_MS = 20 * HOUR;

export type OutcomeStatus = "idle" | "loading" | "done" | "error";
/** Who started a run: the automatic evaluation or the click on „Neu berechnen“. */
export type OutcomeVia = "auto" | "manual";
/** `queued`: a run waits for an idle moment; `paused`: the browser asks us to hold back (`why`). */
export type AutoPhase = "idle" | "queued" | "running" | "paused";

export interface AutoInfo {
  phase: AutoPhase;
  /** German reason of a pause */
  why: string | null;
}

export interface OutcomeState {
  status: OutcomeStatus;
  outcomes: OutcomeMap;
  /** ms the last run finished */
  at: number | null;
  /** loader progress, pages */
  progress: { done: number; total: number } | null;
  error: string | null;
  /** who ran the last (or the running) run */
  via: OutcomeVia | null;
  /** where the candles of the last run came from (`cache`: nothing had to be fetched) */
  source: Source | null;
  /** the automatic evaluation (`signalAuto.ts`) */
  auto: AutoInfo;
}

/** Everything the reading of one event used (the cache key beside the id). */
export const outcomeFingerprint = (e: Pick<SignalEvent, "at" | "side" | "price" | "stop" | "target" | "symbol">): string => `${OUTCOME_RULES_VERSION}|${e.at}|${e.side}|${e.symbol}|${e.price ?? ""}|${e.stop ?? ""}|${e.target ?? ""}`;

interface CacheItem {
  fp: string;
  o: SignalOutcome;
  /** ms the outcome was read (kept for `open` results: the time of the look) */
  at?: number;
}

interface LastRun {
  at: number;
  src: Source;
}

/** Tolerant read of the cache (`{}` for anything unreadable or of another version). */
export function parseOutcomeCache(raw: unknown): Record<string, CacheItem> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const w = raw as { v?: unknown; items?: unknown };
  if (w.v !== OUTCOME_RULES_VERSION || !w.items || typeof w.items !== "object" || Array.isArray(w.items)) return {};
  const out: Record<string, CacheItem> = {};
  for (const [id, it] of Object.entries(w.items as Record<string, unknown>)) {
    const o = it as { fp?: unknown; o?: unknown; at?: unknown } | null;
    if (!o || typeof o.fp !== "string" || !o.o || typeof o.o !== "object") continue;
    const so = o.o as Partial<SignalOutcome>;
    if (so.kind === "target" || so.kind === "stop" || so.kind === "open" || so.kind === "unusable") out[id] = { fp: o.fp, o: { ...unusable(""), ...so } as SignalOutcome, ...(typeof o.at === "number" && Number.isFinite(o.at) ? { at: o.at } : {}) };
  }
  return out;
}

const SOURCES: readonly Source[] = ["binance", "proxy", "cache"];

/** The time and source of the last finished run, as stored (`null` when unreadable or never stored). */
export function parseLastRun(raw: unknown): LastRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const w = raw as { v?: unknown; last?: unknown };
  if (w.v !== OUTCOME_RULES_VERSION || !w.last || typeof w.last !== "object") return null;
  const l = w.last as { at?: unknown; src?: unknown };
  return typeof l.at === "number" && Number.isFinite(l.at) && SOURCES.includes(l.src as Source) ? { at: l.at, src: l.src as Source } : null;
}

/** The cached results that still fit their event and can be kept: final ones and open ones (with the time they were read). */
function readKnown(events: readonly SignalEvent[]): Map<string, { o: SignalOutcome; at: number | null }> {
  const cache = parseOutcomeCache(readJson<unknown>(OUTCOME_CACHE_KEY, null));
  const out = new Map<string, { o: SignalOutcome; at: number | null }>();
  for (const e of events) {
    const hit = cache[e.id];
    if (hit && hit.fp === outcomeFingerprint(e) && (isFinalOutcome(hit.o) || hit.o.kind === "open")) out.set(e.id, { o: hit.o, at: hit.at ?? null });
  }
  return out;
}

/** The cached FINAL outcomes that still fit their event. */
export function cachedOutcomes(events: readonly SignalEvent[]): Map<string, SignalOutcome> {
  const out = new Map<string, SignalOutcome>();
  for (const [id, k] of readKnown(events)) if (isFinalOutcome(k.o)) out.set(id, k.o);
  return out;
}

/** The cached final AND open outcomes (what a reload shows without a request; the assistant quotes these). */
export function cachedKnownOutcomes(events: readonly SignalEvent[]): Map<string, SignalOutcome> {
  return new Map([...readKnown(events)].map(([id, k]) => [id, k.o]));
}

/* ------------------------------------------------------------------ store */

const EMPTY: OutcomeState = { status: "idle", outcomes: new Map(), at: null, progress: null, error: null, via: null, source: null, auto: { phase: "idle", why: null } };
let state: OutcomeState = EMPTY;
const listeners = new Set<() => void>();
let running = false;
/** The last look at each signal in this session (the automatic run asks it when a signal is due again). */
const attempts = new Map<string, Attempt>();

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

/** The look at each signal so far (read by the automatic run's plan). */
export const getAttempts = (): ReadonlyMap<string, Attempt> => attempts;
/** A run is in flight (the click and the automatic run never overlap). */
export const isComputing = (): boolean => running;
/** The automatic evaluation reports its phase here (`signalAuto.ts`). */
export function setAutoInfo(info: AutoInfo): void {
  if (state.auto.phase === info.phase && state.auto.why === info.why) return;
  set({ auto: info });
}

/** Events the outcome applies to: entries with a direction. */
export const outcomeEvents = (events: readonly SignalEvent[]): SignalEvent[] => events.filter((e) => e.entry && e.side != null);

function writeCache(wanted: readonly SignalEvent[], outcomes: ReadonlyMap<string, SignalOutcome>): void {
  const finals: [string, CacheItem][] = [];
  const opens: [string, CacheItem][] = [];
  for (const e of wanted) {
    const o = outcomes.get(e.id);
    if (!o) continue;
    if (isFinalOutcome(o)) finals.push([e.id, { fp: outcomeFingerprint(e), o }]);
    else if (o.kind === "open") {
      const at = attempts.get(e.id)?.at;
      opens.push([e.id, { fp: outcomeFingerprint(e), o, ...(at != null ? { at } : {}) }]);
    }
  }
  const items: Record<string, CacheItem> = {};
  for (const [id, it] of [...finals, ...opens].slice(0, OUTCOME_CACHE_CAP)) items[id] = it;
  try {
    writeJson(OUTCOME_CACHE_KEY, { v: OUTCOME_RULES_VERSION, items, ...(state.at != null && state.source ? { last: { at: state.at, src: state.source } } : {}) });
  } catch {
    /* the cache is a convenience */
  }
}

/**
 * Shows what is cached (final and open results, the time and source of the last run) without any request – a reload keeps what
 * was computed. Cheap; safe to call on mount and before every plan of the automatic run.
 */
export function primeOutcomes(events: readonly SignalEvent[]): void {
  if (state.status === "loading") return;
  const known = readKnown(outcomeEvents(events));
  const merged = new Map(state.outcomes);
  let changed = false;
  for (const [id, k] of known) {
    if (!merged.has(id)) {
      merged.set(id, k.o);
      changed = true;
    }
    // an open result read in an earlier session counts as a look at it: it is read again only with a newer candle
    if (k.o.kind === "open" && !attempts.has(id)) attempts.set(id, { at: k.at ?? 0, newest: k.o.coveredUntil ?? -1, failed: false });
  }
  const last = state.at == null ? parseLastRun(readJson<unknown>(OUTCOME_CACHE_KEY, null)) : null;
  if (changed || last) set({ ...(changed ? { outcomes: merged } : {}), ...(last ? { at: last.at, source: last.src } : {}) });
}

const LOAD_ERROR: Readonly<Record<string, string>> = {
  blocked: "Die Marktdaten sind von hier aus gerade nicht erreichbar.",
  rate: "Das Abfrage-Budget ist erschöpft – später noch einmal.",
  symbol: "Dieser Markt ist bei Binance (USDⓈ-M) nicht bekannt.",
  failed: "Die Kerzen konnten nicht geladen werden.",
};

/** Candles → outcome bars. */
const toOutBars = (bars: readonly { t: number; o: number; h: number; l: number; c: number }[]): OutcomeBar[] => bars.map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c }));

const isAbort = (err: unknown): boolean => err instanceof Error && err.name === "AbortError";

export interface ComputeOptions {
  /** who asks (default `manual`) */
  via?: OutcomeVia;
  /** read only these signals (the automatic run); default: every entry without a final outcome */
  only?: readonly SignalEvent[];
  /** stops the run between two pages (tab in the background); what was read until then is kept */
  signal?: AbortSignal;
}

/**
 * Computes the outcomes of `events` (entries with a direction) that have no final outcome – or of `opts.only`. Loads candles per
 * market, one market after the other; a market that fails marks only its own signals. Resolves with all outcomes known after this
 * run; the shared state is updated along the way.
 */
export async function computeOutcomes(events: readonly SignalEvent[], now: number = Date.now(), opts: ComputeOptions = {}): Promise<OutcomeMap> {
  if (running) return state.outcomes;
  running = true;
  const via = opts.via ?? "manual";
  const wanted = outcomeEvents(events);
  const pick = opts.only ? new Set(opts.only.map((e) => e.id)) : null;
  // what is known already: the cached final results, else this session's result (kept on screen until it is replaced)
  const finals = cachedOutcomes(wanted);
  const outcomes = new Map<string, SignalOutcome>();
  for (const e of wanted) {
    const o = finals.get(e.id) ?? state.outcomes.get(e.id);
    if (o) outcomes.set(e.id, o);
  }
  set({ status: "loading", via, outcomes: new Map(outcomes), progress: { done: 0, total: 0 }, error: null });
  const todo: SignalEvent[] = [];
  let pages = 0;
  let proxy = false;
  let aborted = false;
  try {
    const bySymbol = new Map<string, SignalEvent[]>();
    for (const e of wanted) {
      if (pick && !pick.has(e.id)) continue;
      const have = outcomes.get(e.id);
      if (have && isFinalOutcome(have)) continue;
      const blocked = outcomeBlocker(e);
      if (blocked) {
        outcomes.set(e.id, unusable(blocked));
        continue;
      }
      todo.push(e);
      const list = bySymbol.get(e.symbol);
      if (list) list.push(e);
      else bySymbol.set(e.symbol, [e]);
    }
    const newest = newestClosedBar(now);
    const note = (e: SignalEvent, failed: boolean): void => void attempts.set(e.id, { at: now, newest, failed });
    if (bySymbol.size) {
      const { loadLabData, loadErrorKind } = await import("@/views/labor/historySource");
      let failed = 0;
      for (const [symbol, list] of bySymbol) {
        if (opts.signal?.aborted) {
          aborted = true;
          break;
        }
        const first = Math.min(...list.map((e) => e.at));
        const last = Math.max(...list.map((e) => e.at));
        try {
          const base = await loadLabData({
            symbol,
            intervals: ["15m"],
            from: Math.floor(first / BAR_MS) * BAR_MS,
            to: Math.min(now, last + OUTCOME_HORIZON_MS),
            funding: false,
            signal: opts.signal,
            onProgress: (done, total) => set({ progress: { done, total } }),
          });
          pages += Number.isFinite(base.pages) ? base.pages : 0;
          proxy ||= base.viaProxy === true;
          const bars = toOutBars(base.data["15m"] ?? []);
          let h1: OutcomeBar[] = [];
          if (list.some(needsAtr)) {
            const hist = await loadLabData({ symbol, intervals: ["1h"], from: Math.floor((first - ATR_LEAD_MS) / HOUR) * HOUR, to: Math.min(now, last), funding: false, signal: opts.signal });
            pages += Number.isFinite(hist.pages) ? hist.pages : 0;
            proxy ||= hist.viaProxy === true;
            h1 = toOutBars(hist.data["1h"] ?? []);
          }
          for (const e of list) {
            const atrPct = needsAtr(e) ? atrPctAt(h1, e.at, HOUR, 14) : null;
            outcomes.set(e.id, evaluateSignal(e, bars, { now, atrPct, intervalMs: BAR_MS }));
            note(e, false);
          }
        } catch (err) {
          if (isAbort(err)) {
            aborted = true;
            break;
          }
          failed += list.length;
          const reason = LOAD_ERROR[loadErrorKind(err)] ?? LOAD_ERROR.failed!;
          for (const e of list) {
            outcomes.set(e.id, unusable(reason));
            note(e, true);
          }
        }
        set({ outcomes: new Map(outcomes) });
      }
      if (failed) set({ error: `${failed} Signal${failed === 1 ? "" : "e"} ohne Marktdaten – die Gründe stehen an den Signalen.` });
    }
    const source: Source = proxy ? "proxy" : pages > 0 ? "binance" : "cache";
    if (aborted) {
      set({ status: state.at != null ? "done" : "idle", outcomes: new Map(outcomes), progress: null });
    } else {
      set({ status: "done", outcomes: new Map(outcomes), at: Date.now(), source, progress: null });
    }
    writeCache(wanted, outcomes);
    return outcomes;
  } catch {
    // the loader itself could not be fetched: remember it as a failed look, so the automatic run waits instead of looping
    for (const e of todo) if (!outcomes.has(e.id)) attempts.set(e.id, { at: now, newest: newestClosedBar(now), failed: true });
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
  attempts.clear();
  listeners.clear();
}
