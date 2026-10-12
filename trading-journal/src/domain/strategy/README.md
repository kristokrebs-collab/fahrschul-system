# `src/domain/strategy` – Strategie-Management (P07)

Pure TypeScript, no React, no I/O. Import from `@/domain/strategy`.

An Entscheidungsgrundlage (`Setup`) becomes a full strategy description through PASSTHROUGH keys on its entry in
`settings.setups` (`normalizeSettings` spreads every setup, backups and the cloud merge keep unknown keys – no schema
change; a setup without them reads exactly as before):

| key | type | meaning |
|---|---|---|
| `entryCriteria` / `exitCriteria` | `{id, text}[]` | when to enter / how to exit |
| `riskModel` | `{riskPct, maxLeverage, minRR, stop: box\|struktur\|atr\|fix}` | the plan's risk rules (null = no rule) |
| `tags` | `string[]` | strategy tags (library filter) |
| `examples` | `string[]` | best-practice example trade ids |
| `markets` / `tf` | `string[]` | Binance symbols (`BTCUSDT`) / journal timeframes (`4h`, `1D`); empty = any |
| `auto` | `{boxKinds, minGrade, minStrength, sessions, sides}` | recognition rules for the classifier |

```
types.ts       SetupX = Setup & StrategyExtras; strategyOf (defensive reader), withStrategy (writes only non-empty
               parts, other keys survive), cleanStrategy / cleanCriteria, extrasKey (dirty check), marketKey
classify.ts    classifyTrade(trade, setups, {history}) → Suggestion[] {confidence 0…1, level hoch ≥ .7 / mittel ≥ .45 /
               niedrig, reasons}: box setup kind + grade at entry (trade.boxSnap), stored entry check (trade.signal; s_mtf
               recognises it by itself), session, side, markets, timeframes, texts of the setup, and a Laplace-smoothed
               likelihood ratio learned from the trader's tagged trades (historyModel); hard rules (other account,
               explicit side rule) exclude a setup; confidence = softmax probability × evidence coverage.
               classifyUntagged → bulk suggestions for trades without a setup (≥ mittel)
conformity.ts  tradeConformity / strategyConformity: 0–100 over the measurable parts (Checkliste 30, Plan 15, Risiko 20,
               Stop 10, Exit 15, Markt/TF 10); exitFollowed (Exit-Treue: at target / stop ± 0,25 R or a plan exit
               reason = plan; named off-plan exit, liquidation, < −1,2 R, stop widened = break); a score needs one
               plan-specific part besides "stop"; WR conform vs. other (each side ≥ SPLIT_MIN = 3 trades);
               weakest part; planBreakers (mistake tags of non-conform trades)
compare.ts     compareStrategies(2–3 setups) → rows with Wilson / t intervals (≥ 5 trades), conformity, exit fidelity; the
               leader by the LOWER bound of Ø R ("trade the best"); pairs via P03 compareSets; German verdict
library.ts     matchesLibrary (text, tags, market, timeframe, with trades), libraryFacets, EMPTY_LIBRARY_FILTER
examples.ts    examplesOf: picked examples + suggested best conform winners (screenshots first)
```

Consumers: the Setups page (`src/views/setups`), the SetupEditor (`src/overlays/SetupEditor.tsx`), the integrator's
classify chip in the trade editor (P14). Tests: `tests/unit/strategy.domain.test.ts`.
