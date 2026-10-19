# `src/domain/missed` – Verpasste Chancen (F32)

Pure TypeScript. The signal events the app raised, held against the journal: „regelgerecht, nicht gehandelt“.

| File | What |
|---|---|
| `archive.ts` | `SignalEvent {id, key, at, source: entry · box · key, kind, entry, symbol, side, tf, label, detail, strength, score, ref, watch}`; `parseSignalArchive` (tolerant, versioned wrapper `{v: 1, items}`, a NEWER version reads as `foreign` and must not be overwritten), `appendSignalEvent` (one per `key`), `prune` (newest `SIGNAL_ARCHIVE_CAP` = 300, at most `SIGNAL_ARCHIVE_DAYS` = 120 days; events marked „Beobachten“ go last), `setSignalWatch`. |
| `outcome.ts` · `traits.ts` · `inbox.ts` · `balance.ts` · `quality.ts` · `presence.ts` | see the sections below. |
| `match.ts` | `matchSignals(events, trades, now)` → `MissedReport {rows, missed, traded, open, context, beforeJournal, total, since, until}`. A signal is **gehandelt** when the journal has a trade of the SAME side on the same market from 30 min before to 6 h after it, **offen** while that window runs, otherwise **nicht gehandelt**. A trade with an unreadable pair counts as a match (the doubt goes to the trader). Only `entry` events with a side can be missed; breakouts, targets, hits without a direction are `context`. Signals older than the journal's first trade are not judged (`beforeJournal`). |

## Where the events come from (and where they do not)
`src/market/signalArchive.ts` stores them (`tj2-signal-events`, this device only, not part of backup or cloud sync – like the
Zustellprotokoll nothing new goes to a server). Three existing places record, additively, when they raise a signal:
the entry-check notifier (`market/signals/notify.ts`: a valid entry after the hold time, once per signal bar), the Box-zu-Box alerts
(`market/boxes/alerts.ts`: `setup` and scanner `scan` are entries, `breakout` / `retest` / `failed` / `target` are context), and the
key-level alerts (`market/keylevels/alerts.ts`: a **confirmation** or **retest** of an own level with a direction – only for levels
whose alerts the trader switched on). Before F32 a signal was only toast text in the Zustellprotokoll (no side, no market,
200 lines in all) – the archive starts empty and **cannot be filled retroactively**. Signals that occur while the app is closed are
not seen.

## Ausgang je Signal (F32, `outcome.ts`, `traits.ts`)
`evaluateSignal(event, candles, {now, atrPct, intervalMs})` → `SignalOutcome {kind: target · stop · open · unusable, basis: own · standard, sameBar, entry, stop, target, rr, r, hitAt, bars, horizon, reason}`.
Pure and deterministic; the candles come in as an argument (the loader is `src/views/coach/signalOutcomes.ts`). Rules, all shown on screen:
the candle the signal fell into does not count, the first candle that **opens** at or after it is the entry candle (entry = its open unless the
signal has a price of its own, which must then be touched); stop / target are the signal's own marks (Box setup: entry · stop · first target, own level:
its invalidation as the stop), a missing mark is filled with the standard measure (stop 1,5 × ATR(14, 1h) before the signal, target 2 R) and the result is
labelled `standard`; target first → +R, stop first → −1 R, **both inside one candle → the stop counts** (`sameBar`); neither within the candles / 14 days → `open`
(`horizon` after 14 days, final); marks on the wrong side, no direction / market, no candles → `unusable` with the reason. No fees, no slippage, no funding.
`isFinalOutcome` marks what can never change (the loader caches only those). `compareTraits(missedEvents, outcomes)` sets the traits (side, kind, timeframe, part of
the day, strength, market) of the missed winners against the missed losers: nothing below **20** decided missed signals, both groups ≥ 3, a value from 5 signals on,
the 80 % Wilson interval of each quote against the overall quote („sticht heraus“ only when the whole interval is on one side), **counterexamples always** (≤ 3 per row),
no cause. Tests: `missed.outcome.test.ts`, `missed.outcome.tv.test.ts` (24 real BINANCE:BTCUSDT.P 15m candles from TradingView, hand-counted), `missed.traits.test.ts`.

## Posteingang, Bilanz, Qualität (F28 · F25 · F27, `inbox.ts`, `balance.ts`, `quality.ts`, `presence.ts`)
- **`inbox.ts`** – `buildInbox(events, trades, now)`: status per event – `gehandelt` (journal trade in the window, or linked by hand) → `ausgelassen` (reason set) →
  `abgelaufen` (window over) → `angesehen` → `neu`; relevance order written out in the file header and shown on the card (status, entry, own market, strength, recency);
  `filterInbox`, `linkCandidates` (same market, ±24 h), `signalKindLabel`, `signalLevelLabel`.
- **`balance.ts`** – `buildBalance(events, trades, outcomes, now, by, basis)`: per kind / setup / timeframe: n, traded, left out, expired, running, target / stop / open /
  unusable, hit rate (Wilson 80 %), Ø R (t-interval), sample word (`keine · zu wenig · dünn · tragfähig`); `comparison`: all signals · the traded ones (outcome on the
  chart and booked R of the journal trades, each trade once) · left out / expired, and the difference – with `SELECTION_NOTE` (selection, timing and exit are mixed in;
  no verdict on the signals or on the trader). The basis (`own` / `standard`) can be filtered so the two readings are never averaged without the reader choosing it.
- **`quality.ts`** / **`presence.ts`** – `qualityReport({now, events, log, presence, gaps})`: presence share and breaks ≥ 10 min (`unknown` without a trace – never a guess),
  delay between candle close and alert per source (median, p90 from 5, longest, > 5 min), Zustellprotokoll counts (sent · duplicate · outside active hours · no channel ·
  repeated key, `truncated` when the 200 lines no longer reach the window), `findBarGaps` for the on-demand candle check.
Tests: `missed.inbox.test.ts`, `missed.balance.test.ts`, `missed.quality.test.ts`.

## What changed in the archive
The event grew additive fields (version stays `1`; a record without them reads as `null`): `price`, `stop`, `target`, `barClose`, `name`, `setupKind`, `grade`, `rr` (set by the three recording points),
and the trader's inbox marks `seenAt`, `skip` (+ `skipAt`), `tradeId`. Still this device only, not in the backup or the cloud sync, newest 300 / 120 days.

## What it cannot say
- Whether a signal was skipped on purpose or overlooked – unless the trader says so in the inbox („Ausgelassen – Grund“, a mark of his own).
- **Whether a signal would have been a good trade**: the outcome is the path of the price after it, read with the rules above – not a booked trade (no fees, no slippage, no funding), and not a statement
  about the next signal. A retrospective re-scan of history with today's rules is not done on purpose: it would be a new, hindsight-optimised rule, not the signal the trader saw.
- Signals from before the archive existed, or while the app was closed: they are not there and cannot be added.

Tests: `tests/unit/missed.domain.test.ts`, `tests/unit/views.coach.missed.test.tsx`, `tests/unit/views.coach.signalchain.test.tsx`, `tests/unit/views.coach.signalOutcomes.test.ts`; the recording points are asserted in
`market.signals`, `market.boxes` and `market.keylevels` tests.
