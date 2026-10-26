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
| `priceMv` / `tradeTimeMv` | last trade price / its exchange time; a ticker carries the price in when the newest trade is > 5 s older than it (`tickerCarriesPrice`, same rule as `lastPrice`) — the REST stand-in while the socket is down | odometer (`RollingDigits source`), forming-candle bucketing |
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
| `kline_15m` | WS `kline_15m` (+ REST bootstrap 1500 = 500 × 45m, weight 10 once) | 250 ms | 31 min | feeds the signal check (30m = 2 × 15m, 45m = 3 × 15m); ring 3000. Also the chart's `30m` interval: `ChartCard` resamples history and live tail with `@/chart/resample` (`resampleCandles` / `resampleTail`), so the chart's 30m bars are the check's 30m rung. Settings → Live-Daten lists it as `Kerzen 15m` |
| `kline_1w` | WS `kline_1w` (+ REST 200) | weekly | 7 d + 1 h | `closeW` via `weeklyClose()` |
| `kline_1d` | REST `klines?interval=1d` only (not in the stream, not in `KLINE_FEEDS`) | hourly at hh:00:20 on the Binance clock (`DAILY_POLL_MS`, `DAILY_LAG_MS`); after 00:00 retried every 60 s for 30 min while the newest bar is still yesterday's | 25 h | the Lage-Ampel's daily closes + the signal check's `1D` rung (`DAILY_FEED`). 1000 days once on a fresh start; a cached ring (≥ 900 days, recent) asks only for the missing days (gap fill, weight 1); no "no new point" retries in between; ring 1100. Settings → Live-Daten `Kerzen 1D` |
| `markPrice` | WS `markPrice@1s` (bootstrap `premiumIndex`) | 1 s | 5 s | heartbeat; funding rate + next funding |
| `aggTrade` | WS `aggTrade`; while the socket is not delivering REST `ticker/24hr` every 5 s (`PRICE_REST_FALLBACK_MS`, weight 1) | 100 ms | 5 s | **the** last price (never mark); see "Last price when the stream drops" |
| `bookTop` | WS `bookTicker` (opt-in) | realtime | 5 s | |
| `ticker24h` | REST `ticker/24hr` | 30 s | 90 s | 24 h change; LivePill ring = `nextRefreshAt` |
| `openInterest` | REST `openInterest` | 60 s | 180 s | |
| `openInterestHist`, `topPositionRatio`, `topAccountRatio`, `globalAccountRatio`, `takerRatio` | REST `/futures/data/*` at the chosen period | point cadence = period (poll aligned to the PERIOD boundary + 60–105 s; a late point is retried +60 s, and for periods > 5 min +2 / +5 min) | 2·period + 2 min | bootstrap `limit=500`, poll `limit=30`, ring buffer 500, 30-day retention |
| `topPositionRatio5m`, `topAccountRatio5m`, `globalAccountRatio5m` | the same `/futures/data/*` ratios at the fixed period `5m` | 5 min (aligned 5-min boundary + 60–105 s) | 12 min | bootstrap `limit=52` (4 h 20 min: the 4h Whale–Retail-Delta window has its change from the first load), poll `limit=3`, ring 288; Binance only (direct or proxy, never Bybit/OKX); with period `5m` they ride along with the chosen-period request (no extra call) |
| `fundingHistory` | REST `fundingRate` | on funding tick (`T` from markPrice) | 9 h | |

Period = `normalizePeriod(settings.hyblock.timeframe)`; unsupported (`1m`, `1w`, …) → `1h` and
`reason: "bad_period"` with German `detail` on the five chosen-period `/futures/data` feeds. The ratios are snapshots
(the 5-min point at 14:00 equals the 1h point at 14:00), so the Top-Trader card shows Long % / Delta from the 5-min twins
whenever they are newer and keeps `Δ+ Kerzen` / sparkline on the chosen period: the card refreshes every 5 minutes even
with period `1h`. Cache keys of futures-data feeds carry the period (`${source}:${symbol}:${period}:${feed}`), so a
period switch never hydrates the old period's ring.

**Fallback chain** (fixed): Binance → Bybit → Proxy → Cache. Bybit serves price/candles/funding
(`comparable:true`), global ratio + OI (`comparable:false`), and cannot serve `topPositionRatio`,
`topAccountRatio`, `takerRatio` → `reason: "unsupported"`, label `Nur mit Binance`. OKX (`sources/okx.ts`) is
implemented and tested but not in the default chain (CORS unverified). When the WS dies 3× (handshakes that fail, time
out, or open and stay silent) the WS feeds are REST-polled from Binance every 10 s (`state: fallback`, label
`Binance-Daten · alle 10 s`); the last price is REST-polled every 5 s from the first silence on.

### Last price when the stream drops (Galaxy Tab, 2026-10-08)

The tablet showed 82.446,4 with `Kein Live-Kurs` / `Zuletzt 15:25 · veraltet` for 6 min while ticker, funding and OI
kept updating: `lastPrice` preferred the trade whatever its age, an open-but-silent socket never counted as a failed
attempt (so the WS feeds were never REST-polled), and the pill said `Kein Live-Kurs` for every non-live state. Now:

- **Freshest wins** (`lastPrice`, `getPriceSnapshot`, `priceMv`): trade → book mid → ticker in that order of preference,
  but only among the candidates within `PRICE_PREFER_MS` (5 s) of the newest `asOf`; never the mark price.
- **Socket** (`WsClient`): 10 s without a frame → the socket is closed and the attempt ends like a close (`onSilent(now,
  failedAttempts)`). An attempt that never delivered a frame is a failed attempt (3 in a row → `fallback`, `onFallback`
  once per transition). Next attempt: at once after a blip on a socket that had streamed (at most once per minute), else
  `wsBackoffMs` = 1 s, 2 s, 4 s, 8 s, 16 s, 30 s, 30 s … (+ ≤ 25 % / ≤ 1 s jitter, never above 30 s) **for good**; hidden
  ≥ 1 min. `nudge()` (visible, `pageshow`, `focus`, `online`, Page Lifecycle `resume`) reconnects at once from any
  non-live state and restarts the ladder.
- **REST stand-in** (provider): whenever `wsDown(health)` (silent, exhausted, offline, or reconnecting after it had
  delivered / after a failed attempt — never the first handshake) the ticker is polled every 5 s and its last price is
  published as the trade (`aggFromTicker`); armed on every retry, on resume / `online` (at once, never staggered; a poll
  that slept with the timers is re-armed for now) and by the 5-s watchdog; a failure retries after 5 s; the first trade
  frame cancels it. Budget: class `price` may use the whole bucket, `live` leaves `PRICE_RESERVE` (5 %) of the
  `PRICE_BUCKETS` (`binance.weight`, `proxy`) for it. A trade stream that stalls while the socket delivers other streams
  is fetched over REST after 20 s (was 60 s).
- **Pill** (`deriveMarket().priceMode` / `.pill`, MarketPanel): `stream` → LivePill (`Live`, `Live · vor 8s`); `poll` →
  `Kurs per Abfrage · 5 s` (warn; the REST stand-in delivered within 15 s, or Bybit serves the price, + badge); `waiting` →
  `Verbinde …` (socket down and nothing fresh for 15 s, or back from the background while the first poll is on its way);
  `none` → `Kein Live-Kurs` only when nothing delivered for 2 min (footer `Zuletzt HH:mm · veraltet` = the time of the
  price shown) or every source failed, `Offline` only when the device is offline.

