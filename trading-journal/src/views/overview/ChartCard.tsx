import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toTradeMarkers } from "@/chart/markers";
import { ChartSkeleton } from "@/chart/ChartSkeleton";
import type { ChartHandle, MarkerRect, RangeDays } from "@/chart/NothingCandleChart";
import { scenario } from "@/domain/trigger";
import { cn } from "@/lib/cn";
import { getProvider, lastClosed4h, useFeed, useHealth, useStatusLabel, type Candle, type KlineFeed, type Stamped } from "@/market";
import { radius, spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
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
export const CHART_LOADING = "Lade Historie …";
export const CHART_FOLLOW = "Folgen";
export const CHART_ONLY_7D = "Im 1m-Intervall nur 7 Tage";
export const outsideNote = (n: number): string => `+${n} Trades außerhalb des Zeitraums`;
/** `tj2-ui.flags` key that hides the second pane (`–`). */
export const PANE_OFF_FLAG = "chartPaneOff";

const INTERVALS: readonly { v: ChartInterval; label: string }[] = [
  { v: "1m", label: "1m" },
  { v: "1h", label: "1h" },
  { v: "4h", label: "4h" },
];
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
  candles: Candle[];
}
interface HistoryState {
  feed: KlineFeed;
  /** the stamped feed value last folded in */
  seen: Stamped<Candle[]> | undefined;
  extra: HistoryExtra | null;
  candles: Candle[];
}

/** Folds a new feed value / history() result into the loaded history; keeps the array identity when nothing new arrived. */
export function nextHistory(prev: HistoryState, feedId: KlineFeed, feed: Stamped<Candle[]> | undefined, extra: HistoryExtra | null): HistoryState {
  const base = prev.feed === feedId ? prev.candles : [];
  let next = base;
  if (feed) {
    const last = base[base.length - 1];
    const incomingLast = feed.data[feed.data.length - 1];
    if (base.length === 0) next = feed.data;
    else if (incomingLast && (!last || incomingLast.time > last.time)) next = mergeCandles(base, feed.data);
  }
  if (extra && extra.feed === feedId && extra.candles.length) {
    const first = next[0];
    const extraFirst = extra.candles[0];
    if (!first || (extraFirst && extraFirst.time < first.time)) next = mergeCandles(extra.candles, next);
  }
  return { feed: feedId, seen: feed, extra, candles: next };
}

function toRange(days: number): RangeDays {
  return days <= 7 ? 7 : days <= 30 ? 30 : 90;
}

