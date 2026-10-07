# `src/chart` – candle chart, Recharts cards, attribution

Owner: chart wave (Plan 5). Everything is exported from `@/chart` (barrel `index.ts`).

## NothingCandleChart (`NothingCandleChart.tsx`)

lightweight-charts 5.2.1 candlestick chart in the monochrome theme, `React.memo`. Created once (StrictMode-safe
teardown), `setData` only for a new history (first load, interval change, older bars prepended, source switch); a
history that only gained ≤ 2 bars on the right is appended in place. A live forming candle moves with every trade
(`liveCandle.ts`), a DOM price pulse marks the current price, price lines + zone for `levels`, trade markers with a
new-trade ripple, optional ratio/OI pane, animated 1W/1M/3M range, screenshot crossfade on interval **and** pane
change, a "Folgen" pill away from the live edge, spring tooltip, skeleton → entrance (`tween.chartIn`).

```tsx
import { NothingCandleChart, type ChartHandle, type BarsListener } from "@/chart";
import { priceMv, tradeTimeMv, tickDirMv, volAccumMv, subscribeFeed } from "@/market";

const subscribeBars = useCallback(
  (l: BarsListener) => subscribeFeed("kline_1h", (v) => v && l(v.data, v.asOf)),
  [],
);
<NothingCandleChart
  ref={ref}
  candles={history}                // Candle[] – identity changes only per new bar / load (bar-key selector)
  interval="1h"                    // "1m" | "1h" | "4h" | "1w"
  price={priceMv} tradeTime={tradeTimeMv} tickDir={tickDirMv} tradeVolume={volAccumMv}
  subscribeBars={subscribeBars}    // kline frames, ≤ 1 per animation frame, no React render
  paused={!open}                   // collapsed card: no canvas writes, no pulse, no pill
  followLabel="Folgen"             // floating pill while the live bar is out of view
  levels={settings.market} activeScenario={scenario.key}
  markers={toTradeMarkers(trades)}
  pane="ratio" ratio={topAccountRatio} oi={openInterestHist}
  rangeDays={30}
  onMarkerClick={(tradeId, rect) => openDetail(tradeId, rect)}
  onOutsideCount={(n) => setOutside(n)}
  onCrosshair={(p) => crosshairMv.set(p?.price ?? NaN)} // per move: MotionValues/refs only
/>
ref.current?.fitRange(7);           // animated; fitRange(7, false) jumps
ref.current?.follow();              // glide back to the live edge, keeping the zoom (spring.smooth)
```

Props (`NothingCandleChartProps`): `candles`, `interval`, `levels?`, `activeScenario?`, `markers?`, `ratio?`, `oi?`,
`pane?`, `rangeDays?`, `price?` + `tradeTime?` (both MotionValues; required together), `tickDir?`, `tradeVolume?`,
`subscribeBars?: (l: (bars, asOf) => void) => unsubscribe`, `live?: Candle` (forming bar as a prop, applied as an
authoritative kline without glide – tests / simple callers), `paused?`, `followLabel?`, `onMarkerClick?`,
`onCrosshair?`, `onOutsideCount?`, `height?`, `tooltip?` (default true), `className?`.

### Live forming candle (`liveCandle.ts`, `LiveCandle`)

- **Trades** (`price` + `tradeTime`, flushed once per frame by the market layer): the raw print widens high/low at
  once and the close jumps to it – the canvas never glides (`isSmooth: () => false` in `NothingCandleChart`: a
  `spring.candle` glide pushed `series.update`, i.e. a full canvas repaint, on every display frame while trades
  flowed). `LiveCandle` keeps the glide capability (`isSmooth`) for other callers / tests. The pushed close is
  quantised to `minMove` (float-safe), so the last-price label never shows sub-tick values. The first print of the next bucket (`bucketOpen`: epoch-aligned, weekly = Monday 00:00 UTC)
  closes the previous bar on its last print and opens the new one. Prints across a gap or older than the last bar
  are ignored (`tradeStep`).
- **Klines** (`subscribeBars`, history tails): authoritative OHLC + volume and new bars. Every delivered bar from the
  chart's previous-to-last bar onward is applied, so after a gap (hidden tab, WS outage) the bar that was forming
  before it still gets its final kline. A kline older than the last
  merged trade of the same bar (`tradeTime > asOf`) only widens the range – the live close stays (`reconcileBar`).
  The closing kline of a bar the trades already left is applied as a historical update (`update(bar, true)`).
