# `src/domain/risk` – Risk management (P05)

Pure TypeScript – no React, no I/O. Tools before the trade (size, stop, target, R:R, liquidation) and limits that work
live (day, week, drawdown, open risk, loss per trade, trades per day, leverage) with the pause, plus exposure,
correlation, streak risk, scenarios and the risk spread per strategy / asset. The UI is `src/views/risiko` (see its
README); the daily candles for the correlation come from `src/market/multiDaily.ts`.

```
config.ts       settings.risk (passthrough key) → riskSettingsOf (sanitiser), riskLimits(settings) = settings.risk +
                settings.discipline (maxLossDayPct, maxLossTradePct, maxTrades – NOT duplicated) + ED.LEVERAGE_RULE;
                withRiskSettings(prev, patch) (unknown keys kept, invalid refused, same object when unchanged);
                DEFAULT_TIERS (Binance BTCUSDT maintenance tiers – an approximation), sanitizeTiers, tiersToJson
sizing.ts       positionSize (capital × risk %, stop, taker fee per side, stop slippage → qty, notional = Trade.size, needed
                leverage, margin, over the rule → the size the rule allows), stop candidates (% · ATR · box edge
                − 0,25 ATR · structure − 0,1 ATR), rTargets (1/2/3 R), boxTargetsFor (Box-zu-Box targets with R), rrCalc
                (R:R gross / after fees, breakeven price, the win rate it needs)
liquidation.ts  liquidationPrice: one-way linear contract, W + s·Q·(P − E) = Q·P·mmr − cum solved for P; isolated
                (margin or notional ÷ leverage) or cross (wallet); tier by the notional AT the liquidation price;
                distance in % and ATR; tierTable (maintenance amounts from the floors); liqBeforeStop
limits.ts       limitStatus(input) → LimitReport: rows day / week / drawdown / openRisk / trade / trades / leverage with
                ok · warn (from warnAt) · breach; scope "all" checks every account against its own capital and reports
                the worst; P&L counts on the CLOSE day (exitDate → the guard's mark → entry time); cooldownOf: a
                breached day pauses until midnight, `cooldownLosses` losses in a row pause `cooldownMin` minutes
exposure.ts     exposureReport: open journal trades + venue positions (P11 contract) as legs (a trade that IS a venue
                position counts once), gross / net / hedged per asset and venue, HHI, cross-venue assets, uPnL
correlation.ts  logReturns, pearson, correlationMatrix (aligned by UTC day, ≥ 20 overlapping days, last 90),
                correlationClusters (union-find, ρ ≥ 0,7), clusterRisks (same-side legs inside a cluster)
streakRisk.ts   expected longest losing streak over 100 trades (P03 Schilling) + Monte Carlo of the own results (P03
                engine, seeded), the current streak against it (normal / erhöht / akut), drawdown of a streak
scenario.ts     shock ±x % on every leg → P&L against now (an isolated liquidation loses the margin), liquidations,
                equity and margin load after; scenarioCurve over ±30 %; liquidationShock per leg
perStrategy.ts  riskSpread per setup or asset: risk per trade in % of the start capital – mean, sd, max, consistency
                (1 − CV), trades above the per-trade limit, the steadiest strategy (n ≥ 5)
warnings.ts     riskWarnings(state) (limits, pause, concentration, cross-venue, correlated clusters, close
                liquidations; breach first) and riskPreview(draft, ctx) – the editor's check before a save (risk vs. the
                per-trade limit, leverage rule, liquidation before the stop, day limit, open risk, trades per day, pause)
```

## Conventions
- Money limits are fractions of the account's START capital (`settings.capital`, like the discipline score).
- Nothing blocks the journal: every state only drives warnings, toasts and the pause (which the user can override).
- Every liquidation is labelled "Näherung" in the UI; the tier table is editable.
- Tests: `tests/unit/risk.{sizing,liquidation,limits,exposure,multiDaily}.test.ts`.
