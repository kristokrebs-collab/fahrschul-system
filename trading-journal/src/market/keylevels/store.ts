/**
 * Live status of the key levels: `useKeyLevels()` / `getKeyLevels()` / `subscribeKeyLevels()` / `retainKeyLevels()`.
 *
 * Reads the levels (`allKeyLevels(settings)`: the five fixed ones, derived, plus the user's own), evaluates every enabled
 * level of the market's symbol on the real candles of ITS timeframe (`evaluateLevel`, pure) and builds the day plan.
 * Levels of another symbol are listed but not evaluated (the provider serves one symbol): `unknown`, never confirmed.
 *
 * Cadence: one timer, 1 s (the browser slows it in a background tab – alerts keep running, just later), evaluated only
 * when an input changed (settings, a bar of a used feed, the price at 0.01) and published only when something SHOWN
 * changed (`viewKey`). Nothing runs without a subscriber (`retainKeyLevels`).
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  allKeyLevels,
  buildDayPlan,
  evaluateLevel,
  KEY_TF_SOURCE,
  keyLevelsOfSettings,
  timeframeAvailability,
  unknownEvaluation,
  watchEntry,
  type AlertSettings,
  type AlertStage,
  type DayPlan,
  type KeyLevel,
  type LevelEntry,
  type LevelEvaluation,
  type Observation,
  type Precedence,
  type TfAvailability,
} from "@/domain/keylevels";
import { useJournal } from "@/store/journalStore";
import { getProvider, klineBarKey } from "../marketStore";
import { lastPrice } from "../mapping";
import type { MarketProvider } from "../provider";
import { feedAvailability, levelCandles } from "./candles";
import type { Candle, Stamped } from "../types";

export interface KeyLevelEntry extends LevelEntry {
  /** the level is on the market's symbol and was evaluated */
  live: boolean;
  obs: Observation;
  /** the alert stage the level is in right now */
  stage: AlertStage | null;
}

export interface KeyLevelsView {
  /** `idle`: the live market is not running – every level is `unknown` */
  state: "idle" | "ok";
  /** Binance symbol of the market */
  symbol: string | null;
  entries: KeyLevelEntry[];
  plan: DayPlan;
  precedence: Precedence;
  alerts: AlertSettings;
  tf: TfAvailability[];
}

const EMPTY_PLAN: DayPlan = buildDayPlan({ entries: [], precedence: "higher" });
const INITIAL: KeyLevelsView = {
  state: "idle",
  symbol: null,
  entries: [],
  plan: EMPTY_PLAN,
  precedence: "higher",
  alerts: keyLevelsOfSettings(undefined).alerts,
  tf: timeframeAvailability(null),
};

interface Engine {
  refs: number;
  timer: ReturnType<typeof setInterval> | null;
  offSettings: (() => void) | null;
  view: KeyLevelsView;
  viewKey: string;
  inputKey: string;
  listeners: Set<() => void>;
}
const eng: Engine = { refs: 0, timer: null, offSettings: null, view: INITIAL, viewKey: "", inputKey: "", listeners: new Set() };

/** Evaluates the levels of one symbol at `now` (pure given its inputs – exported for tests). */
export function evaluateEntries(levels: readonly KeyLevel[], symbol: string | null, candlesOf: (tf: KeyLevel["tf"]) => readonly Candle[] | null, now: number, alerts: Pick<AlertSettings, "prepare">, marketRunning = true): KeyLevelEntry[] {
  return levels.map((level) => {
    let evaluation: LevelEvaluation;
    let live = false;
    if (!level.enabled) evaluation = unknownEvaluation("Ausgeschaltet.");
    else if (!marketRunning || !symbol) evaluation = unknownEvaluation("Der Live-Markt läuft nicht – nicht bewertet.");
    else if (level.symbol !== symbol) evaluation = unknownEvaluation(`Gilt für ${level.symbol}; der aktive Markt ist ${symbol} – nicht bewertet.`);
    else {
      live = true;
      const candles = candlesOf(level.tf);
      evaluation = candles ? evaluateLevel(level, candles, now) : unknownEvaluation(`Die ${KEY_TF_SOURCE[level.tf].label} für ${level.tf} sind nicht geladen – nicht bewertet.`);
    }
    return watchEntry(level, evaluation, live, alerts);
  });
}

const r2 = (x: number | null | undefined): string => (x == null ? "-" : x.toFixed(2));

