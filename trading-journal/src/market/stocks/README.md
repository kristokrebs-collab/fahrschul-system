# `src/market/stocks` – the stock data contract (F67 / F68)

One door to US stock data for everything that needs it: the scanner, the watchlist, the news monitor, the trade plan (`src/market/plan/stockCandles.ts`:
the plan's candles; `src/views/timemachine/historySources.ts`: the Zeitmaschine's hourly and daily history) – and the parts other agents build next to them (analyst, Congress). It sits beside `src/market/sources` (Binance) and follows the same rules:
**every value carries `source`, `asOf` (when the market made it) and `receivedAt` (when this app got it)**, a failure is a typed
result and never a gap or an invented number, and nothing but tickers, an interval and a range ever leaves the machine.

```ts
import { stockData } from "@/market/stocks";            // the app's one instance (real API, IndexedDB cache, shared throttle)
const r = await stockData().bars("AAPL", "1d");        // StockResult<StockBars>
if (r.status === "ok")          use(r.data, r.source, r.asOf, r.receivedAt);
else if (r.status === "stale")  use(r.data), show(r.reason, r.message, r.failedAt);   // old data AND why it is old
else                            show(r.reason, r.message);                              // nothing to show: the reason is the content
```

## The contract (`types.ts`, `StockDataContract`)

| call | returns | notes |
|---|---|---|
| `bars(symbol, interval, opts?)` · `barsMany(symbols, interval, opts?)` | `StockResult<StockBars>` · `Record<symbol, StockResult<StockBars>>` | intervals `1m 5m 15m 1h 1d`; candles `{ time, open, high, low, close, volume, closed }` – `closed` = the candle is complete at the time of the fetch (a daily bar when the New York session of its day is over). `meta` = name, currency, exchange, price, previous close, volume, market time. Chunks of 8 tickers per request. |
| `quote(symbol)` · `quotes(symbols)` | `StockResult<StockQuote>` | price, previous close, change, change %, day and 52-week range, volume, market time. Chunks of 20. |
| `symbols()` | `StockResult<SymbolDirectory>` | the Nasdaq Trader directory (US common stocks and ADRs, no ETFs / test issues / warrants / rights): `[symbol, name, exchange, financial status]`, the file time, and what was dropped (counts per kind). |
| `news(symbols)` | `Record<symbol, StockResult<NewsItem[]>>` | headlines `{ id, title, url, publisher, publishedAt, summary }`. Chunks of 8. |

Options: `{ fresh?, signal? }` on every call, `range?` on the bars (Yahoo's range word, default per interval in `DEFAULT_RANGE`). `fresh`
skips the cache once; `signal` aborts (`unavailable("aborted")`).
`StockResult<T>` is `ok | stale | unavailable`; every reason is one of `no-server · offline · network · timeout · login · plan ·
rate-limited · blocked · upstream · bad-symbol · no-data · bad-response · aborted`, each with a German sentence (`REASON_TEXT`, `result.ts`).

## Parts

| file | what |
|---|---|
| `types.ts` | the contract, `SOURCE_NAME` (how a source id is named on screen – "Yahoo Finance (inoffiziell)"), `STOCK_LIMITS`, `RANGES_BY_INTERVAL`, `DEFAULT_RANGE`, `isStockSymbol` (`^[A-Z]{1,5}([.-][A-Z])?$`). |
| `wire.ts` | zod schemas of the four server answers – the server builds them, the client parses them; an answer that does not fit is `bad-response`. |
| `client.ts` | `createStockData(deps)` (api, clock, KV, limiter and `online` are injectable – tests pass fakes) and `stockData()`. Cache first, then the network; a failed refresh serves the cached value as `stale` (with the reason) up to `maxStale`; after a rate limit the client pauses 30 s (`RATE_BACKOFF_MS`); `failFrom` maps `ApiError` (status, code) to a reason. |
| `cache.ts` | IndexedDB (`idbKV`) with memory fallback (`memoryKV`), keys `stocks:bars\|quote\|news:…`. Fresh for / usable stale for: bars 1m 20 s / 1 d · 5m 45 s / 1 d · 15m 90 s / 2 d · 1h 5 min / 3 d · 1d 10 min / 7 d; quote 15 s / 6 h; news 5 min / 1 d; directory 12 h / 14 d. `prune`, `clear`. |
| `throttle.ts` | `createLimiter`: token bucket 40 requests / min, 2 in flight, back-off, abort – modelled on `src/market/budget.ts`. |
| `session.ts` | the New York calendar: DST rule, NYSE holidays and early closes (2026–2027 – `calendarKnown` says when a date lies outside), `sessionOf`, `currentTradingDay`, `isSessionOpen`, `regularOnly`, `isClosedBar`. Pure, no imports – the server functions import it by relative path. |
| `result.ts` | `ok`, `stale`, `unavailable`, `dataOf`, `stampOf`, `REASON_TEXT`. |
| `news.ts` | the news-source registry (below), `loadNews`, `summarize`. |
| `newsSources.ts` | **the extension point** – empty; the one file that imports extra news sources. |
| `scanSources.ts` | what the scanner reads candles from: `stockScanSource(mode, data)` (daily or 5-minute, New York session for the opening range) and the crypto client (`cryptoClient()`: Binance USDⓈ-M tickers → top-N by 24 h quote volume, klines with the same fallback via the EU proxy as the rest of the app, own budget of 100 requests / min). |

## Adding a news source (the SEC 8-K feed, later IR pages)

```ts
// src/market/stocks/newsSources.ts
import { registerNewsSource } from "./news";
registerNewsSource({
  id: "sec-edgar",                      // a StockSourceId
  label: "SEC EDGAR (8-K)",             // how the monitor names it
  load: async (symbols, { fresh, signal }) => ({ AAPL: ok(items, stamp), MSFT: unavailable("upstream", now) }),
});
```

A source answers one `StockResult` per ticker – with its own function, key and rate limit. The monitor merges the items (same link or
same headline = one story, with all tickers and all sources), shows each source's state (`ok / partial / stale / unavailable`, with
reason and time) and never hides a source that failed. Nothing else on the page changes.

## Rules that hold

- **Honest failures.** No server function (static host, offline file) → `no-server`; blocked or limited upstream → `blocked` /
  `rate-limited`; old data is `stale` with the reason, never silently shown as current.
- **Privacy.** The four functions get tickers, an interval and a range. No journal data, no settings, no account value. The share
  edition (`/teilen/`, `npm run build:share`) is the same app with a neutral journal: the stock code is in it, and so is the
  rule – nothing personal is in a request, and no personal string is in the code (the build's privacy guard checks that). The
  single-file builds have no server: the page says `no-server` ("Die Server-Funktionen für Aktien-Daten sind auf dieser Seite nicht eingerichtet.") and Krypto still works (it reads Binance directly).
- **Unofficial source.** Yahoo Finance's chart endpoint and RSS are unofficial; they may change or block at any time. The code treats
  every answer as untrusted input (zod, number checks, off-grid and out-of-session candles dropped).
- **No orders.** Nothing here can send an order; the app never does.

Tests: `tests/unit/stocks.client.test.ts` (typed results, cache and stale rules, batching, error mapping, throttle, news registry,
New York calendar), `tests/unit/stocks.server.test.ts` (the functions on fixtures of real answers), `tests/unit/scanner.sources.test.ts`
(stock and crypto scan sources). Fixtures: `tests/fixtures/stocks/` (README there: where and when each file was fetched).
