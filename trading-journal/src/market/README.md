# `src/market` — keyless live data for BTCUSDT USDⓈ-M perpetuals

Browser-direct market data (Binance REST + WebSocket, no API key, no custom headers) with a Bybit fallback,
an optional EU proxy, IndexedDB cache and an honest health model. Everything a view shows about
"liveness" comes from the health snapshot, never from the mere presence of data.

Import everything from `@/market` (see `index.ts`).

## Lifecycle (`marketStore.ts`)

```ts
import { startMarket, stopMarket, setSymbol, setPeriod, setBookTop } from "@/market";

// App root, once settings are loaded (effect with deps [settings.market.symbol, settings.hyblock.timeframe]):
useEffect(() => {
  startMarket(settings);              // idempotent for the same symbol/period
  return () => stopMarket();
}, [settings.market.symbol, settings.hyblock.timeframe]);

setSymbol("BINANCE:ETHUSDT");         // stop → new cache namespace → start
setPeriod("4h");                      // ratio feeds use the new period
setBookTop(true);                     // subscribe bookTicker only while the Bid/Ask tile is visible
```

`startMarket(settings, { sources?, bookTop?, deps? })` builds a `MarketProvider` via
`createMarketProvider({ symbol, period, sources, bookTop, deps })` and binds the MotionValues.

`createMarketProvider` implements `MarketDataProvider` (`types.ts`) plus: `symbolInfo`, `period`,
`specs`, `started`, `setBookTop(on)`, `onChange(cb)`, `snapshot()`, `clearCache()`, `dispatch(ev)`.
`deps` lets tests inject `fetch`, `wsFactory`, `host` (timers), `random`, `kv` (`null` = memory only),
`documentRef`/`windowRef`, `online`, `probeProxy`, `timeZone`.

## Hooks

| Hook | Returns | Re-renders |
|---|---|---|
| `useFeed(feed)` | `Stamped<FeedValue[F]> \| undefined` | on EVERY publish of that feed – `aggTrade` / `bookTop` / `markPrice` and the forming-bar `kline_*` ticks ride the fast channel. Prefer `useFeedSelect` or the MotionValues |
| `useFeedSelect(feed, select, isEqual?)` | `select(value)` | only when the selected value changes (`Object.is` default); `select` runs only when the stamped value changes identity. Keep `select` / `isEqual` stable (module constants or memoised) |
| `useHealth()` | `ProviderHealth` | on every health change (≈ 1/s per live WS feed: each refreshes `lastDataAt`) |
| `useHealthSelect(select, isEqual?)` | `select(health)` | only when the selected health fields change – prefer it over `useHealth` (e.g. `ChartBodyGate` reads state + failures only) |
| `useStatusLabel(feed)` | `StatusLabel { tone, text, detail? }` | on health changes plus at most once a minute from the feed itself (never per tick) |
| `useStatusTone(feed)` | `StatusLabel["tone"]` | only when the tone changes (dots without text, e.g. the header ticker dot) |
| `useMarketView({ rsiWOverride?, retryInSec? })` | `MarketView` — legacy panel fields | on any **slow** change |
| `useTopTrader(base)` | `TopTraderView` — Long %, delta, deltaCandles, sparkline, `onlyBinance` | on any **slow** change |
| `useMarketVersion()` | slow-change counter | on any **slow** change |
| `usePriceSnapshot(intervalMs = PRICE_SNAPSHOT_INTERVAL_MS (100))` | `PriceSnapshot { price: number \| null (rounded), source }` | only when the rounded price or the source changes, ≤ 1/`intervalMs` |
| `useProvider()` / `getProvider()` | the provider or null | |

Non-hook helpers: `getFeed(feed)` (current stamped value), `subscribeFeed(feed, cb)` (imperative listener, called at most once per
frame with the latest value – push forming candles into a chart without React), `klineBarKey(v)` (`source:length:lastOpen:closed` –
changes only when a bar is added, replaced or closes), `flushMarketNotifications()` (deliver pending notifications synchronously).

**Two notification channels, frame-coalesced.** `HIGH_FREQUENCY_FEEDS` (`aggTrade`, `bookTop`, `markPrice`) and forming-bar kline
ticks publish on the *fast* channel: they never bump `useMarketVersion()` and never re-render `useMarketView` / `useTopTrader` /
`useHealth` subscribers. The *slow* channel carries health, REST feeds and kline BAR changes (a new / closed bar, see `klineBarKey`)
– not ticks. Both are delivered once per animation frame (`frame.update`), so a WS burst costs one React pass; lifecycle
notifications (`startMarket` / `stopMarket`) stay synchronous so no hook ever reads a stopped provider.

`usePriceSnapshot()` is the primitive-returning getter for places that need the price as a number but must not
re-render per tick: the returned object is stable while `Math.round(price)` and `source` are unchanged; `getPriceSnapshot()` is the
non-hook variant. (The trade editor reads the rounded price once a second on the shared `nowMv` clock instead, and applies the
full-precision `priceMv` on click.)