function viewKeyOf(v: KeyLevelsView): string {
  return JSON.stringify([
    v.state,
    v.symbol,
    v.precedence,
    v.alerts,
    v.tf.map((t) => (t.ok ? 1 : t.reason)),
    v.plan.key,
    v.plan.scenarios.map((s) => [s.state, s.trigger, s.invalidation, s.changes]),
    v.entries.map((e) => [
      e.level.id,
      e.level.price,
      e.level.name,
      e.level.enabled,
      e.evaluation.status,
      e.evaluation.basis,
      e.evaluation.reason,
      e.evaluation.progress,
      e.evaluation.retest,
      e.evaluation.broke,
      e.stage,
      e.live,
      r2(e.evaluation.distancePct != null ? Math.round(e.evaluation.distancePct * 10) / 10 : null),
      e.evaluation.events.length,
    ]),
  ]);
}

function inputKeyOf(p: MarketProvider | null, settings: unknown, price: number | null): string {
  const s = settings as { market?: unknown; keyLevels?: unknown };
  let feeds = "";
  if (p) for (const f of new Set(Object.values(KEY_TF_SOURCE).map((x) => x.feed))) feeds += `${klineBarKey(p.get(f) as Stamped<Candle[]> | undefined)}|`;
  return `${p ? p.symbolInfo.binance : "-"}|${feeds}${price == null ? "-" : price.toFixed(2)}|${Math.floor((p?.serverNow() ?? Date.now()) / 60_000)}`.concat(
    `|${JSON.stringify(s.market)}|${JSON.stringify(s.keyLevels)}`,
  );
}

/** One evaluation of everything; publishes only a changed view. `force` ignores the input key. */
export function computeKeyLevels(force = false): void {
  const settings = useJournal.getState().settings;
  const p = getProvider();
  const snap = p ? p.snapshot() : null;
  const price = snap ? (lastPrice(snap)?.price ?? null) : null;
  const key = inputKeyOf(p, settings, price);
  if (!force && key === eng.inputKey) return;
  eng.inputKey = key;
  const cfg = keyLevelsOfSettings(settings);
  const levels = allKeyLevels(settings);
  const now = p ? p.serverNow() : Date.now();
  const symbol = p ? p.symbolInfo.binance : null;
  const entries = evaluateEntries(levels, symbol, (tf) => (p ? levelCandles(p, tf) : null), now, cfg.alerts, !!p);
  const plan = buildDayPlan({ entries: entries.filter((e) => e.live), precedence: cfg.precedence, price });
  const next: KeyLevelsView = { state: p ? "ok" : "idle", symbol, entries, plan, precedence: cfg.precedence, alerts: cfg.alerts, tf: timeframeAvailability(feedAvailability(p)) };
  const vk = viewKeyOf(next);
  if (vk === eng.viewKey) return;
  eng.viewKey = vk;
  eng.view = next;
  for (const l of [...eng.listeners]) l();
}

/** Starts the evaluation while at least one subscriber retains it. Returns the release. */
export function retainKeyLevels(): () => void {
  eng.refs += 1;
  if (eng.refs === 1) {
    eng.offSettings = useJournal.subscribe((st, prev) => {
      if (st.settings.keyLevels !== prev.settings.keyLevels || st.settings.market !== prev.settings.market) computeKeyLevels();
    });
    eng.timer = setInterval(() => computeKeyLevels(), 1000);
  }
  computeKeyLevels(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    eng.refs -= 1;
    if (eng.refs === 0) {
      eng.offSettings?.();
      eng.offSettings = null;
      if (eng.timer) clearInterval(eng.timer);
      eng.timer = null;
    }
  };
}

export const getKeyLevels = (): KeyLevelsView => eng.view;
export function subscribeKeyLevels(cb: () => void): () => void {
  eng.listeners.add(cb);
  return () => void eng.listeners.delete(cb);
}

/** The live view; retains the evaluation while mounted. */
export function useKeyLevels(): KeyLevelsView {
  useEffect(() => retainKeyLevels(), []);
  return useSyncExternalStore(subscribeKeyLevels, getKeyLevels, getKeyLevels);
}

/** Tests: forget everything. */
export function __resetKeyLevels(): void {
  if (eng.timer) clearInterval(eng.timer);
  eng.offSettings?.();
  Object.assign(eng, { refs: 0, timer: null, offSettings: null, view: INITIAL, viewKey: "", inputKey: "" });
  eng.listeners.clear();
}