- **Volume**: the forming bar shows kline volume + traded volume since that kline (`tradeVolume`).
- The series is written once per frame (`frame.render`) and only while active (ready, ≥ 10 % on screen, not
  `paused`); touched bars are replayed on resume. At most one `series.update` per frame, and only in frames where a
  print or kline changed the bar (with a glide, frames that move less than half a price step are skipped).
- Times: `Candle.time` is ms UTC; the chart converts to `UTCTimestamp` seconds. Axis/crosshair labels are rendered in
  `Europe/Berlin` (`CHART_TIME_ZONE`), data stays UTC.

### Overlays (`overlays.tsx`)

- `LivePulse` (`data-fx="price-pulse"`, `aria-hidden`): solid core + dark halo, two breathing rings (`tween.ping`,
  scale 1 → 3.2, the second half a period later) and per-print feedback: a win/loss tint (`tween.flash`, at most one
  per `FLASH_MIN_INTERVAL_MS` = `fxTiming.liveFlashGap` 0,5 s; a direction flip inside the gap only cuts the tint) and a
  bright ping ≤ 4 Hz (`tween.ripple`, flips included). Positioned by `translate3d` from
  `timeToCoordinate(last.time)` / `priceToCoordinate(last.close)` in a rAF queued right behind lightweight-charts' own
  draw, so dot and candle move in the same frame. Hidden when the live bar is off-screen, the chart is off-screen or
  collapsed. Rings stop after `PULSE_STALE_MS` (6 s) without a print. Reduced motion: the static core only. The
  canvas has no last-price animation any more (the old `Continuous` pulse series redrew every frame forever).
- `FollowPill` (`data-fx="follow"`): mounted only while `isAwayFromRealtime(range, lastIndex)`; pops in on
  `spring.pop` (scale .9 → 1, opacity `tween.fade`), arrow nudge, unmounts on `tween.exit`. Sits left of the price
  scale (`priceScale("right").width() + 12`). React renders only when away flips.
- `spawnMarkerRipple(layer, at, color)`: a ring (`tween.ripple`) and a soft disc (`tween.flash`) at a trade marker
  that appeared since the last sync (a newly saved trade); never on a history load, never under reduced motion.

### Skeleton → entrance

`setData` → 2× `requestAnimationFrame` → `ready`; then the container animates `{opacity:0, scale:.985} → {1,1}` with
`tween.chartIn` and the skeleton exits with `tween.fade` (absolute overlay, fixed height → no CLS). The skeleton shows
the Nothing dot-matrix loader (`DotMatrix preset="loader"`, decorative) and a transform-only shimmer
(`animate-fx-shimmer`). Reduced motion → instant, static.

## Data helpers (`panes.ts`, `markers.ts`, `levels.ts`, `animateRange.ts`, `tooltip.tsx`)

