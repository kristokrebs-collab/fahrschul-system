# `src/views/evolve` – Hintergrund-Optimierer (Karte, F66)

The UI of `@/domain/evolve`. One card (`EvolvePanel`) that takes a **list of strategies** and runs them together; the Labor mounts
it through `EvolveSection`, the Strategie-Studio can mount it with its own list.

```
EvolvePanel.tsx    the card: strategy list, start / pause / resume / stop, progress, throttle line, results, proposals, protocol
Leaderboard.tsx    per strategy: current version vs best variant on the test windows, WindowsStrip (train | tests | Bestätigung)
Tournament.tsx     all strategies and variants on the confirmation window, corrected over everything that was tried
ProposalCard.tsx   one proposal: changes in plain words, expected result, overfit probability, plateau, warnings, 3 buttons
LearnedCard.tsx    "Was habe ich gelernt?" – numbers with sample, honest at too little data
ProtocolSheet.tsx  the local trial log (lazy)
EvolveSection.tsx  Labor wrapper: Editor idea + drafts, loads candles with the lab's own loader (`loadLabData`)
labHost.ts         `saveProposalAsVersion`, `startProposalAsChallenger` (Labor store / forward accounts)
evolveStore.ts     zustand run store (one run at a time), local log persistence, `__resetEvolve`
actions.ts         `settings.evolve` writes: decideProposal, recordLiveVerdict, setPower, addRunResult
strings.ts / fmt.ts   all copy (German) and number formats
types.ts           the interface (below)
```

## Interface for the Studio
```ts
import { EvolvePanel, type EvolvePanelProps, type StrategyEntry } from "@/views/evolve";
<EvolvePanel
  strategies={[{ id, name, config, symbol, signal, engine }]}   // StrategyEntry[] – up to 6 run at once
  candles={{ [id]: CandleSet }}  onLoadCandles={(entry) => Promise<CandleSet>}
  onSaveVersion={(entry, proposal) => EvolveActionResult}       // "Als neue Version speichern"
  onStartChallenger={(entry, proposal) => Promise<EvolveActionResult>}
  defaultSelected budget seed
/>
```
The panel never writes a strategy itself: both buttons call the host and show its answer (`{ ok: true, label } | { ok: false, reason }`).
`EvolveSection` is the Labor's host (a new draft / a new version; the editor idea is never overwritten; rules changed since the
proposal → nothing is overwritten and the reason is shown).

## What the user sees and can do
- Always the line **"Läuft nur, solange die App offen ist."** (`evolve-open-note`) and "Ändert nie von selbst"; no server job, no AI.
- Start / Pause / Fortsetzen / Stopp, a progress bar with trial count, and a throttle line (`evolve-throttle`) that says why it is
  slowed down (hidden tab, battery saver, data saver, touch device, own setting "Tempo": Schonend / Normal / Volle Leistung).
- Per proposal: **Als neue Version speichern** · **Als Herausforderer live testen** (virtual forward account, nothing retroactive) ·
  **Ablehnen** (optional reason). Later: "hat sich der Vorschlag live bestätigt?" with expected vs actual in percent.
- Every card ends with "Vergangene Ergebnisse sind keine Prognose. Keine professionelle Finanzberatung."
- "Nichts gefunden" is shown as a result (`evolve-nothing`), not as an error.

Test ids: `evolve-panel` (`data-status`: idle · starting · running · paused · done · error), `evolve-strategy`, `evolve-start`,
`evolve-pause`, `evolve-resume`, `evolve-stop`, `evolve-progress`, `evolve-throttle`, `evolve-open-note`, `evolve-leaderboard`,
`evolve-windows`, `evolve-tournament`, `evolve-proposal` (`evolve-save`, `evolve-challenger`, `evolve-reject`), `evolve-overfit`,
`evolve-plateau`, `evolve-warnings`, `evolve-nothing`, `evolve-protocol-open`, `evolve-protocol`, `evolve-learned`, `evolve-disclaimer`.

Design: see `DESIGN.md`, "Hintergrund-Optimierer". Motion only through `src/motion` (the card has none of its own).
Tests: `tests/unit/views.evolve.test.tsx`, `views.evolve.labor.test.tsx`, `tests/e2e/evolve.spec.ts`.