/** Range pills `1W | 1M | 3M` with the shared `chart-range` thumb (Plan 3.3). */
function RangePills({ value, onChange, disabledAbove }: { value: RangeDays; onChange: (d: RangeDays) => void; disabledAbove?: number }) {
  return (
    <div role="radiogroup" aria-label="Zeitraum" className="inline-flex gap-0.5 rounded-xl border border-line bg-ink-950/60 p-1">
      {RANGES.map((r) => {
        const disabled = disabledAbove != null && r.v > disabledAbove;
        return (
          <button
            key={r.v}
            type="button"
            role="radio"
            aria-checked={value === r.v}
            disabled={disabled}
            title={disabled ? CHART_ONLY_7D : undefined}
            onClick={() => onChange(r.v)}
            className={cn("relative rounded-lg px-2.5 py-1 text-xs font-medium transition-colors", value === r.v ? "text-fg" : "text-mute hover:text-fg", disabled && "cursor-not-allowed opacity-40")}
          >
            {value === r.v && <motion.span layoutId="chart-range" aria-hidden="true" className="absolute inset-0 rounded-lg border border-line-2 bg-ink-750" style={{ borderRadius: radius.thumb }} transition={spring.layout} />}
            <span className="relative z-10">{r.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * `Chart · {sym} Perp` (Plan 6.1 "Chart-Karte", Plan 5): collapsible card (chart stays mounted), interval /
 * range / pane controls, lazy `NothingCandleChart` fed by `useFeed("kline_*")` (history identity stable,
 * live bar via `live`), trigger levels, trade markers → `openDetail(id, "marker")` with a ghost
 * `layoutId="trade-{id}"` at the marker rect.
 */
export function ChartCard() {
  const settings = useJournal((s) => s.settings);
  const trades = useEnriched();
  const chart = useUi((s) => s.chart);
  const setChart = useUi((s) => s.setChart);
  const flags = useUi((s) => s.flags);
  const setFlag = useUi((s) => s.setFlag);
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);

  const interval = chart.interval;
  const rangeDays = toRange(interval === "1m" ? Math.min(chart.rangeDays, 7) : chart.rangeDays);
  const pane: PaneChoice = flags[PANE_OFF_FLAG] ? "none" : chart.pane === "cvd" ? "none" : chart.pane;
  const feedId: KlineFeed = `kline_${interval}`;

  const feed = useFeed(feedId);
  const k4 = useFeed("kline_4h");
  const ratio = useFeed("topAccountRatio");
  const oi = useFeed("openInterestHist");
  const health = useHealth();
  const label = useStatusLabel(feedId);
  const ref = useRef<ChartHandle>(null);

  // history: stable identity per load, extended only when a NEW bar arrives or `history()` returns (state-from-props,
  // no effect, no ref in render); live: the forming bar
  const [extra, setExtra] = useState<HistoryExtra | null>(null);
  const [hist, setHist] = useState<HistoryState>(() => ({ feed: feedId, seen: undefined, extra: null, candles: [] }));
  let candles = hist.candles;
  if (hist.feed !== feedId || hist.seen !== feed || hist.extra !== extra) {
    const next = nextHistory(hist, feedId, feed, extra);
    setHist(next);
    candles = next.candles;
  }
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [outside, setOutside] = useState(0);
  const [ghost, setGhost] = useState<{ id: string; rect: MarkerRect } | null>(null);

  // range beyond the bootstrap window → `history()` (missing edge only, ≤ 30 days retention)
  const requestKey = `${feedId}:${rangeDays}`;
  useEffect(() => {
    const p = getProvider();
    if (!p) return;
    let cancelled = false;
    const now = Date.now();
    p.history(feedId, { from: now - rangeDays * 86_400_000, to: now })
      .then((res) => {
        if (!cancelled && res.data.length) setExtra({ feed: feedId, candles: res.data });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [feedId, rangeDays, requestKey]);
  const loading = loadedKey !== requestKey;
  const live = feed?.data[feed.data.length - 1];
  const markers = useMemo(() => toTradeMarkers(trades), [trades]);
  const closed4h = k4 ? lastClosed4h(k4.data) : null;
  const active = closed4h ? scenario(closed4h.c, settings.market) : null;
  const activeScenario = active?.key === "long" || active?.key === "short" ? active.key : null;

  const onMarkerClick = useCallback(
    (id: string, rect: MarkerRect) => {
      setGhost({ id, rect });
      openDetail(id, "marker");
    },
    [openDetail],
  );
  // keep the ghost until the detail closed (reverse morph target)
  useEffect(() => {
    if (!ghost || detail.id === ghost.id) return;
    const t = setTimeout(() => setGhost(null), 500);
    return () => clearTimeout(t);
  }, [detail.id, ghost]);

  const feedHealth = health.feeds[feedId];
  const empty = candles.length === 0 && (feedHealth.state === "offline" || feedHealth.consecutiveFailures >= 3);
  const sym = settings.market.symbol.split(":").pop() ?? "BTCUSDT";
  const note = [label.text, outside > 0 ? outsideNote(outside) : null, loading ? CHART_LOADING : null].filter(Boolean).join(" · ");

  return (
    <div id={CHART_CARD_ID} className="scroll-mt-20">
      <Card
        title={`Chart · ${sym} Perp`}
        note={note}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<ChartInterval> size="sm" aria-label="Intervall" options={INTERVALS} value={interval} onChange={(v) => setChart({ interval: v, rangeDays: v === "1m" ? 7 : chart.rangeDays })} />
            <RangePills value={rangeDays} onChange={(d) => setChart({ rangeDays: d })} disabledAbove={interval === "1m" ? 7 : undefined} />
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
            <Button size="sm" onClick={() => ref.current?.follow()} disabled={!chart.open}>
              {CHART_FOLLOW}
            </Button>
            <Expander open={chart.open} onToggle={() => setChart({ open: !chart.open })} label="Chart" controls={`${CHART_CARD_ID}-body`} />
          </div>
        }
      >
        {/* Collapse without unmount (Plan 3.3 "Chart-Karte einklappen"): height animates like the Collapsible-Explainer, the chart instance stays. */}
        <motion.div id={`${CHART_CARD_ID}-body`} className="relative overflow-hidden" initial={false} animate={{ height: chart.open ? "auto" : 0, opacity: chart.open ? 1 : 0 }} transition={tween.collapse} aria-hidden={!chart.open}>
          {empty ? (
            <EmptyState title={CHART_EMPTY_TITLE} text={CHART_EMPTY_TEXT} />
          ) : (
            <Suspense fallback={<ChartSkeleton className="h-[300px] md:h-[420px]" />}>
              <NothingCandleChart
                ref={ref}
                candles={candles}
                interval={interval}
                live={live}
                levels={settings.market}
                activeScenario={activeScenario}
                markers={markers}
                pane={pane}
                ratio={ratio?.data}
                oi={oi?.data}
                rangeDays={rangeDays}
                onMarkerClick={onMarkerClick}
                onOutsideCount={setOutside}
              />
            </Suspense>
          )}
          <AnimatePresence>
            {ghost && detail.source === "marker" && (
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
