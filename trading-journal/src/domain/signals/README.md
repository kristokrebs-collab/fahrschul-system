# `src/domain/signals` — the "Einstiegs-Check" engine (pure)

1:1 port of the other journal's `signals.ts` (branch `origin/claude/dreamy-dirac-uwi1be`, `trading-journal/app/src/signals.ts`,
md5 `7307704c…`). Same formulas, same operation order: the unit tests compare every function bit for bit against a verbatim
copy (`tests/unit/reference/otherSignals.js`). No React, no I/O. Live data, retro history, notifications and chart markers
live in `src/market/signals` (exported from `@/market`).

```ts
import { computeSignals, sanitizeSignalCfg, parseSignalSnapshot, toSignalSnapshot, DEFAULT_SIGNAL_CFG, STRENGTH_LABEL } from "@/domain/signals";
```

## What it computes

| Piece | Rule |
|---|---|
| WaveTrend (MCB "close 9/21/2") | `esa = ema(src, 9)`, `de = ema(|src − esa|, 9)`, `ci = (src − esa)/(0.015·de)`, `wt1 = ema(ci, 21)`, `wt2 = sma(wt1, 2)`; EMA seeded with the first value |
| MCB events (`wtSignal`) | over the last `signalLookback` (3) bars incl. the running one: **Bottom/Top** = wt1 and close turn out of a new `revRange` (28)-bar low/high; **Kauf/Verkauf** (`buy`/`sell`) = wt1 crosses wt2 at ≤ −53 / ≥ 53; small crosses `bull`/`bear` only on the right side of zero. Strongest per direction: bottom/top 3 > buy/sell 2 > bull/bear 1 |
| RSI | Wilder (`ta.rsi`), 14; `rsiLong = rsi ≤ rsiOs + rsiNear` (≤ 40), `rsiShort = rsi ≥ rsiOb − rsiNear` (≥ 60); `rsiMa = sma(rsi, 14)` (display) |
| Premium/Discount (LuxAlgo) | `luxZone`: swing pivots of size `swingLookback` (50), trailing extremes since the last pivot, BOS/CHoCH; fallback `pdZone` (range of the last 120 bars). `discount` < 47.5 % ≤ `equilibrium` ≤ 52.5 % < `premium`; `deep` = outer 5 % (the LuxAlgo boxes) |
| `checkTf` | `null` below 150 bars ("Zu wenig Kerzen") |
| Ladder `verdict` | `tiers` = consecutive confirming rungs from the base (30m → 45m → 1h → 4h); `valid = tiers ≥ required (2) && rsiOk` (RSI mandatory); `strength = valid ? min(4, 1 + min(2, tiers − required) + zoneOk) : 0`; `score = round(min(100, tiers/n·55 + rsiOk·20 + zoneOk·15 + strongSignal·10))` |
| Labels | `STRENGTH_LABEL = Kein Signal · Einstieg · Stark · Sehr stark · Maximal`; verdict labels and reasons exactly as the other journal (`Starker Long-Einstieg`, `Long-Signal, RSI noch nicht überverkauft`, `Long: nur 30m bestätigt`, …) |

## Deliberate differences (bug fixes)

1. **Back-dated check** — `signalsAt(bars, cfg, atMs, now)` returns `null` when any ladder rung or the zone timeframe has fewer than
   150 closed bars at `atMs` or ends more than one bar before it. The other journal returned a "strength 0 / Kein Signal" verdict
   there and stored it on trades (polluting "Ergebnis nach Signal-Stärke").
2. **45m** — the other journal asked TradingView for `45m`, which the connector does not serve (the ladder broke at rung 2). Here
   45m (and 30m, 2h, 3h) are resampled exactly (`resampleBars`) from smaller bars.
3. **Config** — `sanitizeSignalCfg` sorts and de-duplicates the ladder, drops rungs below 30m and unknown timeframes, clamps
   `required` to `1..ladder.length`, falls back to the defaults for non-finite numbers (the other settings page saved
   `wtChannel ?? 10`, `wtSignal ?? 4`, `swingLookback ?? 120`). Unknown keys are kept.

## Resampling / alignment

`bucketOpen(t, sec)`: TradingView builds intraday bars of 24/7 crypto symbols from the session start 00:00 UTC. For every length
that divides a day (30m, 45m, 1h, 2h, 3h, 4h) this equals `floor(t/sec)·sec`; other lengths restart at midnight.
`resampleBars(bars, srcSec, sec)`: o = first, h = max, l = min, c = last, v = sum; a leading partial bucket is dropped, the last
(running) bucket is kept. `withLivePrice` completes the running bar with the live price (1:1 port).

## Stored snapshot (`trade.signal`)

`SignalSnapshot` = the other journal's `SignalSnap` (`at, side, score, strength, tiers, label, valid, rsiOk, zoneOk, zone, deep,
tfs[{tf, kind, wt, rsi}]`) plus optional extras: `v: 2`, `mode: "live" | "retro"`, `ladder`, `required`, `zoneTf`, `zonePos`,
`symbol`, `source`, per `tfs` entry `barsAgo`, `ok`, `rsiNear`. Both apps read each other's snapshots.

- `toSignalSnapshot(signals, side, cfg, meta)` — build one (the market layer's `checkTradeAt` / `toTradeSnapshot` do this).
- `parseSignalSnapshot(unknown)` — read a stored value (theirs or ours): normalised copy, unknown keys kept, numeric strings
  accepted, missing label derived from the strength; `null` for anything that is not a snapshot.
- `snapshotLadderLength(s)` — `n` for "x von n Timeframes" (theirs had no ladder: 4).
- `mtfAutoChecks(s)` — auto-ticks of the `s_mtf` checklist (`mtf_base` tiers ≥ 1, `mtf_next` ≥ 2, `mtf_third` ≥ 3, `mtf_rsi`, `mtf_zone`).

## Chart markers

`mcbEvents(wt1, wt2, cfg, close)` / `mcbSeries(bars, cfg, { minor })` — every MCB event bar by bar, with the same conditions as
the check (`minor` adds `bull`/`bear`). The live variant with ms times is `getMcbSeries(interval)` in `@/market`.

## Copy (`copy.ts`)

German strings of the card / form: `KIND_TEXT`, `kindText`, `isStrongKind`, `roleText`, `ageText`, `strengthText`,
`strengthLine`, `ZONE_TEXT`, `zonePillText`, `zoneFooterText`, `signalInfo(cfg, symbol)` (info panel adapted to Binance),
`TOO_FEW_BARS`, `LOADING_TEXT`, `OFFLINE_TEXT`, `STALE_TEXT`, `RETRO_LOADING`, `RETRO_EMPTY`, `DATA_SOURCE_NOTE`.

## Tests

`tests/unit/signals.engine.test.ts` (parity with the reference: indicators, every `wtSignal` prefix, zones, verdicts over 7 config
variants × 6 seeds, snapshots, the retro fix), `tests/unit/signals.resample.test.ts` (alignment, aggregation, config, snapshot
parsing), fixtures in `tests/unit/signals.fixtures.ts`.
