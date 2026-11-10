/**
 * Automatische Auswertung der Signal-Ausgänge (F32): WHICH archived signals the app reads next – a pure rule, no I/O and no
 * clock of its own (the host passes `now`, the known outcomes and the attempts it made). The candles themselves are loaded by
 * `src/views/coach/signalOutcomes.ts`, the idle scheduling lives in `src/views/coach/signalAuto.ts`.
 *
 * The rule, written out (it is also what the cards tell):
 * - A FINAL outcome (target / stop reached, the 14-day limit passed, entry never touched) is never read again.
 * - A signal is read only once a candle that OPENED after it has CLOSED (until then „wartet auf die erste Kerze“).
 * - A signal that is still `open` (or `unusable` because nothing could be read) is read again only when a NEWER closed 15m
 *   candle exists than the one it was last read with, and at the earliest `recheckMs` after the last attempt. A failed load
 *   (network, limit, unknown market) waits `retryMs`.
 * - A run takes at most `maxSignals` signals of at most `maxMarkets` markets, the newest first; per market only signals
 *   within `spanMs` of that market's newest one (one candle load then covers at most `spanMs` + the 14-day horizon, so it
 *   never costs more than a few pages). The rest follows in a later run.
 * - Signals without a direction or a market are unusable right away, with no request: they ride along for free.
 */
import type { SignalEvent } from "./archive";
import { isFinalOutcome, outcomeBlocker, type SignalOutcome } from "./outcome";

/** The candles the outcomes are read from (15m). */
export const AUTO_BAR_MS = 900_000;

export interface AutoLimits {
  /** signals per run */
  maxSignals: number;
  /** markets per run */
  maxMarkets: number;
  /** signals of one market in one run lie at most this far apart (ms) */
  spanMs: number;
  /** an open signal is looked at again at the earliest this long after the last look (ms) */
  recheckMs: number;
  /** after a failed load the signal waits this long (ms) */
  retryMs: number;
}

export const AUTO_LIMITS: Readonly<AutoLimits> = { maxSignals: 20, maxMarkets: 3, spanMs: 30 * 86_400_000, recheckMs: 15 * 60_000, retryMs: 30 * 60_000 };

/** What the loader remembers about its last look at one signal. */
export interface Attempt {
  /** ms the look finished */
  at: number;
  /** open time (ms) of the newest CLOSED 15m candle at that time */
  newest: number;
  /** the candles could not be loaded (not a reading of the candles) */
  failed: boolean;
}

export interface AutoPlan {
  /** the signals to read in the next run, newest first (blocked ones first, they cost nothing) */
  batch: SignalEvent[];
  /** signals due now, whether or not they fit into this run */
  due: number;
  /** entries whose first candle after the signal has not closed yet */
  fresh: number;
  /** read already, waiting for a newer candle or for the retry time */
  waiting: number;
  /** settled for good (final outcome, or unusable by rule) */
  settled: number;
}

/** Open time (ms) of the newest closed candle at `now`. */
export const newestClosedBar = (now: number, intervalMs: number = AUTO_BAR_MS): number => Math.floor(now / intervalMs) * intervalMs - intervalMs;

function dueNow(o: SignalOutcome | undefined, t: Attempt | undefined, newest: number, now: number, limits: AutoLimits): boolean {
  if (!o && !t) return true;
  if (t?.failed) return now - t.at >= limits.retryMs;
  const seen = t ? t.newest : (o?.coveredUntil ?? -1);
  return newest > seen && now - (t?.at ?? 0) >= limits.recheckMs;
}

export interface PlanInput {
  /** entries with a direction (`outcomeEvents`) */
  entries: readonly SignalEvent[];
  outcomes: ReadonlyMap<string, SignalOutcome>;
  attempts: ReadonlyMap<string, Attempt>;
  now: number;
}

export function planAuto(input: PlanInput, limits: AutoLimits = AUTO_LIMITS): AutoPlan {
  const newest = newestClosedBar(input.now);
  const free: SignalEvent[] = [];
  const due: SignalEvent[] = [];
  let fresh = 0;
  let waiting = 0;
  let settled = 0;
  for (const e of input.entries) {
    const o = input.outcomes.get(e.id);
    if (outcomeBlocker(e)) {
      if (o) settled += 1;
      else free.push(e);
      continue;
    }
    if (o && isFinalOutcome(o)) {
      settled += 1;
      continue;
    }
    if (newest < e.at) {
      fresh += 1;
      continue;
    }
    if (dueNow(o, input.attempts.get(e.id), newest, input.now, limits)) due.push(e);
    else waiting += 1;
  }
  due.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  const picked: SignalEvent[] = [];
  const newestOf = new Map<string, number>();
  for (const e of due) {
    if (picked.length >= limits.maxSignals) break;
    const top = newestOf.get(e.symbol);
    if (top == null) {
      if (newestOf.size >= limits.maxMarkets) continue;
      newestOf.set(e.symbol, e.at);
    } else if (top - e.at > limits.spanMs) continue;
    picked.push(e);
  }
  return { batch: [...free, ...picked], due: due.length, fresh, waiting, settled };
}
