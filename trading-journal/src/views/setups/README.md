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
