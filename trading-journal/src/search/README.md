# `src/search` – global search (P13)

One overlay that finds everything in the journal: trades, setups (Entscheidungsgrundlagen), day notes, pages, settings
sections, reports (when the page `berichte` is registered) and commands. Open with `/` or ⌘⇧F / Ctrl+⇧F (bound by
`src/app/ShortcutHost.tsx`), from CommandNav (`openSearch()`), or from code. ⌘K stays CommandNav's.

## Wiring (integrator)

```tsx
// App.tsx, after <SetupEditor/>, before <Celebrate/> (next to ShortcutHost / OnboardingHost)
import { GlobalSearchHost } from "@/search/GlobalSearchHost";
<GlobalSearchHost />
```

The host is a leaf: it subscribes to `useSearch().open` only, loads the overlay chunk (`GlobalSearch.tsx` + the index)
on first open (`preloadSearch()` warms it, e.g. on hover of a search button), and runs the chosen action AFTER the
overlay's exit animation (`onExitComplete` → `takePending()` → `runSearchAction`), so the page switch / detail morph
never fights the closing panel.

## Modules

| file | what |
|---|---|
| `fuzzy.ts` | pure scorer: `fold` (lower case, umlauts ä→a, ß→ss, diacritics stripped, 1:1 index map for highlights), `tokenize`, `matchText` / `matchFolded` (whole word 100 > word prefix 80+ > substring 55 > subsequence ≤ 40), `scoreFields` (every token must hit title or a keyword, title hits weigh double; "uebersicht" falls back to "ubersicht" via `digraphFold`), `mergeRanges` |
| `sources.ts` | `buildSearchIndex(IndexInput)` – pure: same input, same items. Kinds `trade`, `setup`, `day`, `page`, `setting`, `report`, `command`, plus the virtual groups `best` / `recent`. `COMMANDS` (new trade, top / winner / loser / open filters, theme, new setup, shortcuts, tour, intro, export JSON / CSV, navigation, fullscreen), `SETTING_SECTIONS`, `KIND_LABEL`, `setupStats` |
| `rank.ts` | `searchIndex(items, q)` → groups in kind order with highlights; `suggestions()` = what the empty field shows: **"Stärkste zuerst"** (the setups that earn the most, the best trades by R – Trade the best), then recent hits, then a few commands |
| `searchStore.ts` | zustand: `open`, `seed`, `pending`, `recent` (`storageKey("search-recent")`, max 8). `openSearch(seed?)`, `closeSearch(pending?)`, `toggleSearch()`, `takePending()`, `rememberRecent(id)` |
| `actions.ts` | `runSearchAction(a)`: page switch (`navigate`), trade detail (`openDetail(id, null)`), setup → setups page + scroll + a red sweep over the card (`revealCard`), settings section → scroll + sweep, day → overview calendar, commands. `whenShown(page, find, then)` waits for the kept-alive page layer to be visible |
| `GlobalSearch.tsx` | the overlay: `role="dialog"` + `aria-modal`, `useDialogBehaviour`, `useOverlayLane`, `data-layer="Suche"`; combobox + listbox (`aria-activedescendant`, the active option scrolls into view), groups with headings, highlights, `Kbd` hints, honest empty state ("Nichts gefunden" + what to try) |
| `GlobalSearchHost.tsx` | lazy host (see above) |
| `glyphs.tsx` | the per-kind glyphs |

## Effects (120-Hz rules)

- Open: a light variant of the pulse `FullscreenWipe` (`CONFIG` in `GlobalSearch.tsx`): a signal-red curtain wipes
  across the panel (transform only), the panel follows; the curtain is removed once the open has settled. Reduced
  motion: an opacity fade. No blur under `data-safe-fx`.
- Results: `StaggerItem` rows; on the FIRST open the "Stärkste zuerst" titles run a `TextScramble` once; the active row
  carries the shared `HoverPill` (`layoutId="hover-search"`).
- All decor is `aria-hidden`; the overlay announces nothing itself (ToastIsland stays the only `aria-live`).

## Tests

`tests/unit/search.fuzzy.test.ts`, `search.index.test.ts`, `search.overlay.test.tsx` (combobox semantics, filter,
arrows, Enter runs after the exit, Escape); e2e `tests/e2e/search.spec.ts` (dev harness `/dev/ux.html`, mobile +
desktop) and `tests/e2e/a11y.spec.ts` (axe, dark + light; the rule `scrollable-region-focusable` is off for the result
list only – it scrolls through the combobox by design).
