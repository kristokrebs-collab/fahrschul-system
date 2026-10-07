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

## "Top-Trader kaufen · Retail rot" (ours, `whale.ts`)

Additive condition (user requirement 2026-10-07): for a long, Binance top traders buy while retail is red; short mirrored.

| Piece | Rule |
|---|---|
| Inputs | per Binance futures-data period: `topLongShortPositionRatio` (top traders, positions) and `globalLongShortAccountRatio` (all accounts = retail) — the pair behind the Top-Trader card's `Top vs. Alle` delta |
| Period step | change between two consecutive snapshots = one closed period; joined by time, gaps break a run; newest snapshot older than 2 periods + 5 min → no data |
| Run | long: top-trader long % ↑ AND all-accounts long % ↓; short: top ↓ AND retail ↑; counted backwards from the newest period (like `Δ+ Kerzen`) |
| Holds | run ≥ `minRun` (default 2) on ANY configured period (default `30m`, `1h`) |
| Grading (`applyWhale`) | holds and `weight > 0` (default 10): score + weight (max 100) and a VALID entry + 1 strength (max 4, label follows); weight 0 = shown and stored only; the reason line `Top-Trader kaufen · Retail rot (2× 30m/1h)` is appended |
| No data | (off, source without top traders, older than Binance's ~30-day window) → no reading: the verdict is exactly the other journal's; the trade snapshot stores `whale: null` ("keine Daten") — never a fail |
| Settings | `settings.signals.whale = { on, periods, minRun 1…6, weight 0…30 }` (nested, so `DEFAULT_SIGNAL_CFG` stays the other journal's; `sanitizeSignalCfg` fills it, unknown keys kept; part of `signalCfgKey`). Draft strings for the settings page: `whaleDraft.ts` (`sgWhale`, `sgWhalePeriods`, `sgWhaleMin`, `sgWhaleWeight`) |
| Snapshot | `trade.signal.whale = { ok, run, need, period, topChg, retailChg, points, periods[{ period, top, retail, topChg, retailChg, run }] }` for the snapshot's side; old snapshots without the field stay valid |

Market side (live series, polling, retro ≤ 30 days): `src/market/signals/whale.ts`.

## TradingView calibration (2026-10-07)

`tests/unit/signals.tvCalibration.test.ts` + `tests/unit/fixtures/tv-bitstamp-btcusd.json` (BITSTAMP:BTCUSD, the user's screenshots):
RSI 14 / MA 14 and wt1 at the last bar (1h 34.95 / 29.61 / −49, 30m 42.86 / 30.53 / −28), every Bottom/Top label of the visible
windows, the cross dots (wt2 = SMA **2** of wt1; 3 or 4 shift them) and the LuxAlgo zone boxes match with the defaults (MCB
WeloTrades "close 9 1 21 1 60 53 2 −60 −53 2 28 …" = close source, channel 9, average 21, levels ±53/±60, reversal range 28).
The "Bull"/"Bear" labels with the cow / bear icons are WaveTrend divergences (not part of the check). Binance BTCUSDT perp vs Bitstamp
spot on the same windows: 30m 27 of 28 Bottom/Top/Kauf/Verkauf events on the same bar (signal flags differ on 6.4 % of bars, RSI-near
1.3 %, zone 1.7 %), 1h 35 of 36 (1.7 % / 0.8 % / 1.3 %).

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

`tests/unit/signals.whale.test.ts` (the whale condition on synthetic ratio series, grading, config, snapshots, draft strings),
`tests/unit/signals.whaleMarket.test.ts` (live / polled / retro on a fake provider), `tests/unit/signals.engine.test.ts` (parity with the reference: indicators, every `wtSignal` prefix, zones, verdicts over 7 config
variants × 6 seeds, snapshots, the retro fix), `tests/unit/signals.resample.test.ts` (alignment, aggregation, config, snapshot
parsing), fixtures in `tests/unit/signals.fixtures.ts`.

## Long/Short-Tendenz (ours, `bias.ts`)

Additive (user request 2026-10-07: "alle Bedingungen abgleichen … waagerechter Balken, ob eher Short oder eher Long").
`computeBias(signals, cfg, prevLevel?)` → `{ score −1 … +1, sum, limit, level, label, side, pct, percent ("64 % Long"),
valueText ("Eher Long, 64 %"), hold, valid, contributions[{ id, group, label, vote, weight, share, detail }], used, total }`
or `null` ("Keine Daten"). Imported directly (`@/domain/signals/bias`, not re-exported from the barrel). UI:
`views/overview/BiasBar.tsx` (top of the `SignalCard`, compact line in the `SignalStrip`, explainer on tap).

Every condition is read the way `verdict()` reads it, so the bar never argues with the check:

| Condition | Vote (−1 Short … +1 Long), both directions |
|---|---|
| MCB per rung | strongest event per direction in the lookback: `WT_RANK / 3` (Bottom/Top 1, Kauf/Verkauf ⅔, crosses ⅓) × `0.5^(barsAgo / signalLookback)`, long − short, + `0.3 ×` wave (½ wt1 position: −`wtOsStrong` … +`wtObStrong` → +1 … −1; ½ slope: wt1 − wt2 = ±6 → ±1), clamped. **Ladder gate** ("Leiter muss von unten durchgehend bestätigen"): an event counts fully only when every rung below has a signal of the same direction (`ladderTiers`), otherwise `BIAS_UNCONFIRMED` = ¼ (detail: "Bottom (unbestätigt)") |
| RSI 14 | on the check's head rungs (base + the rungs the ladder confirms, either direction): per rung ≤ `rsiOs + rsiNear` (40) +1, ≥ `rsiOb − rsiNear` (60) −1, linear in between (0 at 50); the row = strongest long reading − strongest short reading (the check: "some head rung near OS/OB") |
| Premium/Discount | the check's zone reference: the `zoneTf` check, or the 30m base when that timeframe has too few bars (`verdict`'s `zoneRef`); position in the range: 0 → +1, 47.5 … 52.5 % → 0, 1 → −1 (linear) |
| Top-Trader kaufen · Retail rot | per period: run ≥ `minRun` → ±1, both readings the same way over the window without a full run → ±0.75, one side only → ±0.5, opposite → 0; mean over the periods. Row title by the vote's side; "Top-Trader vs. Retail" at 0 / no data (detail then shows both runs) |

- Weights = the check's score points: MCB 65 (ladder 55 + Bottom/Top 10) split EQUALLY over the rungs (the score gives
  55 / n per confirmed rung), RSI 20, zone 15, whale = `settings.signals.whale.weight` (10; 0 = row shown, never
  counted). Optional override `settings.signals.bias = { mcb, rsi, zone, whale }` (0 … 100; `sanitizeSignalCfg` keeps
  the unknown key, `sanitizeBiasCfg` reads it; `DEFAULT_BIAS_CFG`). No settings UI yet. The bar reads the weights LIVE
  from the journal settings (`useLiveBiasCfg`): the engine keeps its config and re-uses the snapshot while only weights
  change, so the snapshot's `cfg` alone would hold an override back until a reload.
- Missing data (rung "Zu wenig Kerzen", no zone, whale off / no Binance data) is EXCLUDED from the weighted mean, never
  a neutral vote; nothing left (or all weights 0) → `null`.
- Consistency with the verdict (`sig.long` / `sig.short`, recomputed with `verdict()` for hand-built input): when only
  one side is a valid entry, a sum pointing the other way is shown as 0 (`limit.kind = "entry"`); "Stark" needs a valid
  entry on that side, otherwise the score stops at `BIAS_STRONG_CAP` (0.48 = 74 %) and the label at "Eher"
  (`limit.kind = "strong"`). `sum` keeps the unlimited weighted mean (= Σ `contributionImpact`). On 25 120 random-walk
  evaluations (8 seeds, real engine) the gate alone gives 0 sums against a valid entry (was 73) and 8 Neutral on 3 476
  valid entries (was 269); the `entry` limit is a safety net.
- Labels: |score| < 0.15 Neutral, < 0.5 Eher, else Stark (symmetric; = 57.5 % / 75 % of one side). `biasLevel(score,
  prev)` holds the previous level while the score stays within ±0.05 (2.5 %) of its interval (no label flicker at a
  boundary); `computeBias(…, prevLevel)` applies it, the bar carries the previous level from one published evaluation
  to the next, and `hold` ("gehalten: wechselt erst unter 55 %") explains a held label in the explainer.
- Explainer rows: `Gewicht 16 % → +0,16` — shares and contributions rounded with `roundToSum` (largest remainder), so
  the shares add up to exactly 100 % and the contributions to exactly the shown sum; the sum line names a limit
  ("begrenzt auf ±0,00 (gültiger Short-Einstieg im Check: zeigt nicht Long)") or the hysteresis hold.
- Symmetry: a mirrored evaluation gives exactly the negated score (unit test). On the mirrored synthetic market the
  MCB and RSI votes mirror exactly; the zone does not quite (the ported LuxAlgo swing logic finds no pivot on the
  mirror image and falls back to the 120-bar range).
- Bar (`BiasBar`): one MotionValue (`useRevealValue`: springs out of the centre on first view) drives needle, gradient
  fill (centre → needle, scaleX) and halo; the spring is `contextSpringAt(spring.smooth, smoothstep(0.08, 0.6, |Δscore|))`
  (drift: the token itself; swing: shorter with a little bounce); renders ≤ 1/s (published check); reduced motion: jumps.
  `role="meter"` (−100 … 100, `aria-valuetext`) beside the `MorphCard` button (`Long/Short-Tendenz: … Bedingungen
  ansehen`); the strip line is `aria-hidden` (the strip itself is a button; its accessible name is unchanged).
- Tests: `tests/unit/signals.bias.test.ts` (incl. random markets: never opposite a valid entry, "Stark" only with one),
  `tests/unit/views.overview.bias.test.tsx`, `tests/e2e/bias.spec.ts` (long setup from `mocks/synth.ts`, short setup =
  the same price path mirrored around the live price).
