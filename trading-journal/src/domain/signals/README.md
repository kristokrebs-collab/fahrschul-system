# `src/domain/signals` — the "Einstiegs-Check" engine (pure)

Core = 1:1 port of the other journal's `signals.ts` (branch `origin/claude/dreamy-dirac-uwi1be`, `trading-journal/app/src/signals.ts`,
md5 `7307704c…`). Same formulas, same operation order: the unit tests compare every function bit for bit against a verbatim
copy (`tests/unit/reference/otherSignals.js`). No React, no I/O. Live data, retro history, notifications and chart data
live in `src/market/signals` (exported from `@/market`).

On top of the core (ours, user decisions 5, 6, 9, 10, 11 of 2026-10-08 — see [§ v2](#v2-candle-close-states-graded-parts-falling-knife-filter-2026-10-08)):
candle-close states (vorläufig / bestätigt / stark bestätigt), the graded Top-Trader-Kombi, divergences, market structure +
support/resistance, the falling-knife filter, their bias rows and snapshot fields. `verdict()` / `bestVerdict()` stay the raw
1:1 core; `computeSignals()` grades on top of it.

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

## "Top-Trader kaufen · Retail rot" (legacy run rule, `whale.ts`)

Superseded on 2026-10-08 by the graded Top-Trader-Kombi (decision 5, § v2): the live engine no longer polls the 30m/1h series
nor grades with this rule. Kept, pure and tested, so stored values and old snapshots stay readable: `whalePeriod`,
`whaleReading`, `whaleVerdict`, `applyWhale` (still grades a `Signals` when called by hand), `WHALE_TITLE`, the settings-draft
helpers (`whaleDraft.ts`: `sgWhale`, `sgWhalePeriods`, `sgWhaleMin`, `sgWhaleWeight`), `settings.signals.whale.periods /
minRun`, and `trade.signal.whale` (`{ ok, run, need, period, topChg, retailChg, points, periods[] }` or `null` = keine Daten).
New snapshots carry the combo in `parts` instead and leave `whale` out.

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

`tests/unit/signals.engine.test.ts` (parity with the reference: indicators, every `wtSignal` prefix, zones, checks projected onto
the reference fields + the raw verdicts over 7 config variants × 6 seeds, snapshots, the retro fix; with every candle closed and
the parts off the graded evaluation keeps the reference's fields exactly), `tests/unit/signals.v2.test.ts` (candle-close states,
divergences, structure vs a naive LuxAlgo leg reference and `luxZone`, Top-Trader-Kombi, parts, grading, knife filter, bias rows,
snapshots, config keys, determinism, performance), `tests/unit/signals.tradersMarket.test.ts` (live 5-min reading / retro on a
fake provider), `tests/unit/market.signals.test.ts` (live pipeline, cadence, chart data, notifications),
`tests/unit/signals.whale.test.ts` (legacy run rule, config, info panel), `tests/unit/signals.resample.test.ts` (alignment,
aggregation, config, snapshot parsing), `tests/unit/signals.tvCalibration.test.ts` (TradingView screenshots), fixtures in
`tests/unit/signals.fixtures.ts`.

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
| Top-Trader-Kombi (`traders`) | long grade − short grade (met / 4 per side: positions, accounts, retail, zone); title by the leading side, "Top-Trader-Kombi" at 0 / keine Daten. A hand-built input with only a legacy `whale` reading (no `traders` key) still gets the old run-rule row (`whale`) |
| Divergenzen (`div`) | long grade − short grade of the divergence part (best rung; provisional ½) |
| Support / Widerstand (`sr`) | long grade − short grade of the S/R part (near the level + room to the next one) |
| provisional | an MCB event on the forming candle counts `PROVISIONAL_FACTOR` (½): `max(closed event, forming event × ½)`; the row gets `provisional: true` and the detail "vorläufig". `Bias.state` = the candle-close state of the leaning side's entry |

- Weights = the check's score points: MCB 65 (ladder 55 + Bottom/Top 10) split EQUALLY over the rungs (the score gives
  55 / n per confirmed rung), RSI 20, zone 15, the parts their own weight (`whale.weight`, `div.weight`, `sr.weight`, 10;
  0 = row shown, never counted). Optional override `settings.signals.bias = { mcb, rsi, zone, whale, div, sr }` (0 … 100;
  `whale` = the Top-Trader-Kombi; `sanitizeSignalCfg` keeps the unknown key, `sanitizeBiasCfg` reads it;
  `DEFAULT_BIAS_CFG`). No settings UI yet. Row order: `mcb-<tf>` × n, `rsi`, `zone`, `traders`, `div`, `sr`. The bar reads the weights LIVE
  from the journal settings (`useLiveBiasCfg`): the engine keeps its config and re-uses the snapshot while only weights
  change, so the snapshot's `cfg` alone would hold an override back until a reload.
- Missing data (rung "Zu wenig Kerzen", no zone, whale off / no Binance data) is EXCLUDED from the weighted mean, never
  a neutral vote; nothing left (or all weights 0) → `null`.
- Consistency with the verdict (`sig.long` / `sig.short`, recomputed with `verdict()` + `confirmVerdict()` for hand-built
  input; `valid` = a CONFIRMED entry since decision 6, so a provisional entry never makes the bar "Stark"): when only
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

## v2: candle-close states, graded parts, falling-knife filter (2026-10-08)

User decisions 5, 6, 9, 10, 11 (`…/scratchpad/merge/decisions.md`). All pure and deterministic; a full check (4 rungs × 500
bars, every part on) takes ≈ 2 ms (budget < 5 ms, `signals.v2.test.ts`), the live engine runs it ≤ 1/s.

### Evaluation pipeline

```ts
computeSignals(bars, cfg, now = Date.now(), { traders }?)   // → Signals | null
//   checks  = ladder.map(tf => checkTf(tf, bars[tf], cfg, now))      reference fields + forming/closesAt/msToClose/conf/div/structure
//   raw     = bestVerdict(checks, cfg, zone)                         the 1:1 core (unchanged)
//   graded  = gradeSignals({ checks, zone, at, ...raw }, cfg, traders)
//             = confirmVerdict (candle-close rule) → parts (traders, div, sr) → knife filter
signalsAt(bars, cfg, atMs, now, { traders }?)              // back-dated: closed bars only → never provisional
regradeSignals(sig, cfg, traders)                           // same checks, another Top-Trader reading (retro)
```

`SignalInputs = { traders?: TraderReading | null }`. `Signals` gains `traders?: TraderReading | null` (null = on, no data) and
`knife?: { long: KnifeFilter; short: KnifeFilter }`. Every new field is optional in the types (hand-built checks stay valid;
absent = closed / none) and always set by `computeSignals` / `signalsAt`.

### Candle-close state (decisions 6 + 9, `state.ts`)

`type SignalState = "none" | "provisional" | "confirmed" | "strong"` — German `STATE_TEXT`: kein Signal · vorläufig · bestätigt ·
stark bestätigt.

| level | rule |
|---|---|
| rung (`TfCheck.conf[side]: RungConf`) | the MCB events of the `signalLookback` window (same window and conditions as `wtSignal`): an event on the FORMING candle → `provisional`; on a CLOSED candle → `confirmed`; still lit after `strongCloses` closes counted from the signal candle's own close (default 2, `settings.signals.strongCloses` 1 … 6) with the move held (long: no later close below the signal candle's low; short: none above its high) → `strong`. A closed event decides over a forming one. `RungConf = { state, event, closes, held, closed, forming }` |
| rung timing | `TfCheck.forming` (last bar = running candle at `now`), `closesAt` (ms close of the last bar), `msToClose` (at the evaluation; render countdowns from `closesAt` on the shared clock — never re-render per second). Without `now` every bar counts as closed |
| verdict (`confirmVerdict`) | `state`: `none` (entry rule does not hold) · `provisional` (holds, base signal on the forming candle) · `confirmed` (the 30m base candle closed with the signal) · `strong` (base signal strong). Higher rungs keep their own state in `rungStates[]`; `confTiers` = consecutive confirmed rungs |
| counting | `valid` only when confirmed/strong. Provisional entry: `valid` false, `strength` 0, `provStrength` = the strength it gets on the close, `label` = `Vorläufig: <label>` (`PROVISIONAL_PREFIX`), `closesAt` = the base candle's close. Score: a provisional rung inside `tiers` counts `PROVISIONAL_FACTOR` (½) of its 55 / n. Nothing forming → the reference fields are exactly `verdict()`'s |
| chart | `eventState(bars, index, long, forming, strongCloses)` per marker; `@/market` `getMcbSeries` markers carry `state` |
| text | `stateText(state, msToClose?)`, `provisionalText(ms)` → `vorläufig · schließt in 12:04`, `mmss(ms)` |

