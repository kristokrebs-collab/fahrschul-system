# `src/views/setups` – Entscheidungsgrundlagen page

Bundle `G$` (Plan 6.3, morph catalogue 3.3). Reads `useJournal` (settings) + `useAccountView("all")` and
`useUi` (setup editor state); navigation via `@/store/router`. Import from `@/views/setups`.

| export | props / signature | notes |
|---|---|---|
| `SetupsView` | `{ onEdit?(id); onNew?(); onTrades?(id); className? }` | Header `Entscheidungsgrundlagen` + lead, Segmented `Gesamt\|Makro\|Scalp` (visibility via `setupVisibleFor`, stats always from account `all`) and sort `RANK_KEYS` (`Win-Rate\|P&L\|Trades\|Ø R`). Grid `motion.div layout` + `AnimatePresence mode="popLayout"`; last tile `Neue Entscheidungsgrundlage`. Defaults: `onEdit → openSetupEditor({ setupId })`, `onNew → openSetupEditor()`, `onTrades → navigate("trades", { setup: id })` (sets `tradeFilter.setup` and `#trades?setup=…`). Card whose editor is open (not `fromTrade`) is `visibility:hidden`. Below the grid: `Grundregeln` card listing `settings.rules` (read-only; edit in Einstellungen). |
| `SetupCard` | `{ stats: SetupStats & { id }; index; onEdit; onTrades; hidden?; layoutDependency?; className? }` | `motion.div layout layoutId="setup-card-{id}"` `style.borderRadius 16`, enter `{opacity:0,y:8}` on `spring.cards` (stagger `.03`, max 12), exit `{opacity:0,scale:.96}`; `Tilt factor 4` → `Card bare gradientFrom=color`. Sources `setup-dot-{id}` / `setup-name-{id}` (`layout="position"`). Badge `Makro` steel / `Scalp` teal / `Beide` mute; `desc \|\| "Noch keine Regeln hinterlegt."`; checklist `ul`; tiles `Trades \| Win-Rate \| P&L \| Ø R` as `MotionNumber` (P&L `–` at 0 trades); win bar `scaleX` `tween.bar` only when `n > 0`; buttons `Bearbeiten`, `Alle Trades mit dieser Grundlage →` (disabled at 0 trades). `data-testid="setup-card-{id}"`. |
| `PageHeader` | `{ title; lead; action?; count?; countUnit?(n); className? }` | Bundle `aT` (also used by the settings page). Same page enter as the trades `PageHeader`: words rise 10 px out of a 4 px blur one by one (`stagger.words`, y on `spring.enter`, opacity/blur on `tween.reveal`, starting with the page enter), the signal dot pops (`spring.pop`) and rings once (`tween.ripple`), the lead follows; optional count pill rolls (`RollingDigits`, label `{n} {unit}`). The `h1` itself never animates and its text stays the plain title. Static under reduced motion. |
| constants | `SETUPS_TITLE`, `SETUPS_LEAD`, `NEW_SETUP_LABEL`, `RULES_TITLE`, `RULES_NOTE`, `SETUP_BADGE`, `NO_RULES_TEXT`, `TRADES_BUTTON_LABEL` | verbatim UI strings |

```tsx
import { SetupsView } from "@/views/setups";
import { SetupEditor } from "@/overlays/SetupEditor";

<PageSwitch …>{page === "setups" && <SetupsView />}</PageSwitch>
<SetupEditor />   // app level, reads uiStore.setupEditor; morphs from `setup-card-{id}`
```

Motion: the header counts the visible setups; cards reveal their details on first view (tiles `countOnReveal` + `flash`, session-once via `revealKey`, bullets pop and lines light up on `stagger.rows`, win bar fills from 0); the `Neue Entscheidungsgrundlage` tile turns its plus (`spring.plus`), swaps the dashed border for `.fx-ants` while hovered/focused and dips on press; `Grundregeln` lines reveal via `RevealGroup`.

