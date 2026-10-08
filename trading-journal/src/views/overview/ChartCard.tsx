import { AnimatePresence, motion } from "motion/react";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { toTradeMarkers } from "@/chart/markers";
import { ChartSkeleton } from "@/chart/ChartSkeleton";
import type { BarsListener, MarkerRect, RangeDays } from "@/chart/NothingCandleChart";
import { resampleCandles, resampleTail } from "@/chart/resample";
import { signalMarkersKey, type SignalMarker } from "@/chart/signalMarkers";
import type { DivergenceLine, OverlayLayers, StructureOverlay } from "@/chart/primitives/SignalOverlay";
import { levelsConfigured } from "@/domain/defaults";
import { scenario } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import {
  getChartOverlay,
  getProvider,
  KLINE_FEEDS,
  lastClosed4h,
  priceMv,
  subscribeFeed,
  subscribeSignalCheck,
  tickDirMv,
  tradeTimeMv,
  useFeed,
  useFeedSelect,
  useHealthSelect,
  useStatusLabel,
  volAccumMv,
  type Candle,
  type FeedId,
  type KlineFeed,
  type ProviderHealth,
  type Stamped,
} from "@/market";
import { observeInView } from "@/motion/inView";
import { TextShimmer } from "@/motion/TextShimmer";
import { radius, spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Expander } from "@/primitives/Expander";
import { Segmented } from "@/primitives/Segmented";
import { useEnriched, useJournal } from "@/store/journalStore";
import { useUi, type ChartInterval, type ChartPane } from "@/store/uiStore";
import { CHART_CARD_ID } from "./MarketPanel";

const NothingCandleChart = lazy(() => import("@/chart/NothingCandleChart").then((m) => ({ default: m.NothingCandleChart })));

export const CHART_EMPTY_TITLE = "Noch keine Kerzen";
export const CHART_EMPTY_TEXT = "Sobald Binance erreichbar ist, erscheinen hier die Kerzen. Bis dahin zeigt die Karte den letzten Stand aus dem Cache.";
export const CHART_EMPTY_LINE = "Wartet auf Kursdaten …";
export const CHART_LOADING = "Lade Historie …";
export const CHART_FOLLOW = "Folgen";
export const CHART_ONLY_7D = "Im 1m-Intervall nur 7 Tage";
export const CHART_ONLY_30D = "Im 30m-Intervall nur 1 Monat";
/** Toast after a range pill beyond the interval's history switched the interval. */
export const CHART_SWITCHED = "Auf 1h gewechselt";
export const outsideNote = (n: number): string => `+${n} Trades außerhalb des Zeitraums`;
/** `tj2-ui.flags` key that hides the second pane (`–`). */
export const PANE_OFF_FLAG = "chartPaneOff";
/**
 * `tj2-ui.flags` keys of the check overlay layers (legend toggles under the chart). MCB, divergences and S/R are on by
 * default (their flag hides them), structure is off by default (its flag shows it).
 */
export const LAYER_FLAGS = { mcb: "chartMcbOff", div: "chartDivOff", sr: "chartSrOff", struct: "chartStructOn" } as const;

/**
 * Chart intervals (`uiStore.ChartInterval`, persisted in `tj2-ui`). `30m` has no stream of its own: it is resampled
 * from `kline_15m` (the entry check's base rung), so the candles match the check's 30m bars.
 */
