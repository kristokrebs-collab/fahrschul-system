# `src/domain/strategytext` – Strategie als Text (Strategie-Studio)

Pure TypeScript, no React, no I/O, no network. A strategy written in German ("Long, wenn der RSI unter 30 fällt und der Kurs über dem EMA 200
liegt, Stop 1,5 ATR, Ziel 2R, nur in der London-Session") becomes the lab's own rule set (`CustomConfig`, `@/domain/lab`) – and everything the
reader could NOT decide stays visible. The page is `src/views/studio` (README there); a language model is optional and never computes a number.

```ts
import { parseStrategyText, compareStrategies, saveVersion, studioOfSettings } from "@/domain/strategytext";

const p = parseStrategyText(text, { answers });   // → StrategyParse
p.rules        // CustomConfig – what the lab runs
p.understood   // [{ phrase (the trader's own words), span, meaning (the lab's sentence) }]
p.unclear      // [{ phrase, why }]   – parts that did NOT become a rule, with the reason
p.questions    // sentences; p.asks = the same with answer chips (id, options, blocking, chosen)
p.assumptions  // sentences; p.assumptionItems = with chips – every default that was taken where the text was silent
p.ready        // no lab error and no open blocking question
```

## `parseStrategyText` – the local reader (F73)
Rule based, deterministic: the same text and answers give the same rules (no model, no randomness, no clock). Folded text (umlauts and their
`ae/ue` spellings, number words, comma numbers, `65.000`) with an offset map back to the ORIGINAL words (`understood[].span`). Keyword-led scanners
take what holds numbers of its own first (risk, period, market, stop, target, break-even, trailing, partial target, time stop, counter signal,
timeframes, sessions and weekdays, sides); then conditions are read around anchors (`conditions.ts`: RSI, stochastic, CCI, Williams %R, ADX/DI,
Supertrend, VWAP, price levels, moving averages and crosses, MACD, Bollinger, ATR, volume, breakout / Donchian, inside bar, Heikin-Ashi) with
relations ("unter", "fällt unter", "kreuzt nach oben", "zwischen … und …") and negations ("nicht", "kein", "ohne" – a negation the reader cannot
attach is `unclear`, never silently a positive filter). Sections per direction ("Long: … Short: …"), AND / OR chains (a mixed chain is a
question, "und" binds stronger meanwhile).
- **Never guesses silently.** Anything unplaced → `unclear` with a reason ("Uhrzeiten kennt das Labor nicht"); a missing decision → a question;
  every default → an assumption sentence. Words left over after all readers are clustered into `unclear`.
- **Answers complete the rules.** `answers[id] = optionId` (the studio's chips) re-reads the same text deterministically; `pruneAnswers`
  drops answers whose question is gone. Blocking questions (e.g. the direction) keep `ready` false; the others name the provisional
  reading they used until answered. A session chip ("Frankfurt-Session" → London) or a clock-time chip becomes the time filter.
- **Strict parameters** (`strict.ts`): a number outside the lab's range is `unclear`, not clamped silently (`sanitize*` of the lab would).
- Tests: `tests/unit/strategytext.parse.test.ts` (a table of ~100 sentences incl. negations and not-understood parts, answers, determinism).

## `compareStrategies` – several strategies, one honest table (no UI)
`compareStrategies(strategies, candles, options)` and the stepped `createComparison` (idle chunks / worker) run N strategies on the SAME candles,
window, costs and train / test cut (default 70 / 30 by time, one instant for all). Row = trades, win rate, Ø R, profit factor, max drawdown,
the test window's own figures, one-sided p of "Ø R > 0" and the Bonferroni-adjusted p, sample level, rank, equity curve (≤ 48 points). Used by
"Alle testen" and by the version comparison; the background optimiser and the pattern finder call the same function.
- `multiple` = `{ count, trials, luckyChance (1 − 0,95^trials), text }`: the number of strategies is part of the RESULT; `extraTrials` adds
  strategies tried earlier (a search) to the multiple-testing note. `warnings` carry the sentences a table must show.
- Rank by Ø R in the TEST window when every ranked strategy has ≥ `MIN_TEST_TRADES` (5) trades there, else by the whole period – and it says so.
- Rules are not fitted here; the note says that a test window is no longer unseen once rules were edited after looking at this data.
- A row that cannot run says why (`status` invalid / nodata / error, `reason`). `compareIntervals` / `compareWarmupMs` tell the caller what to load.
- Tests: `tests/unit/strategytext.compare.test.ts` on real BTCUSDT fixtures.

## `settings.studio` – several strategies, each with its own versions (`studioConfig.ts`)
`{ v: 1, strategies: [{ id, name, createdAt, updatedAt, text, answers, symbol, period, versions: [{ id, n, at, note, text, answers, setup, key,
config, stats? }], live: [{ accountId, versionNo, at }] }] }`. A versioned passthrough key like `settings.forward` / `settings.keyLevels`:
unknown root keys, unknown keys of a strategy and entries this version cannot read survive (`rejected`, written back untouched); strategies and
versions are arrays of objects with a string `id`, so the cloud / two-tab `merge3` merges per strategy and per version (two devices that both
save "version 3" keep both, renumbered). A version is immutable: text, answers and the rules AS UNDERSTOOD THEN (the reader may improve; an old
version never changes its meaning). `saveVersion` creates one only for a real change; figures (`StoredStats`) attach to the version they belong to.
Limits: 30 strategies, 30 versions each, 8 paper-account links. Operations are pure (`newStrategy`, `updateDraft`, `saveVersion`, `attachStats`,
`setVersionNote`, `addLive`, `diffVersions`, `withStrategies`); the studio writes them from the LATEST settings.
- Tests: `tests/unit/strategytext.studio.test.ts` (round trip, passthrough, strictness, merge of two devices).

## The optional model (`schema.ts`, `ai.ts`, `netlify/functions/strategy-compile.mts`)
The local reader is the normal path. The server function (plan gate `coachAi`, `ANTHROPIC_API_KEY` server-only, rate limits, forced tool call)
turns the TEXT into structured rules; the answer is accepted only if it passes the SAME strict `RulesSchema` as the lab's rules, every quoted
phrase stands in the trader's text (`groundingProblems`) and the lab's own validation finds no error. `aiToParse` makes it the same
`StrategyParse` (`source: "ai"`); the meaning of every understood part is the lab's text of the rule, never the model's prose. A refused,
invalid or ungrounded answer is dropped and the local reading stays. No key, no trades, no results ever go to the model.
- Tests: `tests/unit/strategytext.ai.test.ts`, `tests/unit/strategy.compile.test.ts`.