### Graded parts (`parts.ts`) — `Verdict.parts: GradedPart[]`, `Verdict.partPoints`

One shape for the scorecard: `GradedPart = { id: "traders" | "div" | "sr", side, label, grade 0…1, points, weight, ok, bonus,
state, data, items: PartItem[], detail, tf?, met?, reading?, hits?, levels? }`, `PartItem = { id, label, value (German), raw:
number | null, met: boolean | null (null = keine Daten) }`.

- points = weight × grade (0 without data); score = round(min(100, confirmed score + Σ points)).
- `ok` = the part holds fully; `bonus` = ok with weight > 0 → +1 strength for a valid entry (max 4; a provisional entry's
  `provStrength` likewise). One reason row per part is appended (`partReasonText`, ✓ = `ok`).
- `data: false` (switched on, no inputs) → excluded from score and bias, shown "keine Daten" — never a fail.

| part | long (short mirrored) | grade | ok |
|---|---|---|---|
| `traders` Top-Trader-Kombi (`traders.ts`, decision 5) — title `Top-Trader long · Retail rot` / `Top-Trader short · Retail grün` | items `pos` top traders by POSITION long share > `topPct` (64 %; short: ≤ 100 − topPct = > 64 % short) · `acc` top traders by ACCOUNT likewise · `retail` all-accounts long share FALLING vs one `retailPeriod` earlier (5m, default; 15m · 30m · 1h) = Retail rot (short: rising = grün) · `zone` price in Discount on the check's zone reference (short: Premium). Values `66,0 % Long`, `−0,5 pp`, `Discount · 20 %` | met / 4 | ≥ `bonusParts` (3) met |
| `div` Bullische / Bärische Divergenz (`divergence.ts`, decision 10) | one item per ladder rung: active divergences of that side (`RSI regulär · WT versteckt`) | best rung: regular 0.8, hidden 0.5, + 0.2 when RSI and wt1 both show one, provisional ½ | grade ≥ 0.8 (a closed regular one) |
| `sr` Support + Platz nach oben / Widerstand + Platz nach unten (`structure.ts`, decision 10) | `near`: nearest support / demand below the close within `nearAtr` (1) ATR 14 · `room`: R = distance to the next resistance / (close − stop), stop = the level's bottom − 0.1 ATR; ≥ `minR` (2) R; no resistance = free | ½ near (fades to 0 at 2 × nearAtr) + ½ min(1, R / minR) | near AND room |

