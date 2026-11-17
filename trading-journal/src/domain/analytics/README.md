# `src/domain/analytics` – Pro-Analytics (P03)

Pure TypeScript, no React, no I/O (except `mcRunner.ts`, which only schedules work). Every function takes the closed
trades of an account view (`accountView(…).closed`, trade-time order) and aggregates with `aggregate()` (`../agg.ts`),
so every number agrees with the Hero, the explainers and the Auswertung. Uncertainty is part of every result: sample
size `n`, an 80 % interval (`CI_LEVEL`, the Auswertung's Wilson level) and an honest verdict
(`klar` / `Tendenz` / `offen` / `zu wenig`). Anything random is seeded – the same journal always gives the same numbers.

The Wave-0 contract (`monteCarlo`, `riskOfRuin`, `streaks`, `expectedLongestLosingStreak` and their types) is kept 1:1;
consumers: P05 (streak risk), P04 (coach / NLQ over the breakdowns), P07 (setup comparison), P13 (cockpit widgets).

```
stats.ts        mean, sd, variance, downsideDeviation, skewness (G1), kurtosis (excess G2), quantile (type 7), percentiles,
                median, mad, normCdf / normQuantile, tCdf / tQuantile, betaInc, lnGamma, tTest (+ t-interval), meanCI,
                welch, proportionDiff (Newcombe), wilson / wilsonCI (re-used from insights/shared), bootstrapCI (seeded),
                bootRuns, benjaminiHochberg (q-values), significanceOf, tradesForEdge, tradesForWinRate, rng (mulberry32)
ratios.ts       ratioReport(closed, view) → Sharpe / Sortino per trade and per day (calendar days, × √365), Calmar / MAR
                (accountView proj.comp ÷ |maxDD|), SQN (n ≤ 100), Kelly / Half-Kelly (aggregate's W and payoff),
                Gain-to-Pain (months), Omega (days), Ulcer (equity points, %), Tail Ratio, Edge-Test (t-test of Ø R,
                else Ø P&L); each a Metric {value, n, unit, ci, p?}; RATIO_MIN per metric; tradeReturns, dailyReturns,
                monthlyNets and the single-ratio helpers
montecarlo.ts   monteCarlo / createMonteCarlo (stepped engine: bootstrap | reshuffle, p5…p95 bands, finals, maxDD per path,
                P(DD ≥ x), ruin share, longest losing run, kept paths; MC_CELL_CAP bounds the band memory),
                ddProbability, ddQuantile; riskOfRuin (analytic Cramér-Lundberg on log equity = infinite horizon,
                simulated over N trades, optionally from the trader's own R multiples), ruinAnalytic, ruinSimulated
mc.worker.ts    module worker running monteCarlo / riskOfRuin (protocol: mcProtocol.ts)
mcRunner.ts     runMonteCarlo / runRiskOfRuin: inline worker on web builds, idle-chunk fallback (single-file builds,
                file: pages, no Worker, worker error / timeout) – identical results, AbortSignal support
dimensions.ts   22 dimensions (Strategie, Asset, Börse, Wochentag, Uhrzeit, Session, Haltedauer, Regime, Volatilität,
                Long/Short, Setup × Session, Positionsgröße, Hebel, Timeframe, Überzeugung, Emotion, Monat, Box-Note,
                Herkunft, Konto, Tags, Signal-Stärke); Journal-v3 fields read defensively → NONE_KEY bucket
breakdowns.ts   breakdown(closed, dim, ctx) → rows {agg, Wilson WR interval, Ø R / Ø P&L with t-interval, Welch test vs.
                the rest, BH q-value, verdict}; best = highest lower bound, worst = lowest upper bound
heatmap.ts      heatGrid: weekday × two-hour block (local), best / worst cell (n ≥ 3)
excursion.ts    excursionReport over P06's stored MAE / MFE: scatter, exit / entry efficiency, money left on the table,
                losers that were ≥ 1 R up, stop / target hints
distribution.ts histogram (nice, zero-aligned), moments, Hampel outliers (3 · 1,4826 · MAD), numbers without the top
                1 / 3 / 5 trades and without outliers, profit concentration
streaks.ts      streaks (contract), expectedLongestLosingStreak (contract, Schilling), streakReport (vs. expectation,
                run-length bars, P(win | loss) − P(win | win) with interval)
rolling.ts      rollingStats: rolling WR / PF / Ø P&L / Ø R / Sharpe over the last N trades, equity in R, current form
benchmark.ts    benchmark: equity vs. buy & hold from the market's daily candles (UTC days); adaptiveBenchmark: last 90 days
                as a percentile of the own 90-day history
compare.ts      compareSets (Δ with Newcombe / Welch intervals and tests), periodSplit, accountSplit, setupSplit
customStats.ts  metric × filter × group-by, stored in settings.analytics.custom (passthrough key; customStatsOf,
                withCustomStats, applyCustomFilter, evalCustomStat, customStatTitle)
copy.ts         German titles, empty states, verdicts, RATIO_LABELS and the explainers (Explanation: formula, sample,
                interval, verdict)
```

## Conventions
- Minimum samples: ratios `RATIO_MIN` (5 trades / 10 days / 20 trades for the tail ratio), breakdown buckets 5
  (`BREAKDOWN_MIN_N`), heat cells 3, excursion 5, streak verdict 10, compare 5 per side, adaptive benchmark 30 earlier
  windows; the Analyse page adds Monte Carlo ≥ 10 sample values and risk of ruin ≥ 20 trades. Below it the value is
  `null` (UI: "zu wenig"), never an extrapolation.
- Verdicts: a "good" ratio whose 80 % interval reaches below break-even is reported as "noch nicht sicher" (mute);
  the edge test says "klar" only at a one-sided p < 0,05 (`EDGE_CLEAR_P`).
- Breakdown unit: R when ≥ 60 % of the trades (and ≥ 5) carry one, else money per trade.
- Days: ratios use local calendar days (like the calendar); the benchmark uses UTC days (the candles' grid).
- Performance: everything is O(n) or O(n · runs) with adaptive bootstrap runs (`bootRuns`, ≈ 200k draws); the view
  memoises per `view.closed`. The Monte Carlo runs off the main thread.

## Tests
`tests/unit/analytics.{contract,stats,ratios,montecarlo,breakdowns,patterns,copy}.test.ts`, fixture
`tests/unit/analytics.fixtures.ts` (built with the Auswertung's `qt` / `utc`).
