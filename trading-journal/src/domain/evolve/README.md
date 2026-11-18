# `src/domain/evolve` – Hintergrund-Optimierer (F66 / F73)

Pure TypeScript (the worker entry and the runner are the only files that touch `Worker`/`navigator`). A strategy of the Labor
(a rule set, `CustomConfig`) is improved by small, explained changes ("mutations"), every variant is judged **only on windows the
search never trained on**, and the result is a *proposal* – never an automatic change. Nothing here sends an order, saves a
strategy or starts a forward account; that is the user's click in the card (`src/views/evolve`).

```
types.ts        MutationKind, Evaluation, LogEntry, Overfit, Plateau, StoredProposal, TournamentRow, snapshots, options
mutations.ts    the search space: `mutate / mutateWeighted / mutateChain`, one German sentence per change, `freedomOf` (degrees of freedom)
windows.ts      walk-forward: train 30 % | 4 consecutive test windows (anchored trains) | confirmation window 20 %
score.ts        per-trade R (winsorised at ±5 R, funding INCOME not counted, costs counted), `metricsOf`, `robustScore`
significance.ts multiple-testing correction (White Reality Check, stationary bootstrap) – the long method comment is here
plateau.ts      neighbour check: does the finalist survive when one number moves a little?
evaluate.ts     `Evaluator`: prepares candle facts once per signal key, scores a config on the test windows, `holdout`
search.ts       `EvolveJob`: elite + random restarts + stagnation, seeded, deterministic regardless of time slicing
multi.ts        `EvolveMulti`: several strategies, one shared time-slice scheduler, tournament over ALL strategies and variants
proposal.ts     `buildDraft`: finalist → proposal (change lines, expected result, warnings, overfit, plateau)
learn.ts        Beta posterior per mutation kind from accept / reject and live verdicts → weight 0.3–1.7 for the search
learned.ts      `learnedSummary`: the numbers behind "Was habe ich gelernt?" – honest below the minimum sample
selfcheck.ts    `liveCheck`: did a proposal confirm itself on the forward account? expected vs actual in % per 30 days
config.ts       `settings.evolve` reader / writer (versioned passthrough), `proposalOf`, `trimProposals`, lineage counters
protocol.ts     the local trial log: cap 400, keep the top 30, counters never shrink; `parseBook` / `bookToJson`
throttle.ts     duty cycle for hidden tab, battery saver, data saver, coarse pointer, user power
host.ts         worker protocol (start / pause / resume / stop / abort / throttle → state / progress / done / error)
evolve.worker.ts / environment.ts / runner.ts   inline worker (`?worker&inline`), main-thread fallback, `startEvolve`
index.ts        barrel
```

## Honesty rules (what the code guarantees, with tests in `tests/unit/evolve.*.test.ts`)
- **Selection never sees the confirmation window.** Variants are scored on the four test windows; the last 20 % of the candles
  are only used once, for the finalist and the tournament. A test replaces the confirmation window by a crash and a spike and checks that no trial of the search changes (only the
  confirmation numbers do).
- **Robust score** = `avgR·√n − 0.5·maxDD_R/√n − 0.12·(extra degrees of freedom)`; below 15 test trades a variant is not rankable,
  below 30 it carries a warning. The training number is never the headline.
- **Multiple testing.** Each tried variant is another lottery ticket. `significance.ts` runs a Reality Check over ALL strategies
  and variants of the run (studentised per resample, 24 time blocks), inflates for earlier trials of the same strategy (weighted by
  candle overlap) and floors the result on the holdout (≥ 0.5 if the holdout is negative, ≥ 0.2 if it is worse than the current
  version). The naive p is shown for contrast. "Überanpassungs-Wahrscheinlichkeit" is this p – not a promise either way.
- **Plateau.** Up to 12 neighbours (one number at a time); similar if the score is ≥ 50 % of the finalist's; a plateau if ≥ 60 % are.
- **Costs.** Fees, slippage and funding *costs* count; funding *income* does not (flat-funding carry made random walks look good).
  R per trade is winsorised at ±5 R so one monster trade cannot carry a variant (`best3Share` is shown).
- **Deterministic.** Seeds per strategy (`mixSeed(seed, id)`); the result does not depend on the slice length.
- **Self-check.** `liveCheck` needs ≥ 21 days and ≥ 10 trades on the forward account, otherwise "early". Expected is the test
  result of the proposal, actual the live result, both per 30 days in percent.
- **Learning is thin by design.** Weights move only after ≥ 5 decisions (≥ 3 per kind); the card says "zu wenig" below that.

## Settings
`settings.evolve` is a versioned passthrough (unknown fields survive, id-list proposals merge with `merge3`): `proposals`
(≤ 30, ≤ 9 open), `lineages` (counters per strategy id, ≤ 40), `learn` (accept / reject / good / bad per kind), `stats`, `power`,
`seed`. The full trial log is **local only** (`storageKey("evolve-log")` in localStorage, never part of `settings`, so never synced or exported).

Tests: `evolve.mutations`, `evolve.windows` (hand-computed), `evolve.significance` (noise → high, edge → low, fixed seeds),
`evolve.search`, `evolve.learn`, `evolve.config`, `evolve.host` (protocol, abort, throttle). Shared fixtures: `tests/unit/evolve.helpers.ts`.

Not financial advice: every card and every assistant answer ends with "Keine professionelle Finanzberatung."
