/**
 * Live structure store (F05): `useTrendlines()` / `getTrendlines()` / `subscribeTrendlines()` / `retainTrendlines()`
 * (pattern of `../keylevels/store.ts`).
 *
 * Reads the selected timeframes (`settings.trendlines`), takes the REAL candles of each (`levelCandles`: 1h, 4h, 1D, 1W
 * straight from their feeds, 30m / 2h / 3h resampled from 15m / 1h) and runs `analyzeTrendlines` on the CLOSED ones. A
 * timeframe the feed cannot serve right now (`timeframeAvailability`) is listed with its reason and is NOT analysed –
 * nothing is substituted. The provider serves one symbol: the lines are those of the market's symbol.
 *
 * Cadence: one timer (1 s, slowed by the browser in a hidden tab), a recompute only when an input changed (settings, a bar
 * key of a used feed, the minute) and a publish only when something shown changed. Nothing runs without a subscriber.
 */
import { useEffect, useSyncExternalStore } from "react";
import { analyzeTrendlines, DEFAULT_TREND_TFS, trendlinesOfSettings, type TrendlinesCfg, type TrendlineAnalysis } from "@/domain/trendlines";
import { KEY_TF_SOURCE, KEY_TIMEFRAMES, timeframeAvailability, type KeyTf, type TfAvailability } from "@/domain/keylevels";
import { useJournal } from "@/store/journalStore";
import { feedAvailability, levelCandles } from "../keylevels/candles";
import { getProvider, klineBarKey } from "../marketStore";
import type { MarketProvider } from "../provider";
import type { Candle, Stamped } from "../types";

export interface TrendTfItem {
  tf: KeyTf;
  selected: boolean;
  /** the feed serves this timeframe right now; otherwise `reason` says why not (German) */
  avail: TfAvailability;
  /** `null`: not selected, or the timeframe is not available */
  analysis: TrendlineAnalysis | null;
}

export interface TrendView {
  /** `idle`: the live market is not running */
  state: "idle" | "ok";
  symbol: string | null;
  cfg: TrendlinesCfg;
  /** every timeframe, in order (30m … 1W) */
  items: TrendTfItem[];
}

const INITIAL: TrendView = {
  state: "idle",
  symbol: null,
  cfg: { tfs: [...DEFAULT_TREND_TFS], chart: true },
  items: KEY_TIMEFRAMES.map((tf) => ({ tf, selected: DEFAULT_TREND_TFS.includes(tf), avail: timeframeAvailability(null).find((a) => a.tf === tf)!, analysis: null })),
};

interface Engine {
  refs: number;
  timer: ReturnType<typeof setInterval> | null;
  offSettings: (() => void) | null;
  view: TrendView;
  viewKey: string;
  inputKey: string;
  listeners: Set<() => void>;
}
const eng: Engine = { refs: 0, timer: null, offSettings: null, view: INITIAL, viewKey: "", inputKey: "", listeners: new Set() };

/** Builds the view from the candles of each timeframe (pure given its inputs – exported for tests). */
export function buildTrendView(cfg: TrendlinesCfg, symbol: string | null, avail: readonly TfAvailability[], candlesOf: (tf: KeyTf) => readonly Candle[] | null, now: number, running: boolean): TrendView {
  const items = KEY_TIMEFRAMES.map((tf): TrendTfItem => {
    const selected = cfg.tfs.includes(tf);
    const a = avail.find((x) => x.tf === tf) ?? { tf, ok: false, reason: "Nicht bewertet." };
    if (!selected || !running || !a.ok) return { tf, selected, avail: a, analysis: null };
    const candles = candlesOf(tf);
    if (!candles) return { tf, selected, avail: { tf, ok: false, reason: `Die ${KEY_TF_SOURCE[tf].label} für ${tf} sind nicht geladen.` }, analysis: null };
    return { tf, selected, avail: a, analysis: analyzeTrendlines(candles, tf, now) };
  });
  return { state: running ? "ok" : "idle", symbol, cfg, items };
}

function inputKeyOf(p: MarketProvider | null, settings: unknown): string {
  let feeds = "";
  if (p) for (const f of new Set(Object.values(KEY_TF_SOURCE).map((x) => x.feed))) feeds += `${klineBarKey(p.get(f) as Stamped<Candle[]> | undefined)}|`;
  return `${p ? p.symbolInfo.binance : "-"}|${feeds}${Math.floor((p?.serverNow() ?? Date.now()) / 60_000)}|${JSON.stringify((settings as { trendlines?: unknown }).trendlines ?? null)}`;
}

/** One evaluation; publishes only a changed view. `force` ignores the input key. */
export function computeTrendlines(force = false): void {
  const settings = useJournal.getState().settings;
  const p = getProvider();
  const key = inputKeyOf(p, settings);
  if (!force && key === eng.inputKey) return;
  eng.inputKey = key;
  const cfg = trendlinesOfSettings(settings);
  const now = p ? p.serverNow() : Date.now();
  const next = buildTrendView(cfg, p ? p.symbolInfo.binance : null, timeframeAvailability(feedAvailability(p)), (tf) => (p ? levelCandles(p, tf) : null), now, !!p);
  const vk = JSON.stringify(next);
  if (vk === eng.viewKey) return;
  eng.viewKey = vk;
  eng.view = next;
  for (const l of [...eng.listeners]) l();
}

/** Starts the evaluation while at least one subscriber retains it. Returns the release. */
export function retainTrendlines(): () => void {
  eng.refs += 1;
  if (eng.refs === 1) {
    eng.offSettings = useJournal.subscribe((st, prev) => {
      if (st.settings.trendlines !== prev.settings.trendlines) computeTrendlines();
    });
    eng.timer = setInterval(() => computeTrendlines(), 1000);
  }
  computeTrendlines(true);
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

export const getTrendlines = (): TrendView => eng.view;
export function subscribeTrendlines(cb: () => void): () => void {
  eng.listeners.add(cb);
  return () => void eng.listeners.delete(cb);
}

/** The live view; retains the evaluation while mounted. */
export function useTrendlines(): TrendView {
  useEffect(() => retainTrendlines(), []);
  return useSyncExternalStore(subscribeTrendlines, getTrendlines, getTrendlines);
}

/** Tests: forget everything. */
export function __resetTrendlines(): void {
  if (eng.timer) clearInterval(eng.timer);
  eng.offSettings?.();
  Object.assign(eng, { refs: 0, timer: null, offSettings: null, view: INITIAL, viewKey: "", inputKey: "" });
  eng.listeners.clear();
}
