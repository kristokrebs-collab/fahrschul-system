# `src/domain/coach` – the rule-based trading coach (P04)

Pure TypeScript (no React, no I/O), deterministic and offline. Everything the Coach page, the Berichte page, the trade
panel and the live watcher show is computed here from the enriched journal – with evidence trades, minimum samples and
an honest confidence. Nothing needs a server or an API key; the optional AI wording (`netlify/functions/coach-ask.mts`)
only rephrases an `Answer` that was computed here.

| File | What |
|---|---|
| `events.ts` | **Wave-0 contract** (consumers P05 guard, P08 psych tracker, P12 mentor queue): `BEHAVIOR_KEYS`, `BehaviorKey`, `BehaviorSeverity` (1 Hinweis · 2 Warnung · 3 kritisch), `BEHAVIOR_LABEL`, `BehaviorEvent {key, tradeIds, at, severity, note?}`, `detectBehaviors({trades, settings, days?, now?})`. Signatures final. |
| `detectors.ts` | The detectors and their tuning (`DETECT`): revenge (entry ≤ 60 min after a loss close, hot ≤ 15 min, sized up ≥ 1.5×, explicit "Revenge"), tilt (2+ losses in a row today), overtrading (day limit per account, or 4 trades in 60 min), FOMO (emotion / chase ≥ 0.25 R past the planned entry), stop moved (`stopWidenings`: `stopHistory` and Bitunix TP/SL edits that widen the stop, big loss ≤ −1.5 R), early profit (captured ≤ 35 % of MFE ≥ 1.5 R), loss aversion (losers held ≥ 2× as long as winners), overconfidence (sized up after a 3-win streak), impulsive / boredom (no setup or reason when the trader uses setups), rule violations (`brokenRules`: no stop, leverage over the rule, against the plan, checklist incomplete, loss over the per-trade limit; the trade that broke the day limit). Binary search over close times – one pass per detector. `runDetectors` sorts by `at`. |
| `behaviors.ts` | `behaviorReport(events, closed)`: per behaviour the triggering trades, their P&L and the excess against clean trades (`Σ P&L − n · Ø P&L(clean)`, also in R); `behaviorTrend`, `eventsBetween`, `triggerOf`. |
| `edges.ts` | `findEdges(closed, {settings, events?, minN?})`: single factors (the behaviours, then `EDGE_DIMS` of the P03 breakdowns: setup, side, session, weekday, hour, hold time, regime, volatility, risk %, leverage, timeframe, conviction, emotion, box, strength, asset, tag, account) and 2-way combinations of the decision-relevant ones (capped); per candidate Ø R (or money) vs. the rest, Welch p, **Benjamini-Hochberg** q over all tests, bootstrap CI of the mean and of the difference (seeded per candidate – deterministic), stability over both halves of the journal. `edgeConfidence` → 0–100 and `verdict` **klar** (q ≤ 0.1, CI of the difference clear of 0, same sign in both halves) / **Tendenz** (q ≤ 0.3, CI clear) / **zu wenig Daten**. Only klar / Tendenz are listed; `EDGE_MIN_N` = 8. The Auswertung's `findingCandidates` / FindingsCard are untouched. |
| `recommendations.ts` | `whatIf(closed, match, "skip" \| "only")` with a bootstrap CI of the changed sum; `recommendations()` (stop a leak, focus an edge, stop a behaviour – each with why, evidence, impact, what-if and a `GoalDraft` for P08); `improvementPlan(recs, 3)`; `tradingScore()` (Edge 35 %, Disziplin 25 %, Risikokonstanz 20 %, Journaling 20 %; "Zu wenig Daten" under 10 trades); `behaviorProfile()`; `weeklyLesson()` (from the data, else a principle); `coachTips()`. |
| `tradeReview.ts` | `tradeReview({trade, all, settings, events, currency})`: grade A–D, a verdict, plan vs. execution, MAE / MFE, rules, context (entry check, Box-zu-Box), triggered behaviours, similar trades. |
| `watch.ts` | `coachAlert({before, after, changedIds, settings, now, minSeverity})`: the strongest NEW event a save caused, with advice, suggested pause (`until`) and the triggering trade – the live watcher's logic. |
| `prefs.ts` | `settings.coach` (synced like every setting, unknown keys kept): `reports.seen` (≤ 400 keys), `plan {goals, acceptedAt}` (≤ 5), `ai.notes` (opt-in for note excerpts). `coachPrefsOf`, `withReportSeen`, `withCoachPlan`, `withAiNotes` (same object when nothing changes). |
| `copy.ts` | German texts: titles and leads of both pages, severity labels, advice + cooldown + rule + goal per behaviour, principles, tips, the fallback help. No clinical words – patterns, not diagnoses. |
| `shared.ts` | Small helpers (account, entry / close time, size ratio over the last 20 comparable trades, FNV seed, labels). |
| `nlq/` | German questions → intent → answer (see below). |

## `nlq/` – questions in German
- `lexicon.ts`: normalisation (lower case, ß → ss, umlauts, punctuation), metric synonyms (Win-Rate, Trefferquote,
  P&L, Gewinn, Ø R, Erwartungswert, Profit-Faktor, Drawdown, Haltedauer, Gebühren …), group-by nouns, sort words,
  compare words, sides, accounts, weekdays, sessions, results, emotions, assets (journal pairs + common coins),
  behaviour synonyms, months.
- `parse.ts`: `parseQuestion(text, {setups, assets, tags, now})` → `Intent {type metric | group | compare | list |
  behavior | summary | unknown, metric, filters, period, period2, groupBy, sort, compare, behavior, understood}`.
  Periods: heute, gestern, diese / letzte Woche, diesen / letzten Monat, Quartal, Jahr, „seit März“, „im Mai“, „letzte
  30 Tage“ …
- `answer.ts`: `answerIntent(intent, data)` over the P03 breakdowns → `Answer {text, facts, trades (evidence ids), chart
  (bars / line), confidence {score, label, n, note}, followUps}`. A sample under the minimum says so; an empty selection
  says so; an unknown question gets `FALLBACK_HELP` – never a guess.
- `index.ts`: `askJournal(question, data)`, `suggestQuestions(data, 6)` (chips from the journal), `BEHAVIOR_QUESTION`.

## Tests
`tests/unit/coach.detectors.test.ts`, `coach.edges.test.ts` (FDR determinism, verdicts), `coach.recommendations.test.ts`
(what-if, plan, score, profile, review, watcher), `coach.nlq.test.ts` (a table of German phrases → intents, answers),
fixtures in `coach.fixtures.ts`.
