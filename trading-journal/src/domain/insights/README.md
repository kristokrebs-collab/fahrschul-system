# `src/domain/insights` – Auswertung metrics (Tradezella-style)

Pure TypeScript, no React, no I/O. Every function takes the closed trades of the current account view
(`accountView(…).closed`, trade-time order) and aggregates with `aggregate()` (`../agg.ts`), so every number agrees
with the Hero, the explainers, `MonthlyCard` (`view.months`) and the other views. One day key everywhere:
`dayKeyOf(t)` = local date of `trade.date` (entry time – the journal stores no exit time).

```
shared.ts      dayKeyOf, dayFromKey, groupByDay, accountOf, piecewise (continuous anchors), wilson (80 %), compact ("+1,2k"), mode
calendar.ts    calendarMonth(closed, {y,m}, {notes?, today?}) → 6 weeks × 7 cells + week rows (in-month days only) + month agg,
               dayWinRate, best/worst day, p90 tint scale; monthRange, initialMonth, unitValue (€ | Σ R | % of capital),
               dayView(list, key) → trades, open trades, agg, Σ R, intraday cumulative curve; adjacentTradedDays
edge.ts        edgeScore(view) → 6 axes (PF 25, Gewinn/Verlust 20, Drawdown 20, Win-Rate 15 (60 % = 100), Erholung 10,
               Konstanz 10), score, weakest axis; scorePF/scorePayoff/scoreDrawdown/scoreWinRate/scoreRecovery/
               scoreConsistency; equityDrawdown (= accountView's algorithm); edgeScoreUntil; edgeTimeline (monthly)
mistakes.ts    mistakeReport(closed, setups, withAuto) → rows (n, manual/auto, excess money + R, share, trades), clean agg,
               leak; autoMistakes (Kein Stop, Zu großer Hebel, Gegen den Plan, FOMO, Revenge, Checkliste unvollständig,
               Ohne Grundlage, Gegen Einstiegs-Check, Verlust größer als 1R)
signal.ts      snapOf(t) (memoised parseSignalSnapshot of trade.signal), strengthRows (4…0, "Ohne Check"),
               conditionEffects (Basis/nächste/dritte TF, RSI, Zone: win rate / Ø R / Ø P&L met vs missed)
discipline.ts  scoreDay / disciplineDays / disciplineSummary / heatMap / disciplineStreak; 10 automatic rules; limits from
               settings.discipline (passthrough) or DEFAULT_LIMITS (2 % per trade, 4 % per day, Scalp 5 / Makro 2 trades)
time.ts        sessionOf (UTC: Asien 00–07, London 07–13, New York 13–21, Spät 21–24, Wochenende Sa–So), byWeekday,
               bySession, byHour (2 h, local), bucketSummary (best/worst/busiest/best win rate, n ≥ 3)
risk.ts        rDistribution (7 R bins, Ø planned rr, share ≥ 2R, losses < −1,1 R, winners' R efficiency);
               drawdownReport(view) → under-water points, max/current/avg DD, recovery factor, longest phase, needed gain
winloss.ts     winnersVsLosers → 12 rows, top-3 normalised differences highlighted
findings.ts    findings(closed, {capital, currency}) → top 3 by |impact| = Σ P&L(G) − n(G)·Ø P&L(rest); n ≥ 5 per side,
               |ΔWR| ≥ 10 pp or |impact| ≥ 1 % capital; "klar" when outside the 80 % Wilson interval
recap.ts       periodRange (ISO week / month), recapFor, recap (current, or previous below 4 trades), recapSentence
copy.ts        titles, empty states, explainers (`Explanation` for the overview's ExplanationView)
```

Tests: `tests/unit/insights.{calendar,edge,metrics,view}.test.ts(x)`, fixture `tests/unit/insights.fixtures.ts`.
