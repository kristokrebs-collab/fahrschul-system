# `src/domain/psych` – Psychologie messbar machen (P08)

Pure TypeScript (no React), deterministic, `now` injected. No clinical language: states and patterns, not diagnoses.
Nothing is re-derived – the behaviour patterns are the coach's events (`detectBehaviors`, P04; they already include
the trade editor's psyche flags of P06), the limits and the pause come from P05 (`LimitReport`).

| File | What |
|---|---|
| `checkin.ts` | The daily check-in as a **passthrough key on the day journal** (`tj2-days`, `DayNote.checkin`), next to the existing `mood` (reused): `{ stress 1–5, energy 1–5, sleep h (0–14, ½ h), emotions[] (≤ 8), habits {id: true}, at }`. `normalizeDayNote` keeps it and `isEmptyDayNote` treats it as content – no schema change. `checkinOf` (defensive; empty → `null`), `hasCheckin` (check-in or mood), `hasDayText`, `moodOf`, `checkinInput(c, mood, now)` / `habitInput(note, id, done, now)` (`saveDay` inputs – the adapters merge them over the stored entry), `dayIsEmptyWithout` (when clearing may delete the whole entry), `checkinDays`. Vocabulary: `MOOD_LABELS` (as the calendar's day panel), `STRESS_LABELS` (as the trade editor's psyche meter), `ENERGY_LABELS`, `CHECKIN_EMOTIONS` with a tone. |
| `mood.ts` | `psychFactors({days, closed, currency})` – Stimmung, Stress, Energie, Schlaf (day factors) and Stress / Zuversicht im Trade (trade factors) against results: per level Ø R (or Ø money when < 60 % of the trades carry an R), win rate, n; Spearman ρ; best / worst bucket (n ≥ 3); a verdict sentence – under `MIN_FACTOR_N` (8) "Zu wenig Daten". `strongestFactors` (clearest first). |
| `diary.ts` | `diaryDays({days, list, events, fromKey, toKey})` – one entry per day with anything to say (check-in, texts, trades with their psyche notes and flags, the day's patterns), oldest first; `feelOf` (−1…1), `diarySummary`, `dayLabel`. |
| `trackers.ts` | `psychTrackers({events, closed, days, now})` – FOMO, Revenge (+ Tilt), Selbstüberschätzung, Impulsivität (impulsive, boredom, overtrading), Verlustangst (loss aversion, stop moved), Gewinnmitnahme (early profit): 30-day count vs. the 30 days before, 8 weekly counts, self-reported days from the check-in words, the cost in R (P04 `behaviorReport` excess), evidence trades; most frequent first. `topTracker`, `trackerLine`. |
| `readiness.ts` | `readiness(input)` – "Bereit" / "Noch nicht bereit" / "Pause" from today's check-in, the checklist (the trader's Grundregeln via `preTradeChecklist`, else `DEFAULT_PRE_TRADE`), the P05 limits + pause (an override of "Limit überschreiben" turns the pause into a warning) and today's revenge / tilt / overtrading events. Reasons stop → warn → ok, a score and `pauseUntil`. Advice only – it never blocks. |
| `report.ts` | `psychReport({days, list, events, from, to})` – data of the psychology report of a period: check-ins and their coverage of the trading days, averages, the most named feelings, the trackers of the period, the clearest factor and one sentence. |

## Tests
`tests/unit/psych.checkin.test.ts`, `tests/unit/psych.analysis.test.ts`.
