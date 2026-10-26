# `src/views/labor` – Labor (P07)

Honest backtests on real Binance USDⓈ-M history: `h1 Labor`. Import from `@/views/labor`; the engine is
`@/domain/backtest/index` (the barrel must be imported with `/index` – `@/domain/backtest` is the older
`backtest.ts`, BacktestCompare). Registered as page `labor` by the integrator (P14); until then `dev/labor.html`.

| export | what |
|---|---|
| `LaborView` | `{ className? }` – sections `Versuchsaufbau` (ConfigCard 7 · AssumptionsCard 5), `Lauf` (RunCard · TradesCard after a run), `Robustheit` (OverfitCard · OosCard · WalkForwardCard · HeatmapCard, after a run), `Vergleich` (CompareRunsCard · ReferenceCard). `data-testid="labor-view"`, `data-status`. Mounts `LabReplayHost`. |
| `LABOR_LEAD_FILL` | lead fill key `storageKey("fill-labor")`, highlight `echter Binance-Historie`. |
| `useLabor` | zustand: `cfg` (`LabConfig`, localStorage `storageKey("labor")`), `status` idle/loading/running/done/error/cancelled, `phase`, `progress`, `load {done,total}`, `result` (`LabResult`), `bars` (execution bars of the run, memory only), `runs` (≤ `RUNS_MAX` summaries, localStorage `storageKey("labor-runs")`), `replayId`, `fundingUsed`, `runCfg`; actions `setCfg`, `setParam`, `openReplay`, `clearRuns`. |
| `startLab(signalCfg, now?)` / `cancelLab()` | loads the history (`loadLabData`) and runs the job (`runLab`: inline worker per run, idle chunks under `file://` / single-file / no Worker). A newer start aborts an older one. Load errors → honest German text (blocked / rate / symbol); a failure of the computation itself is `Der Lauf ist fehlgeschlagen.` (never blamed on the network). |
| `planOf(cfg, signal)` / `pagesEstimate(cfg, signal, now?)` | intervals to load, warm-up, completed params; page estimate for `labor-estimate`. |
| `loadLabData`, `LAB_BUDGET`, `LAB_CACHE_PREFIX`, `__setHistoryDeps` | the lab's own loader: `binanceRest` → same-origin `proxyRest` on 451 / CORS / network (never in the file build), own `TokenBucket` (300 weight / min, sequential pages), IndexedDB cache (`tj-market`, key `${storageKey("labor")}:{symbol}:{interval}`, closed bars only; funding `…:funding`). |
| `labReplayModel(trade, bars, intervalMs)` | pure replay model of a backtest trade for the journal's `ReplayChart` + `ScrubTimeline`. |
| `assumptionLines`, `principleLines`, `LABOR` | the assumptions the run makes (data, costs, what is NOT simulated) and the German copy. |

## Cards and effects
- `ConfigCard` (`labor-config`): strategy tiles (`labor-strategy-{box|mcb|rules}`, `role="radio"`, glide `layoutId="labor-strat-{uid}"`), market `Autocomplete`, period / params as `ChipPick` (ink thumb like `Segmented`, glide `layoutId="labor-chip-{id}"`), rule builder (`MorphSelect`), costs in an expander (fees preset, slippage, funding history/flat/none, capital, risk, max leverage), `labor-start` / `labor-cancel`, `labor-estimate`.
- `RunCard` (`labor-run`, `data-status`): busy = `RadarSweep` band + `DotMatrixText` snake percentage inside `role="progressbar"` (`labor-busy`; never a live region); done = `EquityDraw` with glowing head driven by one MotionValue (`labor-equity`), trades as dots with a capped `spawnMarkerRipple` sequence (`RIPPLE_CAP`), `NumberCascade` KPIs (`labor-kpis`), race vs buy & hold (`labor-race`). Reduced motion: end state at once.
- `TradesCard` (`labor-trades`, rows `labor-trade` → replay sheet `labor-replay`).
- `RobustCards`: `OverfitCard` (verdict as `TactileHighlight` tone signal, `labor-verdict`; DSR `ConfidenceMeter`; PBO logit histogram), `OosCard` (`labor-oos`, 70/30), `WalkForwardCard` (`labor-wf`, rail train: grey train, white test), `HeatmapCard` (`labor-heat`, `HeatGridReveal`, `role="grid"`, thin cells marked).
- `SideCards`: `AssumptionsCard` (`labor-assumptions`), `ReferenceCard` (`labor-reference`, `HoldButton` `Als Backtest-Referenz übernehmen` `labor-adopt` → `celebrateRecord` + toast, writes `settings.backtest` with the same meaning as `BacktestCompare`: win rate + leverage-free moves), `CompareRunsCard` (`labor-compare`, `CardSpread` deal, `labor-run-card`).

