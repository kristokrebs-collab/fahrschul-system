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
derive.ts     deriveTrade (qw), computePnlR, leverageOverRule (rule from `ED.LEVERAGE_RULE`)
fills.ts      fillStats, fillPosition, effectiveFees, runningCost, positionSlices, relabelFills (Journal v3, P06)
grouping.ts   groupTrades, detectHedges, pairKey, groupRows (Journal v3, P06)
excursion.ts  excursion (MAE/MFE), atrPctAt, holdMs/holdLabel, captureRatio, replaySteps, excursionStale (Journal v3, P06)
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
lage/         Lage-Ampel (daily / weekly trend state, decision 23)
boxes/        Box zu Box (P02): box detection, phases, setups with grade, snapshot – see src/domain/boxes/README.md
analytics/    Analyse (P03): ratios with intervals, Monte Carlo (+ worker), risk of ruin, breakdowns, dimensions, rolling,
              benchmark, compare, custom stats, significance labels – see src/domain/analytics/README.md
whatif/       „Was wäre wenn“ (F33): one trade re-run on its own candles with another stop / break-even / partial / exit on the backtest engine – src/domain/whatif/README.md
training/     Lernmodus (F38): practice rounds without the future, decision rules, history numbers – settings.training, src/domain/training/README.md
fit/          „Passt zu dir?“ (F49): a finished Labor run (what it demands) held against the journal (what it shows) – agreements and frictions with numbers, no score – src/domain/fit/README.md
discovery/    „Muster-Entdecker“: Merkmale des Einstiegs ohne Look-ahead, Permutationstest + Benjamini-Hochberg + 60/40-Bestätigung, Befund → Backtest-Filter – src/domain/discovery/README.md
timemachine/  Zeitmaschine: one trade plan played through 10 000 simulated sessions (block bootstrap of the real candles by time of day, seeded) and every earlier occasion on the real candles – both through the backtest engine, with intervals, verdict and a warning when they disagree; worker protocol – src/domain/timemachine/README.md
evolve/       Hintergrund-Optimierer (F66): mutations of a Labor rule set judged only on walk-forward test windows, robust score, multiple-testing correction over all tried variants, plateau check, learning from decisions, worker protocol – proposals only, never automatic – src/domain/evolve/README.md
analyst/      Zahlen-Analyst (F68): SEC-Fakten (verkleinert) → Einzelquartale (Restatements, Geschäftsjahr, kumulierte 10-Q-Werte, Q4), Marge/Vorquartal/Vorjahr, „Was sich geändert hat“, Hinweise; kein Konsens – src/domain/analyst/README.md
dcf/          DCF-Rechner (`/dcf`): Barwert mit Endwert, Spanne aus der 5 × 5-Sensitivität, Randfälle, „Was müsste stimmen?“, Ausgangszahlen aus SEC-Zahlen – src/domain/dcf/README.md
thesis/       Kaufthese (F69): `settings.theses`, Szenarien über den DCF, prüfbare Widerlegungsbedingungen, Prüfung gegen gemeldete Zahlen, Versionen mit Änderungsliste – src/domain/thesis/README.md
similar/      „Ähnliche Situationen“ (F19): the last closed candle described by a few numbers, the most alike earlier candles (not overlapping) and what really followed, with counter-examples – src/domain/similar/README.md
coach/        Coach (P04): behaviour detectors, edges / leaks, recommendations, trade review, German Q&A (nlq) –
              see src/domain/coach/README.md
reports/      Berichte (P04): periods, report builder, archive, pending "Bericht bereit", exports – src/domain/reports/README.md
risk/         Risiko (P05): sizing, liquidation, limits, exposure, correlation, streak risk, scenarios, per strategy, warnings –
              see src/domain/risk/README.md
strategy/     Strategien (P07): strategy extras on setups, classifier, conformity – see src/domain/strategy/README.md
backtest/     Labor (P07): backtest engine, strategies, fees, slippage, walk-forward, OOS, overfit check (+ worker) –
              see src/domain/backtest/README.md
growth/       Wachstum (P08): goals (one rule for negative targets: only R metrics and custom), streaks, challenges, habits,
              bests, skills – see src/domain/growth/README.md
psych/        Psyche (P08): states and patterns from the coach's events and P05's limits (no diagnoses) – src/domain/psych/README.md
scanner/      Aktien-Scanner (F67): market-neutral kernel – opening-range breakout, bull flag, oversold-RSI recovery on candles, pre-filter, time-sliced run with progress / cancel and honest counts – src/domain/scanner/README.md
watchlist/    Watchlist (F67): `settings.watchlist = { v: 1, items }` (stocks + crypto pairs, ≤ 50), add / remove / merge-safe, unknown keys and entries kept – index.ts
archive/      Datenarchiv (F26): Reihen-Tabelle, Gerätekonfiguration (Standard aus), Lücken mit Grund, CSV/JSON-Export – nichts geschätzt, nichts aufgefüllt – src/domain/archive/README.md
squeeze/      Squeeze-Beobachtung (F07): Funding, Open-Interest-Anstieg, Konten-Positionierung gegen einstellbare Schwellen, Box-Kontext, frühere Fälle mit Stichprobenwort, `settings.squeeze` – eine Beobachtung, kein Signal – src/domain/squeeze/README.md
newsmonitor/  News-Monitor (F68): headline rules (keyword importance as a hint, words shown), merge of duplicates, "neu seit dem letzten Besuch" – rules.ts, merge.ts
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

