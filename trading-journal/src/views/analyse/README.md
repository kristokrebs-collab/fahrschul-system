# `src/views/analyse` – "Analyse" (Pro-Analytics, P03)

`AnalyseView` (export of `index.ts`, `h1` "Analyse") shows professional statistics with honest uncertainty over the
account view of the Hero's switch (`uiStore.acc`, the page header carries the same `Segmented`). All numbers come from
`@/domain/analytics` (see its README) and go through `aggregate()`, so they agree with the Hero, the explainers and the
Auswertung. Every number shows its sample (n) and, where one exists, an 80 % interval; too little data gives an honest
"zu wenig" / empty state, never a guessed value. "Trade the best": the robust best group leads, but strong words
("Trade the best", "Meiden", "klar", a green tile) only appear when the interval stays clear of break-even.

| Section (lg, 12 columns) | Cards |
|---|---|
| header | `PageHeader` (title, lead with `ANALYSE_LEAD_FILL` = `storageKey("fill-analyse")`, account switch) |
| Kennzahlen | `KennzahlenHero` (12) |
| Was kommen kann | `MonteCarloCard` (8) · `RiskOfRuinCard` (4) |
| Wo deine Edge liegt | `BreakdownCard` (7) · `HeatmapCard` (5) |
| Ausführung | `ExcursionCard` (6) · `DistributionCard` (6) |
| Muster | `RollingCard` (7) · `StreaksCard` (5) |
| Gegen den Markt | `BenchmarkCard` (6) · `CompareCard` (6) · `CustomStatCard` (12) |

Phones: one column in the same order, no horizontal scroll at 390 px. Without trades: one `PreviewCard`.
Every cell is a `Reveal` (ends at `transform: none`); section titles are `h2`s whose letters rise once on first view
(`SplitText`). Cards are the Auswertung's `InsightCard` (`AnaCard` moves the note into the body so the `+` explainer
stays in the header row on phones).

## Cards
- **Kennzahlen** (`KennzahlenHero.tsx`): Sharpe (days × √365) as the headline in Doto with the `TextPrism` lens,
  counting up (`MotionNumber countOnReveal`), its interval as a whisker, the edge test (Ø R, one-sided p, trades still
  needed for "klar"), strengths / weak spots as chips (first strength marked by `TactileHighlight`), and 9 ratio tiles
  (Sortino, Calmar, SQN, Half-Kelly, Gain-to-Pain, Omega, Ulcer, Tail Ratio, Sharpe per trade). Each tile and the
  "Details +" pill are `MorphCard`s → explainer dialog (formula, sample, interval, minimum sample, verdict); the sample
  rolls (`RollingDigits`).
- **Monte Carlo** (`MonteCarloCard.tsx`): 2000 seeded paths of the next 50 / 100 / 250 trades (bootstrap or
  reshuffle) from the R multiples (else P&L; from 10 values, below 30 with a "grober Ausblick" hint), computed by `runMonteCarlo` (worker on web builds, idle chunks in the
  single-file builds / without `Worker`). The fan: 120 pale paths drawn staggered into a canvas (incremental rAF loop,
  asleep when done), then a clip-path wipe uncovers p5–p95 / p25–p75 / median and one `SpotlightSweep` crosses the
  card; `ScrubTimeline` scrubs through the runs (worst / median / best marked) – the scrubbed run is the red path and its
  end and max drawdown are written into the DOM (MotionValue subscription, no React render per scrub). `DotMatrixText`
  "SIM" waves while it simulates. Below: median / 5 % / 95 % / max DD (95 %) and P(DD ≥ x) bars.
- **Risk of Ruin** (`RiskOfRuinCard.tsx`, from 20 trades): ruin (−30 % / −50 %) at 0,5 / 1 / 2 / 3 % or the trader's own median risk,
  simulated over 500 trades from the own R multiples (`NumberCascade` headline) and analytic (infinite horizon), Half-
  Kelly, and the ruin curve per stake (analytic, Half-Kelly marked). The win / loss model is built in R when the trades
  carry R – the same base as the simulation.
- **Breakdown** (`BreakdownCard.tsx`): 22 dimensions (`MorphSelect`; router seam `setAnalyseDim`), rows with n, win
  rate, Ø R / Ø P&L and its interval as a whisker on a shared axis (grows from its centre, staggered), the test against
  the rest after Benjamini-Hochberg (`SigBadge`), "klar" rows marked by `TactileHighlight`; a row opens its trades
  (`TradeRows` → trade detail, detached source). Banner: the robust best / worst bucket.
