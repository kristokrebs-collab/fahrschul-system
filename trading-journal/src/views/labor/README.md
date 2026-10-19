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

## Passt zu dir? (F49)
Section `Passt zu dir?` (`labor-fit`, lazy chunk `FitCard.tsx`) between the diagnosis and the extras, only with a finished run. The shown
run's trades (`strategyFacts`) are held against the journal (`journalProfile` over `useEnriched()` + the coach's behaviour events,
`compareFit`; all in `@/domain/fit`, see its README): win rate, time in a trade, losing runs, drawdown depth, trade frequency, time windows
(UTC), risk per trade, rule discipline. Three groups – **Reibungspunkte** (`fit-group-friction`), **Übereinstimmungen** (`fit-group-match`),
**Nicht beurteilbar** (`fit-group-unknown`) – each item (`fit-item`, `data-id`, `data-kind`) with a `Badge`, one sentence with the
numbers, the two figures side by side and its own caveat. No score, no recommendation; with fewer than 20 closed journal trades (or < 10
trades in the run) the card is an honest empty state (`fit-empty`, `data-status`) that names the numbers. It reads `useLabor` (`result`,
`runCfg`) and the journal and changes neither. Tests: `views.labor.fit.test.tsx`, `fit.test.ts`, e2e `fit.spec.ts`.