| Export | Purpose |
|---|---|
| `toCandleData / toVolumeData / toRatioData / toOiData`, `volumeColor`, `normalizeSeries`, `sec`, `INTERVAL_SECONDS` | `Candle`/`RatioPoint`/`OpenInterestPoint` → lightweight-charts data, sorted & de-duplicated |
| `createMainSeries(chart, { volume? })` → `{ volume, candles }` | pane-0 series in draw order |
| `LiveCandle`, `bucketOpen`, `tradeStep`, `withClose`, `reconcileBar`, `extendsTail`, `MAX_TAIL_APPEND` | live forming candle engine + its pure rules (see above) |
| `LivePulse`, `PulseDriver`, `FollowPill`, `spawnMarkerRipple`, `isAwayFromRealtime`, `PULSE_STALE_MS` | DOM overlays (see above) |
| `PaneController` (`set(kind)`, `setData({ratio, oi})`, `setGrid(candleTimes)`, `dispose()`), `alignToGrid(rows, grid)` | pane 1 line (`longPct` + 50 % baseline, or OI), stretch 3:1 (~25 %); points are snapped onto the candle grid because panes share one time scale (an hourly series on a 4h chart would otherwise add whitespace slots) |
| `setLevels(series, levels, prev, opts)`, `clearLevels`, `LEVEL_STYLES`, `levelColor`, `levelWidth`, `zoneIsSet` | price lines (`longTrigger` LONG `#f2f2f2`, `longStop` INVAL `#9b9b9b`, `shortTrigger` SHORT `#f2f2f2`, `invalidation` HART **`#e5202e`**, `lowerHigh` LH W `#5f5f5f`) + `ZonePrimitive`; updates in place. A level `≤ 0` = not set (share edition): no line, no axis label; the zone band hides unless both edges are set (its autoscale would pull the axis to 0) |
| `ZonePrimitive` (`primitives/ZonePrimitive.ts`) | band `zoneLow–zoneHigh`, fill `#ffffff0e`, dashed edges, `zOrder 'bottom'`, a `ZONE` caption inside the band, the edge PRICES as axis labels (`formatPrice`), `autoscaleInfo`, `hitTest → 'zone'`, `fadeIn(ms)` |
| `filterTickLabels(ticks, labels, toY, format, gap)`, `AXIS_LABEL_GAP` (`axisLabels.ts`) | `localization.tickmarksPriceFormatter` of the candle chart: a tick within 15 px of a level / zone / last-price label stays blank, so no axis text is half covered |
| `buildSignalMarkers(signals, times)`, `signalMarkersKey`, `SignalMarker` (`signalMarkers.ts`) | MCB dots of the entry check (prop `signals`, own marker layer under the trade markers): Bottom/Kauf = win dot below the bar, Top/Verkauf = loss dot above, live bar translucent, no words (the card note has the legend); ids `m:{t}:{kind}` |
| `resampleCandles(src, srcMs, ms)`, `resampleTail` (`resample.ts`) | `30m` chart interval from `kline_15m` (UTC-aligned buckets, `closed` with the last source bar); the tail keeps the live push O(1) |
| `rightOffsetBars(bars, width)`, `RIGHT_FREE_PX`, `RightOffset` | right offset in bars that leaves ≥ 72 px free right of the last bar (price-line titles + live pulse), used by every range target; a fixed 8 bars shrank to ~6 px on 30m · 1M |
| `toTradeMarkers(trades)`, `buildMarkers(markers, snap, bounds)` → `{ markers, outside, byId }`, `snapTime`, `boundsOf`, `markerTradeId`, `hitMarker` | entry ▲/▼ (`#3ddc84`/`#ff4d4f`, journal exception), exit ● toned win/loss/be; ids `e:{id}` / `x:{id}`; exit sits on the entry candle (model has no exit time) |
| `RangeAnimator` (`goTo(range, animated)`, `cancel()`, `dispose()`), `rangeForDays`, `rangeIndices`, `lerpRange`, `barsPerDay` | visible-logical-range morph through two MotionValues with `spring.smooth`; wheel/pointerdown cancels; reduced motion sets directly |
| `ChartTooltip` (`ref: TooltipHandle { move, hide }`), `formatTooltip`, `placeTooltip`, `TOOLTIP_CLASS` | O/H/L/C, Δ % (close vs open), `dd.MM., HH:mm`; position via `useSpring(spring.tooltip)`, text via DOM refs; box measured once, tone class swapped only on change, bounds from a ResizeObserver (no layout read per crosshair move) |
| `fmt` (`format.ts`), `tradeTime` | internal de-DE formatters (`n0/n1/n2/signed/pct0/price/date/time/mio`), bundle `tt` |

## Theme (`theme.ts`)

`NOTHING_DARK` (`makeNothingTheme(background)`), `NOTHING_CANDLES`, `NOTHING_VOLUME`,
`NOTHING_RATIO_LINE`, `NOTHING_OI_LINE`, `NOTHING_MINI`, `ink` ramp, `CHART_RIGHT_OFFSET` (8 bars, the live edge),
`CHART_PRICE_MIN_MOVE` (0.1), `CHART_BACKGROUND_TRANSPARENT`
(decision 7, default) / `CHART_BACKGROUND_SOLID` (`#0a0a0a` fallback), `CHART_FONT`, `CHART_TIME_ZONE`,
`formatTickMark`, `formatChartTime`. One-accent rule: red only on the hard invalidation line and the
series' own last-price line. Fonts: `document.fonts.load('11px "IBM Plex Mono"')` is awaited (≤ 600 ms)
before the first `setData`.

## Recharts cards (`EquityChart.tsx`, `MonthlyBars.tsx`)

