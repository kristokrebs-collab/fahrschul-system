# `src/views/studio` – Strategie-Studio (`#studio`, `h1 Strategie-Studio`)

Write a strategy in plain German, let the studio turn it into the lab's rules, check them on real candles and let them run on paper – never with
money, never with an order. The reading is `@/domain/strategytext` (README there), the engine is the lab's (`@/domain/backtest/index`). Registered
as the lazy page `studio` (`pages.ts`, plan gate `backtestLab` like the lab, `g` `u`); the shell never imports the barrel `index.ts` statically.

| module | what |
|---|---|
| `StudioView.tsx` | `{ className? }` – sections `Deine Strategie` (StrategyList 4 · EditorCard 8 · Understanding 12), `Prüfen` (BacktestCard 7 · LiveCard 5), `Vergleichen` (CompareCard), `Entwürfe und Versionen` (VersionsCard), `Weitere Werkzeuge` (MoreTools). First visit of a session opens the newest strategy; leaving flushes the working copy. `data-testid="studio-view"`. |
| `studioStore.ts` | `useStudio` (zustand, memory only): `editor` (working copy: id, name, text, answers, symbol, period), `parsed` (the reading), `bt` (backtest), `cmp` (comparison), `selected`, `tried` (strategies tried this session – they count for the multiple-testing note), `proposal`, `override`. Actions: `setEditor`, `understand`, `choose(askId, optionId)`, `understandWithAi`, `open`, `newDraft`, `remove`, `save`, `runBacktest`, `runCompare`, proposal actions. The working copy of a strategy is written back 1.2 s after the last keystroke (`flushStudio` on leaving); the first text creates the strategy as a draft WITHOUT a version – a version only arises from "Als Entwurf speichern". |
| `studioWrites.ts` | writes of `settings.studio`, always from the LATEST settings (no draft, no Speichern button): `saveDraftCopy`, `saveStrategyVersion`, `removeStrategy`, `noteVersion`, `putStats`, `linkLive`. |
| `runner.ts` | `runStudioBacktest` (one strategy: `loadLabData` + `runLab` with the Labor page's costs, risk from the text when it names one) and `runStudioCompare` (`createComparison` stepped in 14 ms slices). The Labor page's own state is never touched. `StudioRunError` carries the German message. |
| `resolve.ts` | which rules does a strategy mean right now (`resolveEditor`, `resolveStored`, `resolveText`), and why it cannot run (`whyNotReady`). A saved version does not remember an open question: when the local reading IS the saved one, its questions decide. |
| `live.ts` | `startLive` / `startLiveAll`: one paper account per saved version through `startAccount` of the forward test (source `draft`, version number, rules frozen) – no order, no exchange connection, no path to real money exists in the studio. |
| `aiClient.ts` | client of `strategy-compile` (only with cloud, signed in, plan `coachAi` and a server key; any failure reads as "off"). The answer is re-validated (`parseAiOutput`) before it becomes a reading. |
| `Slots.tsx` / `slotsImpl.tsx` / `types.ts` | `DiscoveryPanel` and `EvolvePanel` (lazy, props `StudioPanelProps`: strategy, candles, last result, `trials`, `onPropose`). `slotsImpl.tsx` holds the placeholders ("Kommt gleich") – the owners of the real panels replace the bodies there. A panel only PROPOSES; the studio shows what would change and applies it after one "Übernehmen". |
| `strings.ts` | the German copy (`STUDIO`), `EXAMPLES` (example chips), `NO_ADVICE`, `PAST_NOT_FORECAST`. |

## Cards
- `StrategyList` (`studio-list`): several strategies side by side, tick (`studio-pick-<id>`, `role="checkbox"`), open (`studio-open-<id>`), "Neue Strategie", **"Alle testen"** (`studio-compare-run`, ≥ 2 ticked) and the count.
- `EditorCard` (`studio-editor`): name, text (`studio-text`, ≤ 4000 characters), example chips (`studio-example-<id>`), market and period, `Verstehen` (`studio-understand`, also ⌘/Ctrl+Enter), the optional `Mit KI genauer verstehen` (`studio-ai`), `Als Entwurf speichern` (`studio-save`). A changed text marks the reading stale (`studio-stale`) – it is never re-read silently.
- `Understanding` (`studio-understanding`): `Das habe ich verstanden` (the text with the understood words marked, numbered like the list; `studio-understood-item`), `Unklar` (`studio-unclear-item`), `Fragen an dich` (answer chips `studio-answer-<askId>-<option>`; needed / provisional / answered), `Meine Annahmen` (chips where the value can be changed here), `So rechnet das Labor` (the rules as sentences, ready or why not).
- `BacktestCard` (`studio-backtest`): costs line, run / cancel, progress, result (`studio-result`): KPIs (`studio-kpis`), the sample sentence (`studio-sample`, small below 30 trades), the equity curve, Train / Test (`studio-split`), the lab's observations (`diagnoseRun`, `studio-findings`). Ends with the one sentence that a backtest shows the past and the disclaimer.
- `LiveCard` (`studio-live`): asks once, then a paper account; lists the accounts of this strategy.
- `CompareCard` (`studio-compare`) + `CompareTable`: the number of compared strategies is on screen before (`studio-cmp-n`, `studio-cmp-before`) and after the run, the multiple-testing box (`studio-cmp-multiple`), a ranked table (cards on a phone), the window and rank basis, skipped strategies with the reason, `Alle ausgewählten live testen (Papier)` (asks first).
- `VersionsCard` (`studio-versions`): versions newest first with stored figures and a note, "In den Editor holen", comparison of two versions (plain-language diff, stored figures, "Beide jetzt rechnen" on the same data).
- `MoreTools` (`studio-more`): the two slot panels and the proposal box (`studio-proposal`).

Every result card ends with "Keine professionelle Finanzberatung."; backtest and comparison cards add "Ein Backtest zeigt die Vergangenheit, keine Prognose."

Tests: `tests/unit/views.studio.test.tsx` (understand, questions, backtest, save / versions, several strategies, compare, paper accounts, proposal),
`tests/unit/assistant.studio.test.ts`, e2e `tests/e2e/studio.spec.ts` (mobile, desktop, 1280 px tablet; set `STUDIO_SHOTS_DIR` for screenshots).