Cards gate their first-view reveal with `useFirstInView` from `@/motion/inView` (shared observer, one update; formerly `src/views/setups/useFirstInView.ts`).

Tests: `tests/unit/views.setups.card.test.tsx`, `tests/unit/views.settings.motion.test.tsx` (PageHeader, useFirstInView).

## pulse-motion pass
- `SetupCard` = `NotchedFrame` (notch bottom right + arrow disc ink → signal red on hover/focus, setup-colour wash greyed at rest → colour on hover, hairline `outline`) inside `Tilt` (factor 4); the spotlight `Card` is no longer used here. Tiles: 2 × 2 below a 22rem card body (`@container`), never ellipsized (MO-01).
- OV-07: `layoutId="setup-card-{id}"` sits on an empty opaque surface (ink-850, clipped to the notched outline via `clip-path: path()`); `Bearbeiten` fades the contents out first and opens the editor when that fade completes (fallback 400 ms), so only the surface morphs into the sheet; on close the contents fade back after 0.24 s. The `data-testid` stays on the card wrapper; `setup-dot-{id}` / `setup-name-{id}` unchanged. `hidden` → contents opacity 0 + `inert` + `aria-hidden`.
- `LeadFill` (`./LeadFill.tsx`, shared page subtitle recipe): `PixelTextFill` (signal-red ember, ends in `text-mute`) once per session (`sessionStorage` key), waits for the intro to settle, then hands off to the plain paragraph in the identical layout and wipes a `TactileHighlight` (tone invert, no side padding) over the key word. Seen / reduced motion: static marker. `PageHeader leadFill={{ storageKey, highlight }}`; setups: `tj2-fill-setups` / `funktioniert`.

## Merge pass (playbook + live check)
- `playbook.ts` (pure): `playbookStats(setup, closed)` / `playbookBySetup(setups, closed)` → `{ agg (aggregate of the setup's closed trades), adherence { items, withList, full, rate, itemRate, fullWinRate, gapsWinRate } (only THIS setup's checklist ids `{setupId}:{itemId}`), topMistake (manual `trade.mistakes`), signal { n, avgScore, avgStrength, validShare } (stored `trade.signal`, either app's shape via `snapOf`) }`; `explainPlaybook(stats, pb, cur)` → `Explanation` (every figure with its formula, verdict incl. rule-true vs gaps win-rate delta); `fromStats(agg)` when no trade list is at hand; text helpers `pfText`, `pnlText`, `adherenceText`, `PLAYBOOK_STRINGS`.
- `SetupCard` (additive props `playbook?`, `currency?`): the existing 4 stat tiles are now ONE morph source (`MorphCard as="div"`, id `setup-stats-{id}`, name `Kennzahlen: {name}`) → playbook explainer; below the win bar the `Playbook` block (id `setup-playbook-{id}`, name `Playbook-Werte: {name}`, `data-testid="setup-playbook"` on the values): Erwartung · Profit-Faktor · Regel-Treue · Bester / Schwächster, plus `Häufigster Fehler` / `Ø Signal-Score`. Plain text values (no extra aria-labelled counters), never ellipsized (2 cols below a 22rem body, 4 above). Shown once the setup has closed trades. Button row gets `pointer-coarse:gap-3.5` so the 44 px hit areas of wrapped buttons never overlap.
- `MtfLiveStrip` (only on `s_mtf`, `data-testid="mtf-live"`, `data-state`): its own `useSignalCheck()` subscription (≤ 1 re-render/s, only on rounded changes) → status pill (Lädt / Live / Veraltet / Offline), stronger side's label + `StrengthDots` + `Score · x von n TF`; the whole strip is a button to the overview (`Einstiegs-Check öffnen: …`). No live region (the toast island announces entries).
- `SetupsView`: passes `playbookBySetup(settings.setups, view.closed)`; `SETUPS_LEAD = ED.COPY.setupsLead` (edition copy, F1 privacy patch hunk applied here); lead-fill key `storageKey("fill-setups")` (personal: `tj2-fill-setups` unchanged); Grundregeln rows are buttons → Einstellungen (`RULE_EDIT_LABEL(n, text)`).
- Tests: `tests/unit/views.setups.playbook.test.tsx`.