## Journal v3 trade fields (Wave-0 contract, owner P06)
All optional and additive – no migration, no `SCHEMA_VERSION` bump. `normalizeTrade` coerces a key only when the record
carries it (an absent key is never added), so legacy trades normalise, derive (`pnl`/`r`) and export byte-identically.
`TradeSchema` lists them leniently (`numOrNull` / `textOrNull` / `array(unknown)` / `unknown`), never required.

| Field(s) | Type | Normalised |
|---|---|---|
| `exitDate`, `syncedAt` | local wall clock like `date` / ISO | non-empty string, else removed |
| `market` | `"perp" \| "spot"` (absent = perp) | other values removed |
| `exchange`, `exchangeAccount`, `externalId`, `syncSource` | string | numbers → string, empty/other removed |
| `positionId`, `groupId`, `hedgeOf` | string | as above |
| `qty`, `fundingFees`, `slippage`, `plannedEntry`, `margin`, `liqPrice` | `number \| null` | `parseNumber` |
| `mae`, `mfe` (price distance ≥ 0), `maeR`, `mfeR`, `atrPct` | `number \| null` | `parseNumber` |
| `marginMode` | `"isolated" \| "cross"` | `ISOLATION` / `CROSS` (venue spelling) mapped, other removed |
| `tags` | `string[]` | trimmed, unique, non-strings dropped |
| `rating` | `1–5 \| null` | integer 1–5 else `null` |
| `fills` | `Fill[]` `{id, at, side open\|close, price, qty, fee?, kind entry\|add\|partial\|exit}` | entries without price/qty > 0 dropped; missing id → `f<i>`; bad kind → from side |
| `screenshots` | `ScreenshotRef[]` `{id, store idb\|cloud\|url, key?, url?, …}` | needs id + store; `url` via `sanitizeUrl`; `store:"url"` without a valid url dropped |
| `annotations` | `Annotation[]` `{id, kind hline\|trend\|box\|text\|arrow, points {time (s), price}[]}` | needs id, kind and ≥ 1 valid point |
| `stopHistory`, `targets` | `StopChange[]`, `TradeTarget[]` | entries need a numeric `price` |
| `psych` | `{stress?, confidence? 1–5, flags?, exitReason?, preNote?, postNote?}` | non-object removed |
| `origin` | `{kind manual\|api\|csv\|bot\|webhook, botId?}` | unknown kind → removed |
| `boxSnap` | opaque (`BoxSnapshot`, `@/market/boxes/snapshot`) | verbatim |
| `decision` (F24) | `{by own\|rules\|ai, via? plan\|box, ref?}` – who decided (not `origin`, which is the record's source) | `by` must be one of the three, else removed; unknown keys survive; see `provenance/README.md` |

Conventions: `size` stays the notional (qty × entry); `fees`, `fundingFees`, `slippage` are costs in `settings.currency`
(positive = paid). Whether `fills` / `fundingFees` feed the auto P&L is decided in `derive.ts` (P06) – only when present.

## Journal v3 logic (P06)
Old trades are untouched: a trade without `fills` / `fundingFees` derives exactly as before (pinned by
`domain.derive.test.ts` and the CSV tests).

- **`fills.ts`** – average-cost accounting of a scaled position. `fillStats(fills, side)` → `{ ordered (time order, stable),
  openQty, closeQty, remaining, avgEntry, avgExit, realized (per partial vs the running Ø), parts[] (per close: basis, pnl,
  share), fees (Σ fill fees, `feesKnown`), peakQty, dca {entries, adds, first, last, low, high, spread, improvement} | null,
  flat }`. `fillPosition(t)` = the `{entry, qty, gross, exit}` the derivation uses (a closed trade with a remainder prices
  it at `t.exit`). `effectiveFees(t)` = `t.fees` when set, else Σ fill fees. `positionSlices(stats)` = the position bar cut by
  every exit (`FillsBar`). `relabelFills` names the closing fill that flattens `exit`, earlier ones `partial`;
  `FILL_KIND_LABELS` = Einstieg / Nachkauf / Teil-Exit / Ausstieg. Quantities compare with `QTY_EPS`.
- **`derive.ts`** – `deriveTrade` takes `fills` (Ø entry, qty, gross P&L over all partials) only when the trade has an opening
  fill, and subtracts `fundingFees` only when it is a finite number. `leverageOverRule(lev, account)` is
  `lev > ED.LEVERAGE_RULE[account]` (personal scalp 4x / makro 5x, share 5x) – the editor's warning and the detail use it.
- **`grouping.ts`** – `groupTrades(trades, { hedges?, now? })` → `{ groups, groupOf }`: union-find over `positionId`
  (kind `position`), `groupId` (`group`) and `hedgeOf` / automatic hedges (`hedge`). `detectHedges` (sweep line) links a long
  and a short on the same `pairKey` (`BINANCE:BTCUSDT.P` = `btc/usdt` = `BTCUSDT`) whose time in the market overlaps;
  open trades older than `STALE_OPEN_MS` (14 days, a forgotten open entry) take no part. A group has `side`
  (`long | short | hedge`), summed `pnl` / `risk`, `r = pnl / risk`, `open`, `from` / `to`, a German `label` and `auto`.
  `groupRows(rows, groups)` keeps the list order and folds each group into one row at its first member.
- **`excursion.ts`** – pure maths on OHLC bars (ms): `excursion(bars, { side, entry, stop, from, to, intervalMs })` →
  MAE / MFE as non-negative price distances from the (Ø) entry plus R and where they happened (whole bars: at most one
  bar's range overstated at each end – documented). `atrPctAt` = ATR(14) % of the bars closed before the entry.
  `excursionInterval` (≤ 3 days 15m, else 1h), `captureRatio`, `holdMs` / `holdLabel` ("3 Std 20 Min"),
  `replaySteps` (running excursion per bar for the replay), `EXCURSION_KEYS` + `excursionStale(before, after)` (an edit of
  entry / stop / times / fills makes stored values stale – the editor drops them, the backfill measures again).
- **`csv.ts`** – 26 columns APPENDED after the bundle header (the first 25 columns stay byte-identical): `Ausstiegszeit;
  Haltedauer (Min);Markt;Börse;Börsenkonto;Menge;Fills;Funding;Slippage;Margin;Margin-Modus;Liq.-Preis;Tags;Bewertung;
  Stress;Zuversicht;Exit-Grund;MAE;MFE;MAE R;MFE R;ATR % Einstieg;Screenshots;Positions-ID;Gruppe;Quelle` (counts for fills
  and screenshots, tags joined with ` | `, formula-injection guard as for every text cell).

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
- `deriveTrade(t): { pnl, risk, r, rr, move, result }` — qty = size/entry (or the fills, see above); fees only in auto-P&L; leverage never used.
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
`tests/unit/domain.*.test.ts` (Journal v3: `domain.fills`, `domain.grouping`, `domain.excursion`, `domain.tradeFields`), `tests/unit/lib.*.test.ts`; `tests/fixtures/tj2-v0.json` is a legacy localStorage snapshot
(`tj2-settings` partial/raw, 13 trades incl. 2 open + one without `account`, 3 `tj2-hyblock` readings) for migration tests.

## Schlüsselmarken, Tagesplan, Alarmstufen, Warum-handeln (F09 / F08 / F22 / F10)
```
keylevels/    own key levels (touch · running break · close · N closes · buffer · retest), `evaluateLevel(level, candles, now)`,
              the five fixed levels derived from `settings.market` (nothing copied), `settings.keyLevels` (versioned passthrough),
              day plan (range / long / short / wait), alert stages + Zustellprotokoll – see src/domain/keylevels/README.md
events/       Ereigniskalender (F43): Funding-Raster, Deribit-Verfall, NYSE-Zeiten/-Feiertage, FOMC-Liste (Fed, mit Abrufdatum), eigene Termine (`settings.events`), Ereignisphasen-Analyse,
              Labor-Filter „Keine Einstiege rund um Termine“, Morgenbriefing – see src/domain/events/README.md
ledger/       Transaktionsbuch (F70, Hilfsrechnung ohne Steuerberatung): Zeilen aus dem Journal, FIFO-Zuordnung, Jahreszusammenfassung, Abgleich-Hinweise, CSV – see src/domain/ledger/README.md
decision/     `explainDecision`: required conditions · optional confirmations · contradictions · missing data, „zu spät“
              (`lateEntry`, `settings.signals.lateMaxR`, default 0.5 R); a high score never overrides a failed required condition
```

## Herkunft der Entscheidung und Demo mit Beispieldaten (F24 / F58)
```
provenance/   `Trade.decision` (wer hat entschieden: eigene Entscheidung / Regelwerk-Signal / KI-Vorschlag; additiv, nie geraten), `decisionOf` mit Grund,
              `signalHints` (nur Hinweise), `compareDecisions` (Anzahl, Trefferquote mit Wilson-Spanne, Ø R, Paare mit Benjamini-Hochberg, „zu wenig Daten“),
              KI-Protokoll `settings.aiLog` (versioniert, Passthrough, nur Helfer / Modell / Zeit / übernommen) – see src/domain/provenance/README.md
demo/         Rechenseite der Produktdemo: künstliche Beispiel-Kerzen (Sinus-Wellen, kein Zufall), Beispiel-CSV, Regelentwurf, Backtest, Demokonto, Alarm
              auf den echten Funktionen der App – nichts wird gespeichert – see src/domain/demo/README.md
```