All motion uses transform / opacity / clip-path, tokens from `@/motion/tokens`, finite loops, `useReducedFx` end states; decorative layers are `aria-hidden`.

Tests: `tests/unit/views.labor.test.tsx`, `tests/unit/backtest.*.test.ts`, e2e `tests/e2e/labor.spec.ts` (dev harness `dev/labor.html`, `PW_LABOR_URL`).

## Eigene Idee und Diagnose (F73)
- `ConfigCard`: strategy tiles – **Eigene Idee** first and widest (`labor-strategy-custom`), then the three templates. For the custom
  idea the card shows `RuleBuilder` (`labor-builder`): name + drafts (`labor-drafts`, save / load / duplicate / delete, versioned in
  `storageKey("labor-drafts")`, ≤ 24), templates (`labor-template-<id>`), execution interval (15m … 1D), side (Long / Short / Beide), the
  AND / OR tree (`labor-tree`, `labor-leaf` with `data-block`, `labor-add-cond` → block gallery `labor-block-<id>`), stop / target /
  management, the plain-language summary (`labor-idea-summary`) and the live check (`labor-check`). Unavailable options are disabled
  WITH a reason (timeframes below the execution interval, the MCB ladder off 1h / 4h, exit on counter signal without both sides).
  An idea with errors cannot start (`labor-start` disabled, `aria-describedby` → the check).
- `DiagnosisCard` (`labor-diagnosis`, section "Diagnose", under every finished run): ranked findings (`labor-finding`), rule funnel
  (`labor-funnel-row`), comparison table (`labor-compare-table`), costs, exits, direction / time, data coverage. `useDiagnosis()`
  returns the `Diagnosis` of the shown run (from `@/domain/lab`).
- Store: `cfg.custom` (sanitised `CustomConfig`), `drafts`, `setCustom`, `saveDraft`, `loadDraft`, `duplicateDraft`, `deleteDraft`.

## Belastung, Prüfbericht, Filtervergleich (F20 / F18 / F17)
Section `Belastung, Bericht, Filter` (`labor-extras`) between the diagnosis and the robustness cards, only with a finished run. `ExtrasSection`
is its own chunk (`lazy` in `LaborView`); its three cards are collapsible (`labor-extra-{stress|report|filters}`, toggle
`labor-extra-toggle-*`, `aria-expanded`) and mount their body (`StressBody`, `ReportBody`, `FilterBody`, each a lazy chunk) on the first opening.
- `extrasStore.ts` (`useExtras`): `stress` / `filters` slices (`idle|running|done|error|cancelled`, `progress`, `result`), the filter choice
  (`selection`, versioned in `storageKey("labor-filters")`, a convenience), `runStress()` / `runFilters()` / `cancelExtra(kind)`. They take the
  input of the SHOWN run from `shownRunInput()` (`laborStore.ts`, memory only, set by `startLab`) and run `runExtra` (worker or idle chunks,
  `@/domain/backtest/index`). A new run, or a changed filter choice, clears the results that described the old one.