Blocked-primary detection (strict — a false positive takes the top traders off Binance while prices keep ticking):
never while Binance demonstrably answers (a WS frame < 30 s or a REST success < 60 s ago) or within 10 s of a tab
resume (a "resume" within 10 s of `start()` — the `pageshow` that ends every page load, a `focus` while it loads — follows no
sleep and sets no grace: a blocked Binance falls back within a second of the load); otherwise `TypeError`s on ≥ 2 different Binance paths within 2 min AND `api.bybit.com/v5/market/time` answering →
`primary.blocked`, every Binance feed moves on (Bybit, ratio feeds to a usable proxy first). A timeout (`AbortError`) is
its own soft kind `timeout`, never a block. Re-probe `fapi/v1/time` after 5 → 10 → 20 → 40 → 60 min (cap), reset on
success — pulled forward to 5 s when the Binance socket delivers or a Binance REST call succeeds while marked blocked,
and to ~3 s on a tab resume; `health.primary.nextProbeAt` holds the time. A successful probe only re-bootstraps the
feeds that move back and reconnects the socket only when it is not live.

Ratio feeds (`BINANCE_FAMILY_FEEDS`: the four chosen-period ratios + the 5-min twins) never leave Binance's cohort on a
soft failure (network, timeout, 5xx, 429): they stay on Binance and retry after 15 s → 30 s → 60 s → 2 min → every 5 min
(`failureRetryMs`); a second network failure in a row while the rest of Binance answers is read as `cors` (the browser
cannot read `/futures/data`) and moves every futures-data feed to the proxy when it is usable. Only a real block hands
`globalAccountRatio` to Bybit (other cohort); the 5-min twins are then parked (`Nur mit Binance`) unless the proxy serves
them. A non-ratio REST feed moved to Bybit by soft failures gets a primary probe, so it comes back.

