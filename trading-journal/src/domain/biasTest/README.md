# `src/domain/biasTest` – "Chart spiegeln / Bias prüfen" (F62)

Pure records and comparison of the guided mirror test. The chart side (the display transform) lives in
`src/chart/mirror.ts`, the UI in `src/views/biasTest`.

## Storage – `settings.biasTests`

```
settings.biasTests = { v: 1, tests: BiasTest[] }       // passthrough settings key, synced like every setting
```

A test is one array item with an `id` (`bt_…`), so the three-way merge of the settings (`merge3`: local adapter, cloud
settings row) merges two devices **per id** – an outcome recorded on one device and a new test on the other both survive.
Writers (`withBiasTest`, `withBiasPatch`, `withoutOpenBiasTest`) return a NEW settings object and keep every other key and
every unknown key inside `biasTests` and inside each test; the reader (`biasTestsOf`) drops what it cannot read and never
rewrites it. A journal without the key reads as "no tests" (older data and backups are untouched). At most
`BIAS_TESTS_MAX` (200) are kept – the oldest *finished* ones go first, an unfinished test is never dropped.

```ts
BiasTest {
  id; v; createdAt; updatedAt;                 // createdAt = the time of the FIRST answer
  context { surface: "markt"|"replay", symbol, interval, anchorMs, tradeId? }   // anchorMs = last bar the trader saw
  blind { hideName, hidePosition, hidePnl, neutralColors };  layers { breakouts, trendlines, boxes, trades, rsi };  rsiMirrored
  first  { direction: long|short|neutral, conditions, invalidation, at }
  second?{ … }                                  // answered on the mirrored chart
  revealedAt?                                   // set together with the second answer
  outcome? { value: up|down|sideways|unclear, note, at }   // the trader's own, recorded LATER
}
```

## Order guarantees

- `newBiasTest` is written when the first answer is saved – before the chart is mirrored. `withSecondAnswer` adds the second
  answer and `revealedAt` in one write and is refused when a second answer exists (answers are not editable afterwards).
- `withOutcome` is refused for an unfinished test. Nothing here reads a price: the outcome is the trader's own entry.
- `draftGaps` / `answerOfDraft`: a direction and the conditions are required; Long / Short also need an invalidation.

## Comparison (`compare.ts`)

`compareAnswers(first, second)` → `{ relation, expectedSecond, headline, points }`. The mirrored chart shows the same data
upside down, so Long ↔ Short fits together (`mirrored`), the same direction twice is shown plainly as a contradiction
(`same`), Neutral combinations are named. **No score**: no number, no "you are biased" – one test is one observation.
`summarize(tests)` counts finished tests by relation with the sample size; under `MIN_PATTERN_N` (10) it says "zu wenig, um
ein Muster zu erkennen" and always "keine Diagnose, keine Ursache".

## Tests

`tests/unit/domain.biasTest.test.ts` (reading, storage, merge, order, comparison, summary), `tests/unit/chart.mirror.test.ts`
(the pure mapping and the flip-twice property), `tests/unit/views.biasTest.test.tsx` (the flow on the real store).