## P07 – Strategie-Management (additive)
Nothing above changed; the page gains a library, a comparison, the strategy description and the auto assignment.
The strategy description lives as passthrough keys on `settings.setups[i]` (`entryCriteria`, `exitCriteria`,
`riskModel`, `tags`, `examples`, `markets`, `tf`, `auto`) – read with `strategyOf`, written with `withStrategy` (only
filled parts) from `@/domain/strategy`; `normalizeSettings` keeps them.

| file | what |
|---|---|
| `LibraryBar.tsx` | search (name, rules, criteria, tags), facet chips (tags / markets / timeframes the library uses), `Mit Trades`, `Vergleichen` (needs 2 setups with trades), `Filter zurücksetzen`. Only hides cards like the account switch (`matchesLibrary`). `data-testid="setup-library"`, `setup-compare-open`; empty result `setup-library-empty` (`LIBRARY_STRINGS.none`). |
| `CompareSheet.tsx` | Sheet `Grundlagen vergleichen`: pick 2–3 (preset = the two with the most trades, a fourth pick drops the oldest); columns dealt by `CardSpread` (`setup-compare-column`), Win-Rate / Ø R / Erwartung with their 80 % interval + `CiWhisker` on a shared axis, PF, Netto, Konformität, Exit-Treue; verdict (`setup-compare-verdict`) with the leader (highest lower bound of Ø R) as `TactileHighlight`; differences against the leader with `SigBadge`. `compareStrategies` (P03 statistics). |
| `StrategyBlock.tsx` | on a card only when the setup has strategy data (`showsStrategy`): strip with Konformität, Exit-Treue, Beispiele, tags – morph source `setup-strategy-{id}` (`MorphCard`, name `Strategie · {name}`) → `StrategyProfile` (`strategy-profile`): criteria, risk model, markets & TF, auto rules, conformity per part (bars + `ConfidenceMeter`), best-practice gallery (`ReelWindow`, `strategy-gallery`; a tap opens the trade). |
| `StrategyFields.tsx` | the editor section (`setup-strategy-fields`): entry / exit criteria lists (`Entry n` / `Exit n`, quick chips from `PLAN_EXITS`), strategy tags (`ChipInput`), expander `Risiko, Märkte und Auto-Erkennung` (risk %, max leverage, min CRV, stop rule, markets, TF, box kinds, min grade, min check strength, sessions, side), example picker (≤ `EXAMPLE_PICK_MAX`). |
| `ClassifyCard.tsx` | `Automatisch zuordnen` (`setup-classify`, only with untagged trades): count + sure suggestions (`classifyUntagged`, ≥ mittel, never `s_bt`); sheet with rows (`setup-classify-row`: trade, suggested setup, reasons, `ConfidenceMeter`), `Übernehmen` (row dissolves) and `HoldButton` `Alle sicheren übernehmen (n)` (`setup-classify-all`, every "hoch"). Writes `saveTrade({ ...trade, setups: [id] })`, never overwrites a tagged trade. |
| `playbook.ts` | `playbookStats(setup, closed, ctx?)` / `playbookBySetup(setups, closed, ctx?)` add `strategy { score, n, exitRate, exitN, examples, weakest }` (`strategyConformity`, `examplesOf`); the card's Playbook line shows `Exit-Treue` (`setup-exit-fidelity`) once measurable; `explainPlaybook` appends rows `Exit-Treue`, `Konformität`, `Beispiele`. `fromStats` is unchanged (no `strategy`). |

`SetupsView` order: header, account/sort switches, `LibraryBar`, grid, `ClassifyCard`, `Grundregeln`, `CompareSheet`.
Tests: `tests/unit/views.labor.test.tsx` (setups block), `tests/unit/strategy.domain.test.ts`, e2e `tests/e2e/labor.spec.ts` (`Entscheidungsgrundlagen · Strategie`).
