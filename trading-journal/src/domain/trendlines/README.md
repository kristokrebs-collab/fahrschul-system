# `src/domain/trendlines` – Preis- und RSI-Struktur über Zeiteinheiten (F05)

Pure TypeScript, no React, no I/O. The live side (candles of each timeframe, store) is `src/market/trendlines`, the card is
`src/views/markt/TrendStructureCard.tsx`, the chart layer `src/chart/primitives/TrendlinePrimitive.ts` +
`src/views/markt/chartTrendlines.ts`.

```ts
import { analyzeTrendlines, describeLine } from "@/domain/trendlines";

const a = analyzeTrendlines(candlesOf4h, "4h", now);   // candles of the timeframe's OWN feed, closed ones are picked
a.price.down.active   // Abwärtstrendlinie (through falling pivot highs), unbroken – or null
a.price.down.broken   // the same kind, recently broken – with its retest
a.rsi.up.active       // Aufwärtstrendlinie of the RSI …
describeLine(view)    // { phase, tone, title, detail } in German
```

## What it is

The algorithm of the RSI trendlines of the box engine (`../boxes/rsiLines.ts`: pivots with `L` left / `R` right bars, the
newest 14 pivots paired, a line must not be crossed between its points, touches, a score) **generalised** so one engine
(`engine.ts`) runs on two series, plus the retest the old code did not have. `rsiLines` itself is untouched (the box
store, the old „RSI-Trendlinien“ card and the alerts still use it).

| | Price | RSI |
|---|---|---|
| `down` – Abwärtstrendlinie | through falling pivot **highs** | through falling RSI pivots |
| `up` – Aufwärtstrendlinie | through rising pivot **lows** | through rising RSI pivots |
| pairs / between points | closes must not lie more than `0.15 ATR` beyond the line | `1.2` points |
| break | a CLOSE more than `0.1 ATR` beyond the line | `0.6` points |
| touch (counts into `touches`) | a pivot within `0.4 ATR` of the line | `1.92` points |
| retest tolerance | `0.4 ATR` | `1.5` points |
| approach (Annäherung) | unbroken, newest close within `1 ATR` of the line | `3` points |
| minimum slope | `0.03 ATR` per bar (a flat pair is a level, not a trendline) | `0.02` points per bar |

All numbers are `DEFAULT_TRENDLINE_CFG` (`types.ts`). ATR = Wilder ATR(14) **at the bar in question** (a tolerance never
borrows a later bar's ATR; no pivot before bar 15). Price lines are straight in linear price (no log scale).

## Three separate facts per line

- **Annäherung** (`view.approach`, `dist`, `distPct`, `distAtr`): an unbroken line and the distance of the newest close.
- **Bruch** (`view.brk`: `at`, `age`, `fresh`): the first CLOSE beyond the line. A wick through the line is no break.
  `fresh` for `maxAge` (8) candles; a broken line stays in the report for `keepBars` (30).
- **Retest** (`view.retest.state`): after the break, the price first closes clear of the line (further than the retest
  tolerance), then comes back and a wick (RSI: the value) reaches the tolerance zone within `retestBars` (20) of the
  break – `pending`; a candle that then closes beyond the line again – `held`; a close back on the old side by more than
  the break tolerance – `failed` („Bruch zurückgenommen“, also after a held retest: both facts are kept); no touch in the
  window – `expired` („Bruch ohne Retest“); before that `none`. A candle right after a hesitant break that merely stays next to the line
  is no retest (the „clear of the line first“ rule).

An unbroken and a recently broken line of the same kind can exist side by side (`TrendSlot { active, broken }`).

## No lookahead

- **Closed candles only** (`closedCandles`): the feed's `closed` flag AND the close time not after `now`. The forming
  candle is not read at all (no pivot, no break, no ATR, no RSI from it).
- A swing is a pivot only with `pivotR` (3) bars to its right, so a pivot is known `pivotR` bars later; a line is known at
  **`confirmedAt = b.i + pivotR`** and not before. The check that voids a pair reads bars up to `confirmedAt` only; a break is
  searched from the bar after it. `view.confirmedTime` says from which candle the line exists.
- Appending candles never changes a line already known (points, slope, `confirmedAt`) – only `brokeAt` can appear
  (pinned on real BTCUSDT 4h / 1D data in `domain.trendlines.test.ts`).

## Honest edges

- **Too few candles**: below `max(44, 14 + L + R + minGap)` closed candles `status` is `"few"`, the lines are empty, `bars` /
  `need` say how many of how many (`emptyText`: „Zu wenig Kerzen (30 von 44).“).
- **Parallel / collinear candidates**: the unbroken line is the one with the newest second point, then the better score
  (touches · 3 + length / 15 + height), then the longer one, then the flatter – a fixed order, never array order. A lower
  parallel line is no resistance as long as the upper peaks cut through it; pairs never mix the points of two lines.
- **Flat or wrong-way pairs** (equal highs, a rising pair of highs for a resistance) give no line.
- The chosen line is the newest structure, like `rsiLines`; a short, steep latest pair can win over a long 3-touch line.
  Both are in `findLines` (exported) if a later feature wants the others.
- Textual output is an observation with numbers (`describeLine`), no forecast and no advice.

## Settings (`config.ts`)

`settings.trendlines` – versioned passthrough (`Settings.trendlines?: unknown`): `{ v: 1, tfs, chart }`. `tfs` = the read
timeframes (default `1h 4h 1D 1W`, any of `30m 1h 2h 3h 4h 1D 1W` – the key-level timeframes), `chart` = price lines in the
Markt chart. Reading is lenient (`trendlinesCfgOf`), writing (`withTrendlines`) keeps unknown keys and returns the same
object when nothing changed. Absent until the user changes something.

Tests: `tests/unit/domain.trendlines.test.ts` (pivots, closed candles, the falling resistance incl. confirmation, approach,
break, retest, mirror symmetry, edge cases, hand-made retest series, RSI, real BTCUSDT data with the rule invariants and the
no-lookahead property, texts), `market.trendlines.test.ts`, `chart.trendline.test.ts`, `views.markt.trend.test.tsx`.
