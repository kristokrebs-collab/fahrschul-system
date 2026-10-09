# `src/domain` – data model, formulas, explainers, exports

Pure TypeScript, no React, no I/O. Every function is a 1:1 port of the original bundle (alias in parentheses;
aliases are also exported, e.g. `wn`, `Hw`, `qM`). German UI strings are verbatim (Anhang A/B) and checked by
`tests/unit/domain.strings.test.ts` (edition copy is checked as its fragments; the composed sentences are pinned by the
explain / trigger tests).

```
types.ts      Trade, EnrichedTrade, Settings, Setup, Rule, HyblockReading, DayNote, JsonBackup, TradeFilter, StoreApi … (lead)
defaults.ts   DEFAULT_SETTINGS (HM), DEFAULT_SETUPS (edition setups + s_mtf), DEFAULT_RULES (LG, 5), DEFAULT_MISTAKES, palette,
              levelsConfigured / weeklyConfigured / zoneConfigured
edition/      personal.ts, share.ts, mtf.ts (pure literals) + index.ts (`ED`, picked at build time)
normalize.ts  normalizeSettings (qM), normalizeTrade, normalizeReading, sortReadings, normalizeDayNote(s), isEmptyDayNote,
              mapToBinanceSymbol
schemas.ts    zod: TradeSchema, HyblockReadingSchema, RawSettingsSchema, SettingsSchema, JsonBackupSchema (all passthrough)
derive.ts     deriveTrade (qw), computePnlR, leverageOverRule
enrich.ts     checklistItemsFor (Uw), enrichTrade / enrichTrades (FG), pruneChecks
agg.ts        aggregate (wn) → Agg, EMPTY_AGG
account.ts    accountView (Hw) → AccountView (equity, drawdown, streak, months, projection, per-setup)
rank.ts       rankSetups (rT), RANK_KEYS (nT), rankSetupStats, splitRanked, setupVisibleFor
patterns.ts   minePatterns (The) → PatternRow[]
checklist.ts  evaluateChecklist, explainChecklist, missedLabel
trigger.ts    scenario (Ng), evaluateTrigger → TriggerState, zoneWarning, countdownLabel
fallingKnife.ts fallingKnife (JG), knifeCardLine, knifeVerdict, explainFallingKnife, readingAge, liveReading
explain.ts    explain (Jl), explainSetup (g2), EMPTY_VERDICT (Ql), tradeLine (Ig), heroTileValue, heroSubline
backtest.ts   backtestCompare (bhe), explainBacktest (h2), hasBacktestSetup, isBacktestTrade
csv.ts        tradesToCsv, csvCell, toJsonBackup, jsonBackupText, exportFilename, stripEnrichment
insights/     Auswertung metrics (Tradezella-style: calendar, discipline, mistakes, risk, edge, R distribution, recap …),
              see src/domain/insights/README.md
signals/      multi-timeframe entry check (MCB + RSI + Premium/Discount, strength score), see src/domain/signals/README.md
```

## Editions (`edition/`)
- `ED` (`@/domain/edition`) is the data of the build's edition: `RULES, SETUPS, BACKTEST, MARKET, CAPITAL, LEVERAGE_RULE, COPY`.
  `__TJ_EDITION__` is a build-time constant, so the other module is dropped from the bundle. Personal = the user's setups, levels,
  capital and copy; share = neutral setups, levels 0 ("nicht gesetzt"), no personal texts.
- `personal.ts`, `share.ts` and `mtf.ts` are PURE LITERALS: `scripts/privacyGuard.ts` reads them as text and fails a share build
  that contains any personal string. Never import `edition/personal` directly – go through `ED`. Copy that differs per edition
  (`COPY.backtestDeleted`, `COPY.leverageRuleSentence`, `COPY.scenarioTargets`, `COPY.setupNamePlaceholder`, …) lives in `COPY`.
- `MTF_SETUP` (`s_mtf`, checklist ids `mtf_base|mtf_next|mtf_third|mtf_rsi|mtf_zone`) exists in both editions and 1:1 in the other
  journal version, so `checks["s_mtf:mtf_base"]` round-trips.
- `levelsConfigured(settings)` (both 4H triggers > 0), `weeklyConfigured` (`lowerHigh` > 0), `zoneConfigured` (`zoneLow`/`zoneHigh` set):
  the share edition starts unset – the market panel, scenario texts and the scenario toast stay hidden until levels are entered.

## Fields shared with the other journal version (never dropped)
- `Trade.mistakes?: string[]` (normalised to `[]`), `Trade.signal?: unknown` (a `SignalSnapshot`, parsed by the signal module, passed
  through verbatim everywhere).
- `Settings.mistakes: string[]` (default `DEFAULT_MISTAKES`), `Settings.signals?: unknown` (absent until saved), plus passthrough keys
  such as `settings.discipline` (Disziplin-Grenzen, read by `insights/discipline.ts`).
- `s_mtf` append guard (`normalizeSettings`): settings from before the multi-TF era – non-empty `setups`, and neither a `mistakes` nor a
  `signals` key – get `s_mtf` appended ONCE; after the first save `mistakes` is persisted, so a deleted `s_mtf` never comes back.