Both wrap shadcn `ChartContainer` (`@/ui/chart`), `isAnimationActive={false}` (Recharts' own animation stays off; the
motion below is ours), `React.memo`. Tick style `{ fill:"#5f5f5f", fontSize:11, fontFamily:"IBM Plex Mono, monospace" }`,
Y formatter `fmt.mio`, tooltip box `TOOLTIP_CLASS`.

```tsx
<EquityChart points={stats.equity} start={stats.start} balance={stats.balance} currency={settings.currency} />
// EquityPoint = { i: number; v: number; t: Trade | null }  (i = 0 → "Start", n → "#n")
// reference line at `start`, stroke gradient #5f5f5f → accent, fill accent .32 → 0,
// accent = balance >= start ? "#f2f2f2" : "#ff4d4f"; readout "Trade #i · dd.MM.yy" / "Start", rows P&L, Kontostand

<MonthlyBars months={stats.months} currency={settings.currency} />
// MonthBucket = { key: "YYYY-MM"; label: "Sep 26"; net: number; n: number; winRate: number | null }
// bars #f2f2f2 (net ≥ 0) / #5f5f5f (< 0) with 4-px rounding on the outer end; tooltip Netto, Trades, Win-Rate
```

- **EquityChart**: draw-in on first view (the `.eq-area` layer wipes open with `clip-path`, `tween.draw`; clipped
  before the first paint through `data-draw="pending"`); a breathing "jetzt" dot at the last point (`PulseDot`,
  `data-fx="equity-now"`) that glides (`spring.smooth`) and pings on new data; a render-free hover readout: cursor
  line, point dot and box glide between points on `spring.tooltip`, text via refs (`nearestIndex` on the plotted
  x positions, read inside the chart by Recharts 3's `useXAxisScale` / `useYAxisScale` / `usePlotArea`). The
  Recharts `Tooltip` and its keyboard layer are gone (`accessibilityLayer={false}`): the chart is a labelled `img`.
- **MonthlyBars**: bars grow out of the zero line on first view (`scaleY` 0 → 1 on `spring.cards`, origin on the zero
  line, `barDelay(i)` = `min(i, stagger.max) · stagger.cards`); hovering a month dims its siblings to 40 % (CSS on
  `[data-hovering]` / `[data-hot]`, set from `onMouseMove` – no React render).
- Reduced motion (or no `IntersectionObserver`): static, no draw-in, no grow, static dot.

## MiniTradeChart (`MiniTradeChart.tsx`)

`<MiniTradeChart candles={hourly} trade={trade} />` – 160 px, no scroll/scale/crosshair, lines
`Einstieg` (`#f2f2f2`), `Stop` (`#9b9b9b` dashed), `Ziel` (`#5f5f5f` dotted), `Ausstieg` (`#f2f2f2` dotted),
entry/exit markers, `fitContent()`. The caller slices the cache to ±3 days around `tradeTime(trade)`
(or calls `provider.history("kline_1h", …)`); mount fades with `tween.fade` (no scale inside a `layout` dialog).

## Attribution (Apache-2.0)

`layout.attributionLogo` is `false`, therefore the page **must** show the NOTICE text and a link to
`https://www.tradingview.com/`. Render `<ChartAttribution />` in the footer, or use `CHART_ATTRIBUTION`
(`notice`, `linkText: "tradingview.com"`, `linkTextLong: "Charting by TradingView"`, `href`, `dataLine:
"Marktdaten: Binance Futures (öffentlich)"`). The notice file is `public/NOTICE-lightweight-charts.txt`.

## Tests

`tests/unit/chart.*.test.ts(x)` – marker snapping/mapping, level colours & in-place updates,
range math + `RangeAnimator`, tooltip/tick formatting, Recharts cards (RTL: endpoint, render-free hover readout, bar
grow origin), `NothingCandleChart` with a mocked `lightweight-charts` (StrictMode create/remove symmetry, single
`setData`, live `update`, trades through a real MotionValue, kline reconcile, pulse placement, follow pill, paused),
`chart.liveCandle` (bucketing, merge/open/skip, reconcile, historical updates, inactive replay, volume),
`chart.selectors` (closed-4h selectors, bar key), `chart.signals` (30m resampling, MCB markers, axis collision guard,
pixel-aware right offset), `chart.levels` (0 = unset, zone edge-price labels).
Fixture: `tests/fixtures/candles-1h.json` (240 hourly BTC-like candles from 2026-09-01).