type ChartIv = ChartInterval;
const INTERVALS: readonly { v: ChartIv; label: string }[] = [
  { v: "1m", label: "1m" },
  { v: "30m", label: "30m" },
  { v: "1h", label: "1h" },
  { v: "4h", label: "4h" },
];
/** Longest range (days) an interval's history covers: 1m 7 days (REST cap), 30m one month (15m ring ≈ 31 days). */
const MAX_RANGE: Partial<Record<ChartIv, RangeDays>> = { "1m": 7, "30m": 30 };
const RANGE_HINT: Partial<Record<ChartIv, string>> = { "1m": CHART_ONLY_7D, "30m": CHART_ONLY_30D };
const MS_15M = 900_000;
const MS_30M = 1_800_000;
/** Intervals with MCB dots from the entry check (1m has no check timeframe). */
const MCB_INTERVALS: ReadonlySet<ChartIv> = new Set(["30m", "1h", "4h"]);
const IV_SECONDS: Record<ChartIv, number> = { "1m": 60, "30m": 1800, "1h": 3600, "4h": 14400 };
const NO_SIGNALS: SignalMarker[] = [];
const RANGES: readonly { v: RangeDays; label: string }[] = [
  { v: 7, label: "1W" },
  { v: 30, label: "1M" },
  { v: 90, label: "3M" },
];
type PaneChoice = "none" | ChartPane;
const PANES: readonly { v: PaneChoice; label: string }[] = [
  { v: "none", label: "–" },
  { v: "ratio", label: "Ratio" },
  { v: "oi", label: "OI" },
];

/** Union by open time, sorted ascending (keeps the history identity stable across live ticks). */
export function mergeCandles(history: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  const m = new Map<number, Candle>();
  for (const c of history) m.set(c.time, c);
  for (const c of incoming) m.set(c.time, c);
  return [...m.values()].sort((a, b) => a.time - b.time);
}

interface HistoryExtra {
  feed: KlineFeed;
  /** market symbol the bars belong to */
  symbol: string;
  candles: Candle[];
}
interface HistoryState {
  feed: KlineFeed;
  symbol: string;
  /** `feedKey()` of the feed value last folded in (length + last open time, NOT the object identity) */
  seen: string | undefined;
  extra: HistoryExtra | null;
  candles: Candle[];
}

/**
 * Change signal of a kline feed value: the stamped object is new on EVERY publish (live ticks of the forming
 * bar included), but the history only changes when a bar is appended or the bootstrap arrives.
 */
export function feedKey(feed: Stamped<Candle[]> | undefined): string | undefined {
  if (!feed) return undefined;
  const last = feed.data[feed.data.length - 1];
  return `${feed.data.length}:${last?.time ?? 0}`;
}

/**
 * Folds a new feed value / history() result into the loaded history; keeps the array identity when nothing new
 * arrived. Another feed or symbol starts over (never mixes two markets' bars).
 */
export function nextHistory(prev: HistoryState, feedId: KlineFeed, feed: Stamped<Candle[]> | undefined, extra: HistoryExtra | null, symbol: string): HistoryState {
  const base = prev.feed === feedId && prev.symbol === symbol ? prev.candles : [];
  let next = base;
  if (feed) {
    const last = base[base.length - 1];
    const incomingLast = feed.data[feed.data.length - 1];
    if (base.length === 0) next = feed.data;
    else if (incomingLast && (!last || incomingLast.time > last.time)) next = mergeCandles(base, feed.data);
  }
  if (extra && extra.feed === feedId && extra.symbol === symbol && extra.candles.length) {
    const first = next[0];
    const extraFirst = extra.candles[0];
    if (!first || (extraFirst && extraFirst.time < first.time)) next = mergeCandles(extra.candles, next);
  }
  return { feed: feedId, symbol, seen: feedKey(feed), extra, candles: next };
}

/** The kline value as of its last bar-key change: the card re-renders once per new bar, never per forming-bar tick. */
const selectBars = (v: Stamped<Candle[]> | undefined): Stamped<Candle[]> | undefined => v;
const sameBarKey = (a: Stamped<Candle[]> | undefined, b: Stamped<Candle[]> | undefined): boolean => feedKey(a) === feedKey(b);
/** Close of the last closed 4h bar; the closed bar is always among the last few, so only the tail is scanned. */
export const selectClosed4hClose = (v: Stamped<Candle[]> | undefined): number | null => (v ? (lastClosed4h(v.data.slice(-4))?.c ?? null) : null);

/** Only the label dips while pressed, so the shared `chart-range` thumb is never measured mid-press. */
const LABEL_PRESS = { press: { scale: 0.97 } };

function toRange(days: number): RangeDays {
  return days <= 7 ? 7 : days <= 30 ? 30 : 90;
}

