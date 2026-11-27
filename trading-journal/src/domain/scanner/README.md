# `src/domain/scanner` – chart scanner kernel (F67)

Reads candles and lists the charts that **match a rule**. Pure TypeScript, no React, no network, no clock of its own
(`now` is passed in). The kernel is market-neutral: it never knows a venue. A caller hands over a `ScanSource` (how to load a
batch of charts) and the list of targets; US stocks (`src/market/stocks`) and crypto (Binance klines) run through the same rules.
The wording is always "matched a rule", never "buy"; the kernel never prints a profit or a score of quality.

```ts
import { runScan, defaultParamsFor, stockUniverse } from "@/domain/scanner";
const outcome = await runScan({ source, targets, params, setups: ["flag", "rsi"], signal, onProgress, now: Date.now });
outcome.hits;                       // Hit[] – symbol, setup, side, reason (one sentence with the numbers), checks, levels, preview candles, stand
outcome.requested / scanned / skipped / failed / errorRate;   // counted from what happened, never estimated
outcome.skippedBy / failedBy;       // per reason; `failures` (≤ 200) with the symbol and the message; `stale` = answered from an old cache
```

## The rules (`setups.ts`) – and the parity with the skill

| setup | reads | rule (all thresholds visible and adjustable in the UI; defaults in `types.ts`) |
|---|---|---|
| `orb` Eröffnungsspanne | intraday candles of one session (5 min for stocks, 15 min for crypto) | high / low of the first `orMinutes` (15; 60 for crypto) of the session; a breakout is the first **complete bar that closes** beyond the edge (`minBreak` distance, optional `minRelVolume`, `latestMinutes` after the open, `stillBeyond` = the last bar must still be beyond). Needs gap-free bars (a halt or a thin stock is skipped as `gaps`, not guessed). Long, short or both. |
| `flag` Flagge | daily closes | a pole of `poleBars` (10) closes that gained **more than** `poleMinGain` (10 %), then a flag of `flagBars` (5) closes whose (high − low) / last close stays **under** `flagMaxRange` (5 %). Same arithmetic as `find_setups` of the trader-scanner skill (read, not executed). |
| `rsi` Überverkaufte Erholung | daily closes | Wilder RSI(`length` 14) was under `level` (30) on the bar before and the last bar closed higher (`requireBounce`; off = RSI under the level now). The RSI is `rsi` from `domain/signals/indicators`. |

Rules use **complete bars only** (`closed !== false`); a forming bar is never read. A rule that cannot run (too few bars) does not hide the others.

## Pre-filter (`prefilter`) – why a chart is left out before a rule runs

`minPrice` (5), `minVolume` (1 M: the last complete daily bar, or the session so far for intraday), only normal Nasdaq financial status
(`N`), `minBars` (30) and `maxAgeDays` (7: a halted or delisted name drops out). Each skipped chart is counted with its reason (`SKIP_TEXT`).
Crypto starts with `minPrice 0 / minVolume 0 / no status / maxAgeDays 3` (`defaultParamsFor`).

## Parts

| file | what |
|---|---|
| `types.ts` | `ScanCandle`, `ScanParams` (+ `DEFAULT_PARAMS`, `PARAM_LIMITS`), `Hit`, `Stand` (source, newest candle, `receivedAt`, stale reason **per row**), `SKIP_TEXT`, `SETUP_NAME`. |
| `setups.ts` | the three rules; each returns a `Hit` with `reason`, `checks` (every condition that held, in words with its number and the threshold), `levels` and `marks` for the preview chart. |
| `scan.ts` | `prefilter`, `scanSymbol` (one chart), `sanitizeParams` (bounds from `PARAM_LIMITS`; a stored or typed value never breaks a rule), `rankHits` / `RANK_NAME` (turnover, the setup's own number, or A–Z – a rank is a position in the chosen sorting, not a grade). |
| `run.ts` | `runScan`: batches, **time slices** (12 ms, then yield – the page stays scrollable and the cancel button works; a worker would only add a copy of every candle), progress after every batch, `AbortSignal` (an aborted run returns what it found, `status: "aborted"`), `HARD_CAP` 400 charts per run, counts of scanned / skipped / failed / stale and the error rate. |
| `universe.ts` | what to scan: `stockUniverse` (directory in blocks of `cap` – default 100, 10–400 –, the watchlist, or typed tickers; invalid ones are listed, unlisted ones scanned anyway), `cryptoTargets` (USDT perpetuals by 24 h quote volume, no delivery contracts, cross pairs or dead markets), `clampCap`, `parseTickers`, `defaultParamsFor(kind, mode)`. |
| `describe.ts` | `describeRule` / `describePrefilter`: the rule as a sentence with the current numbers – what the UI prints next to the start button. |
| `text.ts` | number and time formatting (de-DE), shared by the reasons. |

## Honesty rules (they hold in the UI too)

- **No fake universe.** The list comes from the directory or the watchlist; if the directory cannot be loaded the scan does not start and the reason is shown.
- **Counts are counts.** `requested = scanned + skipped + failed`; the error rate is `failed / requested`; a chart served from an old cache is counted as stale and its row says so.
- **A cap, said out loud.** One run reads at most 400 charts; "Block 3 von 41" says which part of the directory it was.
- **A hit is old as soon as the price moves.** Every row shows source, the newest candle and when it was fetched.

Tests: `tests/unit/scanner.kernel.test.ts` (rules on hand-built candles, boundaries, gaps, pre-filter, ranking, run loop, abort, failures),
`tests/unit/scanner.sources.test.ts` (universe, stock and crypto sources), `tests/unit/scanner.reference.test.ts` (our RSI against TradingView's on 250 real AAPL closes, deviation < 0.05), UI `tests/unit/views.aktien.test.tsx`, e2e `tests/e2e/aktien.spec.ts`.
