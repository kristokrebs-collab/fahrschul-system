# `src/views/cockpit` – Cockpit, your own dashboards (P13)

`CockpitView` (`h1 Cockpit`) puts the cards of every page side by side on a 12-column grid, in several named
dashboards. The cards are the EXISTING components, wrapped unchanged – no card logic is duplicated here.

## Wiring (integrator)

Register the page `cockpit` (label "Cockpit", key `d` for `g d`, lazy like the other pages):

```ts
const CockpitView = lazy(() => import("@/views/cockpit").then((m) => ({ default: m.CockpitView })));
```

Other packages add widgets through the registry – the shape their `*_WIDGETS` exports already have:

```ts
import { registerWidget, registerWidgets } from "@/views/cockpit";
registerWidget({ id: "my-card", title: "Mein Widget", component: MyCard, defaultSpan: 6, group: "Analyse", description: "eine Zeile" });
registerWidgets(ANALYSE_WIDGETS, "Analyse"); // returns the unregister function
```

A widget is a component without props that reads its own stores (so the account switch of the Übersicht applies).
`defaultSpan` snaps to the offered widths `SPANS = [4, 5, 6, 7, 8, 12]` (columns of 12 from `lg`; phones stack).

## Modules

| file | what |
|---|---|
| `registry.ts` | `registerWidget`, `registerWidgets`, `getWidget`, `listWidgets`, `useRegistryVersion` (re-render on change), `snapSpan`, `SPANS`. An older unregister never removes a newer registration of the same id |
| `builtins.tsx` | `registerBuiltinWidgets()` (idempotent, on first import of the view): Übersicht `ov-*` (equity, win rate, setup ranking, recent trades, projection, monthly, checklist, backtest, patterns, top trader), Auswertung `in-*` (recap, findings, calendar, edge, discipline, mistakes, time, drawdown) and the feature exports `ANALYSE_WIDGETS` (P03), `RISIKO_WIDGETS` (P05), `WACHSTUM_WIDGETS` (P08) |
| `cockpitStore.ts` | layout per device in `storageKey("cockpit")` = `{ v, active, boards: [{ id, name, items: [{ id, span }] }] }` – layout only, never journal data. Pure reducers (`addItem`, `removeItem`, `resizeItem`, `reorderItems`, `addBoard`, `renameBoard`, `deleteBoard`, `resetBoard`, `parseCockpit`) + the `cockpit` actions. Unknown widget ids survive in storage (a package not loaded right now keeps its place) and are not rendered. Max 4 boards, 24 widgets each |
| `CockpitView.tsx` | page header, board switcher (`Segmented`), "Anordnen", "Widget hinzufügen"; view grid (each widget in its own `ErrorBoundary variant="widget"` + `Suspense` skeleton, `Reveal` entrance); edit grid |
| `WidgetCatalog.tsx` | the "Widget hinzufügen" sheet: all registered widgets by group, fuzzy filter (`@/search/fuzzy`), add one or several; present ones are marked "Im Cockpit" |
| `copy.ts` | German strings |

Starter boards ("Trade the best" – the strongest signals first): **Mein Cockpit** (equity 8 · win rate 4 · setup
ranking 7 · findings 5 · risk limits 7 · heatmap 5 · recent 7 · monthly 5) and **Risiko** (limits, exposure,
calculator, ruin risk, streaks). "Zurücksetzen" restores a starter board; a new board starts empty.

## Effects

- **Anordnen**: the pulse `WidgetGrid` – hold to lift (tilt), drag, throw to a slot; keyboard: Space lifts, arrows move,
  Space drops, Escape cancels. Each tile shows a live, non-interactive preview of its card (`inert`), the width
  (−/+ along `SPANS`) and remove. Spans in edit mode are scoped `:nth-child` rules (`spanRules`), because the grid
  takes one class for all tiles.
- **New widget**: a `GlyphZoom` wall with "NEU" punched out stands over the fresh tile, then the camera dives
  through (paper wall in light mode); the tile scrolls into view.
- Workaround (until P01 fixes it): `WidgetGrid` keeps its "a drag just ended" flag after a KEYBOARD drop, which would
  swallow the next click in the grid; `settleKeyboardDrop` hands the grid that one click on its own list element.

## Tests

`tests/unit/cockpit.store.test.ts` (registry, parse, reducers), `tests/unit/views.cockpit.test.tsx` (stand-in
widgets: spans, a broken widget caught by its own boundary, Anordnen, catalog, boards); e2e `tests/e2e/cockpit.spec.ts`
(real cards, catalog, keyboard drag, reload, second board) and the cockpit scans in `tests/e2e/a11y.spec.ts`.