`TraderReading = { at, position, account, retail, retailPrev, retailChg, period, step }` (`traderReading(series, cfg, atMs)`,
`TraderSeries = { position, account, retail: RatioSample[]; step? }`; only points ≤ atMs; a series whose newest point is older
than 2 steps + 5 min has no value; a coarser fallback series sets `step`). Settings `settings.signals.whale = { on, weight (0 …
30, default 10), topPct (50 … 90, 64), retailPeriod, bonusParts (1 … 4, 3), periods / minRun (legacy) }`.

### Divergences (`divergence.ts`)

MCB / WeloTrades style: oscillator fractals (`left` 2 bars lower/higher before, `right` 2 not lower/higher after; known `right`
bars later = the confirmation bar), compared with the previous pivot of the same kind `rangeMin` … `rangeMax` (3 … 60) bars
earlier; `midline` (on): bullish pivots below 50 (RSI) / 0 (wt1), bearish above. Regular bullish = price (bar low) lower low +
oscillator higher low; hidden bullish = price higher low + oscillator lower low; bearish mirrored (bar highs). State:
provisional while the confirmation bar forms, confirmed after its close, strong after `strongCloses` closes with the pivot held
(bullish: no later close below the pivot low). `active` = held and confirmed at most `maxAge` (5) bars ago.
`Divergence = { osc: "rsi" | "wt", kind: "regular" | "hidden", dir: 1 | -1, from / to: { index, t (s), price, osc }, at, barsAgo,
state, held, active }`; `TfCheck.div = { all (oldest first, chart lines), long, short (active, newest first) }`.
Settings `settings.signals.div = { on, rsi, wt, hidden, left, right, rangeMin, rangeMax, maxAge, midline, weight }`.

### Market structure + support / resistance (`structure.ts`)

LuxAlgo Smart Money Concepts as on the user's chart: swings with `swingLookback` (50, the same leg logic as `luxZone`; its
swing breaks and trend equal `luxZone`'s `brk` / `bias` — tested), internal structure with `sr.internal` (5); labels HH / LH /
HL / LL; BOS / CHoCH on a close across the last swing / internal pivot (internal only when it differs from the swing pivot);
order blocks ("Atr" filter: bars with range ≥ 2 × ATR 200 skipped; "High/Low" mitigation; newest 5 internal + 5 swing kept);
EQH / EQL (`eqLen` 3 pivots within `eqThreshold` 0.1 × ATR 200). Levels = unbroken pivots, unmitigated blocks, unbroken EQH/EQL
and the premium/discount range → `supports` / `resistances` (nearest first, ≤ 4, merged within 0.1 ATR), `dist` / `distAtr`
(ATR 14). `Structure = { swings, breaks, obs, eqs, trend, itrend, supports, resistances, support, resistance, atr, close, last }`
on every `TfCheck.structure` (when `sr.on`). O(n) (rolling extremes). Settings `settings.signals.sr = { on, internal, eqLen,
eqThreshold, nearAtr, minR, weight }`.

