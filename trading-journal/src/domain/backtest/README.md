# `src/domain/backtest` – Backtest-Labor (P07)

Honest backtests on REAL exchange history: the same box engine and entry check the app runs live, decisions on closed
bars only, fees + slippage + funding, and an overfitting check that says when a result is luck.

**Import from `@/domain/backtest/index`** – the file `src/domain/backtest.ts` (the overview's `BacktestCompare`)
shadows the folder name, so `@/domain/backtest` still resolves to it (unchanged).

Pure TypeScript except `labRunner.ts` (schedules the job on a worker or in idle chunks) and `history.ts` (paging +
cache logic with INJECTED I/O – the Binance / IndexedDB wiring lives in `src/views/labor/historySource.ts`).

```
types.ts         Bar (`t` UNIX seconds), BtTrade / RunResult (times in ms), cost models, EngineCfg, BtStrategy
engine.ts        runBacktest: one position, signal at the close of bar i → fill at the OPEN of i + 1 (gap past stop /
                 target → skipped), intrabar stop BEFORE target (pessimistic when both fit one bar), gap through the stop
                 fills at the open, target = maker limit (no slippage), time stop at the close, window end at the last
                 close; size = riskPct of equity over the stop distance, capped at maxLeverage × equity; MTM equity
fees.ts          FEE_PRESETS (Binance 2/5, Bitunix 2/6, Bybit 2/5,5, OKX 2/5 bp – base tier, no discounts), feeFor,
                 funding every 8 h (00/08/16 UTC): settlementsBetween, rateAt (history ±1 h, else fallback), fundingCost
slippage.ts      fixed bp | half spread | k × ATR(14) | none – always against the trader on market / stop fills
bars.ts          atrSeries, toDaily (complete UTC days of 4h), toWeekly (Monday weeks), closedCount (binary search),
                 gapsOf, cleanBars
metrics.ts       runStats: WR + Wilson 80 %, Ø R + t-interval + one-sided p, PF, net, max DD (MTM), CAGR, Sharpe per trade
                 and annualised (daily, √365), exposure, costs, leverage-free moves (= backtest reference); downsample(Idx)
strategies/      LabStrategy contract: an expensive parameter-free `prepare` (stepped) + a cheap `build(params)`
  boxToBox.ts    the REAL `analyzeBoxes` per closed bar (window 760 bars like the live store), HTF 1D / 1W from complete
                 buckets only, bias = no data (not available historically), "pre" never traded, one trade per box idea;
                 params T1/T2, time stop, min grade A+ | A (+A+), kinds
  mcbLadder.ts   the REAL `signalsAt` at every 4h (or 1h) close with the user's `settings.signals` ladder; rungs built from
                 15m / 1h / 4h like the live engine, closed buckets only, ≤ 500 bars per rung; edge-triggered entries;
                 params target R, stop × ATR, min strength, time stop
  rules.ts       rule builder: RSI < / >, EMA cross, close vs EMA, N-bar breakout (AND, edge-triggered), stop × ATR,
                 target R, time stop
  custom.ts      "Eigene Idee" (F73): the user's rule tree (`@/domain/lab`), edge-triggered, stop ATR / % / swing, target R,
                 position management; funnel + comparison variants for the diagnosis
optimize.ts      evaluate (one parameter set over a window), scoreOf (Ø R ÷ sd × √min(n,100), ≥ 5 trades), bestTrial,
                 oosSplit (70 / 30)
walkForward.ts   wfLayout (k test windows, train = 2 × test, no overlap), wfWindow (optimise on train, trade test),
                 summarizeWf (OOS record, efficiency = OOS Ø R ÷ train Ø R)
overfit.ts       deflatedSharpe (Bailey / López de Prado, ≥ 10 trades), pboOf (CSCV, 8 blocks → 70 splits, ≥ 16 trades),
                 paramHeat (first two grid params, others at the chosen values, stability = neighbours ÷ best),
                 robustness → robust / fraglich / overfit / wenig (thresholds `ROBUST`)
history.ts       loadKlines / loadFunding: forward paging from startTime (Binance semantics, 1500 / 1000 per page),
                 closed bars only, cached per symbol + interval (head / tail fetch only, listing start remembered),
                 AbortSignal between pages; estimatePages
reference.ts     toBacktestReference (winRate + moves = the meaning of `settings.backtest`), referenceLabel
job.ts           createLabJob: stepped pipeline signals (72 %) → run → IS grid + OOS → walk-forward → full grid → PBO /
                 DSR / heat / verdict → LabResult (deterministic)
lab.worker.ts    inline module worker stepping the job in 40 ms slices with progress messages
labRunner.ts     runLab: a fresh worker per run (abort = terminate), idle chunks under file:// / single-file builds /
                 without Worker / after a worker failure – identical results
```

## No look-ahead (tested)
- The engine asks the strategy at the close of bar i and fills at the open of bar i + 1; the strategy never sees i + 1.
- `boxToBox.prepare` / `mcbLadder.prepare` give bar i the same facts with the history cut after bar i
  (`tests/unit/backtest.strategies.test.ts`).
- Higher timeframes use only buckets that had closed at that bar's close.

## Tests
`tests/unit/backtest.{engine,costs,overfit,history,strategies}.test.ts` (engine fills, costs, DSR / PBO / heat /
verdict, walk-forward layout, paging + cache, strategies and the whole job on the real BTCUSDT fixtures, idle runner =
synchronous run, abort, reference).

## Position management (F65, engine)
`EntrySignal.manage` (optional; absent = the plain stop / target, results unchanged) is decided at bar CLOSES and in force
from the NEXT bar – never retroactive inside the bar that triggered it:
- **Break-even**: after the best price since the fill reached +X R (of the ORIGINAL risk) or +X %, the stop moves to the entry
  or to the estimated NET break-even (entry fee + taker exit fee + slippage covered; funding not estimated). Only set when it lies
  behind the close; else retried at the next close.
- **Trailing stop**: ATR(14) multiple or percent behind the best price (highest high / lowest low since the fill), optional
  activation at +N R. Ratchet – the stop never loosens.
- **One partial take-profit**: a maker limit at +N R for a share of the ORIGINAL quantity (no slippage, gap through it fills at the
  better open); must lie nearer than the final target, else dropped. Optionally the stop then moves to break-even.
- Order inside a bar: the stop in force at the bar's start → partial → final target → time stop. When the bar's range holds the
  stop AND a take-profit (and the open did not gap through the stop) the stop wins and the trade is flagged `ambiguous`.
- `BtTrade`: `stop` stays the ORIGINAL stop (R = pnl ÷ original stop distance × original quantity), `stopExit` is the stop in force
  at the exit, `partials[]` the partial fills; `qty`, `fees`, `funding`, `pnl`, `r` are totals, `exit` the last fill, `move` uses
  the average exit. New exit reasons `breakeven` and `trail`. `RunResult` also counts `signals`, `skippedGap`, `skippedRisk`.
- 30m (2 × 15m) and 2h (2 × 1h) are built from COMPLETE exchange buckets (`deriveBars`); the loader only asks for 15m / 1h.

## "Eigene Idee" and the diagnosis (F73) – `src/domain/lab`
- `rules/types.ts` – `CustomConfig` (`version: 1`): `interval` (execution), `sides`, two `Group` trees (`long`, `short`; AND / OR,
  nested, `Leaf` = block + params + own timeframe `"exec" | TfId` + optional `not`), `stop`, `target`, `exits`. Tri-state per bar:
  0 false · 1 true · 2 UNKNOWN (never satisfies a required leaf; Kleene logic).
- `rules/blocks.ts` – 15 blocks (RSI level / vs its MA, MCB events, WaveTrend state, MCB-ladder verdict, premium / discount, MA cross,
  price vs MA, MACD, Bollinger, ATR percentile, N-bar breakout, own price level, volume spike, RSI trendline break). Value at bar i
  uses bars ≤ i only (tested by cutting the history after i on real bars). The RSI trendline (`boxes/rsiLines`) is evaluated on the
  window ending at every bar (cost: heavy, flagged in the UI).
- `rules/tree.ts` – `sanitizeCustom` (clamps, unknown blocks dropped, unique ids), `parseCustom` (version check), `validateCustom`
  (German messages; errors block the run), `summarizeCustom` ("Long wenn … UND …"), `evaluateLeaves` + `mapToExec` (a higher
  timeframe is visible only once its bar has CLOSED at the execution bar's close; a hole in its data → unknown), `combineTree`.
- A new signal = rising edge of a side's tree; long and short on the same close → no trade (counted as conflict).
- `diagnosis/diagnose.ts` – `diagnoseRun(result: LabResult, cfg: DiagnoseCfg, data: DiagnoseData): Diagnosis`, pure, JSON-safe,
  deterministic. `data.bars` = execution bars of the run (index space of the trades). Shape (see `diagnosis/types.ts`):
  `coverage` (rows per interval, expected vs received, gaps, warm-up), `funnel` (examined → rules → new signals → valid entries →
  blocked by an open position → handed to the engine → skipped gap / risk → executed), `costs` (gross, fees, slippage, funding,
  net, cost share, cost in R), `exits` (per reason n / share / Ø R), `sides`, `byHour` (4 h blocks, UTC), `byWeekday`, `payoff`
  (Ø vs median winner / loser, break-even win rate, top-3 share), `excursion` (stop in ATR / %, MFE / MAE, losers that were green,
  quick stops), `ambiguous`, `sample` (level + warnings), `compare` (base + "ohne Kosten", "ohne <Filter>", "ohne Verwaltung"
  re-runs from the job's `diagnose` phase) and `findings[]` – ranked `{ id, severity, title, text, evidence[] }`, each an
  OBSERVATION with the numbers it rests on. Thresholds are exported as `DIAG`.
- Tests: `tests/unit/backtest.exits.test.ts`, `lab.rules.test.ts`, `lab.custom.test.ts`, `lab.diagnosis.test.ts`,
  `views.labor.custom.test.tsx`, e2e `tests/e2e/labor-custom.spec.ts`.
