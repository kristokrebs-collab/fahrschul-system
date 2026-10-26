/**
 * The watch core of the key-level alerts (F22) – ONE implementation for the browser (`src/market/keylevels/alerts.ts`)
 * and the server (`netlify/functions/_lib/alertWatch`, the e-mail alarm F21). Pure: no I/O, no clock, no React. Alias-free
 * on purpose (the Netlify function bundles it).
 *
 * What is shared: evaluating a level on its candles (`watchEntry`), the stage memory with its first silent look, the
 * restart after an edit (`levelFingerprint`) and the decision which stage fires (`stepWatch`, built on `stepStages`).
 * What is NOT shared is the delivery: the browser shows a toast and a system notification, the server collects the fires
 * in an outbox and mails them (`serverAlerts.ts`). A test (`tests/unit/alerts.watch.parity.test.ts`) feeds the same
 * candles to both sides and compares the decisions.
 */
import { currentStage, FRESH_MEMORY, observe, seedMemory, stepStages, type AlertMemory, type Observation } from "./alerts";
import { evaluateLevel, type EvalCandle } from "./evaluate";
import type { AlertSettings, AlertStage, KeyLevel, LevelEvaluation } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An evaluation without a verdict: `unknown` never confirms, never alerts. */
export const unknownEvaluation = (reason: string): LevelEvaluation => ({
  status: "unknown",
  basis: null,
  reason,
  progress: null,
  trigger: null,
  last: null,
  distancePct: null,
  retest: "none",
  broke: false,
  awaitingRetest: false,
  atr: null,
  events: [],
  asOf: null,
});

/** One level as the watch reads it: the evaluation, whether it was evaluated at all (`live`) and where it stands. */
export interface WatchEntry {
  level: KeyLevel;
  evaluation: LevelEvaluation;
  /** the level was evaluated on real candles (not switched off, not another market, not without data) */
  live: boolean;
  obs: Observation;
  /** the alert stage the level is in right now */
  stage: AlertStage | null;
}

/** Observation and stage of an evaluated level. */
export function watchEntry(level: KeyLevel, evaluation: LevelEvaluation, live: boolean, alerts: Pick<AlertSettings, "prepare">): WatchEntry {
  const obs = observe(level, evaluation, alerts);
  return { level, evaluation, live, obs, stage: currentStage(obs) };
}

/** Evaluates `level` on `candles` (the candles of ITS timeframe, `null` = none) and wraps the result as a `WatchEntry`. */
export function evaluateWatch(level: KeyLevel, candles: readonly EvalCandle[] | null, now: number, alerts: Pick<AlertSettings, "prepare">, missing = "Keine Kerzen geladen – nicht bewertet."): WatchEntry {
  const evaluation = candles ? evaluateLevel(level, candles, now) : unknownEvaluation(missing);
  return watchEntry(level, evaluation, candles != null, alerts);
}

/** What a stored stage memory is valid for: any change of these starts the level over. */
export function levelFingerprint(l: KeyLevel): string {
  return [l.symbol, l.price, l.tf, l.direction, l.kind, l.closes, l.distance.mode, l.distance.value, l.invalidation ?? "", l.since ?? ""].join("|");
}

export interface WatchMem {
  fp: string;
  m: AlertMemory;
}
/** Stage memory per level id. */
export type WatchMems = Record<string, WatchMem>;

/** Tolerant read of a stored memory map (browser storage or `settings.serverAlerts.mem`). */
export function parseWatchMems(raw: unknown): WatchMems {
  const out: WatchMems = {};
  if (!isObj(raw)) return out;
  for (const [id, e] of Object.entries(raw)) {
    if (isObj(e) && typeof e.fp === "string" && isObj(e.m) && typeof e.m.reached === "number" && typeof e.m.cycle === "number") {
      out[id] = { fp: e.fp, m: { cycle: e.m.cycle, reached: e.m.reached, fired: isObj(e.m.fired) ? e.m.fired : {}, ever: isObj(e.m.ever) ? e.m.ever : {} } as AlertMemory };
    }
  }
  return out;
}

/** A stage that fired in this step. */
export interface WatchFire {
  level: KeyLevel;
  stage: AlertStage;
  cycle: number;
  evaluation: LevelEvaluation;
}

export interface WatchStep {
  /** the new memory (`prev` itself when nothing changed) */
  mems: WatchMems;
  /** the memory changed – the caller stores it */
  dirty: boolean;
  fires: WatchFire[];
}

export interface StepOptions {
  /**
   * Levels whose first look is NOT silent: the watcher already covers the time they count from (the e-mail alarm: a
   * level made or edited after the switch was turned on). They start from a fresh memory and step at once, so a trigger
   * that happened between their creation and the first look is still announced.
   */
  live?: (level: KeyLevel) => boolean;
}

/**
 * One look at every level: forgets levels that are gone, skips fixed (`legacy`), switched-off and unevaluated levels,
 * seeds a level the first time it is seen or after an edit (the stage it stands in is remembered, NOTHING is announced –
 * what is already true is not news), and steps the stage machine of the rest. A stage that is switched off still moves
 * the cycle on silently, a level switched off forgets (switching it on again starts with a silent first look).
 */
export function stepWatch(prev: WatchMems, entries: readonly WatchEntry[], now: number, opts: StepOptions = {}): WatchStep {
  const mems: WatchMems = { ...prev };
  let dirty = false;
  const ids = new Set(entries.map((e) => e.level.id));
  for (const id of Object.keys(mems)) {
    if (!ids.has(id)) {
      delete mems[id];
      dirty = true;
    }
  }
  const fires: WatchFire[] = [];
  for (const e of entries) {
    const l = e.level;
    if (l.legacy) continue;
    if (!l.enabled) {
      if (mems[l.id]) {
        delete mems[l.id];
        dirty = true;
      }
      continue;
    }
    if (!e.live || e.evaluation.status === "unknown") continue; // another market / no usable data: no stage, nothing to step
    const fp = levelFingerprint(l);
    const was = mems[l.id];
    const first = !was || was.fp !== fp;
    if (first && !opts.live?.(l)) {
      mems[l.id] = { fp, m: seedMemory(e.stage) };
      dirty = true;
      continue;
    }
    const from = first ? { ...FRESH_MEMORY, fired: {}, ever: {} } : was!.m;
    const res = stepStages(from, e.obs, l.alerts, now);
    if (first || res.mem !== from) {
      mems[l.id] = { fp, m: res.mem };
      dirty = true;
    }
    if (res.fire) fires.push({ level: l, stage: res.fire, cycle: res.cycle, evaluation: e.evaluation });
  }
  return { mems: dirty ? mems : prev, dirty, fires };
}
