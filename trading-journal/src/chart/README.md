# `src/chart` – candle chart, Recharts cards, attribution

Owner: chart wave (Plan 5). Everything is exported from `@/chart` (barrel `index.ts`).

## NothingCandleChart (`NothingCandleChart.tsx`)

lightweight-charts 5.2.1 candlestick chart in the monochrome theme. Created once (StrictMode-safe
teardown), `setData` only when the `candles` array identity changes, `series.update` for `live`,
price lines + zone for `levels`, trade markers, optional ratio/OI pane, animated 1W/1M/3M range,
screenshot crossfade on interval change, spring tooltip, skeleton → entrance (`tween.chartIn`).

```tsx
import { NothingCandleChart, toTradeMarkers, type ChartHandle } from "@/chart";

const ref = useRef<ChartHandle>(null);
<NothingCandleChart
  ref={ref}
  candles={history}                // Candle[] from provider.get("kline_1h").data – stable per load
  interval="1h"                    // "1m" | "1h" | "4h" | "1w"
  live={formingCandle}             // last Candle from the WS kline stream (see below)
  levels={settings.market}         // MarketLevels → LONG / INVAL / SHORT / HART / LH W + zone band
  activeScenario={scenario.key}    // "long" | "short" | null → lineWidth 2 on that trigger
  markers={toTradeMarkers(trades)} // EnrichedTrade[] → TradeMarker[]
  pane="ratio" ratio={topAccountRatio} oi={openInterestHist}
  rangeDays={30}                   // 7 | 30 | 90 – changes morph with spring.smooth
  onMarkerClick={(tradeId, rect) => openDetail(tradeId, rect)}
  onOutsideCount={(n) => setOutside(n)}   // "+{n} Trades außerhalb des Zeitraums"
  onCrosshair={(p) => priceMv.set(p?.price ?? NaN)} // per move: MotionValues/refs only
  height={420}                      // default: h-[300px] md:h-[420px]
/>
ref.current?.fitRange(7);           // animated; fitRange(7, false) jumps
ref.current?.follow();              // scrollToRealTime() – "Folgen"
ref.current?.takeScreenshot();      // HTMLCanvasElement | null
ref.current?.chart;                 // IChartApi | null (escape hatch)
```

Props (`NothingCandleChartProps`): `candles: Candle[]`, `interval: ChartInterval`, `levels?`,
`activeScenario?`, `markers?: TradeMarker[]`, `ratio?: RatioPoint[]`, `oi?: OpenInterestPoint[]`,
`pane?: "none"|"ratio"|"oi"`, `rangeDays?: 7|30|90`, `live?: Candle`, `onMarkerClick?(id, rect: MarkerRect)`,
`onCrosshair?(point: CrosshairPoint | null)`, `onOutsideCount?(n)`, `height?`, `tooltip?` (default true), `className?`.

### Feeding candles from the market layer

- History: pass the provider's `Candle[]` once per load. Do **not** rebuild the array on every WS
  message – that triggers `setData` (allowed, but it repaints everything). The chart keeps the user's
  visible window across re-loads of the same interval and re-fits `rangeDays` on the first load or
  when `interval` changes.
- Live: pass the forming candle (`k.t` open time in ms, `o/h/l/c/v`, `closed = k.x`) as `live`. The
  component coalesces to one `update()` per frame; bars older than the last loaded bar are ignored.
  When `live.time` is newer than the last bar it is appended (new candle).
- Times: `Candle.time` is ms UTC; the chart converts to `UTCTimestamp` seconds. Axis/crosshair labels
  are rendered in `Europe/Berlin` (`CHART_TIME_ZONE`), data stays UTC.
- Interval switch: pass the new `candles` **and** `interval` in the same render; the old frame is
  crossfaded out (`takeScreenshot` overlay, `tween.crossfade`).
- Empty `candles` → skeleton (`Chart wird geladen`). The card shows `Noch keine Kerzen` itself.

### Skeleton → entrance

`setData` → 2× `requestAnimationFrame` → `ready`; then the container animates
`{opacity:0, scale:.985} → {1,1}` with `tween.chartIn` and the skeleton exits with `tween.fade`
(absolute overlay, fixed height → no CLS). Reduced motion → instant.

## Data helpers (`panes.ts`, `markers.ts`, `levels.ts`, `animateRange.ts`, `tooltip.tsx`)