- **Wochentag × Uhrzeit** (`HeatmapCard.tsx`): 7 × 12 cells via `HeatGridReveal` cascading from the best cell; cells
  below 3 trades are paler; tap → numbers; the three best times and the weakest one.
- **MAE / MFE** (`ExcursionCard.tsx`): scatter (dots pop on `spring.pop`), exit efficiency ring, Ø MAE in R, money
  left on the table, losers that were ≥ 1 R up, stop / target hints. Needs P06's measured excursions (honest hint
  otherwise).
- **Verteilung** (`DistributionCard.tsx`): histogram (€ / R, bars grow), Hampel outliers popping out with a dashed
  signal ring, skew / kurtosis, where the profit comes from (stacked share bar), the numbers without the top 3.
- **Rollierend** (`RollingCard.tsx`): win rate / Ø R / PF / Sharpe over 10 / 20 / 50 trades with the overall value
  dashed and the current form; `ScrubTimeline` moves the guide, the readout, the signed `DotMatrix` R-VU meter (window
  Ø R, ±2 R) and the `EquityDraw` of the equity in R (drawn up to the scrubbed trade).
- **Serien** (`StreaksCard.tsx`): longest winning / losing streak vs. the expected longest losing streak, run lengths as
  mirrored bars, P(win | after a win) vs. P(win | after a loss) with its test.
- **Benchmark** (`BenchmarkCard.tsx`): the account vs. buy & hold of the live market from the provider's `kline_1d`
  cache – the two lines race on ONE shared scale (one MotionValue drives both clip-paths and the glowing heads; two
  separate `EquityDraw`s would each scale to their own range); the adaptive benchmark (last 90 days as a percentile of
  the own history). No candles → honest hint.
- **Vergleich** (`CompareCard.tsx`): period / account (all trades) / setup vs. setup; Δ with interval whisker and
  verdict where a test exists.
- **Eigene Kennzahl** (`CustomStatCard.tsx`): metric × filter (side, period, setup) × group-by with live preview; saved
  into `settings.analytics.custom` via `saveSettings` (toast), removed with a `DissolveOut`.

## State and data
- `analyseStore.ts` (`useAnalyseUi`): dimension, Monte-Carlo horizon / method, risk-of-ruin stake / threshold, rolling
  window, compare mode – per tab session (in memory). Router seam: `setAnalyseDim(dim)`, `analyseDimFromQuery(q)`,
  `analyseQuery(dim)`.
- `hooks.ts`: `useAnalyseBase` (account view + settings), `memoClosed` (one computation per `view.closed` and key),
  `useRatios`, `useMonteCarlo` / `useRiskOfRuin` (aborted on input change; the previous result stays while the next
  runs; state is only set from the run's callbacks).
- `widgets.tsx`: `ANALYSE_WIDGETS` for the P13 cockpit (`{ id, title, component, defaultSpan }`, components without
  props).

## layoutIds (MorphCard)
`morph-fact-ana-{key}` / `morph-title-fact-ana-{key}` for `key` ∈ sharpe, sortino, calmar, sqn, halfKelly, gainToPain,
omega, ulcer, tailRatio, sharpeTrade (to be added to the contract table in `src/motion/README.md`, owned by P01).

## Motion / 120 Hz
Tokens from `@/motion/tokens` only (fan timing = `tween.draw` spread over the paths, `tween.reveal` per path); transform
/ opacity / clip-path only (the fan's canvas redraw is incremental and finite); `useReducedFx` → the final picture at
once; no blur (the benchmark head's glow is a static shadow, off under `data-safe-fx`); finite loops (the "SIM" wave
only while simulating, the VU meter sleeps at rest); decorative layers `aria-hidden`, the numbers stay text; no new
`aria-live` (toasts via the island).

## Wiring (P14)
Register `analyse` → `AnalyseView` (pages, dock / command nav, router `#analyse?dim=<key>` → `setAnalyseDim`, intro
boot, icon). Until then the dev harness `dev/analyse.html` (Vite dev server) renders the page with the real journal
store, `bootMarket` (daily candles for the benchmark), the trade detail, toasts and confetti (`?dim=` works there too).

## Tests
- `tests/unit/views.analyse.test.tsx` – empty / fixture / legacy states, tiles + dialog, breakdown + seam, Monte Carlo
  and ruin runs, custom stat save, account switch, widgets.
- `tests/e2e/analyse.spec.ts` – 140 generated trades: every card, dialog, scrubbing, dimension switch, rows → trades,
  heatmap, custom stat persisted / removed, `?dim=`, empty journal, legacy fixture, no horizontal scroll, no console
  errors (`PW_ANALYSE_URL`, default `/dev/analyse.html`; skips where the harness is not served).