```ts
const { price, source } = usePriceSnapshot();     // { price: 84206, source: "binance" } | { price: null, source: null }
const closed4h = useFeedSelect("kline_4h", selectClosed4h, sameClosed4h); // re-renders only when a 4h bar closes
```

`Stamped<T> = { data, asOf, receivedAt, source, comparable }` — every value carries provenance.

## MotionValues (`motionValues.ts`) — no React render per tick

Updated from the WS and flushed once per animation frame (`frame.update`); `priceMv` is always set LAST in a flush, so a `priceMv`
listener reads the matching `tradeTimeMv` / `tickDirMv`. `bindMotionValues(provider)` is called by `startMarket` (seeds from the
snapshot, returns the unsubscribe); `flushMotionValues()` flushes synchronously.

| value | meaning | typical use |
|---|---|---|
| `priceMv` / `tradeTimeMv` | last trade price / its exchange time | odometer (`RollingDigits source`), forming-candle bucketing |
| `tickDirMv` | +1 / −1 direction of the last move (zero-ticks keep it; 0 = none yet) | pulse / flash colour (`#3ddc84` / `#ff4d4f`) |
| `open24hMv` | 24 h reference open (`lastPrice / (1 + pct/100)` of the ticker) | live 24 h % = `(price / open − 1) · 100` |
| `bidMv` `askMv` `markMv` `fundingMv` `nextFundingMv` | book / mark / funding | Bid/Ask tile, funding line with `nowMv` |
| `priceReceivedAtMv` | local receive time of the last price | LivePill age with `nowMv` |
| `flowImbalanceMv` | order-flow imbalance −1..+1 (decayed, `ORDER_FLOW_HALF_LIFE_MS` = 15 s) | buy/sell meter (`scaleX`) |
| `volAccumMv` `buyVolMv` `sellVolMv` | monotonic taker volume since the symbol was bound | difference two readings to get a window |
| `tradeCountMv` | prints since bind; changes ≤ once per frame, also on same-price trades | heartbeat ping (`pingOn`) |

All of them reset to 0 only when the SYMBOL changes (re-binding the same symbol keeps every value, so nothing jumps). Gate every
effect built on them with `useReducedFx()`. Countdowns and ages combine them with the shared `nowMv` clock (`@/motion/clock`, see
`src/motion/README.md`) in leaf nodes – never `setInterval` state.

## Feed table (Binance primary)

| Feed | Transport | Cadence | `staleAfterMs` | Notes |
|---|---|---|---|---|
| `kline_1m/1h/4h` | WS `kline_*` (+ REST bootstrap 499) | 250 ms | 2·interval + 60 s | upsert by open time; `closed` = final |
| `kline_1w` | WS `kline_1w` (+ REST 200) | weekly | 7 d + 1 h | `closeW` via `weeklyClose()` |
| `markPrice` | WS `markPrice@1s` (bootstrap `premiumIndex`) | 1 s | 5 s | heartbeat; funding rate + next funding |
| `aggTrade` | WS `aggTrade` | 100 ms | 5 s | **the** last price (never mark) |
| `bookTop` | WS `bookTicker` (opt-in) | realtime | 5 s | |
| `ticker24h` | REST `ticker/24hr` | 30 s | 90 s | 24 h change; LivePill ring = `nextRefreshAt` |
| `openInterest` | REST `openInterest` | 60 s | 180 s | |
| `openInterestHist`, `topPositionRatio`, `topAccountRatio`, `globalAccountRatio`, `takerRatio` | REST `/futures/data/*` | point cadence = period (poll aligned: 5-min boundary + 60–105 s) | 2·period + 2 min | bootstrap `limit=500`, poll `limit=30`, ring buffer 500, 30-day retention |
| `fundingHistory` | REST `fundingRate` | on funding tick (`T` from markPrice) | 9 h | |

Period = `normalizePeriod(settings.hyblock.timeframe)`; unsupported (`1m`, `1w`, …) → `1h` and
`reason: "bad_period"` with German `detail` on the five `/futures/data` feeds.

**Fallback chain** (fixed): Binance → Bybit → Proxy → Cache. Bybit serves price/candles/funding
(`comparable:true`), global ratio + OI (`comparable:false`), and cannot serve `topPositionRatio`,
`topAccountRatio`, `takerRatio` → `reason: "unsupported"`, label `Nur mit Binance`. OKX (`sources/okx.ts`) is
implemented and tested but not in the default chain (CORS unverified). When the WS dies 3× the WS feeds
are REST-polled from Binance every 10 s (`state: fallback`, label `Binance-Daten · alle 10 s`).

Blocked-primary detection: Binance `fetch` throws `TypeError` while `api.bybit.com/v5/market/time` answers →
`primary.blocked`, every Binance feed moves to Bybit at once. Re-probe `fapi/v1/time` after 5 → 10 → 20 → 40 →
60 min (cap), reset on success. Proxy probe (`/api/binance/fapi/v1/time`) once on start.

