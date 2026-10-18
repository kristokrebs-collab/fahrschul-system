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