- `TIMEFRAMES` = `1m 5m 15m 30m 45m 1h 2h 4h 1D 3D 1W` (30m / 45m / 2h from the other version).
- `mapToBinanceSymbol(raw)`: a USD pair from another exchange (`BYBIT:BTCUSD`, `XBTUSD`) maps to the Binance USDⓈ-M symbol
  (`BINANCE:BTCUSDT`); the original stays in `market.sourceSymbol`.
- `DayNote` (`tj2-days`, `{ "YYYY-MM-DD": { note, plan?, review?, mood? 1–5, updatedAt } }`): `normalizeDayNote(s)` keeps unknown fields,
  `isEmptyDayNote` → the entry is removed instead of stored.

## Pipeline
```ts
import { normalizeSettings } from "@/domain/normalize";
import { enrichTrades } from "@/domain/enrich";
import { accountView } from "@/domain/account";
import { explain } from "@/domain/explain";

const settings = normalizeSettings(JSON.parse(localStorage.getItem("tj2-settings") ?? "null"));
const enriched = enrichTrades(trades, settings);            // recomputes pnl/r, adds risk/rr/move/result/items/checked/complete
const view = accountView(enriched, settings, "all");        // "all" | "makro" | "scalp"; opts.now for deterministic tests
const netExplainer = explain("net", view, settings);        // { title, what, formula?: FormulaSegment[], rows, verdict }
```

## Key signatures
- `deriveTrade(t): { pnl, risk, r, rr, move, result }` — qty = size/entry; fees only in auto-P&L; leverage never used.
- `aggregate(closed: EnrichedTrade[]): Agg` — `n, wins, losses, be, net, gw, gl, fees, winRate, pf (∞ possible), avgWin, avgLoss (neg.), beWinRate, payoff, avgR, rN, r2, bestR, worstR, exp, best, worst, moveWin, moveLoss, moveExp, moveN`.
- `accountView(all, settings, acc = "all", { now? })`: `{ start, list, closed (tt asc), open, g, equity: {i,v,t}[], balance, maxDD, dd:{peak,trough,peakI,troughI}, curDD, peak, streak, streakType, months: MonthBucket[] (last 12, "Sep 26"), proj: {days,r,linear,comp,monthly,perWeek,endLin,weak}|null, setups: SetupStats[], none }`.
- `rankSetups(list, key)` — desc by key (null → −∞), ties → more trades first.
- `minePatterns(closed): PatternRow[]` — rows `plan | side | account (only if both) | conviction | emotion (≥2 groups) | weekday (≥2 groups)`; tile value = `n ? pct0(winRate) : "–"`, caption `"{n} Trades · {signed(net,0)}"`.
- `evaluateChecklist(closed)` → `{ withList, full, gaps, missed (top 3), items (with vs without per item) }`; `explainChecklist(ev)`.
- `scenario(close4h, levels)` → `{ key: "bear"|"long"|"short"|"range", tone, title, detail } | null`; strict `<`/`>`.
- `evaluateTrigger({ price, close4h, close4hLive?, closeW, rsiW, levels })` → `{ scenario, livePreview, weekly:{show, weeklyOk, rsiOk, rsiBar, rows}, zone:{inZone, warning}, distance:{toLong, toShort, longLabel, shortLabel, longInReach, shortInReach}, longInvalidated }`.
- `fallingKnife(cur, prev, { price, source? }, settings)` → `{ pts[4], n, rising, knife, all }`.
- `backtestCompare(closed, settings.backtest, "all" | "bt")` → rows (`Win-Rate`, `Ø Gewinner`, `Ø Verlierer`, `Erwartung pro Trade`), headline, sub, warnBadge.
- `explain(key, view, settings)` for `net | trades | winRate | pf | avgR | maxDD | exp | projection | streak`; `explainSetup(setupStats, view.list, currency)`; `explainBacktest(key, agg, settings)`; `explainFallingKnife(fk)`.
  `Explanation = { key, title, sheetTitle?, what, formula?: FormulaSegment[], rows: [label, value, cls?, subline?][], verdict: { tone, text } }`; `formulaText(f)` flattens (`br` → `\n`).
- `tradesToCsv(enriched, settings)` — BOM + `;` + header verbatim, rows sorted by `tt`, numbers `.`→`,`, quoting on `"`/`;`/newline, `null` → `""`.
- `toJsonBackup(trades, settings, hyblock?, now?)` → `{ exportedAt, settings, trades (enrichment stripped, pnl/r kept), hyblock?, schemaVersion: 1 }`.

## Constants worth knowing
`BACKTEST_SETUP_ID = "s_bt"`, `ACCOUNT_LABELS` (`Gesamt/Makro/Scalp`), `SETUP_ACCOUNT_LABELS` (`Beide`), `CONVICTION_LEVELS`, `RESULT_LABELS` (`Gewinn/Verlust/Break-even/Offen`), `LEVERAGE_RULE`, `HYBLOCK_LINK`, `nextSetupColor(setups)`, `BACKTEST_SETUP_DELETED`, `TRIGGER_REACH_THRESHOLD = 0.003`.

## Tests / fixture
`tests/unit/domain.*.test.ts`, `tests/unit/lib.*.test.ts`; `tests/fixtures/tj2-v0.json` is a legacy localStorage snapshot
(`tj2-settings` partial/raw, 13 trades incl. 2 open + one without `account`, 3 `tj2-hyblock` readings) for migration tests.
