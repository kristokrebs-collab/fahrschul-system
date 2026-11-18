/**
 * Automatische Auswertung der Signal-Ausgänge (F32): the archive's signals get their outcome without a click. Quiet by design –
 * a handful of signals per run, in idle moments, with a wait between runs; the rule WHICH signals are due is the pure
 * `planAuto` (`@/domain/missed/autoplan`), the candles and the reading are `computeOutcomes` (`signalOutcomes.ts`) – the same
 * function, source, cache and lab budget as the click on „Neu berechnen“, only ever a subset of what the click would load.
 *
 * Triggers: a page that shows outcomes was opened (`useOutcomes` → `requestAutoOutcomes("page")`, with `retainAuto` it also looks
 * again every 15 minutes while the page is open) and once after the app started if signals are waiting (`SignalOutcomeHost`
 * → `"start"`, then at most `AUTO_BG_RUNS` runs in all without a page open).
 *
 * It holds back – and says why on the card – while the tab is in the background (a run in flight stops between two pages),
 * the browser asks for data saving, the battery is low (≤ 20 % and not charging) or the device is offline. It resumes by itself.
 * The assistant never starts it: it only quotes what is cached.
 */
import { readThrottleEnv, watchEnvironment } from "@/domain/evolve/environment";
import { AUTO_LIMITS, planAuto, type AutoPlan } from "@/domain/missed/autoplan";
import type { SignalEvent } from "@/domain/missed/archive";
import { getSignalArchive } from "@/market/signalArchive";
import { computeOutcomes, getAttempts, getOutcomeState, isComputing, outcomeEvents, primeOutcomes, setAutoInfo } from "./signalOutcomes";

/** Wait after a page opened (let the page settle and animate first). */
export const AUTO_PAGE_WAIT_MS = 1500;
/** Wait between the start of one run and the next. */
export const AUTO_GAP_MS = 120_000;
/** While a page is open, look again for newer candles this often. */
export const AUTO_RECHECK_MS = AUTO_LIMITS.recheckMs;
/** After the browser lifted a pause (tab shown again …) wait this long before the next run. */
export const AUTO_RESUME_WAIT_MS = 4000;
/** Runs after the app start without a page that shows outcomes. */
export const AUTO_BG_RUNS = 3;

export interface AutoEnv {
  hidden: boolean;
  saveData: boolean;
  batteryLow: boolean;
  offline: boolean;
}

/** Why the automatic run holds back right now (German, shown on the card), `null` = it may run. */
export function pauseReason(e: AutoEnv): string | null {
  if (e.hidden) return "die App ist im Hintergrund";
  if (e.saveData) return "der Datensparmodus ist an";
  if (e.batteryLow) return "der Akku ist schwach";
  if (e.offline) return "du bist offline";
  return null;
}

export interface AutoDeps {
  now: () => number;
  /** runs `cb` once after `ms`, in an idle moment; returns the cancel */
  later: (cb: () => void, ms: number) => () => void;
  env: () => AutoEnv;
  archive: () => readonly SignalEvent[];
  compute: typeof computeOutcomes;
  /** calls `cb` when the tab is shown / hidden or the battery changes; returns the stop */
  watch: (cb: () => void) => () => void;
}

const defaultDeps = (): AutoDeps => ({
  now: () => Date.now(),
  later: (cb, ms) => {
    let idle: number | null = null;
    const timer = setTimeout(() => {
      // an idle moment (≤ 5 s late); without `requestIdleCallback` (Safari) the timer alone
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => cb(), { timeout: 5000 });
      else cb();
    }, ms);
    return () => {
      clearTimeout(timer);
      if (idle != null && typeof window !== "undefined") window.cancelIdleCallback?.(idle);
    };
  },
  env: () => {
    const e = readThrottleEnv("normal");
    return { hidden: e.hidden, saveData: e.saveData, batteryLow: e.batteryLow, offline: typeof navigator !== "undefined" && navigator.onLine === false };
  },
  archive: () => getSignalArchive(),
  compute: computeOutcomes,
  watch: (cb) => watchEnvironment(cb),
});

let deps: AutoDeps = defaultDeps();
let refs = 0;
let bgRuns = 0;
let cancelTimer: (() => void) | null = null;
let ctl: AbortController | null = null;
let lastStart = Number.NEGATIVE_INFINITY;
let unwatch: (() => void) | null = null;

/** Tests: other clock / scheduler / environment / compute. */
export function __setAutoDeps(d: Partial<AutoDeps> | null): void {
  __resetAuto();
  deps = d ? { ...defaultDeps(), ...d } : defaultDeps();
}