| Export | Purpose |
|---|---|
| `toCandleData / toVolumeData / toRatioData / toOiData`, `normalizeSeries`, `sec`, `INTERVAL_SECONDS` | `Candle`/`RatioPoint`/`OpenInterestPoint` → lightweight-charts data, sorted & de-duplicated |
| `createMainSeries(chart)` → `{ volume, candles, pulse }` | pane-0 series in draw order |
| `PaneController` (`set(kind)`, `setData({ratio, oi})`, `dispose()`) | pane 1 line (`longPct` + 50 % baseline, or OI), stretch 3:1 (~25 %) |
| `setLevels(series, levels, prev, opts)`, `clearLevels`, `LEVEL_STYLES`, `levelColor`, `levelWidth` | price lines (`longTrigger` LONG `#f2f2f2`, `longStop` INVAL `#9b9b9b`, `shortTrigger` SHORT `#f2f2f2`, `invalidation` HART **`#e5202e`**, `lowerHigh` LH W `#5f5f5f`) + `ZonePrimitive`; updates in place |
| `ZonePrimitive` (`primitives/ZonePrimitive.ts`) | band `zoneLow–zoneHigh`, fill `#ffffff0e`, dashed edges, `zOrder 'bottom'`, axis labels `Zone`, `autoscaleInfo`, `hitTest → 'zone'`, `fadeIn(ms)` |
| `toTradeMarkers(trades)`, `buildMarkers(markers, snap, bounds)` → `{ markers, outside, byId }`, `snapTime`, `boundsOf`, `markerTradeId`, `hitMarker` | entry ▲/▼ (`#3ddc84`/`#ff4d4f`, journal exception), exit ● toned win/loss/be; ids `e:{id}` / `x:{id}`; exit sits on the entry candle (model has no exit time) |
| `RangeAnimator` (`goTo(range, animated)`, `cancel()`, `dispose()`), `rangeForDays`, `rangeIndices`, `lerpRange`, `barsPerDay` | visible-logical-range morph through two MotionValues with `spring.smooth`; wheel/pointerdown cancels; reduced motion sets directly |
| `ChartTooltip` (`ref: TooltipHandle { move, hide }`), `formatTooltip`, `placeTooltip`, `TOOLTIP_CLASS` | O/H/L/C, Δ % (close vs open), `dd.MM., HH:mm`; position via `useSpring(spring.tooltip)`, text via DOM refs |
| `fmt` (`format.ts`), `tradeTime` | internal de-DE formatters (`n0/n1/n2/signed/pct0/price/date/time/mio`), bundle `tt` |

## Theme (`theme.ts`)

`NOTHING_DARK` (`makeNothingTheme(background)`), `NOTHING_CANDLES`, `NOTHING_VOLUME`, `NOTHING_PULSE`,
`NOTHING_RATIO_LINE`, `NOTHING_OI_LINE`, `NOTHING_MINI`, `ink` ramp, `CHART_BACKGROUND_TRANSPARENT`
(decision 7, default) / `CHART_BACKGROUND_SOLID` (`#0a0a0a` fallback), `CHART_FONT`, `CHART_TIME_ZONE`,
`formatTickMark`, `formatChartTime`. One-accent rule: red only on the hard invalidation line and the
series' own last-price line. Fonts: `document.fonts.load('11px "IBM Plex Mono"')` is awaited (≤ 600 ms)
before the first `setData`.

## Recharts cards (`EquityChart.tsx`, `MonthlyBars.tsx`)

Both wrap shadcn `ChartContainer` (`@/ui/chart`), `isAnimationActive={false}` (M0, bundle parity),
`React.memo`. Tick style `{ fill:"#5f5f5f", fontSize:11, fontFamily:"IBM Plex Mono, monospace" }`,
Y formatter `fmt.mio`, tooltip box `TOOLTIP_CLASS`.

```tsx
<EquityChart points={stats.equity} start={stats.start} balance={stats.balance} currency={settings.currency} />
// EquityPoint = { i: number; v: number; t: Trade | null }  (i = 0 → "Start", n → "#n")
// reference line at `start`, stroke gradient #5f5f5f → accent, fill accent .32 → 0,
// accent = balance >= start ? "#f2f2f2" : "#ff4d4f"; tooltip "Trade #i · dd.MM.yy" / "Start", rows P&L, Kontostand

<MonthlyBars months={stats.months} currency={settings.currency} />
// MonthBucket = { key: "YYYY-MM"; label: "Sep 26"; net: number; n: number; winRate: number | null }
// bars #f2f2f2 (net ≥ 0) / #5f5f5f (< 0) with 4-px rounding on the outer end; tooltip Netto, Trades, Win-Rate
```

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
range math + `RangeAnimator`, tooltip/tick formatting, Recharts cards (RTL), `NothingCandleChart`
with a mocked `lightweight-charts` (StrictMode create/remove symmetry, single `setData`, live `update`).
Fixture: `tests/fixtures/candles-1h.json` (240 hourly BTC-like candles from 2026-09-01).