### Falling-Knife-Filter (`knife.ts`, decision 11)

`knifeFilter(sig, cfg, side = "long") → { side, items: KnifeItem[3], n, total: 3, all, data, label: "2 von 3 erfüllt" }`,
`KnifeItem = { id, label, met: boolean | null, detail, tfs }`; also on `Signals.knife.long / .short`. Same evaluation as the
Einstiegs-Check (single source of truth). The former "Preis in Support-/Liquiditätszone" item is removed.

| id | met (long; short mirrored) |
|---|---|
| `structure` Erstes Higher Low oder BOS auf 1H/4H | on 1h or 4h (`KNIFE_TFS`): the newest internal low is the first HL after an LL and unbroken, OR the newest break is bullish (BOS / CHoCH, internal or swing) and ≤ `KNIFE_BREAK_MAX_AGE` (20) bars old |
| `divergence` RSI bullische Divergenz | an active REGULAR bullish RSI divergence on a closed candle on any ladder rung (WT / hidden listed in `detail` only) |
| `whale` Whale-vs-Retail-Delta | the Top-Trader-Kombi's own items: (positions OR accounts > topPct) AND retail red; `null` without a reading |

Copy: `KNIFE_TITLE`, `KNIFE_INFO` (filter = safety check for macro longs, Einstiegs-Check = trigger, same live data).

### Snapshot (`trade.signal`) additions

`state`, `confTiers`, `provStrength`, `partPoints`, `parts: SignalSnapshotPart[]` (`{ id, grade, points, weight, ok, data,
state, items: [{ id, met, raw }], met?, period?, tf?, hits?, lean?, target?, r?, free? }`), `knife: { n, items: [{ id, met }] }`,
per `tfs` entry `state`, `closes`. A provisional live snapshot stores `valid: false`, `strength: 0`, `state: "provisional"`,
`provStrength`. `parseSignalSnapshot` keeps old snapshots unchanged (no `state` → `snapshotState(s)` = `null`), drops invalid new
fields, keeps unknown keys. `snapshotPart(p)` = the stored form of a part.

### Market side (`@/market`, `src/market/signals`)

- `useSignalCheck()` / `getSignalSnapshot()` → `LiveSignals` with everything above (evaluated with `now` = device time; the
  Top-Trader reading on the Binance clock). Identity changes only when a shown value changes (`signalsKey` covers states,
  parts, knife; not the countdown).
- Top-Trader-Kombi live: the provider's 5-min twins (`topPositionRatio5m`, `topAccountRatio5m`, `globalAccountRatio5m`) through
  the data layer's `deriveTraderSeries` (`src/market/traders.ts`) — the same points as the Top-Trader card; Binance / proxy only.
  `liveTraders(p, cfg)`, `liveTraderSeriesOf(p)`, `tradersInputKey(p, cfg)`. Retro `tradersAt(p, cfg, t, now)`: the live ring
  (24 h), else one `provider.fetchRatios(kind, "5m", { endTime: t, … })` page per series (memoised per minute, retried after a
  failure); > ~30 days → `null`. The former 30m / 1h run-rule polling is gone.
- `checkTradeAt` / `retroCheck`: closed bars only (never provisional) + `tradersAt`.
- Notifications: only valid = confirmed entries; dedupe key = the base signal's own bar (`signalBarOpen(sig, side)`), so a
  signal never repeats while it stays lit; text `signalNotifyDetail` (`Sehr stark · 2 von 4 Timeframes · bestätigt ·
  Top-Trader 3/4 · Divergenz 1h`); the 60 s hold guard stays.
- Chart data (pull, compute on demand from the check's bars): `getMcbSeries(interval, { minor?, bars? })` → `McbMarker { time
  (ms), kind, live, state }`; `getDivergences(interval, { bars?, recent? })` → `ChartDivergence { osc, kind, dir, from / to:
  { time (ms), price, osc }, confirmedAt, barsAgo, state, active }[]` (oldest first; `[]` when `div.on` is off);
  `getStructure(interval, { bars? })` → `ChartStructure { swings, breaks (pivotTime), obs (breakTime), eqs, supports,
  resistances, support, resistance (ChartLevel: Level with `time` ms, `null` for the range), trend, itrend, atr, close }`.