- **Belastungstest** (`labor-stress`): the loss-series block (`labor-streaks`, `labor-mc`) is instant from the trades; the scenario table
  (`labor-stress-table`, rows `labor-stress-row` with `data-scenario` / `data-status`) starts with `labor-stress-run`. Pills `Ersatz` /
  `nicht gerechnet` with the reason under the label.
- **Prüfbericht** (`labor-report`): `useAudit()` = `auditRun(result, bars)` – outliers (`labor-outlier-table`, `-text`), data holes
  (`labor-datagaps`, `labor-gap-list`), signals (`labor-signals`, `labor-late-text`), test periods (`labor-period-wf`, `-oos`, `labor-quiet`, `labor-thirds`).
- **Filtervergleich** (`labor-filters`): one row per filter (`labor-filter`, `data-filter`, `data-available`; `labor-filter-switch-<id>`,
  `labor-filter-reason` for locked ones), `labor-filters-run`, then `labor-filter-table` (rows `labor-filter-row`, `data-variant`), the contribution table
  (`labor-contrib-table`) and the overlap note (`labor-filter-overlap`).
- Tests: `tests/unit/views.labor.extras.test.tsx`, e2e `tests/e2e/labor-extras.spec.ts`.

## Diese Idee testen (F12)
A Box setup (`Beste Setups` dialog → `setup-to-lab`), the entry check (`Warum handeln oder auslassen?` → `signal-to-lab`), a
journal edge / leak (`Leaks & Edges` → `coach-test-idea`) and the assistant ("Teste diese Idee", `ideaTool`) hand their data to
`translateIdea` (`@/domain/lab/idea.ts`, pure, tested in `tests/unit/lab.idea.test.ts`). The result, an `IdeaDraft`, is a complete
"Eigene Idee": market, execution interval, side, rule tree (AND), stop, target – plus three lists that are never empty by accident:
`mapped` (what became a rule), `gaps` (what did NOT, each with its reason: top-trader ratios and the Lage-Ampel have no history, a
journal setup is a playbook, behaviour / feeling is no market state, box quality is no block …) and `notes` (approximations and
defaults: "Näherung: …", stop / target defaults, UTC vs local time).
- Box setup: breakout / retest → `breakout` block with the box length as look-back (named approximation), range → premium /
  discount zone (named approximation), RSI trendline break → `rsiLine`, stop = the plan's distance in %, target = the plan's CRV.
  A rule that would consist only of exclusions ("NICHT …") or of nothing is not testable.
- Entry check: the lab's own `mcbLadder` block IS that check, candle by candle; minimum strength = the verdict's (without the
  top-trader bonus point the lab cannot reproduce).
