# `src/domain/fit` – „Passt die Strategie zu mir?“ (F49)

Pure TypeScript, no React, no I/O. The card is `src/views/labor/FitCard.tsx` (lazy chunk of the Labor page, under the diagnosis).

```ts
import { strategyFacts, journalProfile, compareFit } from "@/domain/fit";

const s = strategyFacts({ name, from, to, riskPct, maxDD, trades });   // what a finished Labor run demands (trades: entryTime, exitTime, r, pnl)
const j = journalProfile(enrichedTrades, settings, behaviorEvents);     // what the journal shows (closed trades, all accounts and markets)
const r = compareFit(s, j);                                             // { status, reason, strategy, profile, items[] }
```

## What is compared
Eight statements, always in this order, each `match` / `friction` / `unknown` with a sentence, the two figures side by side
(`evidence`) and the caveat that belongs to THAT statement (`caveat`):

| id | idea (from the run) | you (from the journal) | friction when |
|---|---|---|---|
| `winRate` | wins ÷ trades, 80 % Wilson interval | same over your closed trades | the idea's interval lies wholly below yours („gewinnt seltener“); wholly above is reported as an agreement with the difference named; overlapping = „kein belastbarer Unterschied“ |
| `hold` | median time in a trade | median `exitDate − date` over the trades that carry an exit time (≥ 10) | medians differ by a factor ≥ 2 either way |
| `streak` | longest run of losing trades | longest run in the journal; shown with the expectation for your win rate over the idea's trade count (`expectedLongestLosingStreak`) | the idea's run is ≥ 2 trades longer („verlangt bis zu 9 Verlusttrades in Folge auszuhalten; deine längste Serie waren 4“) |
| `drawdown` | deepest drop of the cumulative R (and the run's equity drawdown in %) | same over your trades with a R (≥ 20) | idea > 1,5 × yours AND ≥ 2 R more |
| `frequency` | trades per week over the test period | trades per week over your journal span (≥ 14 days) | factor ≥ 2 either way |
| `window` | share of entries per UTC weekday (Mo–Fr) and session | same shares of your entries (≥ 20 trades) | a window with ≥ 15 % of the idea's entries and < 5 % of yours („60 % der Einstiege fallen auf Montag; von deinen Trades liegen 0 % dort“) |
| `risk` | the run's risk per trade (% of the account) | median `risk ÷ start capital of the account` (≥ 10 trades with a stop) | idea > 1,5 × your median |
| `discipline` | the test executes every signal with a fixed stop that is never moved away | share of trades with a stop, trades with a stop moved away (coach event `stopMoved`), share marked „Plan befolgt“ (≥ 10 answers) | < 90 % with a stop, or ≥ 2 trades (≥ 5 %) with a moved stop, or < 70 % plan-following |

All thresholds are in `FIT_RULES` (`types.ts`); the minimums are `MIN_*`.

## What it does not do
- **No total score, no ranking, no „geeignet / ungeeignet“, no advice to trade or skip.** Frictions are observations („verlangt“ vs. „du …“),
  not forecasts of how the trader would behave. The card says so in a fixed box.
- **Honest empty states** (`status`): `journalNone` (no closed trade), `journalFew` (< 20 closed trades – the number is named),
  `strategyFew` (the run has < 10 trades). A single statement whose journal sample is too small is `unknown` WITH the reason
  (e.g. „Von deinen Trades haben 3 eine Ausstiegszeit; ab 10 …“) – never a guess.
- It reads the run's trades and the journal; it changes neither `diagnoseRun` nor the extras nor any journal data.
- Execution effort (F49), three further statements, all with both numbers and a caveat:
  - **Prüftakt** (`cadence`): the run's candle size against the journal's usual candle (median of `Trade.timeframe`, ≥ 10 trades); friction from a factor of 4
    (`FIT_RULES.cadenceFactor`, inclusive). A "look" is the close of a candle – how long a look takes, the app does not know.
  - **Regelumfang** (`ruleload`): conditions + exit rules of the idea (only "Eigene Idee" and the rule builder; the fixed templates have no rule list)
    against the median number of checklist points per trade (global rules + the setup's items, ≥ 10 trades with a checklist); friction from twice AND at
    least 3 more (`ruleFactor`, `ruleMinExtra`). Different things are compared and the caveat says so.
  - **Zeitbudget** (`timebudget`): looks per day and trades per week next to the minutes per day from the check-in field "Verfügbare Zeit" (≥ 5 days).
    Never judged: always `unknown` with both numbers – the verdict stays with the trader.
- Still approximated, not measured: the effort (no time per look, no hands-on vs. automatic).

## Reading notes
- Times are UTC on both sides: the run's entries are epoch ms; a journal trade is a local wall-clock string read as the real instant
  and bucketed in UTC.
- „Dein Journal“ is every account and market in it (the card says „alle Konten und Märkte“); the profile is not filtered to the run's symbol.
- The longest losing run and the drawdown grow with the number of trades – the caveat of the statement says so.

## Tests
`tests/unit/fit.test.ts` (hand-computed: drawdown depth, the idea's 10 trades, the journal's 24 trades, every statement, the empty
states and unknowns), fixtures `fit.fixtures.ts`; card: `tests/unit/views.labor.fit.test.tsx`; e2e `tests/e2e/fit.spec.ts`.