/** Tests: forget every timer and counter. */
export function __resetAuto(): void {
  cancelTimer?.();
  cancelTimer = null;
  ctl?.abort();
  ctl = null;
  unwatch?.();
  unwatch = null;
  refs = 0;
  bgRuns = 0;
  lastStart = Number.NEGATIVE_INFINITY;
}

function plan(): AutoPlan {
  const events = deps.archive();
  primeOutcomes(events);
  return planAuto({ entries: outcomeEvents(events), outcomes: getOutcomeState().outcomes, attempts: getAttempts(), now: deps.now() });
}

function arm(cb: () => void, ms: number): void {
  cancelTimer?.();
  cancelTimer = deps.later(() => {
    cancelTimer = null;
    cb();
  }, ms);
}

/** Nothing is due: quiet, and while a page is open look again for newer candles. */
function rest(p: AutoPlan): void {
  setAutoInfo({ phase: "idle", why: null });
  if (refs > 0 && p.waiting + p.fresh > 0) arm(() => void tick(), AUTO_RECHECK_MS);
}

/** Queues a run after `wait` (not before the gap since the last run), unless nothing is due or the browser asks to hold back. */
function decide(wait: number): void {
  if (ctl) return; // a run is in flight: it plans again when it ends
  const p = plan();
  if (!p.batch.length) return rest(p);
  const why = pauseReason(deps.env());
  if (why) {
    cancelTimer?.();
    cancelTimer = null;
    return setAutoInfo({ phase: "paused", why });
  }
  setAutoInfo({ phase: "queued", why: null });
  arm(() => void tick(), Math.max(wait, lastStart + AUTO_GAP_MS - deps.now()));
}

async function tick(): Promise<void> {
  const why = pauseReason(deps.env());
  if (why) return setAutoInfo({ phase: "paused", why });
  if (isComputing()) return arm(() => void tick(), 20_000); // the click is reading: do not overlap
  const p = plan();
  if (!p.batch.length) return rest(p);
  lastStart = deps.now();
  if (refs === 0 && bgRuns > 0) bgRuns -= 1;
  const mine = new AbortController();
  ctl = mine;
  setAutoInfo({ phase: "running", why: null });
  try {
    await deps.compute(deps.archive(), deps.now(), { via: "auto", only: p.batch, signal: mine.signal });
  } catch {
    /* computeOutcomes reports its own failures */
  }
  if (ctl === mine) ctl = null;
  if (mine.signal.aborted) {
    // the browser asked us to stop: what was read is kept, the rest waits for the end of the pause
    const reason = pauseReason(deps.env());
    if (reason) return setAutoInfo({ phase: "paused", why: reason });
    return decide(AUTO_RESUME_WAIT_MS);
  }
  const next = plan();
  if (next.batch.length && (refs > 0 || bgRuns > 0)) return decide(AUTO_GAP_MS);
  rest(next);
}

/** The browser's state changed (tab shown / hidden, battery): hold back at once, or pick the work up again. */
function onEnvChange(): void {
  const why = pauseReason(deps.env());
  const phase = getOutcomeState().auto.phase;
  if (why) {
    if (phase === "idle") return;
    ctl?.abort();
    cancelTimer?.();
    cancelTimer = null;
    return setAutoInfo({ phase: "paused", why });
  }
  if (phase === "paused") {
    setAutoInfo({ phase: "idle", why: null });
    decide(AUTO_RESUME_WAIT_MS);
  }
}

/**
 * Asks for an evaluation: `"page"` = a page that shows outcomes is open, `"start"` = the app started. Cheap when nothing is due
 * (one pass over the archive); several callers in a row become one queued run.
 */
export function requestAutoOutcomes(reason: "page" | "start" = "page"): void {
  unwatch ??= deps.watch(onEnvChange);
  if (reason === "start") bgRuns = AUTO_BG_RUNS;
  decide(reason === "start" ? 0 : AUTO_PAGE_WAIT_MS);
}

/**
 * A page that shows outcomes is mounted: while it is, the automatic run goes on until nothing is due and looks again for newer
 * candles every 15 minutes. Returns the release (the last release cancels a run that has not started).
 */
export function retainAuto(): () => void {
  refs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0 && bgRuns === 0 && !ctl && cancelTimer) {
      cancelTimer();
      cancelTimer = null;
      setAutoInfo({ phase: "idle", why: null });
    }
  };
}
