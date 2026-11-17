# `src/domain/similar` – Historisch ähnliche Situationen (F19)

Pure TypeScript, no React, no I/O. The live side (candles of a timeframe) is `src/market/similar`, the card is
`src/views/markt/SimilarCard.tsx`, the mini chart of a hit `src/views/markt/SimilarHitSheet.tsx`.

```ts
import { findSimilar, headline, fewText } from "@/domain/similar";

const r = findSimilar(candlesOf4h, "4h", now, { horizon: 12, unit: "r" });   // candles of the timeframe's OWN feed
r.status            // "ok" (≥ 20 hits) | "few" | "noCandles" | "noFeatures"
r.hits              // nearest first: index, time, distance, feature values, the real course after it
r.summary           // shares up / down (Wilson 80 %), spread, counter-examples, setback, first touch – only when "ok"
r.baseline          // the same horizon after EVERY comparable candle of the period (the yardstick)
headline(r.summary, 12) // „In 14 von 24 ähnlichen Situationen lag der Kurs nach 12 Kerzen höher (58 %, Spanne 41–73 %).“
```

## How it works
1. **Closed candles only** (`closedCandles` of the trendline engine: the feed's flag AND the close time have passed). The
   forming candle is neither the current situation nor a candidate nor part of a course.
2. **Description** (`features.ts`): the last closed candle gets one number per feature – RSI, RSI slope (5 candles), distance
   to EMA 50 (optional EMA 200) in ATR, range / ATR, `ln(volume ÷ Ø20)`, the move of the last 10 candles in ATR, optionally
   weekday and session (UTC). The same numbers exist for every earlier closed candle.
3. **Distance**: root of the mean squared difference, each feature in units of its **fixed** scale (`FEATURES[id].scale`,
   e.g. RSI 10 points, EMA distance 1,5 ATR). No z-scores over the data: a statistic of the whole period would let later candles
   shape the description of earlier ones. Categorical features count 0 / 1.
4. **Hits** (`pickHits`): nearest first, at most `maxHits` (40), nothing beyond `maxDistance` (1,2), and never closer than
   `max(minGap, horizon)` candles to a chosen hit – two hits never share a course. A candidate needs `horizon` closed candles after
   it, so every hit has its complete outcome; the newest `horizon` candles are never hits.
5. **Outcome** (`outcomeAt`): from the hit's close, over the next `horizon` candles – highest high (`up`) and lowest low
   (`down`) as excursions ≥ 0, the close after the horizon (`change`, direction), and which of ±1 unit was touched first.
   Unit `r`: 1 R = 1 ATR of the hit's candle; `pct`: 1 % of its close. Both in one candle = „Reihenfolge unbekannt“ (never a guess).
6. **Summary** (`summarize`, only with ≥ 20 hits): shares up / down / flat with an 80 % Wilson interval, median and quartiles of
   the change, median excursions, the **counter-examples** (every hit that went against the majority direction, largest move
   first – none hidden), the median setback against the majority, first-touch shares and their median time.
7. **Yardstick** (`baseline`): the share up after *every* comparable candle of the period. Its courses overlap, so it is a strongly
   dependent sample – the card says so.

## What it does not claim
- Fewer than `MIN_HITS` (20) hits → `status: "few"`, `summary: null`, text „Zu wenig Daten“; the hits can still be looked at.
- Similarity is a description of the past, not a forecast (`NOT_A_FORECAST`); many features and many tried variants produce chance
  patterns (`MULTIPLE_TESTING`); both texts are always shown by the card.
- The loaded period is what the market layer holds (REST bootstrap ≈ 500 candles for 1h / 4h, ≈ 1500 for 15m, ≈ 1000 for 1D, ≈ 200 for 1W;
  the rings keep more if the chart loaded older ones): on the short feeds „zu wenig Daten“ is the usual, honest answer.

## Proof that nothing looks ahead (`tests/unit/similar.features.test.ts`, `similar.search.test.ts`)
- the feature table of a series cut at candle i equals the full table at i, for **every** i and feature;
- changing every candle after i leaves the table at 0…i bit-identical (and does change later values: the test is not vacuous);
- an absurd forming candle (or one flagged closed before its time) appended changes the result not at all.

Hand-computed fixtures (short indicator lengths, arithmetic in the comments) cover ATR, RSI, EMA distances, range, trend, relative
volume, `outcomeAt`, `pickHits` and `summarize`. RSI / EMA 50 / EMA 200 are checked against real TradingView values
(`tests/unit/similar.tvFixture.ts`: BINANCE:BTCUSDT 1D, 2026-10-19, via the TradingView MCP tools, tolerances explained there).

## Performance
O(candles × features) for the table and O(candidates log candidates) for the pick – a few milliseconds for 1500 candles, so it
runs on the main thread inside a `useMemo`; a worker would cost more than it saves.