Same-origin proxy `/api/binance/*`: Netlify proxy rewrites in the repo's `netlify.toml` (`/api/binance/futures/data/*` and
the six `/fapi/v1/*` market paths → `https://fapi.binance.com`, served from the CDN edge next to the visitor). Probed on
start (`/api/binance/fapi/v1/time` must return Binance JSON; the SPA's HTML or a 451 → not usable) and again — at most every
5 min — when a ratio feed needs it. `preferProxy` / `provider.setPreferProxy(on)` (the `EU-Proxy verwenden` switch,
`tj2-ui.useProxy`, wired in `marketStore`) routes the ratio feeds through it. Not available from disk (`file:`).

Scheduler invariants: a failure while `navigator.onLine` is false keeps a 30-s retry armed, and data arriving while
marked offline counts as "back online" (every REST feed is re-polled) — the `online` event is easily missed by a frozen
tab. On a resume the overdue polls are spread over a few seconds. A watchdog on the 5-s health tick re-arms any REST feed
that has neither a pending poll nor a poll in flight, and schedules a primary probe for feeds parked elsewhere.
`provider.refresh(feed, { force: true })` (`Jetzt aktualisieren`) asks Binance again for a feed parked on another source
while Binance is not blocked.

## Reliability on the live site (decision 14) — tab switches, sleep/wake, network drops

What keeps every feed refreshing on a Galaxy Tab in Samsung Internet (tests: `market.reliability`, `market.toptrader`,
`market.ws`, `market.traders`, all with fake timers + a synthetic Binance in `tests/unit/market.netHarness.ts`):

| Trigger | What the provider does |
|---|---|
| `visibilitychange` (visible), `pageshow` (bfcache), `focus` (split screen), Page Lifecycle `resume`, `online`, a device sleep (health ticks > 3 intervals apart) | `resume()`: overdue polls re-armed and spread over ~1.5 s, every REST feed older than one cadence re-polled, a silent socket reconnected, parked feeds re-probed (`focus` / `pageshow` / `resume` at most every 5 s) |
| every 5-s health tick (watchdog) | lost timers (a poll > 3 s overdue) re-armed; REST data older than `staleAfterMs` on the Binance clock with the next poll far away kicked (now → 30 s → 60 s → 2 min → 5 min, reset when data advances); REST feeds without a pending poll re-armed; kline tails scanned for holes |
| socket silent 10 s / handshake > 15 s / dead without retry | reconnect (at once after a blip, then 1, 2, 4 … 30 s for good; at most once a minute while hidden so background notifications keep their stream); the last price REST-polled every 5 s meanwhile; 3 attempts without a frame (silent ones included) → WS feeds REST-polled every 10 s (`fallback`) |
| one stream stalls while the socket delivers others (`STREAM_STALL_MS`: mark 15 s, trades 20 s, book 60 s, klines 90 s) | that feed fetched over REST (klines with gap fill); a second stall within 10 min re-subscribes |
| reconnect / REST fallback / resume | kline gap fill from the oldest unfilled hole on the server clock (stays pending when the request fails; genuine exchange holes remembered) |
| `429` | bucket paused 60 s, feed retried with backoff |
| `418` | ban backoff 2 → 4 → … 30 min; every direct REST feed moves to the proxy at once (another IP), a probe brings them back |
| `451` / network failures on ≥ 2 Binance paths while Bybit answers (strict, see below) | blocked: feeds move on (ratio feeds to a usable proxy, never to Bybit's cohort); re-probe 5 → 60 min, pulled forward on evidence |
| `TypeError` on `/futures/data` while the rest of Binance answers | read as CORS → every futures-data feed to the same-origin proxy (`/api/binance/*`, `netlify.toml`); opened from disk (no proxy) the Live-Daten card and the Top-Trader note say so and point to the web link |
| device clock off (`ClockSkew`, from WS mark price / premiumIndex / the time probe; applied ≥ 2 s and consistent) | staleness, aligned polls and gap fills use `serverNow()`; the Live-Daten card names the offset |
| budget | token buckets per host; bulk pages (history, retro checks, `fetchKlines`, `fetchRatios`, 1D) only take tokens while 40 % of the bucket stays free (`BULK_RESERVE`), so no feed is ever starved by a history scroll; the other live feeds leave 5 % of the Binance weight / proxy buckets for the price stand-in (`PRICE_RESERVE`) |

**Routes (CORS-safe).** Every Binance REST path the app uses is proxied by `netlify.toml` (`/api/binance/fapi/v1/{time,
klines, premiumIndex, ticker/24hr, openInterest, fundingRate}`, `/api/binance/futures/data/*`); the CSP `connect-src`
allows `fapi.binance.com`, `wss://fstream.binance.com`, Bybit, OKX and `'self'` (the proxy) – plus `*.supabase.co` (https +
wss) for the cloud since P14; nothing else of the market layer needs a new host.

**Daily candles of several consumers (P14).** Two subsystems fetch 1D klines for symbols other than the live one, each
through its own budget and cache: `multiDaily.ts` (P05 correlation: one page of 99, at most one fetch per symbol and UTC
day, reuses the provider's own `kline_1d`) and the box scanner (`boxes/scanner.ts`, P02: 300 daily bars per watchlist
symbol, its IndexedDB cache); the Analyse benchmark (P03) reads the provider's `kline_1d` feed. In the integrated app a
watchlist symbol that is also traded may be fetched once by each – a known, bounded overlap (weight 1–2 per symbol and
day), never a loop.

**Honest freshness per feed** (Settings → Live-Daten): next to `Stand` (time of the newest data) every row says
`nächste Daten in 3:12` (REST; `5 h 59 min` for long waits), `Stream · Daten vor 2 s` (WebSocket, on the Binance clock),
`Stream getrennt · neuer Versuch in 0:04`, `per REST (Stream aus) · nächste Daten in 0:07`, or the cause while a poll fails
(`Netzwerk/CORS-Fehler (…) · 2× in Folge · neuer Versuch in 0:28`). The countdown runs on the shared `nowMv` clock in a
fixed-width tabular slot (no render per second, no column re-flow). The Top-Trader card note: see `topTraderFreshness`.

### Live top-trader / retail series for the Einstiegs-Check (`traders.ts`)

```ts
import { getTraderSeries, subscribeTraderSeries, useTraderSeries, traderSeriesKey, deriveTraderSeries } from "@/market";

const s = getTraderSeries();      // LiveTraderSeries | null (market stopped)
// s.position / s.account / s.retail: RatioPoint[] (time ms at the 5-min boundary, longPct 0–100), oldest first —
//   Binance topLongShortPositionRatio / topLongShortAccountRatio / globalLongShortAccountRatio at period 5m
//   (the provider's 5-min twins: same points as the Top-Trader card, no extra request); fits the engine's TraderSeries
// s.step = 300 000; s.source: "binance" | "proxy" | null; s.asOf: newest point; s.nextAt: next poll (device clock)
// s.status: "live" | "loading" | "retrying" | "stale" | "blocked" | "unsupported" | "offline"; s.detail: German reason
const off = subscribeTraderSeries(() => engine.markDirty());   // ≤ 1×/frame when one of the three series publishes
const series = useTraderSeries();  // React; re-renders only when a newest point, route, status or next poll changes
```

Only Binance data counts (direct or proxy, per feed health AND per value); Bybit/OKX have no top-trader cohort → empty
series, `unsupported`. Freshness is judged on `serverNow()` with the engine's rule (newest point ≤ 2 steps + 5 min old).

`provider.fetchRatios(kind, period, { endTime?, startTime?, limit?, maxWaitMs? })` — one `/futures/data` page at any
period (`topPositionRatio | topAccountRatio | globalAccountRatio`) on the route the ratio feeds use right now (Binance
direct or the proxy, never Bybit/OKX), charged to the futures-data budget as a bulk call; no Binance route →
`RestError("unsupported")`. For back-dated top-trader readings (Binance keeps ~30 days) and extra periods.

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
| REST feed failing on its source (`consecutiveFailures > 0`, reason network/timeout/5xx/429/cors) | `Zuletzt HH:mm · Netzwerk/CORS-Fehler` / `· Zeitüberschreitung` / `· Serverfehler` / `· Rate-Limit` | warn |

The **market card** status (`connecting|live|error|unavailable`) is driven only by the price feed:
`useMarketView().status/message/sourceBadge/priceMode/pill` (`legacyStatus()`): a 6-s WS hiccup does not change the header;
socket down with a fresh REST price → `live`, pill `Kurs per Abfrage · 5 s`; nothing fresh for 15 s → `live`, pill
`Verbinde …`; `now − asOf > 120 s` → `error` with `Zuletzt HH:mm · veraltet` (time of the price shown), pill
`Kein Live-Kurs` (`connecting` + `Verbinde …` instead while a resume's first poll is on its way); Bybit price → `live`
**with** `sourceBadge: "Ersatzquelle Bybit"`; device offline → `Offline · Stand HH:mm`. LivePill text: `liveAgeLabel(receivedAt, now)`
(`Live`, `Live · vor 12s`, `vor 3 min`, warn > 120 s), rendered on `nowMv`; ring: a `RingCycle { endsAt: nextTickerRefreshAt, ms }`
that runs itself (`refreshRingProgress(nextTickerRefreshAt, now)` remains for a static progress).
Non-comparable values (`comparable:false`) show the `andere Kohorte` badge with `COHORT_HINT[source]`.

Kline gap fill: a non-bootstrap kline poll (WS reconnect, REST fallback) requests every bar since the newest cached one
(`ceil(gap / interval) + 1`, at least 2, at most 1500), so a long outage leaves no holes in the series.

`provider.fetchKlines(interval, { endTime?, startTime?, limit?, maxWaitMs? })` — one kline page (`FetchInterval` = the live
intervals + `1d`) from the source the kline feeds currently use, charged to the same budget (waits ≤ 15 s for tokens, then
`RestError("rate_limited")`), never published into the live cache. Used by the retro signal check (incl. the Lage at T).

Opened from disk (`file:`/`content:`, `isFileProtocol()` from `@/edition`) the proxy source is dropped from the chain (no Netlify
function; no `file:///api/…` CORS noise).

## Signal check (`signals/`) — live "Einstiegs-Check", retro check, chart markers

The pure engine is `@/domain/signals` (1:1 port of the other journal, see its README; the v2 additions — candle-close
states, Top-Trader-Kombi on the 5-min series (`tradersAt` for back-dated trades), divergences, structure + S/R, the
falling-knife filter and the chart APIs `getMcbSeries` / `getDivergences` / `getStructure` — are in its section
"v2: candle-close states, graded parts, falling-knife filter"). This layer feeds it:

| Rung | Built from | |
|---|---|---|
| 30m, 45m | `kline_15m` × 2 / × 3 | exact, UTC-session aligned like TradingView |
| 1h, 2h, 3h | `kline_1h` × 1 / 2 / 3 | |
| 4h | `kline_4h` | |
| 1D | the provider's `kline_1d` feed (shared with the Lage-Ampel; the engine's own 5-min polling is gone) | |

Every rung evaluates its last 500 bars (the other journal's `count: 500`); the running candle is completed with the live price
(`priceMv` / `tradeTimeMv`, only while younger than 5 min). `startMarket` starts it (`signals/boot.ts` follows
`settings.signals` from the journal store), `stopMarket` stops it — nothing to mount.

**Clock:** forming vs closed (candle-close states, `msToClose`, the chart's `closed` flag) is decided on the exchange
clock, `provider.serverNow()` (the device clock + the applied skew), since candle times are Binance times; countdowns
render `closesAt − (nowMv + signalClockOffset())`. The notifier's own timers stay on the device clock.
`BarConverter` re-converts the tail of a live series by object identity (a REST gap fill that corrects bar k after the
socket appended k + 1 reaches the engine). `getChartOverlay(interval, { bars, mcb, div, structure })` = the three chart
APIs from one build of the bars.

**Cadence (120 Hz rule):** a kline publish, a price frame or a health change only marks the engine dirty; one timer runs at
most once per second (5 s in a hidden tab) and sleeps while no data arrives. A full evaluation costs ≈ 1 ms (test budget 3 ms).
The published state changes identity only when the rounded result changes.

**1m frames (`SIGNAL_FRAME_MS` = 60 s, `SIGNAL_FRAME_GRACE_MS` = 1 s):** the running candles are completed with the live price
taken at the last minute boundary on the exchange clock (+ 1 s grace: the closing kline update arrives ~250 ms after it), and the
check is RECOMPUTED only when a new minute frame starts (`armFrame` wakes the engine at hh:mm:01) or the CLOSED history, the
Top-Trader series, the Lage or the config change (`inputKeyOf`) — not with every tick. A dirty run inside the same frame with the
same closed bars returns the published state unchanged. So the forming-candle states (vorläufig signals, MCB / RSI meters, the
Long/Short-Tendenz) move once a minute, like a trader reading the 1m closes; within a frame nothing flickers. Countdowns run on
the clock (`closesAt`), unaffected. Per frame the engine also remembers forming-candle events that came and went (`intrabar`:
greyed, never counted) and the turn price of every forming rung (`turns`). A frame taken within 5 s of its boundary stands for
the minute that just closed (`frameAt` = boundary − 1 ms). The frame's price completes only candles still forming at the
evaluation: a rung whose candle closed after the frame was taken (its final frame arrives within the grace) keeps the feed's
final close (`buildBars(…, ex)`).

```ts
import { useSignalCheck, getSignalSnapshot, subscribeSignalCheck, toTradeSnapshot, checkTradeAt, retroCheck, getMcbSeries, getSignalCandles } from "@/market";

const { state, snapshot, updatedAt, message } = useSignalCheck();
// state: "loading" | "ok" | "stale" | "offline"; snapshot: LiveSignals | null (may be set while loading/stale)
// snapshot.long / .short / .best: Verdict { tiers, strength 0–4, label, valid, rsiOk, zoneOk, score, reasons[] }
// snapshot.checks[i]: TfCheck | null per ladder rung (null = "Zu wenig Kerzen"); snapshot.zone: check of cfg.zoneTf
// snapshot.cfg (sanitised settings.signals), .symbol, .source, .price, .at
const tradeSignal = toTradeSnapshot(snapshot, "long");          // → trade.signal (SignalSnapshot, mode "live")
const snap = await checkTradeAt(trade.date, trade.side);         // live within 5 min, else rebuilt from history at T; null = not covered
const r = await retroCheck(date);                                // { status: ok|live|no-history|error|unavailable, signals, message }
getMcbSeries("45m");                                             // [{ time (ms), kind: bottom|top|buy|sell, live }]; { minor: true } adds bull/bear
getSignalCandles("45m");                                         // Candle[] of a signal timeframe (chart)
```

| State | message |
|---|---|
| `loading` | `Kerzen werden geladen …` / `Zu wenig Kerzen für den Check.` (feeds delivered, < 150 bars) |
| `ok` | `null` |
| `stale` | `Marktdaten veraltet, der Check zeigt den letzten Stand.` (a kline feed stale / offline) |
| `offline` | `Keine Marktdaten (Binance).` / `Kein Live-Kurs für dieses Symbol.` |

**Retro check** (`checkTradeAt(date, side)`): within 5 min of now the live snapshot; otherwise every source interval is fetched
as ONE `endTime = T` page (1500 × 15m, 499 × 1h, 499 × 4h ≈ weight 20) unless the live ring already holds enough contiguous bars
before T; only bars closed at T count. Too little history → `null` (never a fake "strength 0"). Memoised per symbol, config and
minute; network errors resolve `null` (status `error`, retried on the next call). Debounce date inputs in the form (≈ 300 ms).

**Lage-Ampel** (`src/market/lage.ts`, decision 23): `useLage()` / `getLage()` / `subscribeLage()` / `retainLage()` →
`{ lage: Lage | null, status: { state: idle|loading|ok|stale|error, fetchedAt, closedAt, nextAt, source, detail } }`, computed
by `@/domain/lage` from the closed candles of `kline_1d` (last 1000), `kline_4h` and `kline_1h` plus the live price
(`priceMv`, ≤ 1/s); two stages (closed bars ≈ 0.5 ms on a new close — or once the Binance clock passes the close of a bar
the series already report closed, e.g. the socket's final frame on a device clock slightly behind — live values ≈ 0.04 ms),
published only when a shown value changes (`lageKey`). **Missing daily close:** while the 1D candle of the day that closed at
the last 00:00 UTC is not there (the first seconds after 00:00, or the 00:00:20 poll and its retries failed), that day is
built from its 24 closed 1H candles (`dailyFromHourly` in `@/domain/lage`: first open, max high, min low, last 1H close —
the same Binance trades as the 1D candle) and used for the Lage and the gate until the 1D candle arrives and replaces it;
after 5 min the status says so (`stale`, `LAGE_DERIVED_TEXT` "Tagesschluss aus 1H-Kerzen (1D-Kerze fehlt noch)").
Not all 24 present / reported closed → the Lage of the day before with "Tagesschluss noch nicht geladen"; missing for more
than `LAGE_NO_CLOSE_MS` (1 h) after 00:00 UTC → `lage: null` (no gate, "keine Daten"; status `stale`,
`LAGE_NO_CLOSE_TEXT`), never yesterday's state silently. The base is recomputed at 00:00 and 00:00 + 1 h by the clock
(`pendingAt`). Status from the daily feed's health (failures, CORS from a file, "Tagesschluss noch nicht geladen"
after 00:05 UTC). The engine holds it while running and gates the long verdict with it (`settings.signals.lage = { on, mode }`,
part of the input key: a switch re-grades at once); retro checks compute the Lage at T from the cached daily feed or one
`1d` page (`endTime = T`; a page that fails → no gate for that check and the result is not memoised, `partial`). The overview's toast (`src/app/ScenarioWatcher.tsx`) follows its state changes.

**Notification:** a NEW valid entry (edge after the first evaluation, held ≥ 60 s against repaint) → toast (`pushToast`, kind
`signal`, 5.2 s: label, `Score n`, strength line) once per base bar and side, persisted in `storageKey("signal-last")`
(`tj2-signal-last`). With `settings.signals.notify` and a granted permission also a system notification while the page is not
in front. `requestSignalNotifyPermission()` must be called from the click that enables the switch; `signalNotifyPermission()`.

## Mapping (`mapping.ts`)

- `deriveMarket(snapshot, health, { now, rsiWOverride })` → `price` (rounded last price), `change`, `close4h/At`
  (`lastClosed4h` = bundle `UM`), `closeW/At`, `rsiW` (local Wilder 14, TradingView override wins), `live4hClose`,
  `fundingLine` (`Mark 84.212 · Funding +0,0100 % · nächstes Funding in 05:59:59`), `openInterest`,
  `openInterestChange24h`, `taker`, `bid/ask`, `updatedAt`, `nextTickerRefreshAt`, `status/message/sourceBadge`,
  `priceMode` (`stream|poll|waiting|none`) and `pill` (the card's status pill, see "Last price when the stream drops").
- `deriveTopTrader(snapshot, health, base)` → `longPct` (accounts|positions per `tj2-ui.topTraderBase`),
  `delta = topPositionLong% − globalLong%` (joined by timestamp), `deltaCandles` (trailing `> 0`, bundle `oK`),
  `sparkline` (last 20), `onlyBinance`, `liveReadingOk`, `detail`, `taker`, `fromLive` / `readingFeed` (Long % and Delta
  from the 5-min twin when it is newer). `liveReadingOk` needs the series from Binance or the proxy per health AND per
  value (a Bybit retail series that ticked to `stale` no longer passes).
- `topTraderFreshness(tt, health, periodMs)` + `freshnessText(f, now)` → the card note: `Binance liefert alle 5 min neu ·
  Stand 14:05 · nächste Daten in 3:12`, `Binance antwortet nicht (Netzwerk/CORS) · Stand 13:55 · neuer Versuch in 0:28`,
  `Binance blockiert (Region) · … · neuer Versuch in 4:10`, `Binance über EU-Proxy · alle 5 min neu …`, `Offline`.
  `topTraderHealthSignature(h)` is the re-render key.
- `virtualReading(topTrader, lastManual)` → `{ …, note: "Live von Binance" }` (`· 5-min-Wert` from the twin) or `null` in
  the Bybit fallback.
- `triggerDistances(price, levels)`, `takerDelta`, `fundingPct`, `lastPrice`.

## Box-zu-Box live (`boxes/`, P02) — boxes, alerts, scanner, trade snapshot

The pure engine is `@/domain/boxes` (boxes on swing points, breakout by CLOSE, Box-zu-Box targets, diagonal RSI lines,
graded setups). `src/market/boxes` runs it live; import from `@/market/boxes` (not re-exported by `@/market`).

| Module | Contract |
|---|---|
| `store.ts` — `retainBoxes()` / `getBoxes()` / `subscribeBoxes()` / `useBoxes({ enabled? })` | Live analysis of **4h** (`kline_4h`, extended ONCE per provider by `provider.history("kline_4h")` to ~760 bars; the provider's ring keeps ~600, so the page's older part is kept in the store), **1D** (`kline_1d`, 1000 days) and **1W** (`kline_1w`). Closed candles only; the live price (`priceMv`, ≤ 1/s) drives only `pending` (beyond an edge before the close), the zone and the setups' entry. Higher timeframe: 1D grades 4h, 1W grades 1D. Top-trader bias: `getTraderSeries()` → `traderReading` → `traderBiasOf` (≥ 55 % long with a non-negative Whale–Retail-Delta = long, mirrored; no fresh Binance data = `null`). `settings.boxes` (`boxesCfgOf`) via `useJournal`. **Cadence:** `findBoxes` + `rsiLines` (1–6 ms per timeframe) only when a timeframe's closed-bar key changes or the engine cfg does, one timeframe per idle callback (`requestIdleCallback`, else a 16 ms timer); the live part (`boxState` with the cached boxes + `boxSetups`, ≈ 1 ms per timeframe) at most once a second, never while hidden; a publish only when something shown changes (`boxKey` per timeframe, bias, status). `useBoxes` delivers as a transition; `enabled: false` neither retains nor subscribes. A release + retain with the same provider (keep-alive page) keeps everything. View: `{ state: off\|idle\|loading\|ok\|error, detail, symbol, cfg, bias, tfs: { 4h, 1d, 1w: { analysis, bars, closedAt, closesAt, boxId, key } }, best }` – `best` = setups passing `cfg.minGrade` (A+ / A, never a mere preparation), best score first. The signal engine (`signals/engine.ts`, `signalCfgKey`) is untouched. |
| `alerts.ts` — `BoxAlertHost`, `startBoxAlerts()`, `evaluateBoxes(view)`, `useRecentBoxAlerts()` | Toast (`kind: "signal"`; the ToastIsland is the one live region) + optional browser notification (permission granted, tab in the background) when a box changes phase at a candle CLOSE into breakout / retest / failed / target, when a new setup reaches the minimum grade, and when the scanner finds a new A+. Deduplicated per box id + phase (setup id; scan row id = symbol, timeframe, side, kind, box start – `scanAlertKey`, so a setup that stays A+ alerts once, not every 4h), remembered across reloads (`storageKey("box-alerts")`, newest 200); the first evaluation after a start (or after alerts were turned on) only seeds. `BoxAlertHost` is a render-nothing leaf the app mounts once: it retains the store while `on` + `alerts` (every plan – the box chart is free) and the scanner while `alerts` + `scanner` are set and the plan includes `boxScanner` (`setBoxScannerAllowed`, F03), and releases them when turned off (no fetch for alerts nobody gets). Each scanned symbol is analysed once per fetch (memo per series), in the task that brought its bars. |
| `scanner.ts` — `retainScanner()` / `getScan()` / `subscribeScan()` / `useScan()` / `scanNow()` / `scanSymbol()` | Watchlist (`settings.boxes.watchlist`, default 10 USDT perps, ≤ 20): per symbol one 4h page (499, weight 2) + one 1D page (300, weight 2) from `binanceRest().klines`, plus one 1W page (200, weight 2) once per closed Monday week (reused from the cache otherwise); the 1D boxes grade the 4h ones and the 1W boxes the 1D ones, exactly like the Markt page (MM-8; without a weekly page the 1D series aggregated to weeks stands in), and 1W setups are listed as well (F16); rows = only setups passing the minimum grade, best score first. **Own token bucket** `SCAN_BUDGET` ≤ 20 weight / min (separate from the provider's buckets — a full default scan takes ~2 min, ~3 min in the first scan of a week). After every 4h close + 20–80 s jitter (`nextScanAt`), on demand, an overdue scan on return to the tab. 451 / CORS / network on the direct route → the rest of the session via the same-origin proxy (`proxyRest`), not in the file build (honest error). Bars cached in IndexedDB (`tj-market`, key `${storageKey("box-scan")}:${symbol}:${tf}`): a reload shows the last results without a request while the newest closed 4h bar is cached. |
| `snapshot.ts` — `resolveTradeBoxes(date, side, { symbol?, tf?, signal?, klines? })`, `boxGradeOf(trade)`, `boxSnapOf(trade)`, `parseBoxSnapshot`, `toBoxSnapshot` | `Trade.boxSnap` contract (pure part in `@/domain/boxes/snapshot.ts`). **Live** when the entry lies in the forming (or just closed) bar of the running store's symbol; **retro** otherwise: `provider.fetchKlines(tf, { endTime: entry })` + the higher timeframe, closed bars before the entry only (no look-ahead), memoised per bar, 6 s timeout → `null`. No top-trader read retro (never invented). A symbol other than the provider's resolves only with an explicit `klines` source (review MM-6: the editor passes the trade's pair and gets `null` for other pairs, never the live market's box); the readers (`boxSnapOf` / `boxGradeOf`) ignore a stored snapshot of another symbol than the trade's pair. |
| `backfill.ts` + `BoxSnapBackfillHost.tsx` — `startBoxSnapBackfill`, `boxSnapCandidates`, `backfillBoxSnap` | Review F02: synced / imported trades (Bitunix auto-sync, CSV, TradingView, REST) and trades on other pairs get the box context of their OWN pair at entry – idle queue after a minute in the app, one trade every 4 s, ≤ 30 per session, every attempt remembered for a day (`storageKey("boxsnap-tried")`), a look every 5 min for newly synced trades; klines through the scanner's own budget (`budgetedKlines`, ≤ 20 weight / min, direct → proxy). Mounted in `DeferredHosts` ("Box-Kontext"). |

Box fix: the bars a timeframe analyses come from `closedBars(older, ring, intervalMs)` – strictly ascending and gap-free on
the interval grid (the history page is put in front only where it connects to the ring, a repeated open time keeps the
newer row, only the newest gap-free run is kept), so the engine's bar indices and the chart's bar times always agree.
`BoxTfView.liveFrom` (ms) = `reentryIndex` (`@/domain/boxes/live.ts`): where a broken-and-re-entered newest box is live
again – the chart's live part starts there.

Tests: `tests/unit/market.boxes.test.ts` (domain additions, store on a fake provider and on the net harness, scanner budget /
proxy / cache, alerts seed / close-only / dedup, resolver live / retro), `tests/unit/market.boxSnapshot.test.ts`. E2E:
`mockMarket(page, "live", { boxes: true })` serves REAL BTCUSDT 4h / 1D bars (`tests/unit/fixtures/binance-btcusdt-*.json`,
1W aggregated) with the 4h bar `cut4h` (default 1493, an A+ range long) forming "now"; other symbols get their own cut and
price level (scanner). Since the box fix (`tests/e2e/mocks/boxFixture.ts`, unit-tested in `mocks.boxFixture.test.ts`): one
shift for every timeframe, 1D = the UTC days of the same shifted 4h bars (older days from the daily fixture), 1W = their
weeks, Binance `startTime` / `endTime` / `limit` window semantics.

## Other modules

`symbol.ts` (`tvSymbolToBinance`, `resolveSymbol` → Bybit/OKX symbols, `Fallback nur für USDT-Perps`; a USD symbol of another
venue — the other journal's `BITSTAMP:BTCUSD` — or a bare `BTCUSD` maps to the USDT perp `BTCUSDT`, TradingView's `.P` suffix is
dropped),
`period.ts` (Binance/Bybit/OKX period tables, `cadenceLabel`), `feeds.ts` (spec table), `budget.ts` (token
buckets at 10 % reserve; bulk calls keep 40 % free for the live feeds, live feeds keep 5 % of the price buckets for the price stand-in), `clock.ts` (`ClockSkew`, `skewText`), `schedule.ts` (`nextAlignedAt`, `wsBackoffMs`, `probeBackoffMs`, pausable `Scheduler`),
`cache.ts` (`MarketCache`, `upsertSeries`, key `${source}:${symbol}:${feed}` / `${source}:${symbol}:${period}:${feed}`, DB `tj-market`), `health.ts`
(pure `reduceHealth`), `statusLabel.ts`, `indicators.ts`, `sources/*` (zod-validated REST clients, `WsClient`,
proxy probe), `format.ts` (minimal de-DE formatters).

## Testing

Fixtures: `tests/fixtures/binance-*.json`, `bybit-*.json`, `ws-scenarios/{live,stale,blocked_451,offline,reconnect}.json`.
Notifications and MotionValues are frame-coalesced: after dispatching WS messages in a unit test call
`flushMarketNotifications()` and `flushMotionValues()` before asserting. Views mocked through
`tests/unit/views.overview.harness.tsx` (`fakeMarket(actual)`) get fixture-backed `useFeed` / `useFeedSelect` / `getFeed` /
`useHealth` / `useHealthSelect`, a no-op `subscribeFeed`, and real MotionValues seeded from the snapshot.
Signal check: `tests/unit/market.signals.test.ts` (fake provider: live parity with the other journal's pipeline, ≤ 1/s cadence,
stable identity, status texts, 2h/3h/1D rungs, markers, retro history incl. null-not-0, notifications, < 3 ms per check); the
pure engine in `tests/unit/signals.*.test.ts`. Kline fixtures: `binance-klines-{1m,15m,1h,4h,1w}.json`.
E2E: `await mockMarket(page, "live")` (`tests/e2e/mocks/market.ts`) routes REST to fixtures and replays the
WS scenario through a fake `window.WebSocket`. Unit tests: `tests/unit/market.*.test.ts`.

Proxy: the active route is the `netlify.toml` proxy rewrite (see above). The optional Netlify function
`netlify/functions-disabled/binance.mts` (`/api/binance/*`, region `fra`, allowlist, `x-upstream-status`, CORS to
`SITE_ORIGIN`) answers on the same paths if moved to `netlify/functions/` (needs Pro for `fra`); the probe accepts both.
Top-trader staleness scenarios (one TypeError, 503/429 ×3, CORS on `/futures/data`, period 1h, period switch, missed
`online` event, resume, real block, proxy preference): `tests/unit/market.toptrader.test.ts`.
Stream-drop scenarios (silent socket → REST price within 20 s and ≤ 6 s old for 6 min, reconnect ladder for good, hidden
6 min → visible, Page Lifecycle `resume`, `pageshow` / `online`, REST failing too → `Verbinde …` → `Kein Live-Kurs`):
`tests/unit/market.priceFallback.test.ts`; the ladder itself in `market.ws.test.ts`, the pill in `market.mapping.test.ts`
and `views.overview.marketPill.test.tsx`.

## Schlüsselmarken live (`keylevels/`, F09 / F08 / F22)

Import from `@/market/keylevels` (not part of the `@/market` barrel). `candles.ts`: the candles of a level's OWN timeframe from
the provider's feeds (30m = 2 × `kline_15m`, 2h / 3h from `kline_1h` – epoch-aligned like the chart's 30m, 4h / 1D / 1W
straight; a timeframe without candles gives `null` → the level is `unknown`, never another timeframe) and
`feedAvailability` for the picker. `store.ts`: `useKeyLevels()` / `getKeyLevels()` / `retainKeyLevels()` evaluate the five fixed
levels and the user's own on a 1-s timer (only when an input changed; published only when something shown changed), levels
of another symbol are listed but not judged. `alerts.ts`: `KeyLevelHost` (mounted in `DeferredHosts`, only while an own enabled
level exists) steps the pure stage machine, delivers through the toast island and – permission granted, page not in front – a
system notification, and writes every outcome to the Zustellprotokoll (`deliveryLog.ts`, `tj2-keylevel-log`, newest 200,
browser-local). The stage memory is stored (`tj2-keylevel-mem`), so a reload never repeats a stage; the first look at a level
only seeds. The plan-change toast (`tj2-keylevel-plan`) is on by default only for users with an own level. The existing signal
and box alerts add their toasts to the same log as lines (log only – their own rules are unchanged). `chartLines.ts`:
`useKeyLines(symbol)` for the chart lines. **Alerts run only while the app is open** – no server-side monitoring (F21 is not
part of this). Tests: `tests/unit/market.keylevels.test.ts`.

## Signalarchiv (`signalArchive.ts`, F32)

The signal events the app raised (valid entry of the Einstiegs-Check, Box-zu-Box setups, confirmed own key levels) as data with a
time, market and side – the input of the „Verpasste Chancen“ card (`@/domain/missed`, see its README). `tj2-signal-events`
(`storageKey("signal-events")`), versioned `{ v: 1, items }`, the newest 300 / 120 days, this device only (not in the backup, not
synced); a stored newer version is never overwritten. `recordSignalEvent` is called next to `logExternalDelivery` in
`signals/notify.ts` and `boxes/alerts.ts` and after `recordDelivery` in `keylevels/alerts.ts`; it never throws.

### Erweiterung des Signalarchivs und Anwesenheitsspur (F25 · F27 · F28 · F60)
The three recording points now also store the marks the signal had (`price` / `stop` / `target` / `name` / `setupKind` / `grade` / `rr` of a Box setup, the invalidation of an own
level as `stop`) and `barClose` (the close of the candle the alert rests on, for the delay between close and alert); the inbox marks `seenAt` / `skip` / `tradeId` are written by
`markSeen` / `skipSignal` / `linkTrade`. `presence.ts` writes the **Anwesenheitsspur**: a beat every 30 s while a tab runs the app (`PresenceHost`, mounted in `DeferredHosts`),
stored as segments under `tj2-presence` (`{ v: 1, segs: [{ id, a, b }] }`, 35 days, ≤ 400 segments, this device only, not in the backup or the cloud sync); a beat later than
150 s after the previous one starts a new segment. It exists from the day it is first written – before that the share of open time is „unbekannt“. The candles for the outcome per signal are loaded
**automatically** (idle, a few signals per run, cache first, never in a background tab or with data saving – `views/coach/signalAuto.ts`) or on „Neu berechnen“, the gap check **on demand**
(`candleCheck.ts`); both through the lab's history source (`views/coach/signalOutcomes.ts`), never by the live provider.

## Preis- und RSI-Struktur live (`trendlines/`, F05)

Pure engine: `@/domain/trendlines`. `store.ts` (`useTrendlines` / `getTrendlines` / `subscribeTrendlines` /
`retainTrendlines`, pattern of `keylevels/store.ts`) reads the selected timeframes of `settings.trendlines`, takes the REAL
candles of each (`keylevels/candles.ts` `levelCandles`: 1h / 4h / 1D / 1W straight from their feeds, 30m from 15m, 2h / 3h
from 1h) and runs `analyzeTrendlines` on the closed ones; a timeframe `timeframeAvailability` cannot serve is listed with
its German reason and not analysed (nothing substituted). One 1 s timer, recompute only when a used feed's bar key, the
minute or the settings changed, publish only a changed view; nothing runs without a subscriber. `useTrendView(on)` is the
lazy consumer (store imported on demand, own chunk) for the chart; `write.ts` saves `settings.trendlines` at once.
Import from `@/market/trendlines/<file>` (the index re-exports the store, so eager code must not use it). Tests:
`tests/unit/market.trendlines.test.ts`.

## Ähnliche Situationen (`similar/`, F19)

`useSituationInput(tf)` hands the card the REAL candles of one timeframe (`keylevels/candles.ts` `levelCandles`: 1h / 4h / 1D / 1W
straight from their feeds, 30m from 15m, 2h / 3h from 1h) plus `timeframeAvailability` and the data source's clock; a timeframe
the feed cannot serve yields no candles and its German reason – nothing is substituted. It re-renders only when the source
feed's bar key (`klineBarKey`: a bar appended or closed, not forming ticks) or the feed's health text changes; nothing runs
without a mounted caller (no timer, no store). The search itself is the pure `@/domain/similar` and runs on the main thread in
the card's `useMemo` (milliseconds for ≤ 1500 candles). Tests: `tests/unit/views.markt.similar.test.tsx`.

## `sec/` – SEC EDGAR für die Aktien-Module (F68 / F69)

Kein Krypto-Feed: der **Vertrag** zu den Server-Funktionen `GET /api/v1/sec/facts?ticker=` und `/api/v1/sec/filings?ticker=` (`netlify/functions/sec-facts.mts`, `sec-filings.mts`; Betrieb, Grenzen und Env siehe `netlify/functions/README.md`). Der Browser spricht nie selbst mit der SEC (Kontakt im User-Agent nötig, `data.sec.gov` ohne CORS, 10 Anfragen je Sekunde).
Wie `Stamped` der Feeds trägt jedes Ergebnis `source` (`"sec-edgar"`, Anzeige „SEC EDGAR (XBRL)“), `asOf` (Datum, auf das sich die Zahlen beziehen: neuestes Quartalsende bzw. neueste Meldung), `receivedAt` (wann der **Server** die SEC gelesen hat – eine Antwort aus dem Server-Speicher behält ihre ursprüngliche Zeit), `cached`, `stale` und die SEC-URL (`src/ui/SourceStand.tsx` zeigt Quelle + Abruf).
| Datei | was |
|---|---|
| `wire.ts`, `concepts.ts`, `days.ts`, `reduce.ts`, `tickers.ts`, `filings.ts` | **rein und ohne `@/`-Alias** (die Funktionen importieren sie relativ): Antwortformate, die gelesenen XBRL-Konzepte je Kennzahl, Datumshelfer, `reduceCompanyFacts` (SEC-„company facts“ 3–20 MB → bekannte Konzepte, nur Berichte (10-Q/10-K), ~6 Jahre, eine Einheit je Konzept; Werte werden nie geändert, Wiederholungen bleiben), Ticker → CIK (Klassen-Aktien mit `-` oder `.`), die Einreichungsliste (letzte 10-Q/10-K/8-K, jüngste Ergebnismeldung mit Punkt 2.02, Pressemitteilung aus dem Ordner-Index). |
| `client.ts`, `index.ts` | `fetchSecFacts`, `fetchSecFilings` (5-Minuten-Zwischenspeicher je Browser, gleiche Anfragen in Flug teilen sich einen Aufruf), `SecError` mit `kind`: `setup_required` („Einrichtung nötig“: `SEC_USER_AGENT` fehlt, kein Aufruf), `unknown_ticker`, `no_facts`, `busy`, `timeout`, `upstream`, `invalid`, `invalid_query`, `plan_required`, `unauthenticated`, `rate_limited`, `unavailable` (kein Server hier) – jeweils mit der deutschen Meldung des Servers. |
Tests: `tests/unit/sec.shared.test.ts`, `tests/unit/sec.client.test.ts`, `tests/unit/functions.sec.test.ts`; Fixtures im echten SEC-Format in `tests/fixtures/sec` (Erzeuger `make.mjs`, Herkunft dort beschrieben).

## Handelsplan-Kerzen und Erinnerung (`plan/`, F44 · F22)

`plan/candles.ts` lädt die Kerzen des Handelsplans (Binance USDⓈ-M, 5m / 15m / 30m / 1h) für das Fenster einer Sitzung über die REST-Clients dieser Schicht (`fetchJson`, `klinesSchema`, `mapKline`; direkt, bei Sperre / CORS / Netzfehler derselbe Weg über den EU-Proxy, nie in der Einzeldatei-Version). **Zwischenspeicher zuerst**: abgeschlossene Kerzen ändern sich nie – pro Symbol und Zeitrahmen liegt EIN lückenloser Block (IndexedDB `storageKey("plan-klines")`, höchstens 1 500 Kerzen); `onCache` liefert ihn sofort, danach wird nur geholt, was davor und danach fehlt (je Anfrage nur so viele Kerzen, wie fehlen). Die noch laufende Kerze kommt mit, wird aber nie gespeichert. Ohne Netz zeigt die Seite den Zwischenspeicher mit dem Grund. `plan/sources.ts` ist die Tabelle der Kerzenquellen: Krypto bereit, Aktien als Platz vorbereitet (`ready: false`, die Seite sagt es und erfindet keine Kerzen). `plan/clock.tsx` (`PlanClockHost`, in `DeferredHosts` eingehängt) meldet die Erinnerung „flat by close“ eines gespeicherten Plans zur Uhrzeit – ein Timer auf die nächste fällige, Toast und eine Zeile im Zustellprotokoll (`quietOutcome`), bei geöffneter App; eine erst nach 12 Stunden gefundene gilt still als verpasst. Tests: `tests/unit/market.plan.candles.test.ts`, `tests/unit/market.plan.clock.test.tsx`.

## Aktien (`stocks/`, F67 / F68)

Stock data comes through its own contract, not through `MarketProvider`: `src/market/stocks` (README there) gives bars, quotes, the Nasdaq Trader
symbol directory and headlines as typed results `ok | stale | unavailable(reason)`, each value with `source`, `asOf` and `receivedAt`, over four
public-data functions (`/api/v1/stocks/*`, see `netlify/functions/README.md`). It reuses `cache.ts` (KVStore) and `budget.ts` (TokenBucket) of this
folder and has its own client, cache ages and throttle. The crypto side of the scanner reads Binance klines and the 24 h ticker through the
existing REST helpers (`sources/binance.ts`, `sources/http.ts`, `sources/proxy.ts`) with its own budget. Tests: `tests/unit/stocks.client.test.ts`, `tests/unit/stocks.server.test.ts`.

## Datenarchiv (F26) – `archive/`

Ein lokales Archiv öffentlicher Binance-USDⓈ-M-Zahlen und der Analysezustände der App, **nur solange die App offen ist** und der Schalter
an ist (Standard aus, `tj2-archive-cfg` im Browser dieses Geräts – nicht in `settings`, nicht in Backup oder Cloud-Sync). Ansicht:
Einstellungen › Datenarchiv (`src/views/settings/ArchiveCard.tsx`); warum dort: es ist eine Entscheidung über den Speicher und die Daten dieses Geräts
(an/aus, Größe, Löschen), keine Tagesansicht – und die Startseite bleibt unberührt.

| Datei | Aufgabe |
|---|---|
| `db.ts` | eigene IndexedDB (`tj2-archive`, je Edition): `points` (Schlüssel `[Reihe, Symbol, Zeit]`) und `ticks` (das Protokoll); Zeilenbereiche, Überblick, Ringpuffer-Kürzen von unten, Löschen; `ArchiveUnavailable` / `ArchiveQuotaError` |
| `collector.ts` | ein Takt: je Symbol `premiumIndex` (Markpreis, zuletzt abgerechnete Funding-Rate), `openInterest`, drei `/futures/data`-Verhältnisse (5 min); Weg direkt → EU-Proxy bei 451 / CORS / Netzwerk / Limit (nicht im Datei-Build); eigener Abstand von 200 ms, 429/418 → 5 min Pause; schreibt **nur**, was die Börse im Fenster des Abrufs meldet; Protokoll mit Grund je Symbol; Stopp bei > 90 % des Browser-Speichers |
| `runner.ts` | die Uhr: erster Takt nach 15 s (oder wenn der Takt des vorigen Abrufs um ist), danach alle 5/10/15 min; ein aufwachender Tab holt einen überfälligen Takt nach kurzer Pause nach – die Zeit davor bleibt eine Lücke; hält Lage-Ampel und Box-Analyse am Laufen, solange „Analysezustände“ an ist |
| `states.ts` | liest, was die App gerade zeigt (Lage-Ampel, Box-Phase 4h/1D/1W des Markt-Symbols); fehlt die Auswertung, fehlt der Eintrag |
| `store.ts` | Schalter (`useArchiveCfg`, `useArchiveOn`) und Laufzustand (`useArchiveStatus`, `rev` zählt jede Änderung des Inhalts) |
| `host.tsx` | Blatt-Host; `ArchiveMount` in `DeferredHosts` lädt den Chunk **nur bei eingeschaltetem Archiv** |

**Fenster-Regel (keine Lücke wird gefüllt).** Ein Abruf nimmt von den 5-Minuten-Verhältnissen nur Punkte seit dem vorigen Abruf (minus 5 min
Veröffentlichungsverzug), wenn die App ohne Pause lief (vorheriger Takt höchstens 2,5 Intervalle her), sonst nur die des letzten Intervalls. Binance könnte
die Zeit dazwischen nachliefern (etwa 30 Tage Historie) – die App holt das bewusst nicht nach. **Lücken** = Abstand > 2,5 × Takt; die Ursache steht im Protokoll
(`src/domain/archive/gaps.ts`): kein Takt = App zu; Takt mit Fehler = Grund (`blocked_451`, `network`, `rate_limited`, `timeout`, `offline`, `http_5xx`, `quota`);
Takt ohne das Symbol = nicht gewählt.

**Grenzen:** Ringpuffer je Reihe und Symbol (8 640 Einträge, Zustände 4 320) und ein Größenlimit (10–100 MB, aus der Zahl der Einträge geschätzt – die Ansicht sagt „geschätzt“);
höchstens 8 Symbole; Zustände nur für das Markt-Symbol; **kein Server-Archiv**. Live gegen Binance nicht geprüft (aus dem Sandbox-Netz antwortet `fapi` mit 451; nur das Testnet ist erreichbar:
dort stimmen die Formen von `premiumIndex`, `openInterest` und `fundingRate`, `/futures/data` gibt es dort nicht) – die Tests laufen mit gemocktem `fetch` in den dokumentierten Formen und fake-indexeddb.
Tests: `archive.db.test.ts`, `archive.collector.test.ts`, `archive.runner.test.ts`, `archive.domain.test.ts`, `views.settings.archive.test.tsx`, e2e `archive.spec.ts`.

## Squeeze-Beobachtung (F07) – `squeeze/`

`read.ts` liest die Archivreihen eines Symbols (30 Tage) für die reine Regel in `@/domain/squeeze`; `alerts.ts` meldet **nur nach ausdrücklichem Einschalten**
(`settings.squeeze.alerts`, Standard aus) über den Weg der Box-Alarme: Toast (`kind: "signal"`), Zustellprotokoll (`logExternalDelivery("box", …)`) und – wenn der Browser-Hinweis der
Box-Alarme an ist und der Tab im Hintergrund – ein System-Hinweis. Gemeldet wird der **Beginn** je Symbol und Seite (nicht, solange es gilt; höchstens einmal in 6 h; der erste Blick nach
dem Start merkt sich nur). `host.tsx` hängt als `SqueezeMount` in `DeferredHosts` und lädt nur bei Alarm an **und** laufendem Archiv. Karte und Texte: `src/views/markt/README.md`.


## Börsenhistorie, Orderbuch, Signalprotokoll (F26 · F07 · F44 · F25 · F28 · F31)

- `archive/backfill.ts` (+ `backfillStore.ts`, `backfillLog.ts`): der Lauf von „Börsenhistorie nachladen“ – ein Abruf zugleich mit Pause, Fortschritt nach jedem Fenster, Abbruch nach der Pause, 429 beendet den Lauf,
  Weg über `RestRoute` (`sources/route.ts`: direkt, bei 451 / CORS / Netzwerk / 429 über den EU-Proxy). Schreibt in eigene Reihen (`…Hist`), nie in die des Sammlers. `sources/binance.ts` kennt dafür `markPriceKlines`
  und `depth`. Reine Regeln: `@/domain/archive/backfill`.
- `execution/book.ts`: `loadBook(symbol)` – ein Orderbuch-Schnappschuss (`/fapi/v1/depth`, 1000 Stufen) und der 24-Stunden-Umsatz auf Klick; Fehler kommen mit Grund zurück (nie geworfen, nie ersetzt). Rechenkern: `@/domain/execution`.
- `signalRecord.ts` (dynamisch geladen von `signals/notify.ts`, `boxes/alerts.ts`, `keylevels/alerts.ts`): schreibt zu jedem Signal die Voraussetzungen (`@/domain/missed/prereq`) und den Regelstand; `signalRules.ts`
  und `ruleVersions.ts` geben einer Einstellungsmenge ihren Fingerabdruck und die laufende Nummer (`tj2-rule-versions`, nur dieses Gerät). Der Einstiegs-Check hängt den Regelstand auch an den Snapshot am Trade
  (`overlays/SignalSection.tsx`, beim Speichern). Nichts davon gehört zur Erstladung (`ruleVersions.ts` importiert bewusst aus den Einzelmodulen von `@/domain/missed`, nicht aus dem Barrel).
Tests: `archive.backfill.*.test.ts`, `execution.market.test.ts`, `market.signalRecord.test.ts`.