- Journal combination: weekday + session → the new block `timeWindow` (UTC; `sessionOfSec` equals the journal's `sessionOf`),
  side / asset / timeframe / signal strength → market, interval, side, ladder. Without any rule the lab stays untouched and the
  reason shows under the button (`TestIdeaButton`, lazy `openIdea`).
- `useLabor`: `idea` (memory only), `applyIdea(draft)` (fills `cfg`: strategy `custom`, symbol, rules; keeps the trader's own set-up
  as the way back), `restoreBeforeIdea()`, `dismissIdea()`. `IdeaCard` (`labor-idea`, lists `labor-idea-mapped|gaps|notes`) sits
  above the set-up while an idea is active. Nothing is saved as a draft, no run is started.

## TradingView (F14)
Section `TradingView` (lazy chunk `TvSection.tsx`): `AdapterStatusCard` (`labor-tv-status`, data from `@/domain/tvimport` `TV_ADAPTERS`:
tester export = unterstützt · alert webhook = nur Forwardtest über Alert · Pine execution / indicator as block / indicator series /
account access = nicht unterstützt, each with its limits) and `TvCompareCard` (`labor-tv-compare`): the strategy-tester export "List
of trades" (CSV, EN or DE headers, comma / semicolon / tab, point or comma decimals, any column order) is read in the browser
(`parseTvTrades`, nothing is uploaded), unreadable lines are listed with their line number (`labor-tv-errors`), the file's time zone is
chosen (UTC … UTC+3) and the file is compared with the SHOWN lab run (`compareTrades`): pairing by direction and entry time (one
execution bar of tolerance), common period only, open trades left out, net difference (all compared / paired only) next to the
unit-free sum of price moves, and observations on possible reasons (costs, position size, order of high / low inside a candle,
delay, unpaired trades) – each backed by figures and phrased as "kann", never as a proven cause. See `src/domain/tvimport/README.md`.

## Forward-Test (F23)
Section `Forward-Test` (`forward-section`, lazy chunk `forward/ForwardSection.tsx`, between the extras and the robustness cards, always shown):
a rule tree ("Eigene Idee" editor state, a saved draft or a ready-made template) runs as a **virtual account** on NEW, closed candles from
a fixed start on – never backwards. The pure part is `@/domain/forward` (see its README); this folder holds the runner and the UI.
- `forward/NewAccountCard` (`forward-new`): rules (`forward-rules`, the plain-language text `forward-rules-text` under it), name, market,
  start capital, risk per trade, leverage; costs are the lab's current ones (`forward-costs`). `forward-start` freezes a sanitised copy of
  the rules (and the signal setting) and saves the account into `settings.forward` (`forward/forwardActions.ts`, always from the LATEST
  settings). Refusals name their reason (`forward-problem`): rules that cannot run, more than 8 accounts, more than 5 running / paused.
- `forward/AccountCard` (`forward-account`, `data-status`): status badge, source badge (Editor · Entwurf V2 · Vorlage · fremd), **"Stand: bis
  Kerzenschluss …"** (`forward-stand`; "noch keine Kerze seit dem Start geschlossen" before the first close), the runtime line
  (`forward-runtime`, `data-phase`), equity curve, KPIs with sample size and 80 % intervals (`forward-kpis`), the open position / waiting
  entry (`forward-open`), pause / resume / end / delete (end and delete ask first, `forward-confirm`), the frozen rules, the trades, and
  **"Hält der Forward-Test, was der Rückblick zeigt?"** (`forward-compare`): the backtest of the same rules, costs and risk over 6 / 12 / 24
  months BEFORE the start, next to the account with the deviation per figure; below 10 trades on either side it only says "zu früh".
  When the draft the account came from was edited afterwards, `forward-changed` says: a change is a new version = a new account.
- `forward/forwardRunner.ts`: `catchUp(id)` loads the account's candles with the lab's loader (cache first, only the missing tail from the
  exchange), cuts every series at the account's fixed anchor (`startMs − warm-up`, so the indicators are the same however often it runs),
  prepares the strategy facts in slices, lets `advanceAccount` continue the engine and saves – only if the user did not change the account
  meanwhile (else it repeats). One run per account at a time. `runCompare(id, days)` is the backtest comparison (memory only).
- `forward/ForwardHost.tsx` (mounted by `DeferredHosts` → `ForwardMount`, only while an account is running / paused / being wound up): catch-up
  when the app opens, after every candle close of the soonest interval (`setTimeout` from the real clock, +4 s grace), when the tab returns.
  **Honest limit:** nothing runs while the app is closed; the missing candles are calculated at the next open – exactly as if it had been open.
- `forward/forwardStore.ts`: runtime state (phase, load progress, last check, error, comparison result), memory only.
- Assistant (not built): fits "Wie läuft mein Forward-Test?" and "Hält mein virtuelles Konto, was der Backtest zeigt?" – `accountView` and
  `compareForward` are the deterministic sources.
- Tests: `tests/unit/forward.advance.test.ts` (catch-up = one pass, property), `forward.config.test.ts` (stored shape, merge, comparison),
  `views.labor.forward.test.tsx`, e2e `tests/e2e/forward.spec.ts`.

## Versionen und Playbooks (F15 / F13 / F45)
Section `Versionen und Playbooks` (`labor-drafts-section`, lazy chunk `DraftsSection.tsx`, at the end of the page, always shown).
- **Versionen** (`VersionsCard`, `labor-versions`): `saveDraft` / `duplicateDraft` / `addForeignDraft` record a version of the draft when the
  rules or the name changed (`versionsStore.ts`, `storageKey("labor-draft-versions")`, ≤ 20 per draft and 240 in total, numbering never reuses a
  number; drafts that existed before get a first version "Stand vor der Versionierung"). Each version shows its time, the change against the one
  before in plain language (`diffConfigs` in `@/domain/lab/versions`: "Long · RSI Niveau: 30 → 25", "Stop: 1,5 × ATR(14) → 2 % vom Schlusskurs"),
  an editable note and **Wiederherstellen** (puts the rules back into the draft and the editor; that is a new version "Wiederhergestellt aus
  Version n"). "Editor-Stand als neue Version speichern" has an optional note. **Zwei Versionen nebeneinander** (`labor-version-compare`): the
  parameters row by row (changed rows marked) and – when the lab remembers a run of that version (`RunSummary.id` carries the rules' key) –
  its key numbers, else "Kein Lauf dieser Version".
- **Playbook** (`PlaybookCard`, `labor-playbook`): export a draft / template / the editor state as versioned JSON (`@/domain/playbook`:
  title, description, optional author and market, the rule tree, a checksum – nothing from the journal) to a file or the clipboard; import
  by paste or file (file size checked before reading). The reader refuses with named reasons (see `src/domain/playbook/README.md`), shows a
  **preview** with the rules in plain language and warnings, and only a click creates the draft – marked `origin` (**fremd**, kept through
  edits and copies, badge in the draft list). **Probe im Labor** puts the rules in the set-up and runs them on the market history.
- Tests: `tests/unit/lab.versions.test.ts`, `lab.playbook.test.ts` (incl. prototype pollution, huge / deep input), `views.labor.drafts.test.tsx`.

## Mehr Bausteine, Strategie-Bibliothek, Pine, Parameter-Raster (F06 / F11 / F14 / F15 / F16 / F64)
- **Bausteine** (`@/domain/lab/rules/blocksPlus.ts`, Reihen in `series.ts`): 17 neue – Donchian, ADX/DI, Stochastic, Keltner, Ichimoku, CCI, Williams %R, OBV,
  VWAP (Tag/Session/Woche, UTC), Opening Range, Inside Bar, Heikin-Ashi, Pivot-Bruch, Fibonacci-Rücksetzer (Golden Pocket), Supertrend, Chandelier, Funding-Extrem –
  plus neue Modi für Bollinger (Rückkehr ins Band, Mittellinie, Squeeze mit Fenster) und MACD (Histogramm). Alle aus geschlossenen Kerzen, im Builder in den
  bisherigen Familien. `check(p, tfSec)` meldet unpassende Parameter (Opening Range 15 min auf 1h-Kerzen, Session-VWAP auf 4h) als Fehler der Prüfung;
  **Funding-Extrem** ist ohne die echte Funding-Historie (`Kosten → Funding: Historie`) gesperrt, im Baustein-Picker mit Grund (`validateCustom(cfg, { funding })`).
- **Strategie-Bibliothek** (`LibrarySheet.tsx`, lazy; Daten `@/domain/lab/library`): Button `labor-lib-open` neben den Vorlagen (`useLibrary.show()`) → Sheet `labor-lib` mit 32 Karten, gehostet von `LibraryHost` auf Seitenebene (wie das Replay-Sheet; in einer Zelle läge es unter dem Dock), 
  (`labor-lib-card`, `data-card`, `data-kind`), Suche `labor-lib-search`, Typ-Filter, Details (Bekannt aus · Gedacht für · Schwächen · übliche Zeiteinheiten · typische Werte
  konservativ / Standard / aggressiv mit Erklärung je Zahl). `labor-lib-load-<id>-<level>` lädt den Entwurf in „Eigene Idee“ (`setCustom`), schließt das Sheet, startet nichts.
  Karten tragen keine Ergebnisse und keine Erfolgsaussagen (ein Test sucht nach Versprechen). Die Zahl auf der Karte und im Entwurf sind **dieselbe Quelle** (`params` → `make`).
- **Pine** (`PineCard.tsx` in der TradingView-Sektion, lazy; Domain `@/domain/lab/pine`): Schritte „Pine erzeugen → in TradingView testen → Export hier vergleichen“,
  Knopf `labor-pine-make` → lesbares Pine-v6-Skript (`labor-pine-code`), Kopieren, Datei, Notizen zu Abweichungen, Link „Chart in TradingView öffnen“ (`BINANCE:BTCUSDT.P` + Intervall;
  nur ein Link). Nicht übersetzbare Bausteine (`labor-pine-gaps`) stehen namentlich da und im Skript als `input.bool(false)`. Kosten stammen aus dem letzten Lauf (`runCfg`), sonst
  aus den Einstellungen; eine optionale Tick-Größe macht die Slippage zu Ticks. Kein Login, kein Kontozugriff.
- **Parameter-Raster** (Karte `labor-extra-params` unter „Belastung, Bericht, Filter“, `ParamGridBody.tsx`, lazy; Domain `@/domain/lab/extras/paramGrid`): zwei Zahlen der
  Regeln um ±25 % (3 × 3), derselbe Lauf je Zelle (`runExtra` mit `what: "params"`, Mitte = gezeigter Lauf). Gesperrt mit Grund bei rechenintensiven Bausteinen; nur für „Eigene Idee“.
  Zellen mit weniger als 10 Trades werden als schwach markiert, es gibt keine „beste“ Zelle.
- Tests: `tests/unit/lab.blocksPlus.test.ts`, `lab.library.test.ts`, `lab.pine.test.ts` (Snapshots), `lab.paramGrid.test.ts`, `views.labor.library.test.tsx`, e2e `tests/e2e/library.spec.ts`.

## Passt zu dir? (F49)
Section `Passt zu dir?` (`labor-fit`, lazy chunk `FitCard.tsx`) between the diagnosis and the extras, only with a finished run. The shown
run's trades (`strategyFacts`) are held against the journal (`journalProfile` over `useEnriched()` + the coach's behaviour events,
`compareFit`; all in `@/domain/fit`, see its README): win rate, time in a trade, losing runs, drawdown depth, trade frequency, time windows
(UTC), risk per trade, rule discipline. Three groups – **Reibungspunkte** (`fit-group-friction`), **Übereinstimmungen** (`fit-group-match`),
**Nicht beurteilbar** (`fit-group-unknown`) – each item (`fit-item`, `data-id`, `data-kind`) with a `Badge`, one sentence with the
numbers, the two figures side by side and its own caveat. No score, no recommendation; with fewer than 20 closed journal trades (or < 10
trades in the run) the card is an honest empty state (`fit-empty`, `data-status`) that names the numbers. It reads `useLabor` (`result`,
`runCfg`) and the journal and changes neither. Tests: `views.labor.fit.test.tsx`, `fit.test.ts`, e2e `fit.spec.ts`.

## Muster-Entdecker (Auftrag B)
Abschnitt `Muster-Entdecker` (`labor-discovery`, lazy chunk `DiscoverySection.tsx`) ganz unten. Er wählt die Quelle der Karte `DiscoveryPanel` (`src/views/discovery`, README dort): die Trades und Kerzen des **gezeigten Laufs**
(`useLabor.result` / `bars`, dazu die Schlüsselmarken desselben Markts, die schon vor dem Einstieg angelegt waren) oder die **Journal-Trades**, und verdrahtet „Mit diesem Filter testen“: das bestätigte Muster wird mit `useExtras.setPattern(spec)`
zum Muster-Filter der Filterauswahl und `runFilters()` rechnet denselben Lauf mit und ohne Muster; das Ergebnis steht unter dem Befund und sagt, dass das Muster aus denselben Trades stammt (nur ein Test auf denselben Daten). Nichts wird
automatisch übernommen. Tests: `views.labor.discovery.test.tsx`, `discovery.sources.test.ts` (Filtervergleich auf dem echten BTCUSDT-Lauf), e2e `discovery.spec.ts`.
## Hintergrund-Optimierer (F66)
Section `Hintergrund-Optimierer` (`evolve-section`, lazy chunk `EvolveSection.tsx` of `@/views/evolve`) after the forward test. It lists the editor
idea ("Eigene Idee") and up to five drafts as strategies; the candles come from the Labor's own loader (`loadLabData`, same cache and limits as a
run). The card runs them together in a Web Worker (only while the app is open), judges every variant only on windows it was not trained on and
shows proposals – **Als neue Version speichern** (a new draft "… v2" for the editor idea, a new version for a draft; rules that changed since the
proposal are never overwritten), **Als Herausforderer live testen** (a virtual forward account, nothing retroactive), **Ablehnen**. The only
additive change to the Labor store is `addDraft(name, config, note)`. The rest is in `src/views/evolve/README.md` and `src/domain/evolve/README.md`.
Tests: `views.evolve.labor.test.tsx`, e2e `evolve.spec.ts`.
## Inhalt-Leiste (Auffindbarkeit)

Unter dem Seitenkopf sitzt die `SectionNav` (`src/primitives/SectionNav.tsx`): ein Chip je Abschnitt, klebt unter dem Header, markiert den sichtbaren Abschnitt (`aria-current="location"`), ein Tipp scrollt weich (reduzierte Bewegung: Sprung) und hebt den Titel kurz hervor. Chips für die Abschnitte, die gerade da sind (Diagnose, Passt zu dir?, Belastung, Robustheit erst nach einem fertigen Lauf, Vergleich ab dem ersten gespeicherten Lauf); `Section section=…` setzt `data-section` am Titel. Test: `tests/e2e/funktionen-anker.spec.ts` (jeder Chip landet unter der Leiste), `tests/unit/primitives.sectionNav.test.tsx`.

## Zeitmaschine (Abschnitt ganz unten)
Abschnitt `Zeitmaschine` (`tm-section`, lazy chunk `@/views/timemachine/LaborSection`, nach dem Muster-Entdecker, Chip in der Inhalt-Leiste): ein Plan per Hand (Markt, Richtung, Einstieg, Stop, Ziel, Zeitrahmen 15m / 1h / 4h / 1T, Zeitraum), die
Kerzen über denselben Lader wie der Lauf (`loadLabData`, Cache zuerst, nur geschlossene Kerzen), Kosten wie im Versuchsaufbau (Gebührenstufe, Slippage, Funding pauschal – nicht die echte Funding-Historie), darunter die Karte
`TimeMachineCard` (10 000 Sitzungen + jeder frühere Vorfall, Worker mit Fortschritt und Abbruch). Weitere Einstellungen (Zeitstopp, Läufe, Seed, Ziehen, Schwankung, Trend, Suche nach früheren Vorfällen, Break-even, Trailing)
hinter dem „+“. Ein geänderter Preis rechnet auf denselben Kerzen neu; Markt, Zeitrahmen oder Zeitraum verlangen neue Kerzen. Details: `src/views/timemachine/README.md`, `src/domain/timemachine/README.md`.
Tests: `tests/unit/views.timemachine.test.tsx`, e2e `tests/e2e/timemachine.spec.ts`.