/**
 * Range pills `1W | 1M | 3M` with the shared `chart-range` thumb (Plan 3.3); only the label squashes on press. A range
 * beyond the interval's history (`maxDays`) stays tappable (dimmed): the tap calls `onBeyond`, which switches to 1h
 * and says so – a disabled pill did nothing on touch and explained itself only by a hover title (tablet audit 2a.1).
 */
function RangePills({ value, onChange, maxDays, hint, onBeyond }: { value: RangeDays; onChange: (d: RangeDays) => void; maxDays?: number; hint?: string; onBeyond: (d: RangeDays) => void }) {
  const reduced = useReducedFx();
  return (
    <div role="radiogroup" aria-label="Zeitraum" className="inline-flex gap-0.5 rounded-xl border border-line bg-ink-950/60 p-1">
      {RANGES.map((r) => {
        const beyond = maxDays != null && r.v > maxDays;
        return (
          <motion.button
            key={r.v}
            type="button"
            role="radio"
            aria-checked={value === r.v}
            aria-description={beyond ? `${hint}: wechselt auf 1h` : undefined}
            title={beyond ? `${hint} – tippen wechselt auf 1h` : undefined}
            onClick={() => (beyond ? onBeyond(r.v) : onChange(r.v))}
            whileTap={reduced ? undefined : "press"}
            className={cn(
              // coarse pointers: at least 44 px wide, and the hit area grows 10 px up and down (44 px), never sideways into the neighbouring pill
              "relative rounded-lg px-2.5 py-1 text-center text-xs font-medium transition-colors pointer-coarse:min-w-11 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
              value === r.v ? "text-fg" : beyond ? "text-faint hover:text-mute" : "text-mute hover:text-fg",
            )}
          >
            {value === r.v && (
              <motion.span
                layoutId="chart-range"
                layoutDependency={value}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg border border-line-2 bg-ink-750"
                style={{ borderRadius: radius.thumb }}
                transition={spring.layout}
              />
            )}
            <motion.span className="relative z-10 inline-block" variants={LABEL_PRESS} transition={spring.press}>
              {r.label}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** What the check overlay draws on one chart interval (each field keeps its identity until its content changes). */
export interface CheckOverlay {
  signals: SignalMarker[];
  divergences: DivergenceLine[];
  structure: StructureOverlay | null;
}
const NO_LINES: DivergenceLine[] = [];
const EMPTY_OVERLAY: CheckOverlay = { signals: NO_SIGNALS, divergences: NO_LINES, structure: null };

/** Content key of divergence lines (state and activity included: both change the look). */
export const divergencesKey = (lines: readonly DivergenceLine[]): string =>
  lines.map((d) => `${d.osc}${d.kind[0]}${d.dir}:${d.from.time}:${d.to.time}:${d.state[0]}${d.active ? "+" : ""}`).join(",");

/** Content key of the drawn structure: levels, breaks, EQs, swings – not the live distances (not drawn). */
export function structureKey(s: StructureOverlay | null): string {
  if (!s) return "";
  const lv = (l: StructureOverlay["supports"][number] | null) => (l ? `${l.dir}${l.price}@${l.time}:${l.top}-${l.btm}${l.label}` : "-");
  return [
    s.supports.map(lv).join(";"),
    s.resistances.map(lv).join(";"),
    lv(s.support),
    lv(s.resistance),
    s.breaks.map((b) => `${b.kind}${b.dir}${b.internal ? "i" : ""}${b.time}:${b.pivotTime}:${b.level}`).join(";"),
    s.eqs.map((q) => `${q.kind}${q.from.time}:${q.to.time}${q.broken ? "x" : ""}`).join(";"),
    s.swings.map((p) => `${p.label}${p.internal ? "i" : ""}${p.time}`).join(";"),
  ].join("|");
}

/**
 * External store of the check overlay of one chart interval (MCB dots, divergences, structure + S/R): re-read when the
 * entry check publishes (≤ 1/s, only on a real change) and on a new bar (the store is re-created per history change),
 * each part memoised by content, so the chart re-sets a layer only when something on it appears, moves or changes
 * state. Hidden layers are not computed; all layers come from one build of the bars (`getChartOverlay`).
 *
 * Off the publish path: the engine publishes inside its own timer task, so a publish only marks the overlay stale and
 * schedules ONE re-read in a task of its own (the re-read costs ≈ 0.2 ms on 4h, ≈ 2.4 ms on 30m × 1500 bars). While
 * the chart card is off screen nothing is re-read; it catches up when it scrolls back into view.
 */
interface OverlayStore {
  read: () => CheckOverlay;
  subscribe: (cb: () => void) => () => void;
  /** chart card on screen (default true): off screen, publishes are only noted */
  setVisible: (on: boolean) => void;
}

function createOverlayStore(interval: ChartIv, enabled: boolean, bars: number, layers: OverlayLayers): OverlayStore {
  let dirty = true;
  let visible = true;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const subs = new Set<() => void>();
  const keys = { mcb: "", div: "", st: "" };
  let value: CheckOverlay = EMPTY_OVERLAY;
  const read = (): CheckOverlay => {
    if (!enabled || !MCB_INTERVALS.has(interval)) return EMPTY_OVERLAY;
    if (dirty) {
      dirty = false;
      let next = value;
      const o = getChartOverlay(interval, { bars, mcb: layers.mcb, div: layers.div, structure: layers.sr || layers.struct });
      const mcb = o.mcb.length ? o.mcb : NO_SIGNALS;
      const mk = signalMarkersKey(mcb);
      if (mk !== keys.mcb) {
        keys.mcb = mk;
        next = { ...next, signals: mcb };
      }
      const div = o.div.length ? o.div : NO_LINES;
      const dk = divergencesKey(div);
      if (dk !== keys.div) {
        keys.div = dk;
        next = { ...next, divergences: div };
      }
      const sk = structureKey(o.structure);
      if (sk !== keys.st) {
        keys.st = sk;
        next = { ...next, structure: o.structure };
      }
      value = next;
    }
    return value;
  };
  const notify = () => {
    if (pending || !visible || !subs.size) return;
    pending = setTimeout(() => {
      pending = null;
      for (const cb of [...subs]) cb();
    }, 0);
  };
  const subscribe = (cb: () => void) => {
    subs.add(cb);
    const off = subscribeSignalCheck(() => {
      dirty = true;
      notify();
    });
    return () => {
      off();
      subs.delete(cb);
      if (!subs.size && pending) {
        clearTimeout(pending);
        pending = null;
      }
    };
  };
  const setVisible = (on: boolean) => {
    visible = on;
    if (on && dirty) notify();
  };
  return { read, subscribe, setVisible };
}

/** The check overlay for the chart (`createOverlayStore`); empty while collapsed or on 1m. */
function useCheckOverlay(interval: ChartIv, enabled: boolean, bars: number, layers: OverlayLayers, history: readonly Candle[]): CheckOverlay {
  // a new bar (history identity) re-creates the store: dots, pivots and levels follow the new candle
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `history` is the re-read trigger, not an input
  const store = useMemo(() => createOverlayStore(interval, enabled, bars, layers), [interval, enabled, bars, layers, history]);
  // re-read only while the chart card is on screen (shared IntersectionObserver; without one it always is)
  useEffect(() => {
    const el = document.getElementById(CHART_CARD_ID);
    if (!el) return;
    return observeInView(el, (on) => store.setVisible(on));
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.read, () => EMPTY_OVERLAY);
}

/** Legend of the MCB dots (the canvas draws dots only, no words that could collide). */
export const MCB_LEGEND = { long: "MCB Bottom/Kauf", short: "MCB Top/Verkauf" } as const;

/** Layer toggles under the chart: visible label, accessible name. */
export const LAYER_TEXT: Readonly<Record<keyof OverlayLayers, { label: string; name: string }>> = {
  mcb: { label: "MCB", name: "MCB-Punkte im Chart" },
  div: { label: "Divergenzen", name: "Divergenzen im Chart" },
  sr: { label: "S/R", name: "Support und Widerstand im Chart" },
  struct: { label: "Struktur", name: "Marktstruktur im Chart (BOS, CHoCH, EQH, EQL)" },
};
/** Key of the candle-close states and line styles (the canvas carries no words for them). */
export const STATE_KEY = { provisional: "vorläufig", confirmed: "bestätigt", strong: "stark bestätigt", regular: "regulär", hidden: "versteckt" } as const;
const LAYER_ORDER: readonly (keyof OverlayLayers)[] = ["mcb", "div", "sr", "struct"];

/** Tiny legend glyphs (decorative): what each layer looks like on the canvas. */
function LayerGlyph({ layer }: { layer: keyof OverlayLayers }) {
  const common = { width: 18, height: 10, viewBox: "0 0 18 10", "aria-hidden": true, className: "shrink-0" } as const;
  if (layer === "mcb")
    return (
      <svg {...common}>
        <circle cx="5" cy="5" r="3" fill="var(--color-win)" />
        <circle cx="13" cy="5" r="3" fill="var(--color-loss)" />
      </svg>
    );
  if (layer === "div")
    return (
      <svg {...common}>
        <path d="M1.5 3 L16.5 7.5" stroke="var(--color-win)" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    );
  if (layer === "sr")
    return (
      <svg {...common}>
        <rect x="1" y="3.5" width="16" height="3" fill="rgba(255,255,255,0.08)" />
        <path d="M1 3.5 H17" stroke="#9b9b9b" strokeWidth="1" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M1 6.5 H17" stroke="#9b9b9b" strokeWidth="1" strokeDasharray="2 2.5" />
      <path d="M7 3 H11" stroke="#5f5f5f" strokeWidth="1" />
    </svg>
  );
}

/** Key glyph of a candle-close state (neutral ink: the style, not the side). */
function StateGlyph({ state }: { state: "provisional" | "confirmed" | "strong" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {state === "provisional" ? (
        <circle cx="6" cy="6" r="3" fill="none" stroke="#9b9b9b" strokeWidth="1.25" />
      ) : (
        <circle cx="6" cy="6" r="3.25" fill="#d9d9d9" />
      )}
      {state === "strong" && <circle cx="6" cy="6" r="5.4" fill="none" stroke="#d9d9d9" strokeOpacity="0.5" strokeWidth="1" />}
    </svg>
  );
}

function LineGlyph({ dashed }: { dashed?: boolean }) {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true" className="shrink-0">
      <path d="M1 4 H15" stroke="#d9d9d9" strokeWidth="1.25" strokeDasharray={dashed ? "3.5 2.5" : undefined} />
    </svg>
  );
}

/**
 * Layer toggles + style key under the chart (`aria-pressed` chips, ≥ 44 px tall on coarse pointers): MCB · Divergenzen
 * · S/R · Struktur, then what a ring / dot / halo and a solid / dashed line mean. Persisted in `tj2-ui.flags`.
 */
export const ChartLayers = memo(function ChartLayers({ layers, onToggle }: { layers: OverlayLayers; onToggle: (layer: keyof OverlayLayers) => void }) {
  const reduced = useReducedFx();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3" data-testid="chart-layers">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ebenen im Chart">
        {LAYER_ORDER.map((k) => {
          const on = layers[k];
          return (
            <motion.button
              key={k}
              type="button"
              aria-pressed={on}
              aria-label={LAYER_TEXT[k].name}
              onClick={() => onToggle(k)}
              whileTap={reduced ? undefined : { scale: 0.95 }}
              transition={spring.press}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-[color,border-color,background-color,opacity] duration-200 pointer-coarse:min-h-11 pointer-coarse:px-3",
                on ? "border-white/25 bg-white/[0.06] text-fg" : "border-line-2 text-faint hover:text-mute",
              )}
              data-chart-layer={k}
            >
              <span className={cn("inline-flex transition-opacity duration-200", on ? "opacity-100" : "opacity-35")}>
                <LayerGlyph layer={k} />
              </span>
              {LAYER_TEXT[k].label}
            </motion.button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint" data-testid="chart-state-key">
        {layers.mcb && (
          <>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <StateGlyph state="provisional" />
              {STATE_KEY.provisional}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <StateGlyph state="confirmed" />
              {STATE_KEY.confirmed}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <StateGlyph state="strong" />
              {STATE_KEY.strong}
            </span>
          </>
        )}
        {layers.div && (
          <>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <LineGlyph />
              {STATE_KEY.regular}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <LineGlyph dashed />
              {STATE_KEY.hidden}
            </span>
          </>
        )}
      </div>
    </div>
  );
});

function McbLegend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2" data-testid="mcb-legend">
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-win" />
        {MCB_LEGEND.long}
      </span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-loss" />
        {MCB_LEGEND.short}
      </span>
    </span>
  );
}

/** Status label · outside count · loading shimmer. Follows health on its own, so the card never re-renders for it. */
function ChartNote({ feedId, outside, loading, mcb }: { feedId: KlineFeed; outside: number; loading: boolean; mcb: boolean }) {
  const label = useStatusLabel(feedId);
  const text = [label.text, outside > 0 ? outsideNote(outside) : null].filter(Boolean).join(" · ");
  return (
    <>
      {text}
      {mcb ? (
        <>
          {text ? " · " : null}
          <McbLegend />
        </>
      ) : null}
      {loading ? (
        <>
          {text ? " · " : null}
          <TextShimmer baseColor="var(--color-faint)" bandColor="var(--color-mute)">
            {CHART_LOADING}
          </TextShimmer>
        </>
      ) : null}
    </>
  );
}

type FeedHealth = ProviderHealth["feeds"][FeedId];
/** Per-feed health selectors of the gate (module constants, so `useHealthSelect` never re-memoises). */
const GATE_HEALTH = Object.fromEntries(KLINE_FEEDS.map((f) => [f, (h: ProviderHealth): FeedHealth => h.feeds[f]])) as Record<KlineFeed, (h: ProviderHealth) => FeedHealth>;
/** The gate reads only the state and the failure count: `lastDataAt` ticks (once a second while live) never re-render it. */
const sameGateHealth = (a: FeedHealth, b: FeedHealth): boolean => a.state === b.state && a.consecutiveFailures === b.consecutiveFailures;

/**
 * Empty state instead of an endless skeleton: no bars, the history request has settled and the feed is not (yet)
 * delivering (offline / failed fallback / at least one REST failure). First paint keeps the skeleton. Health changes
 * several times per second while live; only this gate follows them and hands back the same `chart` element.
 */
function ChartBodyGate({ feedId, hasCandles, loading, chart }: { feedId: KlineFeed; hasCandles: boolean; loading: boolean; chart: ReactElement }) {
  const h = useHealthSelect(GATE_HEALTH[feedId], sameGateHealth);
  const empty = !hasCandles && (h.state === "offline" || h.consecutiveFailures >= 3 || (!loading && (h.consecutiveFailures >= 1 || h.state === "fallback")));
  return empty ? <EmptyState title={CHART_EMPTY_TITLE} text={CHART_EMPTY_TEXT} line={CHART_EMPTY_LINE} /> : chart;
}

/**
 * `Chart · {sym} Perp` (Plan 6.1 "Chart-Karte", Plan 5): collapsible card (chart stays mounted), interval / range /
 * pane controls, lazy `NothingCandleChart`. The card renders on bar changes only: history through a bar-key
 * selector, the forming candle straight into the chart (`priceMv` per trade, `subscribeFeed` per kline), status
 * and empty state in their own leaves. Trigger levels, trade markers → `openDetail(id, "marker")` with a ghost
 * `layoutId="trade-{id}"` at the marker rect.
 */
export function ChartCard() {
  const settings = useJournal((s) => s.settings);
  const trades = useEnriched();
  const chart = useUi((s) => s.chart);
  const setChart = useUi((s) => s.setChart);
  const paneOff = useUi((s) => s.flags[PANE_OFF_FLAG] === true);
  const mcbOff = useUi((s) => s.flags[LAYER_FLAGS.mcb] === true);
  const divOff = useUi((s) => s.flags[LAYER_FLAGS.div] === true);
  const srOff = useUi((s) => s.flags[LAYER_FLAGS.sr] === true);
  const structOn = useUi((s) => s.flags[LAYER_FLAGS.struct] === true);
  const layers = useMemo<OverlayLayers>(() => ({ mcb: !mcbOff, div: !divOff, sr: !srOff, struct: structOn }), [mcbOff, divOff, srOff, structOn]);
  const setFlag = useUi((s) => s.setFlag);
  const detailId = useUi((s) => s.detail.id);
  const detailSource = useUi((s) => s.detail.source);
  const openDetail = useUi((s) => s.openDetail);
  const pushToast = useUi((s) => s.pushToast);

  const interval = chart.interval;
  const maxRange = MAX_RANGE[interval];
  const rangeDays = toRange(maxRange != null ? Math.min(chart.rangeDays, maxRange) : chart.rangeDays);
  const pane: PaneChoice = paneOff ? "none" : chart.pane === "cvd" ? "none" : chart.pane;
  // 30m is resampled from the 15m stream (history, live tail and the check's 30m rung share it)
  const feedId: KlineFeed = interval === "30m" ? "kline_15m" : `kline_${interval}`;
  const symbol = settings.market.symbol;
  const levelsOn = levelsConfigured(settings);

  const feed = useFeedSelect(feedId, selectBars, sameBarKey);
  const close4h = useFeedSelect("kline_4h", selectClosed4hClose);
  const ratio = useFeed("topAccountRatio");
  const oi = useFeed("openInterestHist");

  // history: stable identity per load, extended only when a NEW bar arrives or `history()` returns (state-from-props,
  // no effect, no ref in render)
  const [extra, setExtra] = useState<HistoryExtra | null>(null);
  const [hist, setHist] = useState<HistoryState>(() => ({ feed: feedId, symbol, seen: undefined, extra: null, candles: [] }));
  let source = hist.candles;
  if (hist.feed !== feedId || hist.symbol !== symbol || hist.seen !== feedKey(feed) || hist.extra !== extra) {
    const next = nextHistory(hist, feedId, feed, extra, symbol);
    setHist(next);
    source = next.candles;
  }
  // stable identity per history change (the chart keys `setData` on it)
  const resampled = useMemo(() => (interval === "30m" ? resampleCandles(source, MS_15M, MS_30M) : null), [interval, source]);
  const candles = resampled ?? source;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [outside, setOutside] = useState(0);
  const [ghost, setGhost] = useState<{ id: string; rect: MarkerRect } | null>(null);

  // range beyond the bootstrap window → `history()` (missing edge only, ≤ 30 days retention)
  const requestKey = `${symbol}:${feedId}:${rangeDays}`;
  useEffect(() => {
    const p = getProvider();
    if (!p) return;
    let cancelled = false;
    const now = Date.now();
    p.history(feedId, { from: now - rangeDays * 86_400_000, to: now })
      .then((res) => {
        if (!cancelled && res.data.length) setExtra({ feed: feedId, symbol, candles: res.data });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [feedId, symbol, rangeDays, requestKey]);
  const loading = loadedKey !== requestKey;
  const markers = useMemo(() => toTradeMarkers(trades), [trades]);
  const overlay = useCheckOverlay(interval, chart.open, Math.min(1500, Math.ceil((rangeDays * 86_400) / IV_SECONDS[interval]) + 60), layers, candles);
  const signals = overlay.signals;
  const onLayer = useCallback(
    (k: keyof OverlayLayers) => {
      if (k === "struct") setFlag(LAYER_FLAGS.struct, !layers.struct);
      else setFlag(LAYER_FLAGS[k], layers[k]);
    },
    [layers, setFlag],
  );
  const active = levelsOn && close4h != null ? scenario(close4h, settings.market) : null;
  const activeScenario = active?.key === "long" || active?.key === "short" ? active.key : null;

  // forming candle: kline frames go straight into the chart (≤ 1 per frame), never through a render
  const subscribeBars = useCallback(
    (listener: BarsListener) =>
      subscribeFeed(feedId, (v) => {
        if (!v) return;
        listener(interval === "30m" ? resampleTail(v.data, MS_15M, MS_30M) : v.data, v.asOf);
      }),
    [feedId, interval],
  );

  /** A range pill beyond the interval's history: switch to 1h with that range and say so. */
  const onBeyond = useCallback(
    (d: RangeDays) => {
      const hint = RANGE_HINT[interval];
      setChart({ interval: "1h", rangeDays: d });
      pushToast({ kind: "info", title: CHART_SWITCHED, detail: hint ? `${hint}.` : undefined });
    },
    [interval, setChart, pushToast],
  );

  const onMarkerClick = useCallback(
    (id: string, rect: MarkerRect) => {
      setGhost({ id, rect });
      openDetail(id, "marker");
    },
    [openDetail],
  );
  // keep the ghost until the detail closed (reverse morph target)
  useEffect(() => {
    if (!ghost || detailId === ghost.id) return;
    const t = setTimeout(() => setGhost(null), 500);
    return () => clearTimeout(t);
  }, [detailId, ghost]);

  const sym = symbol.split(":").pop() ?? "BTCUSDT";
  const body = (
    <Suspense fallback={<ChartSkeleton className="h-[300px] md:h-[420px]" />}>
      {/* a new market gets a fresh chart: no bar, pulse or print of the previous symbol survives the switch */}
      <NothingCandleChart
        key={symbol}
        candles={candles}
        interval={interval}
        levels={settings.market}
        activeScenario={activeScenario}
        markers={markers}
        signals={signals}
        divergences={overlay.divergences}
        structure={overlay.structure}
        layers={layers}
        pane={pane}
        ratio={ratio?.data}
        oi={oi?.data}
        rangeDays={rangeDays}
        price={priceMv}
        tradeTime={tradeTimeMv}
        tickDir={tickDirMv}
        tradeVolume={volAccumMv}
        subscribeBars={subscribeBars}
        paused={!chart.open}
        followLabel={CHART_FOLLOW}
        onMarkerClick={onMarkerClick}
        onOutsideCount={setOutside}
      />
    </Suspense>
  );

  return (
    <div id={CHART_CARD_ID} className="scroll-mt-20">
      <Card
        title={`Chart · ${sym} Perp`}
        note={<ChartNote feedId={feedId} outside={outside} loading={loading} mcb={signals.length > 0} />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<ChartIv>
              size="sm"
              aria-label="Intervall"
              options={INTERVALS}
              value={interval}
              onChange={(v) => setChart({ interval: v, rangeDays: v === "1m" ? 7 : Math.min(chart.rangeDays, MAX_RANGE[v] ?? chart.rangeDays) })}
            />
            <RangePills value={rangeDays} onChange={(d) => setChart({ rangeDays: d })} maxDays={maxRange} hint={RANGE_HINT[interval]} onBeyond={onBeyond} />
            <Segmented<PaneChoice>
              size="sm"
              aria-label="Pane"
              options={PANES}
              value={pane}
              onChange={(v) => {
                if (v === "none") setFlag(PANE_OFF_FLAG, true);
                else {
                  setFlag(PANE_OFF_FLAG, false);
                  setChart({ pane: v });
                }
              }}
            />
            <Expander open={chart.open} onToggle={() => setChart({ open: !chart.open })} label="Chart" controls={`${CHART_CARD_ID}-body`} />
          </div>
        }
      >
        {/* Collapse without unmount (Plan 3.3 "Chart-Karte einklappen"): height animates like the Collapsible-Explainer, the chart instance stays. */}
        <motion.div id={`${CHART_CARD_ID}-body`} className="relative overflow-hidden" initial={false} animate={{ height: chart.open ? "auto" : 0, opacity: chart.open ? 1 : 0 }} transition={tween.collapse} aria-hidden={!chart.open}>
          <ChartBodyGate feedId={feedId} hasCandles={candles.length > 0} loading={loading} chart={body} />
          {MCB_INTERVALS.has(interval) && candles.length > 0 && <ChartLayers layers={layers} onToggle={onLayer} />}
          <AnimatePresence>
            {ghost && detailSource === "marker" && (
              <motion.div
                key={ghost.id}
                layoutId={`trade-${ghost.id}`}
                aria-hidden="true"
                className="pointer-events-none fixed z-[57]"
                style={{ top: ghost.rect.top, left: ghost.rect.left, width: ghost.rect.width, height: ghost.rect.height, borderRadius: radius.card }}
                transition={{ layout: spring.detail }}
                exit={{ opacity: 0, transition: tween.exit }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </Card>
    </div>
  );
}
