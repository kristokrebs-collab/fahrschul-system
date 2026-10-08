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
| `topPositionRatio5m`, `topAccountRatio5m`, `globalAccountRatio5m` | the same `/futures/data/*` ratios at the fixed period `5m` | 5 min (aligned 5-min boundary + 60–105 s) | 12 min | bootstrap `limit=36`, poll `limit=3`, ring 288; Binance only (direct or proxy, never Bybit/OKX); with period `5m` they ride along with the chosen-period request (no extra call) |
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
resume; otherwise `TypeError`s on ≥ 2 different Binance paths within 2 min AND `api.bybit.com/v5/market/time` answering →
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
allows `fapi.binance.com`, `wss://fstream.binance.com`, Bybit, OKX and `'self'` (the proxy).

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

**Cadence (120 Hz rule):** a kline publish, a price frame or a health change only marks the engine dirty; one timer evaluates at
most once per second (5 s in a hidden tab) and sleeps while no data arrives. A full evaluation costs ≈ 1 ms (test budget 3 ms).
The published state changes identity only when the rounded result changes.

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
(`priceMv`, ≤ 1/s); two stages (closed bars ≈ 0.5 ms on a new close, live values ≈ 0.04 ms), published only when a shown
value changes (`lageKey`). Status from the daily feed's health (failures, CORS from a file, "Tagesschluss noch nicht geladen"
after 00:05 UTC). The engine holds it while running and gates the long verdict with it (`settings.signals.lage = { on, mode }`,
part of the input key: a switch re-grades at once); retro checks compute the Lage at T from the cached daily feed or one
`1d` page (`endTime = T`). The overview's toast (`src/app/ScenarioWatcher.tsx`) follows its state changes.

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
