# `src/domain/missed` – Verpasste Chancen (F32)

Pure TypeScript. The signal events the app raised, held against the journal: „regelgerecht, nicht gehandelt“.

| File | What |
|---|---|
| `archive.ts` | `SignalEvent {id, key, at, source: entry · box · key, kind, entry, symbol, side, tf, label, detail, strength, score, ref, watch}`; `parseSignalArchive` (tolerant, versioned wrapper `{v: 1, items}`, a NEWER version reads as `foreign` and must not be overwritten), `appendSignalEvent` (one per `key`), `prune` (newest `SIGNAL_ARCHIVE_CAP` = 300, at most `SIGNAL_ARCHIVE_DAYS` = 120 days; events marked „Beobachten“ go last), `setSignalWatch`. |
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

## What it cannot say
- Whether a signal was skipped on purpose or overlooked, or the trader was away: the journal has no such record.
- **Whether a missed signal would have worked**: the price path after a signal is not archived, a missed signal has no outcome.
  Hence **no comparison of recurring traits against comparable failures (Gegenbeispiele)** is computed – it would need per signal
  the entry / stop / target and the path to the outcome. The card states this and the sample instead of a pattern. Not built on
  purpose: a retrospective re-scan of history with today's rules would be a new, hindsight-optimised rule, not the signal the
  trader saw.
- A „Testen“ draft for the Labor (F12) does not exist yet: the action opens the Labor page only.

Tests: `tests/unit/missed.domain.test.ts`, `tests/unit/views.coach.missed.test.tsx`; the recording points are asserted in
`market.signals`, `market.boxes` and `market.keylevels` tests.
