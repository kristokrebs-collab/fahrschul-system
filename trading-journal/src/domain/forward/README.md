# `src/domain/forward` – Forward-Test: virtuelles Konto je Strategie (F23)

Pure TypeScript, no React, no I/O. A **virtual account** runs one frozen "Eigene Idee" rule tree on NEW, closed candles from a fixed start on –
never backwards. Everything shown is derived from the candles by the lab engine (`@/domain/backtest`); a model never computes a number.
The runner (candle loading, timer, saving) and the UI are in `src/views/labor/forward` (see the README of `src/views/labor`).

```ts
import { newAccount, advanceAccount, planOf, engineCfgOf, accountView, compareForward } from "@/domain/forward";

const a0 = newAccount({ id, name, config, signal, symbol, capital, riskPct, maxLeverage, exchange, slippage, funding, source }, Date.now());
const { anchorMs, intervals } = planOf(a0);                      // load the candles from the anchor on (always the same first candle)
const prep = customStrategy.prepare(data, strategyInOf(a0), a0.startMs).result();
const { account } = advanceAccount(a0, prep, engineCfgOf(a0, funding), Date.now());   // catch-up: only candles that CLOSED, from the cursor on
const view = accountView(account);                               // curve, runStats (with intervals), open position, "Stand"
```

## Catch-up = one pass (tested as a property)
`runBacktest` is resumable (`keepOpen` + `resume`, `EngineCarry` in `backtest/types.ts`): a window can end with an open position and a waiting
order, and the next call continues with the next bar. `advanceAccount` feeds every candle that closed since the stored cursor. Splitting the
candles at ANY points gives exactly the trades, the open position and the waiting order of a single pass over all of them
(`tests/unit/forward.advance.test.ts`: random cut points over three rule sets incl. break-even, trailing, partial target, long + short,
candle by candle, through JSON). Why it holds: the candle series always starts at the same anchor (`startMs − warm-up`), so recursive
indicators have the same values; a strategy decides at the close of bar i from bars 0…i only; the carry holds no bar index (the open position
stores the entry candle's open TIME).

## No look-ahead, no rewriting
- Nothing is decided on a candle that has not closed, nor before the start. The first counting candle is the one that contains the creation time
  (its close lies after the start); `startOf`.
- The rules (a sanitised copy, `key = customKey`) and the signal setting are frozen. A change is a new version = a new account.
- **Pause** = no NEW entries for candles closing inside the pause (`gateStrategy`, windows `{from, to}` in ms); an open position keeps being
  managed. **End** (`endAccount`) = the account is wound up at the last close at or before the end time: an open position is closed there
  (reason "end"), a waiting order dropped, `cursor.done`. A full account (`MAX_TRADES` = 250) ends itself at the candle of its last trade
  (`endReason: "limit"`, the same candle whether it caught up in one go or candle by candle).

## Stored shape (`settings.forward`)
`{ v: 1, accounts: [{ id, name, createdAt, status, pauses, symbol, interval, startMs, capital, riskPct, maxLeverage, exchange, slippage, funding,
config, key, signal, source, cursor, trades }] }`. Versioned passthrough: unknown root keys and unreadable account entries survive (`withAccounts`),
an id list for the cloud / two-tab `merge3`. Limits: 8 accounts, 5 not ended, 250 trades, 40 pauses.
`cursor` = `{ t, c, carry, nTrades, pnlSum, done, sig }` is a **cache** the candles can rebuild: `isCoherent` checks the check value `sig`, the trade
count and sum and the carry's realised money; anything else (a merge of two devices, a hand edit, an engine refusing the carry) is **rebuilt from
the candles** by the next `advanceAccount` (`rebuilt: true`) – deterministic, so nothing the candles still hold is lost.

## Numbers
`accountView` → `runStats` (win rate with its Wilson interval, Ø R with t-interval and p, profit factor, max drawdown …) and the equity curve:
one point per closed trade plus the mark-to-market value at the last processed close (the per-candle curve is not stored, so the drawdown is
measured on these points – the UI says so). `compareForward(forwardStats, backtestStats)` ("Hält der Forward-Test, was der Rückblick zeigt?"):
the backtest is the same rules / costs / risk over the days BEFORE the start (`backtestWindow`); rows per figure with the deviation and whether
the forward value lies inside the backtest's 80 % interval; verdict `thin` (< 10 trades on either side), `holds`, `differs` – the latter lists
possible reasons, none of them checked.
