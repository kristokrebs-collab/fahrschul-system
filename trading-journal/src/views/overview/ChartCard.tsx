import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { toTradeMarkers } from "@/chart/markers";
import { ChartSkeleton } from "@/chart/ChartSkeleton";
import type { BarsListener, MarkerRect, RangeDays } from "@/chart/NothingCandleChart";
import { resampleCandles, resampleTail } from "@/chart/resample";
import { signalMarkersKey, type SignalMarker } from "@/chart/signalMarkers";
import { levelsConfigured } from "@/domain/defaults";
import { scenario } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import {
  getMcbSeries,
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

/**
 * External store of the MCB events of one chart interval: re-read when the entry check publishes (≤ 1/s, only on a real
 * change) and memoised by content, so the chart re-sets its dots only when one appears, moves or disappears.
 */
function createMcbStore(interval: ChartIv, enabled: boolean, bars: number): { read: () => SignalMarker[]; subscribe: (cb: () => void) => () => void } {
  let dirty = true;
  let key = "";
  let value: SignalMarker[] = NO_SIGNALS;
  const read = (): SignalMarker[] => {
    if (!enabled || !MCB_INTERVALS.has(interval)) return NO_SIGNALS;
    if (dirty) {
      dirty = false;
      const next = getMcbSeries(interval, { bars });
      const k = signalMarkersKey(next);
      if (k !== key) {
        key = k;
        value = next.length ? next : NO_SIGNALS;
      }
    }
    return value;
  };
  const subscribe = (cb: () => void) =>
    subscribeSignalCheck(() => {
      dirty = true;
      cb();
    });
  return { read, subscribe };
}

/** MCB dots for the chart (`createMcbStore`); none while collapsed or on 1m. */
function useMcbMarkers(interval: ChartIv, enabled: boolean, bars: number): SignalMarker[] {
  const store = useMemo(() => createMcbStore(interval, enabled, bars), [interval, enabled, bars]);
  return useSyncExternalStore(store.subscribe, store.read, () => NO_SIGNALS);
}

/** Legend of the MCB dots (the canvas draws dots only, no words that could collide). */
export const MCB_LEGEND = { long: "MCB Bottom/Kauf", short: "MCB Top/Verkauf" } as const;

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
  const signals = useMcbMarkers(interval, chart.open, Math.min(1500, Math.ceil((rangeDays * 86_400) / IV_SECONDS[interval]) + 60));
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