## Rendering status (Plan 4.4)

Use `useStatusLabel(feed)` / `provider.statusLabel(feed)`:

| State | text | tone |
|---|---|---|
| live | `Live · {cadence}` — `Live · stündlich`, `Live · alle 5 min`, `Live · 1 s`, `Live · Echtzeit` | live |
| stale (and connecting with cached data) | `Zuletzt HH:mm · veraltet` | warn |
| fallback | `Bybit-Daten · {cadence}` + `detail: "Binance nicht erreichbar (451/CORS)"`; `Binance-Daten · alle 10 s` when only the WS is down | warn |
| offline | `Offline · Stand HH:mm` / `Offline` | error |
| connecting | `Verbinde …` | muted |
| reason `bad_symbol` | `Kein Live-Kurs` | error |
| reason `unsupported` | `Nur mit Binance` (+ cohort tooltip in `detail`) | muted |

The **market card** status (`connecting|live|error|unavailable`) is driven only by the price feed:
`useMarketView().status/message/sourceBadge` (`legacyStatus()`): a 6-s WS hiccup does not change the header;
`now − asOf > 120 s` → `error` with `Zuletzt HH:mm · veraltet`; Bybit price → `live` **with**
`sourceBadge: "Ersatzquelle Bybit"`; offline → `Offline · Stand HH:mm`. LivePill text: `liveAgeLabel(receivedAt, now)`
(`Live`, `Live · vor 12s`, `vor 3 min`, warn > 120 s), rendered on `nowMv`; ring: a `RingCycle { endsAt: nextTickerRefreshAt, ms }`
that runs itself (`refreshRingProgress(nextTickerRefreshAt, now)` remains for a static progress).
Non-comparable values (`comparable:false`) show the `andere Kohorte` badge with `COHORT_HINT[source]`.

## Mapping (`mapping.ts`)

- `deriveMarket(snapshot, health, { now, rsiWOverride })` → `price` (rounded last price), `change`, `close4h/At`
  (`lastClosed4h` = bundle `UM`), `closeW/At`, `rsiW` (local Wilder 14, TradingView override wins), `live4hClose`,
  `fundingLine` (`Mark 84.212 · Funding +0,0100 % · nächstes Funding in 05:59:59`), `openInterest`,
  `openInterestChange24h`, `taker`, `bid/ask`, `updatedAt`, `nextTickerRefreshAt`, `status/message/sourceBadge`.
- `deriveTopTrader(snapshot, health, base)` → `longPct` (accounts|positions per `tj2-ui.topTraderBase`),
  `delta = topPositionLong% − globalLong%` (joined by timestamp), `deltaCandles` (trailing `> 0`, bundle `oK`),
  `sparkline` (last 20), `onlyBinance`, `liveReadingOk`, `detail`, `taker`.
- `virtualReading(topTrader, lastManual)` → `{ …, note: "Live von Binance" }` or `null` in the Bybit fallback.
- `triggerDistances(price, levels)`, `takerDelta`, `fundingPct`, `lastPrice`.

## Other modules

`symbol.ts` (`tvSymbolToBinance`, `resolveSymbol` → Bybit/OKX symbols, `Fallback nur für USDT-Perps`),
`period.ts` (Binance/Bybit/OKX period tables, `cadenceLabel`), `feeds.ts` (spec table), `budget.ts` (token
buckets at 10 % reserve), `schedule.ts` (`nextAlignedAt`, `wsBackoffMs`, `probeBackoffMs`, pausable `Scheduler`),
`cache.ts` (`MarketCache`, `upsertSeries`, key `${source}:${symbol}:${feed}`, DB `tj-market`), `health.ts`
(pure `reduceHealth`), `statusLabel.ts`, `indicators.ts`, `sources/*` (zod-validated REST clients, `WsClient`,
proxy probe), `format.ts` (minimal de-DE formatters).

## Testing

Fixtures: `tests/fixtures/binance-*.json`, `bybit-*.json`, `ws-scenarios/{live,stale,blocked_451,offline,reconnect}.json`.
Notifications and MotionValues are frame-coalesced: after dispatching WS messages in a unit test call
`flushMarketNotifications()` and `flushMotionValues()` before asserting. Views mocked through
`tests/unit/views.overview.harness.tsx` (`fakeMarket(actual)`) get fixture-backed `useFeed` / `useFeedSelect` / `getFeed` /
`useHealth` / `useHealthSelect`, a no-op `subscribeFeed`, and real MotionValues seeded from the snapshot.
E2E: `await mockMarket(page, "live")` (`tests/e2e/mocks/market.ts`) routes REST to fixtures and replays the
WS scenario through a fake `window.WebSocket`. Unit tests: `tests/unit/market.*.test.ts`.

Netlify EU proxy: `netlify/functions-disabled/binance.mts` (`/api/binance/*`, region `fra`, allowlist,
`x-upstream-status`, CORS to `SITE_ORIGIN`). Move to `netlify/functions/` to enable; needs Pro for `fra`.
