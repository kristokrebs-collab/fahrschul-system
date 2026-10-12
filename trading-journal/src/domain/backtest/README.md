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
